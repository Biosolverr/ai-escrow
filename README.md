# AI Escrow — GenLayer Intelligent Contract

An on-chain freelance escrow where **three LLM validators independently fetch the deliverable URL and evaluate it against the task spec**, then reach consensus to decide payout.

---

## Architecture

```
Browser (frontend/index.html)
  └── genlayer-js  ──────────────────────────► GenLayer node
                                                  └── contracts/ai_escrow.py
                                                        ├── gl.get_webpage(url)   ← fetches deliverable
                                                        ├── gl.nondet.exec_prompt ← LLM arbitration
                                                        └── gl.message_raw["datetime"] ← consensus time
```

`main.ts` is a **pure static file server** — it serves `frontend/index.html` and nothing else. All business logic runs on-chain inside `ai_escrow.py`; there is no off-chain LLM reimplementation.

---

## Contract: `contracts/ai_escrow.py`

### Key design decisions

#### 1 · Validators read the actual deliverable (`gl.get_webpage`)

```python
deliverable_content = gl.get_webpage(deliverable_url, mode="text")
content_excerpt = deliverable_content[:4000]
```

Both the leader and every validator independently fetch the deliverable URL during arbitration. The LLM prompt includes the fetched content, so the verdict is based on what the URL actually contains, not just its address.

#### 2 · Deterministic timestamps (`gl.message_raw["datetime"]`)

All timestamp operations use:

```python
def _tx_timestamp() -> u256:
    raw_dt: str = gl.message_raw["datetime"]
    normalised = raw_dt.replace("Z", "+00:00")
    dt = datetime.datetime.fromisoformat(normalised)
    return u256(int(dt.timestamp()))
```

`gl.message_raw["datetime"]` is the consensus-agreed transaction time — identical on the leader and every validator. `datetime.datetime.now()` is **not used** anywhere in the contract; it would differ between nodes and break consensus.

#### 3 · Frontend talks directly to GenLayer

`frontend/index.html` imports `genlayer-js` and calls the contract directly:

```js
import { createClient, createAccount, generatePrivateKey } from 'https://esm.sh/genlayer-js@latest';
// ...
await c.writeContract({ address: CONTRACT_ADDRESS, functionName: 'resolve_escrow', args: [BigInt(id)] });
```

No proxy, no backend API, no off-chain reimplementation.

---

## Escrow flow

| Step | Method | Who | Result |
|------|--------|-----|--------|
| 1 | `create_escrow(freelancer, task, window)` | Client (payable) | Funds locked, status `pending` |
| 2 | `submit_deliverable(id, url)` | Freelancer | Status → `submitted` |
| 3 | `resolve_escrow(id)` | Client / Freelancer / Owner | Validators fetch URL → LLM vote → status `resolved`, window opens |
| 4a | `claim_payment(id)` | Anyone | After window expires — executes payout |
| 4b | `dispute_escrow(id)` | Client or Freelancer | Within window — status → `disputed` |
| 5 | `re_resolve_escrow(id)` | Client / Freelancer / Owner | Second fetch+vote — final payout |

---

## Verdicts & payouts

| Verdict | Payout (after 1 % platform fee) |
|---------|----------------------------------|
| `approved` | 100 % → Freelancer |
| `partial` | 50 % → Freelancer, 50 % → Client |
| `rejected` | 100 % → Client |

---

## Quick start

### Deploy

```bash
genlayer deploy contracts/ai_escrow.py
# or
python scripts/deploy.py --network studionet
```

### Run frontend

```bash
deno run --allow-net --allow-read main.ts
# open http://localhost:8000
```

Update `CONTRACT_ADDRESS` in `frontend/index.html` to your deployed address.

### Run tests

```bash
python -m pytest tests/
```

---

## Project structure

```
contracts/ai_escrow.py    ← Intelligent Contract (all logic here)
frontend/index.html       ← Browser UI, talks to chain via genlayer-js
main.ts                   ← Static file server only (no business logic)
scripts/deploy.py         ← Deployment helper
scripts/interact.py       ← End-to-end demo script
tests/                    ← Simulation tests
```
