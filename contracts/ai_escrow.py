# { "Depends": "py-genlayer:test" }

# ═══════════════════════════════════════════════════════════════
# AI Escrow — Intelligent Contract
# ═══════════════════════════════════════════════════════════════

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


class VoteResult(Enum):
    APPROVED = "approved"
    PARTIAL = "partial"
    REJECTED = "rejected"


@allow_storage
@dataclass
class EscrowRecord:
    client: Address
    freelancer: Address
    task_description: str
    deliverable_url: str
    amount_wei: u256
    status: str
    votes: list[str]
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
        self.owner = gl.message.sender

    @gl.public.write
    def create_escrow(self, freelancer: Address, task_description: str) -> u256:
        assert gl.message.value > u256(0), "Must deposit funds"
        assert 20 <= len(task_description) <= 2000, "Invalid task description length"
        assert freelancer != gl.message.sender, "Client and freelancer must differ"

        escrow_id = self.escrow_counter
        self.escrow_counter = escrow_id + u256(1)

        self.escrows[escrow_id] = EscrowRecord(
            client=gl.message.sender,
            freelancer=freelancer,
            task_description=task_description,
            deliverable_url="",
            amount_wei=gl.message.value,
            status=EscrowStatus.PENDING.value,
            votes=[],
            final_verdict="",
            created_at=gl.block.timestamp,
            resolved_at=u256(0),
        )
        return escrow_id

    # Добавь остальные методы позже, после того как этот вариант увидит схему
    @gl.public.view
    def get_total_escrows(self) -> u256:
        return self.escrow_counter

    @gl.public.view
    def get_verdict(self, escrow_id: u256) -> dict:
        record = self.escrows[escrow_id]
        return {
            "votes": record.votes,
            "final_verdict": record.final_verdict,
            "status": record.status,
            "resolved_at": int(record.resolved_at),
        }
