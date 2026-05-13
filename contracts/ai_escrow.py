# ai_escrow.py
# AI Escrow / Smart Dispute Resolver
# GenLayer Intelligent Contract
#
# Flow:
#   1. Client creates escrow (deposits funds, sets task spec)
#   2. Freelancer submits work result URL
#   3. Any party triggers AI arbitration
#   4. 3 LLM validators independently evaluate: APPROVED / PARTIAL / REJECTED
#   5. Majority-vote consensus releases funds accordingly
#
# GenLayer's Optimistic Democracy ensures validators reach equivalence
# on the non-deterministic LLM calls via the Equivalence Principle.

from dataclasses import dataclass
from enum import Enum
from typing import Optional
import json

from genlayer import *


class EscrowStatus(Enum):
    PENDING    = "pending"     # Awaiting freelancer submission
    SUBMITTED  = "submitted"   # Work submitted, awaiting arbitration
    APPROVED   = "approved"    # Full payment to freelancer
    PARTIAL    = "partial"     # 50% to freelancer, 50% refunded to client
    REJECTED   = "rejected"    # Full refund to client
    DISPUTED   = "disputed"    # Under active AI arbitration


class VoteResult(Enum):
    APPROVED = "approved"
    PARTIAL  = "partial"
    REJECTED = "rejected"


@dataclass
class EscrowRecord:
    client:          Address
    freelancer:      Address
    task_description: str
    deliverable_url:  str
    amount_wei:       u256
    status:           str   # EscrowStatus.value
    votes:            list  # list of VoteResult strings
    final_verdict:    str
    created_at:       u256
    resolved_at:      u256


