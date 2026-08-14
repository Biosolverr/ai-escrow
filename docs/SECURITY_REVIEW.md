# Security review: pinned artifacts, structured verdicts, fail-closed verification

Reviewer finding: *"The money-moving verdict relies on a mutable URL and
brittle model-output parsing. Pin the exact submitted artifact, fail closed
when retrieval fails, and add adversarial tests for parsing, prompt
injection, and payout conservation."*

## What changed

### A. Pinned artifact (IPFS CID + consensus-agreed content hash)

- `submit_deliverable` now requires a content-addressed reference
  (`ipfs://<cid>` or a gateway URL containing `/ipfs/<cid>`) instead of an
  arbitrary mutable HTTP(S) URL. Plain links are rejected by `_extract_cid`.
- At submission time, the contract fetches the content through
  `gl.eq_principle.strict_eq()` and stores a sha256 hash of the exact
  4000-character excerpt that will later be shown to the arbitration LLM
  (`_pin_content_hash` / `record.content_hash`).
- Every later arbitration (`resolve_escrow`, `re_resolve_escrow`) re-fetches
  by the same CID and re-hashes the same excerpt length, and refuses to
  arbitrate if the hash no longer matches -- this is what actually catches
  drift, since we do not cryptographically decode the CID's own multihash
  (no such library is available in this single-file GenVM sandbox; see the
  module docstring in `ai_escrow.py`).

### B. Structured, strictly-parsed verdicts

- The LLM is asked for `response_format="json"` with an explicit
  `{"verdict": "approved" | "partial" | "rejected"}` schema instead of a
  free-text one-word answer.
- `_canonicalize_verdict` requires an exact enum match after
  strip+lowercase. There is no substring/keyword search left, so text like
  *"NOT APPROVED"* or a reply containing both keywords can no longer be
  misclassified.
- Deliverable content fed to the model is wrapped in
  `<deliverable_content>...</deliverable_content>` with an explicit
  instruction to treat it as data, never as commands -- a first line of
  defence against prompt injection embedded in the deliverable itself.

### C. Fail-closed on any anomaly

- A single canonical sentinel, `VERIFICATION_FAILED`, covers: retrieval
  failure, hash mismatch, and unparseable/out-of-enum model output. It is
  returned as a normal string (not raised as an exception) so that
  `gl.eq_principle.strict_eq()` can still reach deterministic consensus on
  "we agree this failed" across independent validators.
- `VERIFICATION_FAILED` NEVER triggers `_payout`. `resolve_escrow` /
  `re_resolve_escrow` route it to a new `EscrowStatus.VERIFICATION_FAILED`
  status instead of `RESOLVED`/`APPROVED`/`PARTIAL`/`REJECTED`.
- `submit_deliverable` now also accepts resubmission from
  `VERIFICATION_FAILED` (in addition to the original `PENDING`), so a
  freelancer can fix a broken/rate-limited gateway link or re-pin fresh
  content and try again without the funds ever having moved.
- `claim_payment` asserts the stored verdict is one of the three payable
  values before paying out, as defence in depth (this should be
  unreachable given the state machine, but costs nothing to assert).

## Tests added

- `tests/test_pure_helpers.py` -- 180+ pure pytest cases (no GenVM needed,
  see `tests/conftest.py` for how the `genlayer` SDK is stubbed locally)
  covering: `_canonicalize_verdict` brittle-parsing/injection edge cases,
  `_extract_cid` mutable-URL rejection, `_compute_payout` conservation
  across amounts/fees/verdicts (including 1-wei and odd-net edge cases),
  and `_hash_excerpt` determinism.
- `tests/test_arbitration_gltest.py` -- integration-test **skeletons**
  for the scenarios that need real GenVM/consensus machinery (hash
  mismatch after submission, gateway going down mid-lifecycle, prompt
  injection against `mock_llm`, double-claim, full-lifecycle balance
  conservation). These are marked with `TODO`s wherever they depend on
  your local `gltest` fixture/mocking API -- they were written as a spec
  to run against a local studio node with `mock_llm: true`, not verified
  against a live node from this environment.

## Known limitations / follow-ups

1. **No cryptographic CID verification.** `_extract_cid` checks CID
   *shape* only. The actual integrity guarantee is the consensus-pinned
   `content_hash`, not the CID format. A future iteration could add a
   proper multihash/multibase decode if a suitable dependency becomes
   available in the GenVM environment.
2. **`VERIFICATION_FAILED` retry has no rate limit.** A malicious actor
   could spam `resolve_escrow` against a permanently-broken CID to burn
   validator compute. Consider a max-attempts counter if this becomes a
   real griefing vector on mainnet.
3. **Dispute history is not preserved across a `VERIFICATION_FAILED` ->
   resubmit cycle.** After resubmission the escrow starts a fresh
   `resolve_escrow` cycle even if the previous cycle was already
   `DISPUTED`; this is a deliberate simplification, flagged here for
   visibility.
4. **Redeploy required.** `deliverable_url` was renamed to
   `deliverable_cid`, `content_hash` and `ipfs_gateway` are new state
   fields, and `EscrowStatus.VERIFICATION_FAILED` is a new value -- this is
   not compatible with the already-deployed Bradbury Testnet contract.
   Per plan, redeploy happens after this fix set and the adversarial gltest
   suite have both been run against a local node.
