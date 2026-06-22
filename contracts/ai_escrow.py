# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import typing
from genlayer import *
from dataclasses import dataclass
from enum import Enum
import datetime


class EscrowStatus(Enum):
    PENDING   = "pending"
    SUBMITTED = "submitted"
    RESOLVED  = "resolved"
    DISPUTED  = "disputed"
    APPROVED  = "approved"
    PARTIAL   = "partial"
    REJECTED  = "rejected"


@allow_storage
@dataclass
class EscrowRecord:
    client: Address
    freelancer: Address
    task_description: str
    deliverable_url: str
    amount_wei: u256
    status: str
    votes: DynArray[str]
    final_verdict: str
    dispute_window_seconds: u256
    resolved_at: datetime.datetime


class AIEscrow(gl.Contract):
    """AI Escrow — 3 LLM validators read deliverable via gl.nondet.web.get()"""

    escrows: TreeMap[u256, EscrowRecord]
    escrow_counter: u256
    platform_fee_bps: u256
    owner: Address

    def __init__(self):
        self.escrow_counter   = u256(0)
        self.platform_fee_bps = u256(100)
        self.owner            = gl.message.sender_address

    def _payout(self, record: EscrowRecord, verdict: str) -> None:
        fee = (record.amount_wei * self.platform_fee_bps) // u256(10000)
        net = record.amount_wei - fee
        if verdict == "approved":
            gl.get_contract_at(record.freelancer).emit_transfer(value=net)
        elif verdict == "partial":
            half = net // u256(2)
            gl.get_contract_at(record.freelancer).emit_transfer(value=half)
            gl.get_contract_at(record.client).emit_transfer(value=net - half)
        else:
            gl.get_contract_at(record.client).emit_transfer(value=net)
        if fee > u256(0):
            gl.get_contract_at(self.owner).emit_transfer(value=fee)

    def _run_arbitration(self, task_description: str, deliverable_url: str, is_dispute: bool) -> dict:
        dispute_note = "This is a DISPUTED re-arbitration — evaluate with extra care.\n" if is_dispute else ""

        def _fetch_content() -> str:
            if not deliverable_url:
                return ""
            response = gl.nondet.web.get(deliverable_url)
            body = response.body.decode("utf-8")
            return body[:4000] if body else ""

        def _vote_once(page_content: str) -> str:
            content_section = (
                "DELIVERABLE CONTENT (fetched from URL):\n" + page_content + "\n\n"
                if page_content
                else "DELIVERABLE CONTENT: (could not fetch — evaluate by URL and task description)\n\n"
            )
            prompt = (
                "You are an impartial arbitrator evaluating a freelance deliverable.\n\n"
                "TASK DESCRIPTION:\n" + task_description + "\n\n"
                "DELIVERABLE URL:\n" + deliverable_url + "\n\n"
                + content_section
                + dispute_note
                + "Respond with exactly one word — APPROVED, PARTIAL, or REJECTED.\n"
                "APPROVED = fully meets requirements\n"
                "PARTIAL  = partially meets requirements\n"
                "REJECTED = does not meet requirements\n\n"
                "Verdict:"
            )
            raw = gl.nondet.exec_prompt(prompt)
            upper = raw.strip().upper()
            if "APPROVED" in upper:
                return "approved"
            if "REJECTED" in upper:
                return "rejected"
            return "partial"

        def _majority(votes: list) -> str:
            counts = {"approved": 0, "partial": 0, "rejected": 0}
            for v in votes:
                counts[v] = counts[v] + 1
            best = "partial"
            max_c = max(counts.values())
            for v, c in counts.items():
                if c == max_c and max_c >= 2:
                    best = v
                    break
            return best

        def leader_fn():
            page_content = _fetch_content()
            votes = [_vote_once(page_content) for _ in range(3)]
            return {"votes": votes, "verdict": _majority(votes)}

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            page_content = _fetch_content()
            votes = [_vote_once(page_content) for _ in range(3)]
            return _majority(votes) == leaders_res.calldata["verdict"]

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    @gl.public.write.payable
    def create_escrow(self, freelancer: str, task_description: str, dispute_window_seconds: u256) -> u256:
        assert gl.message.value > u256(0), "Must deposit funds"
        assert 20 <= len(task_description) <= 2000, "Invalid task description length"
        assert dispute_window_seconds >= u256(60), "Dispute window must be at least 60 seconds"
        freelancer_addr = Address(freelancer)
        assert freelancer_addr != gl.message.sender_address, "Client and freelancer must differ"

        escrow_id = self.escrow_counter
        self.escrow_counter = escrow_id + u256(1)
        record = EscrowRecord(
            gl.message.sender_address,
            freelancer_addr,
            task_description,
            "",
            gl.message.value,
            EscrowStatus.PENDING.value,
            [],
            "",
            dispute_window_seconds,
            datetime.datetime.now(),
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
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.SUBMITTED.value, "Deliverable not submitted"
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
            or gl.message.sender_address == self.owner
        ), "Not authorized to resolve"

        result = self._run_arbitration(record.task_description, record.deliverable_url, is_dispute=False)
        record.votes         = result["votes"]
        record.final_verdict = result["verdict"]
        record.status        = EscrowStatus.RESOLVED.value
        record.resolved_at   = datetime.datetime.now()
        self.escrows[escrow_id] = record
        return result["verdict"]

    @gl.public.write
    def dispute_escrow(self, escrow_id: u256) -> None:
        record = self.escrows[escrow_id]
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
        ), "Only parties can dispute"
        assert record.status == EscrowStatus.RESOLVED.value, "Can only dispute a resolved escrow"
        elapsed = (datetime.datetime.now() - record.resolved_at).total_seconds()
        assert elapsed < int(record.dispute_window_seconds), "Dispute window has closed"
        record.status = EscrowStatus.DISPUTED.value
        self.escrows[escrow_id] = record

    @gl.public.write
    def re_resolve_escrow(self, escrow_id: u256) -> str:
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.DISPUTED.value, "Escrow not in DISPUTED state"
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
            or gl.message.sender_address == self.owner
        ), "Not authorized to re-resolve"

        result  = self._run_arbitration(record.task_description, record.deliverable_url, is_dispute=True)
        verdict = result["verdict"]
        record.votes         = result["votes"]
        record.final_verdict = verdict
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
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.RESOLVED.value, "Nothing to claim"
        elapsed = (datetime.datetime.now() - record.resolved_at).total_seconds()
        assert elapsed >= int(record.dispute_window_seconds), "Dispute window still open"
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

    @gl.public.view
    def get_escrow(self, escrow_id: u256) -> typing.Any:
        record = self.escrows[escrow_id]
        return {
            "client":                  str(record.client),
            "freelancer":              str(record.freelancer),
            "task_description":        record.task_description,
            "deliverable_url":         record.deliverable_url,
            "amount_wei":              int(record.amount_wei),
            "status":                  record.status,
            "votes":                   list(record.votes),
            "final_verdict":           record.final_verdict,
            "dispute_window_seconds":  int(record.dispute_window_seconds),
            "resolved_at":             record.resolved_at.isoformat(),
        }

    @gl.public.view
    def get_total_escrows(self) -> u256:
        return self.escrow_counter

    @gl.public.view
    def get_verdict(self, escrow_id: u256) -> typing.Any:
        record = self.escrows[escrow_id]
        return {
            "votes":         list(record.votes),
            "final_verdict": record.final_verdict,
            "status":        record.status,
        }

    @gl.public.view
    def get_platform_fee_bps(self) -> u256:
        return self.platform_fee_bps

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner)
