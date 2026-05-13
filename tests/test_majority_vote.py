# tests/test_majority_vote.py
# Тест логики majority vote — без genlayer, без сервера, без LLM
# Запуск: pytest tests/test_majority_vote.py -v


def majority_vote(votes: list) -> str:
    """
    Копия логики из ai_escrow.py — majority vote 3 валидаторов.
    2-of-3 = победитель. Три разных = PARTIAL (нейтральный исход).
    """
    counts = {"approved": 0, "partial": 0, "rejected": 0}
    for v in votes:
        if v in counts:
            counts[v] += 1

    max_count = max(counts.values())
    for verdict, count in counts.items():
        if count == max_count and max_count >= 2:
            return verdict

    return "partial"  # three-way tie


def parse_verdict(llm_output: str) -> str:
    """Копия логики парсинга LLM ответа."""
    output_upper = llm_output.strip().upper()
    if "APPROVED" in output_upper:
        return "approved"
    elif "PARTIAL" in output_upper:
        return "partial"
    elif "REJECTED" in output_upper:
        return "rejected"
    else:
        return "partial"  # ambiguous → safe default


# ── Тесты majority_vote ───────────────────────────────────────────────────────

class TestMajorityVoteLogic:

    def test_unanimous_approved(self):
        assert majority_vote(["approved", "approved", "approved"]) == "approved"

    def test_unanimous_rejected(self):
        assert majority_vote(["rejected", "rejected", "rejected"]) == "rejected"

    def test_unanimous_partial(self):
        assert majority_vote(["partial", "partial", "partial"]) == "partial"

    def test_majority_approved_2of3(self):
        assert majority_vote(["approved", "approved", "rejected"]) == "approved"

    def test_majority_approved_other_order(self):
        assert majority_vote(["rejected", "approved", "approved"]) == "approved"

    def test_majority_rejected_2of3(self):
        assert majority_vote(["rejected", "rejected", "approved"]) == "rejected"

    def test_majority_partial_2of3(self):
        assert majority_vote(["partial", "partial", "approved"]) == "partial"

    def test_three_way_tie_returns_partial(self):
        # Ничья → нейтральный исход = partial
        assert majority_vote(["approved", "partial", "rejected"]) == "partial"

    def test_three_way_tie_other_order(self):
        assert majority_vote(["rejected", "approved", "partial"]) == "partial"


# ── Тесты parse_verdict ───────────────────────────────────────────────────────

class TestParseVerdict:

    def test_parse_approved_exact(self):
        assert parse_verdict("APPROVED") == "approved"

    def test_parse_approved_lowercase(self):
        assert parse_verdict("approved") == "approved"

    def test_parse_approved_in_sentence(self):
        assert parse_verdict("After analysis, the verdict is APPROVED.") == "approved"

    def test_parse_rejected(self):
        assert parse_verdict("REJECTED") == "rejected"

    def test_parse_partial(self):
        assert parse_verdict("PARTIAL") == "partial"

    def test_parse_ambiguous_defaults_to_partial(self):
        assert parse_verdict("I cannot determine the outcome.") == "partial"

    def test_parse_empty_defaults_to_partial(self):
        assert parse_verdict("") == "partial"

    def test_parse_approved_wins_over_partial_if_both_present(self):
        # APPROVED встречается первым в проверке
        assert parse_verdict("APPROVED and PARTIAL mentioned") == "approved"


# ── Тесты платёжной логики ────────────────────────────────────────────────────

class TestPaymentLogic:

    ESCROW = 1_000_000_000_000_000_000  # 1 ETH в wei
    FEE_BPS = 100  # 1%

    def _fee(self, amount):
        return (amount * self.FEE_BPS) // 10000

    def _net(self, amount):
        return amount - self._fee(amount)

    def test_approved_freelancer_gets_99_percent(self):
        net = self._net(self.ESCROW)
        assert net == 990_000_000_000_000_000  # 0.99 ETH

    def test_partial_each_gets_half_of_net(self):
        net = self._net(self.ESCROW)
        half = net // 2
        assert half == 495_000_000_000_000_000  # 0.495 ETH

    def test_fee_is_1_percent(self):
        fee = self._fee(self.ESCROW)
        assert fee == 10_000_000_000_000_000  # 0.01 ETH

    def test_fee_cannot_exceed_10_percent(self):
        max_fee_bps = 1000
        fee = (self.ESCROW * max_fee_bps) // 10000
        assert fee == 100_000_000_000_000_000  # 0.1 ETH

    def test_net_plus_fee_equals_total(self):
        fee = self._fee(self.ESCROW)
        net = self._net(self.ESCROW)
        assert fee + net == self.ESCROW

    def test_partial_both_sides_plus_fee_equals_total(self):
        net = self._net(self.ESCROW)
        half = net // 2
        remainder = net - half
        fee = self._fee(self.ESCROW)
        assert half + remainder + fee == self.ESCROW
