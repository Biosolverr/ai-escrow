# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# ===================================================================
# AI Escrow -- Intelligent Contract
# ===================================================================

import typing
import datetime
from genlayer import *
from dataclasses import dataclass
from enum import Enum


class EscrowStatus(Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    RESOLVED = "resolved"       # verdict exists, dispute window still open
    DISPUTED = "disputed"       # dispute opened, funds frozen
    APPROVED = "approved"       # final: freelancer gets paid
    PARTIAL = "partial"         # final: funds split
    REJECTED = "rejected"       # final: client gets refund
    CLAIMED = "claimed"         # claim_payment called after window expired


def _tx_timestamp() -> u256:
    """
    Deterministic transaction timestamp -- same value on leader and every
    validator because it comes from the consensus-agreed message context,
    NOT from the local wall clock.

    gl.message_raw["datetime"] is a str in ISO-8601 format, e.g.
    "2024-06-17T12:34:56+00:00" or "2024-06-17T12:34:56Z".
    Python >= 3.11 accepts the 'Z' suffix in fromisoformat; we normalise it
    anyway for safety.
    """
    raw_dt: str = gl.message_raw["datetime"]
    normalised = raw_dt.replace("Z", "+00:00")
    dt = datetime.datetime.fromisoformat(normalised)
    return u256(int(dt.timestamp()))


@allow_storage
@dataclass
class EscrowRecord:
    client: Address
    freelancer: Address
    task_description: str
    deliverable_url: str
    amount_wei: u256
    status: str
    final_verdict: str
    created_at: u256
    resolved_at: u256
    dispute_window_seconds: u256   # configurable dispute window


class AIEscrow(gl.Contract):
    """AI Escrow with LLM-based arbitration, web-content fetching, and a
    configurable dispute window.  Timestamps are derived from the
    consensus-agreed transaction context so every validator agrees.

    Arbitration uses gl.eq_principle.strict_eq(): the leader fetches the
    deliverable and asks an LLM for a verdict; every validator
    independently re-fetches the URL and re-asks the LLM, then GenVM
    compares the two canonical verdict strings exactly. Because the
    verdict is already normalised down to "approved" / "partial" /
    "rejected" before comparison, an exact-match check is the correct
    and cheapest equivalence principle here -- a mismatch means a genuine
    disagreement about the outcome, not just a wording difference."""

    escrows: TreeMap[u256, EscrowRecord]
    escrow_counter: u256
    platform_fee_bps: u256
    owner: Address

    def __init__(self):
        self.escrow_counter = u256(0)
        self.platform_fee_bps = u256(100)  # 1 %
        self.owner = gl.message.sender_address

    # -- internal payout --------------------------------------------------------

    def _payout(self, record: EscrowRecord, verdict: str) -> None:
        amount_wei = record.amount_wei
        fee = (amount_wei * self.platform_fee_bps) // u256(10000)
        net = amount_wei - fee

        if verdict == "approved":
            gl.get_contract_at(record.freelancer).emit(value=net).__receive__()
        elif verdict == "partial":
            half = net // u256(2)
            remainder = net - half
            gl.get_contract_at(record.freelancer).emit(value=half).__receive__()
            gl.get_contract_at(record.client).emit(value=remainder).__receive__()
        else:  # rejected
            gl.get_contract_at(record.client).emit(value=net).__receive__()

        if fee > u256(0):
            gl.get_contract_at(self.owner).emit(value=fee).__receive__()

    # -- LLM arbitration ----------------------------------------------------------

    def _run_arbitration(
        self, task_description: str, deliverable_url: str, is_dispute: bool
    ) -> str:
        dispute_note = (
            "This is a DISPUTED case -- evaluate especially carefully.\n"
            if is_dispute
            else ""
        )

        def get_verdict() -> str:
            # -- Fetch actual deliverable content via GenLayer web access --
            deliverable_content = gl.nondet.web.render(deliverable_url, mode="text")
            content_excerpt = (
                deliverable_content[:4000] if deliverable_content else "(could not fetch content)"
            )

            prompt = (
                "You are an impartial arbitrator evaluating a freelance deliverable.\n\n"
                f"TASK DESCRIPTION:\n{task_description}\n\n"
                f"DELIVERABLE URL:\n{deliverable_url}\n\n"
                f"DELIVERABLE CONTENT (fetched from URL):\n{content_excerpt}\n\n"
                f"{dispute_note}"
                "Based on the task description AND the actual fetched content above, "
                "respond with exactly one word: APPROVED, PARTIAL, or REJECTED.\n"
                "- APPROVED: deliverable fully meets requirements\n"
                "- PARTIAL: deliverable partially meets requirements\n"
                "- REJECTED: deliverable clearly does not meet requirements\n\n"
                "Your verdict:"
            )
            raw = gl.nondet.exec_prompt(prompt)
            upper = raw.strip().upper()
            if "APPROVED" in upper:
                return "approved"
            elif "REJECTED" in upper:
                return "rejected"
            else:
                return "partial"

        # Leader runs get_verdict() once; every validator independently
        # re-runs the exact same function (own fetch, own LLM call) and
        # GenVM checks the two canonical strings for exact equality.
        return gl.eq_principle.strict_eq(get_verdict)

    # -- write methods --------------------------------------------------------------

    @gl.public.write.payable
    def create_escrow(
        self,
        freelancer: str,
        task_description: str,
        dispute_window_seconds: u256,
    ) -> u256:
        assert gl.message.value > u256(0), "Must deposit funds"
        assert 20 <= len(task_description) <= 2000, "Invalid task description length"
        assert dispute_window_seconds >= u256(60), "Dispute window must be at least 60 seconds"
        freelancer_addr = Address(freelancer)
        assert freelancer_addr != gl.message.sender_address, "Client and freelancer must differ"

        escrow_id = self.escrow_counter
        self.escrow_counter = escrow_id + u256(1)

        record = gl.storage.inmem_allocate(
            EscrowRecord,
            gl.message.sender_address,
            freelancer_addr,
            task_description,
            "",
            gl.message.value,
            EscrowStatus.PENDING.value,
            "",
            _tx_timestamp(),   # <- deterministic consensus timestamp
            u256(0),
            dispute_window_seconds,
        )
        self.escrows[escrow_id] = record
        return escrow_id

    @gl.public.write
    def submit_deliverable(self, escrow_id: u256, deliverable_url: str) -> None:
        record = self.escrows[escrow_id]
        assert gl.message.sender_address == record.freelancer, "Only freelancer can submit"
        assert record.status == EscrowStatus.PENDING.value, "Escrow not in PENDING state"
        assert len(deliverable_url) > 0, "Deliverable URL required"

        record.deliverable_url = deliverable_url
        record.status = EscrowStatus.SUBMITTED.value
        self.escrows[escrow_id] = record

    @gl.public.write
    def resolve_escrow(self, escrow_id: u256) -> str:
        """LLM arbitration.  Fetches deliverable via gl.nondet.web.render().
        Funds are NOT paid out yet -- dispute window opens first."""
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.SUBMITTED.value, "Deliverable not submitted"
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
            or gl.message.sender_address == self.owner
        ), "Not authorized to resolve"

        verdict = self._run_arbitration(
            record.task_description, record.deliverable_url, is_dispute=False
        )

        record.final_verdict = verdict
        record.resolved_at = _tx_timestamp()   # <- deterministic consensus timestamp
        record.status = EscrowStatus.RESOLVED.value
        self.escrows[escrow_id] = record
        return verdict

    @gl.public.write
    def dispute_escrow(self, escrow_id: u256) -> None:
        """Open a dispute while the window is still open."""
        record = self.escrows[escrow_id]
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
        ), "Only parties can dispute"
        assert record.status == EscrowStatus.RESOLVED.value, "Can only dispute a resolved escrow"

        now = _tx_timestamp()   # <- deterministic consensus timestamp
        assert now <= record.resolved_at + record.dispute_window_seconds, "Dispute window expired"

        record.status = EscrowStatus.DISPUTED.value
        self.escrows[escrow_id] = record

    @gl.public.write
    def re_resolve_escrow(self, escrow_id: u256) -> str:
        """Second LLM arbitration after a dispute.  Final payout is executed."""
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.DISPUTED.value, "Escrow not in DISPUTED state"
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
            or gl.message.sender_address == self.owner
        ), "Not authorized to re-resolve"

        verdict = self._run_arbitration(
            record.task_description, record.deliverable_url, is_dispute=True
        )

        record.final_verdict = verdict
        record.resolved_at = _tx_timestamp()   # <- deterministic consensus timestamp

        if verdict == "approved":
            record.status = EscrowStatus.APPROVED.value
        elif verdict == "partial":
            record.status = EscrowStatus.PARTIAL.value
        else:
            record.status = EscrowStatus.REJECTED.value

        self.escrows[escrow_id] = record
        self._payout(record, verdict)
        return verdict

    @gl.public.write
    def claim_payment(self, escrow_id: u256) -> str:
        """Claim funds after the dispute window expires without a dispute."""
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.RESOLVED.value, "Nothing to claim"

        now = _tx_timestamp()   # <- deterministic consensus timestamp
        assert now > record.resolved_at + record.dispute_window_seconds, "Dispute window still open"

        verdict = record.final_verdict
        if verdict == "approved":
            record.status = EscrowStatus.APPROVED.value
        elif verdict == "partial":
            record.status = EscrowStatus.PARTIAL.value
        else:
            record.status = EscrowStatus.REJECTED.value

        self.escrows[escrow_id] = record
        self._payout(record, verdict)
        return verdict

    # -- view methods --------------------------------------------------------------

    @gl.public.view
    def get_escrow(self, escrow_id: u256) -> typing.Any:
        record = self.escrows[escrow_id]
        return {
            "client": str(record.client),
            "freelancer": str(record.freelancer),
            "task_description": record.task_description,
            "deliverable_url": record.deliverable_url,
            "amount_wei": int(record.amount_wei),
            "status": record.status,
            "final_verdict": record.final_verdict,
            "created_at": int(record.created_at),
            "resolved_at": int(record.resolved_at),
            "dispute_window_seconds": int(record.dispute_window_seconds),
        }

    @gl.public.view
    def get_total_escrows(self) -> u256:
        return self.escrow_counter

    @gl.public.view
    def get_verdict(self, escrow_id: u256) -> typing.Any:
        record = self.escrows[escrow_id]
        return {
            "final_verdict": record.final_verdict,
            "status": record.status,
            "resolved_at": int(record.resolved_at),
        }

    @gl.public.view
    def get_platform_fee_bps(self) -> u256:
        return self.platform_fee_bps

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner)


