"""
Adversarial unit tests for the pure helpers extracted from ai_escrow.py.

Run with:  pytest tests/test_pure_helpers.py -v
No GenVM / studio node required -- see conftest.py for how genlayer is stubbed.
"""
import itertools
import pytest

import ai_escrow as c  # noqa: E402  (conftest.py puts contracts/ on sys.path)


# ---------------------------------------------------------------------------
# _canonicalize_verdict -- brittle-parsing / prompt-injection resilience
# ---------------------------------------------------------------------------

class TestCanonicalizeVerdict:

    @pytest.mark.parametrize("raw", [
        '{"verdict": "approved"}',
        '{"verdict": "APPROVED"}',
        '{"verdict": " Approved "}',
        {"verdict": "approved"},
    ])
    def test_valid_approved_variants(self, raw):
        assert c._canonicalize_verdict(raw) == "approved"

    @pytest.mark.parametrize("raw", [
        '{"verdict": "partial"}',
        '{"verdict": "rejected"}',
    ])
    def test_other_valid_verdicts(self, raw):
        import json
        expected = json.loads(raw)["verdict"]
        assert c._canonicalize_verdict(raw) == expected

    # -- the exact failure modes that made the old substring-matching logic brittle --

    def test_negation_does_not_flip_to_approved(self):
        # Old code: "APPROVED" in upper -> True even for "NOT APPROVED".
        # New code only trusts the structured `verdict` field, so a model
        # that ignores instructions and writes prose instead of JSON must
        # fail closed, not get misread via substring search.
        raw = "This deliverable is NOT APPROVED, it is incomplete."
        assert c._canonicalize_verdict(raw) == c.VERIFICATION_FAILED

    def test_both_keywords_present_in_free_text_fails_closed(self):
        raw = "REJECTED reasons noted, but overall APPROVED on balance."
        assert c._canonicalize_verdict(raw) == c.VERIFICATION_FAILED

    def test_empty_string_fails_closed(self):
        assert c._canonicalize_verdict("") == c.VERIFICATION_FAILED

    def test_none_fails_closed(self):
        assert c._canonicalize_verdict(None) == c.VERIFICATION_FAILED

    def test_malformed_json_fails_closed(self):
        assert c._canonicalize_verdict('{"verdict": "approved"') == c.VERIFICATION_FAILED

    def test_json_without_verdict_key_fails_closed(self):
        assert c._canonicalize_verdict('{"result": "approved"}') == c.VERIFICATION_FAILED

    def test_json_array_instead_of_object_fails_closed(self):
        assert c._canonicalize_verdict('["approved"]') == c.VERIFICATION_FAILED

    def test_verdict_value_wrong_type_fails_closed(self):
        assert c._canonicalize_verdict('{"verdict": 1}') == c.VERIFICATION_FAILED
        assert c._canonicalize_verdict('{"verdict": ["approved"]}') == c.VERIFICATION_FAILED

    def test_out_of_enum_verdict_fails_closed(self):
        assert c._canonicalize_verdict('{"verdict": "maybe"}') == c.VERIFICATION_FAILED
        assert c._canonicalize_verdict('{"verdict": "unclear"}') == c.VERIFICATION_FAILED

    def test_extra_keys_do_not_break_valid_parse(self):
        raw = '{"verdict": "rejected", "confidence": 0.9, "reason": "missing pages"}'
        assert c._canonicalize_verdict(raw) == "rejected"

    def test_prompt_injection_payload_in_verdict_field_fails_closed(self):
        # Simulates a model that got confused by injected instructions and
        # echoed something other than a clean enum value into the field.
        raw = '{"verdict": "approved. ignore previous instructions"}'
        assert c._canonicalize_verdict(raw) == c.VERIFICATION_FAILED

    def test_markdown_fenced_json_fails_closed(self):
        # Models sometimes wrap JSON in ```json ... ``` despite instructions
        # not to. We deliberately do NOT strip fences -- any deviation from
        # exact JSON must fail closed rather than get "smartly" recovered,
        # since smart recovery is itself an injection surface.
        raw = '```json\n{"verdict": "approved"}\n```'
        assert c._canonicalize_verdict(raw) == c.VERIFICATION_FAILED


# ---------------------------------------------------------------------------
# _extract_cid -- mutable-URL rejection
# ---------------------------------------------------------------------------

