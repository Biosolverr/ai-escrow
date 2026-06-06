# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# ═══════════════════════════════════════════════════════════════
# AI Escrow — Intelligent Contract
# ═══════════════════════════════════════════════════════════════

import typing
from genlayer import *
from dataclasses import dataclass
from enum import Enum


class EscrowStatus(Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    PARTIAL = "partial"
    REJECTED = "rejected"
    DISPUTED = "disputed"


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


class AIEscrow(gl.Contract):
    """AI Escrow with 3 LLM validators"""

    escrows: TreeMap[u256, EscrowRecord]
    escrow_counter: u256
    platform_fee_bps: u256
    owner: Address

    def __init__(self):
        self.escrow_counter = u256(0)
        self.platform_fee_bps = u256(100)  # 1%
        self.owner = gl.message.sender_address

    # ── helpers ──────────────────────────────────────────────────────────────

    def _majority_vote(self, votes: list) -> str:
        counts = {"approved": 0, "partial": 0, "rejected": 0}
        for v in votes:
            if v in counts:
                counts[v] += 1
        max_count = max(counts.values())
        for verdict, count in counts.items():
            if count == max_count and max_count >= 2:
                return verdict
        return "partial"  # three-way tie → neutral

    def _parse_verdict(self, llm_output: str) -> str:
        upper = llm_output.strip().upper()
        if "APPROVED" in upper:
            return "approved"
        elif "REJECTED" in upper:
            return "rejected"
        elif "PARTIAL" in upper:
            return "partial"
        return "partial"

    # ── write methods ─────────────────────────────────────────────────────────

    @gl.public.write.payable
    def create_escrow(self, freelancer: str, task_description: str) -> u256:
        assert gl.message.value > u256(0), "Must deposit funds"
        assert 20 <= len(task_description) <= 2000, "Invalid task description length"
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
            gl.block.timestamp,
            u256(0),
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

        task_description = record.task_description
        deliverable_url = record.deliverable_url
        amount_wei = record.amount_wei

        def leader_fn():
            prompt_template = (
                "You are an impartial arbitrator evaluating a freelance deliverable.\n\n"
                "TASK DESCRIPTION:\n{task}\n\n"
                "DELIVERABLE URL:\n{url}\n\n"
                "Evaluate whether the deliverable satisfies the task description.\n"
                "Respond with exactly one word: APPROVED, PARTIAL, or REJECTED.\n"
                "- APPROVED: deliverable fully meets requirements\n"
                "- PARTIAL: deliverable partially meets requirements\n"
                "- REJECTED: deliverable clearly does not meet requirements\n\n"
                "Your verdict:"
            )
            votes = []
            for _ in range(3):
                prompt = prompt_template.format(
                    task=task_description, url=deliverable_url
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
            if isinstance(leaders_res, Exception):
                return False
            leaders_verdict = leaders_res["verdict"]

            prompt_template = (
                "You are an impartial arbitrator evaluating a freelance deliverable.\n\n"
                "TASK DESCRIPTION:\n{task}\n\n"
                "DELIVERABLE URL:\n{url}\n\n"
                "Evaluate whether the deliverable satisfies the task description.\n"
                "Respond with exactly one word: APPROVED, PARTIAL, or REJECTED.\n"
                "- APPROVED: deliverable fully meets requirements\n"
                "- PARTIAL: deliverable partially meets requirements\n"
                "- REJECTED: deliverable clearly does not meet requirements\n\n"
                "Your verdict:"
            )
            votes = []
            for _ in range(3):
                prompt = prompt_template.format(
                    task=task_description, url=deliverable_url
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

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        votes = result["votes"]
        verdict = result["verdict"]

        # All storage writes AFTER consensus (outside nondet block)
        record.votes = votes
        record.final_verdict = verdict
        record.resolved_at = gl.block.timestamp

        fee = (amount_wei * self.platform_fee_bps) // u256(10000)
        net = amount_wei - fee

        if verdict == "approved":
            record.status = EscrowStatus.APPROVED.value
            self.escrows[escrow_id] = record
            gl.message.send_tokens(record.freelancer, net)
            if fee > u256(0):
                gl.message.send_tokens(self.owner, fee)

        elif verdict == "partial":
            record.status = EscrowStatus.PARTIAL.value
            self.escrows[escrow_id] = record
            half = net // u256(2)
            remainder = net - half
            gl.message.send_tokens(record.freelancer, half)
            gl.message.send_tokens(record.client, remainder)
            if fee > u256(0):
                gl.message.send_tokens(self.owner, fee)

        else:  # rejected
            record.status = EscrowStatus.REJECTED.value
            self.escrows[escrow_id] = record
            gl.message.send_tokens(record.client, net)
            if fee > u256(0):
                gl.message.send_tokens(self.owner, fee)

        return verdict

    @gl.public.write
    def dispute_escrow(self, escrow_id: u256) -> None:
        record = self.escrows[escrow_id]
        assert (
            gl.message.sender_address == record.client
            or gl.message.sender_address == record.freelancer
        ), "Only parties can dispute"
        assert record.status in (
            EscrowStatus.APPROVED.value,
            EscrowStatus.PARTIAL.value,
            EscrowStatus.REJECTED.value,
        ), "Can only dispute a resolved escrow"
        record.status = EscrowStatus.DISPUTED.value
        self.escrows[escrow_id] = record

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