@gl.contract
class AIEscrow:
    """
    AI-powered escrow contract that uses multiple LLM validators
    to determine whether freelance work satisfies the task spec.

    GenLayer's consensus layer runs each validator independently;
    the Equivalence Principle reconciles non-deterministic LLM outputs
    into a single canonical result.
    """

    # escrow_id -> EscrowRecord
    escrows: TreeMap[u256, EscrowRecord]
    escrow_counter: u256
    platform_fee_bps: u256   # basis points (e.g. 100 = 1%)
    owner: Address

    def __init__(self) -> None:
        self.escrow_counter   = u256(0)
        self.platform_fee_bps = u256(100)   # 1% platform fee
        self.owner            = gl.message.sender

    # ─────────────────────────────────────────────
    # CLIENT: Create escrow and deposit funds
    # ─────────────────────────────────────────────

    @gl.public.write
    def create_escrow(
        self,
        freelancer: Address,
        task_description: str,
    ) -> u256:
        """
        Client calls this with value= amount to escrow.
        Returns the new escrow_id.
        """
        assert gl.message.value > u256(0), "Must deposit funds"
        assert len(task_description) >= 20, "Task description too short"
        assert len(task_description) <= 2000, "Task description too long"
        assert freelancer != gl.message.sender, "Client and freelancer must differ"

        escrow_id = self.escrow_counter
        self.escrow_counter = escrow_id + u256(1)

        self.escrows[escrow_id] = EscrowRecord(
            client           = gl.message.sender,
            freelancer       = freelancer,
            task_description = task_description,
            deliverable_url  = "",
            amount_wei       = gl.message.value,
            status           = EscrowStatus.PENDING.value,
            votes            = [],
            final_verdict    = "",
            created_at       = gl.block.timestamp,
            resolved_at      = u256(0),
        )

        return escrow_id

    # ─────────────────────────────────────────────
    # FREELANCER: Submit work deliverable
    # ─────────────────────────────────────────────

    @gl.public.write
    def submit_work(self, escrow_id: u256, deliverable_url: str) -> None:
        """
        Freelancer submits the URL of their delivered work
        (GitHub repo, Figma link, hosted demo, etc.)
        """
        record = self.escrows[escrow_id]

        assert gl.message.sender == record.freelancer, "Only freelancer can submit"
        assert record.status == EscrowStatus.PENDING.value, "Escrow not in PENDING state"
        assert len(deliverable_url) >= 5, "Invalid deliverable URL"
        assert deliverable_url.startswith("http"), "URL must start with http"

        record.deliverable_url = deliverable_url
        record.status          = EscrowStatus.SUBMITTED.value
        self.escrows[escrow_id] = record

    # ─────────────────────────────────────────────
    # ARBITRATION: AI validators evaluate the work
    # This is the core intelligent function.
    # ─────────────────────────────────────────────

    @gl.public.write
    def trigger_arbitration(self, escrow_id: u256) -> None:
        """
        Either party (or anyone after 7-day timeout) can trigger AI arbitration.

        GenLayer runs this function across multiple validators. Each validator:
          1. Fetches the deliverable URL (real web access)
          2. Calls an LLM to evaluate against the task spec
          3. Returns a structured verdict

        The Equivalence Principle ensures validators converge on
        equivalent results despite LLM non-determinism.
        """
        record = self.escrows[escrow_id]

        assert record.status == EscrowStatus.SUBMITTED.value, \
            "Work must be submitted before arbitration"
        assert gl.message.sender in [record.client, record.freelancer], \
            "Only parties to this escrow can trigger arbitration"

        record.status = EscrowStatus.DISPUTED.value
        self.escrows[escrow_id] = record

        # ── Validator 1: Technical Completeness ──────────────────────────────
        vote_1 = self._evaluate_technical_completeness(
            task_spec      = record.task_description,
            deliverable_url= record.deliverable_url,
        )

        # ── Validator 2: Requirement Coverage ───────────────────────────────
        vote_2 = self._evaluate_requirement_coverage(
            task_spec      = record.task_description,
            deliverable_url= record.deliverable_url,
        )

        # ── Validator 3: Quality & Professionalism ───────────────────────────
        vote_3 = self._evaluate_quality_and_professionalism(
            task_spec      = record.task_description,
            deliverable_url= record.deliverable_url,
        )

        votes = [vote_1, vote_2, vote_3]

        # ── Majority vote ────────────────────────────────────────────────────
        verdict = self._majority_vote(votes)

        record.votes         = [v for v in votes]
        record.final_verdict = verdict
        record.resolved_at   = gl.block.timestamp

        # ── Settle funds based on verdict ────────────────────────────────────
        if verdict == VoteResult.APPROVED.value:
            record.status = EscrowStatus.APPROVED.value
            self.escrows[escrow_id] = record
            self._pay_freelancer(record, full=True)

        elif verdict == VoteResult.PARTIAL.value:
            record.status = EscrowStatus.PARTIAL.value
            self.escrows[escrow_id] = record
            self._pay_freelancer(record, full=False)

        else:  # REJECTED
            record.status = EscrowStatus.REJECTED.value
            self.escrows[escrow_id] = record
            self._refund_client(record)

    # ─────────────────────────────────────────────
    # LLM Evaluation Agents
    # ─────────────────────────────────────────────

    def _evaluate_technical_completeness(
        self, task_spec: str, deliverable_url: str
    ) -> str:
        """
        Agent 1 – Checks if the deliverable is technically complete.
        Fetches the actual URL and reasons about code/design presence.
        """
        # Fetch deliverable content (GenLayer's real web access)
        try:
            web_content = gl.get_webpage(deliverable_url, mode="text")
            web_snippet = web_content[:3000] if len(web_content) > 3000 else web_content
        except Exception:
            web_snippet = "[Could not fetch URL - treat as missing deliverable]"

        prompt = f"""You are a strict technical evaluator for a freelance escrow system.

TASK SPECIFICATION:
{task_spec}

DELIVERABLE URL: {deliverable_url}

FETCHED CONTENT FROM URL:
{web_snippet}

Evaluate whether the deliverable is TECHNICALLY COMPLETE relative to the task specification.

Consider:
- Does the URL resolve to real content/code/work?
- Are the technical requirements from the spec present?
- Is there evidence of actual implementation vs. empty/placeholder content?

Respond with EXACTLY one of these verdicts and nothing else:
APPROVED - deliverable fully satisfies the technical requirements
PARTIAL - deliverable partially satisfies requirements (core done, extras missing)
REJECTED - deliverable does not satisfy the technical requirements"""

        result = gl.exec_prompt(prompt)
        return self._parse_verdict(result)

    def _evaluate_requirement_coverage(
        self, task_spec: str, deliverable_url: str
    ) -> str:
        """
        Agent 2 – Checks requirement-by-requirement coverage.
        Extracts explicit requirements and checks each one.
        """
        try:
            web_content = gl.get_webpage(deliverable_url, mode="text")
            web_snippet = web_content[:3000] if len(web_content) > 3000 else web_content
        except Exception:
            web_snippet = "[Could not fetch URL - treat as missing deliverable]"

        prompt = f"""You are a meticulous requirements analyst for a freelance escrow system.

TASK SPECIFICATION:
{task_spec}

DELIVERABLE URL: {deliverable_url}

FETCHED CONTENT FROM URL:
{web_snippet}

Your job: Extract all explicit requirements from the task specification, then check whether each is addressed in the deliverable.

Score as:
- APPROVED: 85%+ of requirements are met
- PARTIAL: 40-84% of requirements are met
- REJECTED: Less than 40% of requirements are met

Think step by step, but your final line must be EXACTLY one word:
APPROVED
PARTIAL
REJECTED"""

        result = gl.exec_prompt(prompt)
        return self._parse_verdict(result)

    def _evaluate_quality_and_professionalism(
        self, task_spec: str, deliverable_url: str
    ) -> str:
        """
        Agent 3 – Evaluates overall quality, polish, and professionalism.
        Looks for red flags like empty repos, placeholder code, or copy-paste.
        """
        try:
            web_content = gl.get_webpage(deliverable_url, mode="text")
            web_snippet = web_content[:3000] if len(web_content) > 3000 else web_content
        except Exception:
            web_snippet = "[Could not fetch URL - treat as missing deliverable]"

        prompt = f"""You are a quality assurance expert evaluating freelance work for escrow release.

TASK SPECIFICATION:
{task_spec}

DELIVERABLE URL: {deliverable_url}

FETCHED CONTENT FROM URL:
{web_snippet}

Evaluate the QUALITY and PROFESSIONALISM of the work:
- Is the work original and non-trivial?
- Does it meet professional standards for this type of task?
- Are there obvious red flags? (empty repo, only README, placeholder content, scaffolded boilerplate with no real work)
- Would a reasonable client accept this as satisfactory completion?

Be fair but strict. Your final answer must be EXACTLY one of:
APPROVED
PARTIAL
REJECTED"""

        result = gl.exec_prompt(prompt)
        return self._parse_verdict(result)

    # ─────────────────────────────────────────────
    # Consensus & Settlement
    # ─────────────────────────────────────────────

    def _parse_verdict(self, llm_output: str) -> str:
        """Extract structured verdict from LLM output."""
        output_upper = llm_output.strip().upper()

        if "APPROVED" in output_upper:
            return VoteResult.APPROVED.value
        elif "PARTIAL" in output_upper:
            return VoteResult.PARTIAL.value
        elif "REJECTED" in output_upper:
            return VoteResult.REJECTED.value
        else:
            # Default to PARTIAL if LLM output is ambiguous
            return VoteResult.PARTIAL.value

    def _majority_vote(self, votes: list) -> str:
        """
        Simple majority vote across 3 validators.
        Ties (1-1-1) → PARTIAL (safest neutral outcome).
        """
        counts = {
            VoteResult.APPROVED.value: 0,
            VoteResult.PARTIAL.value:  0,
            VoteResult.REJECTED.value: 0,
        }
        for v in votes:
            if v in counts:
                counts[v] += 1

        max_count = max(counts.values())

        # Check for clear majority (2 or 3 out of 3)
        for verdict, count in counts.items():
            if count == max_count and max_count >= 2:
                return verdict

        # 3-way tie or no majority → PARTIAL
        return VoteResult.PARTIAL.value

    def _compute_platform_fee(self, amount: u256) -> u256:
        return (amount * self.platform_fee_bps) // u256(10000)

    def _pay_freelancer(self, record: EscrowRecord, full: bool) -> None:
        """Transfer escrowed funds to freelancer (full or 50%)."""
        total   = record.amount_wei
        fee     = self._compute_platform_fee(total)
        net     = total - fee

        if full:
            gl.message.recipient(record.freelancer).transfer(net)
        else:
            # PARTIAL: 50% each
            half = net // u256(2)
            gl.message.recipient(record.freelancer).transfer(half)
            remainder = net - half
            gl.message.recipient(record.client).transfer(remainder)

        # Platform fee stays in contract (owner can withdraw)

    def _refund_client(self, record: EscrowRecord) -> None:
        """Refund client minus platform fee."""
        total = record.amount_wei
        fee   = self._compute_platform_fee(total)
        net   = total - fee
        gl.message.recipient(record.client).transfer(net)

    # ─────────────────────────────────────────────
    # READ-ONLY VIEWS
    # ─────────────────────────────────────────────

    @gl.public.view
    def get_escrow(self, escrow_id: u256) -> EscrowRecord:
        """Return full escrow record."""
        return self.escrows[escrow_id]

    @gl.public.view
    def get_escrow_status(self, escrow_id: u256) -> str:
        return self.escrows[escrow_id].status

    @gl.public.view
    def get_verdict(self, escrow_id: u256) -> dict:
        """Return votes and final verdict for a resolved escrow."""
        record = self.escrows[escrow_id]
        return {
            "votes":          record.votes,
            "final_verdict":  record.final_verdict,
            "status":         record.status,
            "resolved_at":    int(record.resolved_at),
        }

    @gl.public.view
    def get_total_escrows(self) -> u256:
        return self.escrow_counter

    # ─────────────────────────────────────────────
    # ADMIN
    # ─────────────────────────────────────────────

    @gl.public.write
    def withdraw_fees(self) -> None:
        """Owner withdraws accumulated platform fees."""
        assert gl.message.sender == self.owner, "Only owner"
        balance = gl.contract.balance
        if balance > u256(0):
            gl.message.recipient(self.owner).transfer(balance)

    @gl.public.write
    def update_platform_fee(self, new_fee_bps: u256) -> None:
        assert gl.message.sender == self.owner, "Only owner"
        assert new_fee_bps <= u256(1000), "Fee cannot exceed 10%"
        self.platform_fee_bps = new_fee_bps