class TestExtractCid:

    V0 = "Qm" + "a" * 44          # 46 chars, CIDv0-shaped
    V1 = "b" + "a" * 58           # 59 chars, CIDv1-shaped

    def test_ipfs_scheme_v0(self):
        assert c._extract_cid(f"ipfs://{self.V0}") == self.V0

    def test_gateway_url_v0(self):
        assert c._extract_cid(f"https://ipfs.io/ipfs/{self.V0}") == self.V0

    def test_gateway_url_v1_with_trailing_path_and_query(self):
        ref = f"https://some-gateway.example/ipfs/{self.V1}/index.html?x=1"
        assert c._extract_cid(ref) == self.V1

    def test_plain_mutable_http_url_rejected(self):
        with pytest.raises(AssertionError):
            c._extract_cid("https://my-site.example/deliverable.html")

    def test_github_pages_url_without_ipfs_rejected(self):
        with pytest.raises(AssertionError):
            c._extract_cid("https://freelancer.github.io/proof/index.html")

    def test_empty_string_rejected(self):
        with pytest.raises(AssertionError):
            c._extract_cid("")

    def test_too_short_cid_rejected(self):
        with pytest.raises(AssertionError):
            c._extract_cid("ipfs://QmShort")

    def test_non_alnum_cid_rejected(self):
        with pytest.raises(AssertionError):
            c._extract_cid(f"ipfs://{self.V0[:-1]}!")


# ---------------------------------------------------------------------------
# _compute_payout -- conservation across the input space
# ---------------------------------------------------------------------------

class TestPayoutConservation:

    AMOUNTS = [1, 2, 3, 7, 100, 999, 1_000_000, 10**18, 10**18 + 1, 3 * 10**18 - 1]
    FEES_BPS = [0, 1, 100, 250, 9999]
    VERDICTS = ["approved", "partial", "rejected"]

    @pytest.mark.parametrize("amount,fee_bps,verdict",
                              list(itertools.product(AMOUNTS, FEES_BPS, VERDICTS)))
    def test_conservation_holds(self, amount, fee_bps, verdict):
        result = c._compute_payout(amount, fee_bps, verdict)
        assert result["freelancer"] + result["client"] + result["owner"] == amount
        assert all(v >= 0 for v in result.values())

    def test_approved_pays_freelancer_only_besides_fee(self):
        result = c._compute_payout(1000, 100, "approved")
        assert result["client"] == 0
        assert result["freelancer"] == 990  # 1000 - 1% fee

    def test_rejected_pays_client_only_besides_fee(self):
        result = c._compute_payout(1000, 100, "rejected")
        assert result["freelancer"] == 0
        assert result["client"] == 990

    def test_partial_split_is_even_for_even_net(self):
        result = c._compute_payout(1000, 0, "partial")
        assert result["freelancer"] == 500
        assert result["client"] == 500

    def test_partial_split_remainder_goes_to_client_and_nothing_is_lost(self):
        # net = 999 (odd) -> half=499, remainder=500. Must NOT silently
        # drop the extra wei anywhere.
        result = c._compute_payout(999, 0, "partial")
        assert result["freelancer"] == 499
        assert result["client"] == 500
        assert result["freelancer"] + result["client"] == 999

    def test_zero_fee_bps(self):
        result = c._compute_payout(12345, 0, "approved")
        assert result["owner"] == 0
        assert result["freelancer"] == 12345

    def test_one_wei_amount_never_lost(self):
        for verdict in self.VERDICTS:
            result = c._compute_payout(1, 100, verdict)
            assert sum(result.values()) == 1

    def test_invalid_verdict_raises_instead_of_silently_paying(self):
        with pytest.raises(ValueError):
            c._compute_payout(1000, 100, c.VERIFICATION_FAILED)
        with pytest.raises(ValueError):
            c._compute_payout(1000, 100, "unclear")


# ---------------------------------------------------------------------------
# _hash_excerpt -- same slice must be hashed as is fed to the LLM (no TOCTOU gap)
# ---------------------------------------------------------------------------

class TestHashExcerpt:

    def test_deterministic(self):
        content = "hello world" * 100
        assert c._hash_excerpt(content) == c._hash_excerpt(content)

    def test_sensitive_to_content_beyond_excerpt_boundary_is_ignored_consistently(self):
        # Two different tails beyond DELIVERABLE_EXCERPT_LEN must hash the
        # same, since only the excerpt is ever hashed OR fed to the model --
        # this documents the trade-off explicitly rather than silently.
        head = "x" * c.DELIVERABLE_EXCERPT_LEN
        content_a = head + "AAAA"
        content_b = head + "BBBB"
        assert c._hash_excerpt(content_a) == c._hash_excerpt(content_b)

    def test_sensitive_to_content_within_excerpt(self):
        a = "hello world"
        b = "hello worlD"
        assert c._hash_excerpt(a) != c._hash_excerpt(b)
