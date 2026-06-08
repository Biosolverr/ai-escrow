# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# ═══════════════════════════════════════════════════════════════
# AI Escrow — Intelligent Contract
# ═══════════════════════════════════════════════════════════════

import typing
import datetime
from genlayer import *
from dataclasses import dataclass
from enum import Enum


class EscrowStatus(Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    RESOLVED = "resolved"       # вердикт есть, окно диспута ещё открыто
    DISPUTED = "disputed"       # диспут открыт, деньги заморожены
    APPROVED = "approved"       # финал: фрилансер получил деньги
    PARTIAL = "partial"         # финал: деньги поделены
    REJECTED = "rejected"       # финал: клиент получил деньги
    CLAIMED = "claimed"         # claim_payment вызван после окна


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
    created_at: u256
    resolved_at: u256
    dispute_window_seconds: u256   # окно диспута, задаётся при создании


class AIEscrow(gl.Contract):
    """AI Escrow with 3 LLM validators and configurable dispute window"""

    escrows: TreeMap[u256, EscrowRecord]
    escrow_counter: u256
    platform_fee_bps: u256
    owner: Address

    def __init__(self):
        self.escrow_counter = u256(0)
        self.platform_fee_bps = u256(100)  # 1%
        self.owner = gl.message.sender_address

    # ── internal payout ──────────────────────────────────────────────────────

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

    # ── LLM arbitration (shared logic) ───────────────────────────────────────

    def _run_arbitration(self, task_description: str, deliverable_url: str, is_dispute: bool) -> dict:
        dispute_note = "This is a DISPUTED case — evaluate carefully.\n" if is_dispute else ""

        def leader_fn():
            prompt_template = (
                "You are an impartial arbitrator evaluating a freelance deliverable.\n\n"
                "TASK DESCRIPTION:\n{task}\n\n"
                "DELIVERABLE URL:\n{url}\n\n"
                "{note}"
                "Respond with exactly one word: APPROVED, PARTIAL, or REJECTED.\n"
                "- APPROVED: deliverable fully meets requirements\n"
                "- PARTIAL: deliverable partially meets requirements\n"
                "- REJECTED: deliverable clearly does not meet requirements\n\n"
                "Your verdict:"
            )
            votes = []
            for _ in range(3):
                prompt = prompt_template.format(
                    task=task_description, url=deliverable_url, note=dispute_note
                )
                raw = gl.nondet.exec_prompt(prompt)
                upper = raw.strip().upper()
                if "APPROVED" in upper:
                    votes.append("approved")
                elif "REJECTED" in upper:
                    votes.append("rejected")
                else:
                    votes.append("partial")

            counts = {"approved": 0, "partial": 0, "rejected": 0}
            for v in votes:
                counts[v] += 1
            max_count = max(counts.values())
            verdict = "partial"
            for v, c in counts.items():
                if c == max_count and max_count >= 2:
                    verdict = v
                    break
            return {"votes": votes, "verdict": verdict}

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            leaders_verdict = leaders_res.calldata["verdict"]
            prompt_template = (
                "You are an impartial arbitrator evaluating a freelance deliverable.\n\n"
                "TASK DESCRIPTION:\n{task}\n\n"
                "DELIVERABLE URL:\n{url}\n\n"
                "{note}"
                "Respond with exactly one word: APPROVED, PARTIAL, or REJECTED.\n"
                "- APPROVED: deliverable fully meets requirements\n"
                "- PARTIAL: deliverable partially meets requirements\n"
                "- REJECTED: deliverable clearly does not meet requirements\n\n"
                "Your verdict:"
            )
            votes = []
            for _ in range(3):
                prompt = prompt_template.format(
                    task=task_description, url=deliverable_url, note=dispute_note
                )
                raw = gl.nondet.exec_prompt(prompt)
                upper = raw.strip().upper()
                if "APPROVED" in upper:
                    votes.append("approved")
                elif "REJECTED" in upper:
                    votes.append("rejected")
                else:
                    votes.append("partial")

            counts = {"approved": 0, "partial": 0, "rejected": 0}
            for v in votes:
                counts[v] += 1
            max_count = max(counts.values())
            my_verdict = "partial"
            for v, c in counts.items():
                if c == max_count and max_count >= 2:
                    my_verdict = v
                    break
            return my_verdict == leaders_verdict

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    # ── write methods ─────────────────────────────────────────────────────────

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
            [],
            "",
            u256(int(datetime.datetime.now().timestamp())),
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
        """LLM арбитраж. Деньги НЕ выплачиваются — ждём окна диспута."""
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.SUBMITTED.value, "Deliverable not submitted"
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
            or gl.message.sender_address == self.owner
        ), "Not authorized to resolve"

        result = self._run_arbitration(
            record.task_description, record.deliverable_url, is_dispute=False
        )

        record.votes = result["votes"]
        record.final_verdict = result["verdict"]
        record.resolved_at = u256(int(datetime.datetime.now().timestamp()))
        record.status = EscrowStatus.RESOLVED.value  # деньги заморожены, окно открыто
        self.escrows[escrow_id] = record
        return result["verdict"]

    @gl.public.write
    def dispute_escrow(self, escrow_id: u256) -> None:
        """Открыть диспут пока окно не истекло."""
        record = self.escrows[escrow_id]
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
        ), "Only parties can dispute"
        assert record.status == EscrowStatus.RESOLVED.value, "Can only dispute a resolved escrow"

        now = u256(int(datetime.datetime.now().timestamp()))
        assert now <= record.resolved_at + record.dispute_window_seconds, "Dispute window expired"

        record.status = EscrowStatus.DISPUTED.value
        self.escrows[escrow_id] = record

    @gl.public.write
    def re_resolve_escrow(self, escrow_id: u256) -> str:
        """Повторный LLM арбитраж после диспута. Выплачивает деньги финально."""
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.DISPUTED.value, "Escrow not in DISPUTED state"
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
            or gl.message.sender_address == self.owner
        ), "Not authorized to re-resolve"

        result = self._run_arbitration(
            record.task_description, record.deliverable_url, is_dispute=True
        )

        verdict = result["verdict"]
        record.votes = result["votes"]
        record.final_verdict = verdict
        record.resolved_at = u256(int(datetime.datetime.now().timestamp()))

        if verdict == "approved":
            record.status = EscrowStatus.APPROVED.value
        elif verdict == "partial":
            record.status = EscrowStatus.PARTIAL.value
        else:
            record.status = EscrowStatus.REJECTED.value

        self.escrows[escrow_id] = record
        self._payout(record, verdict)  # финальная выплата
        return verdict

    @gl.public.write
    def claim_payment(self, escrow_id: u256) -> str:
        """Забрать деньги после истечения окна диспута (если диспута не было)."""
        record = self.escrows[escrow_id]
        assert record.status == EscrowStatus.RESOLVED.value, "Nothing to claim"

        now = u256(int(datetime.datetime.now().timestamp()))
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

    # ── view methods ──────────────────────────────────────────────────────────

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
            "votes": list(record.votes),
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
            "votes": list(record.votes),
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

