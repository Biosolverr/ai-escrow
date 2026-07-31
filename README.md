# AI Escrow — GenLayer Intelligent Contract

An on-chain freelance escrow where **three LLM validators independently fetch the deliverable URL and evaluate it against the task spec**, then reach consensus to decide payout.

---

## Architecture

```
Browser (frontend/index.html)
  └── genlayer-js  ──────────────────────────► GenLayer node
                                                  └── contracts/ai_escrow.py
                                                        ├── gl.nondet.web.render(url) ← fetches deliverable
                                                        ├── gl.nondet.exec_prompt ← LLM arbitration
                                                        └── gl.message_raw["datetime"] ← consensus time
```

Frontend is a single self-contained static file — no server-side code, no
off-chain LLM reimplementation. All business logic runs on-chain inside
`ai_escrow.py`; the browser talks directly to the chain via `genlayer-js`.

---

## Contract: `contracts/ai_escrow.py`

### Key design decisions

#### 1 · Leader + validators independently fetch the deliverable (`gl.nondet.web.render`)

```python
deliverable_content = gl.nondet.web.render(deliverable_url, mode="text")
content_excerpt = deliverable_content[:4000]
```

The leader fetches the deliverable URL and asks an LLM for a verdict, already
normalised to one of three canonical strings: `"approved"`, `"partial"`,
`"rejected"`. Every validator independently re-runs the exact same function
(own fetch, own LLM call), and GenVM compares the two canonical strings via
`gl.eq_principle.strict_eq()` — exact match, since the output is already
reduced to a fixed category before comparison. A mismatch means a genuine
disagreement about the outcome, not a wording difference, so `strict_eq` is
the correct (and cheapest) Equivalence Principle here — no extra NLP
comparison call is needed the way `prompt_comparative` would require.

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

## Deployed contract

| | |
|---|---|
| Network | GenLayer Bradbury Testnet (chainId 4221) |
| Contract address | `0xCc6ec0B09D33989671984C736702cCcC4B22d07B` |
| Deploy tx | `0x6475a1648418a85635034df5869dda0fd959ef70e646385a91fd9eecc44b95d5` |
| Explorer | https://explorer-bradbury.genlayer.com/ |

## Quick start

### Deploy

Requires the `genlayer` CLI (`npm install -g genlayer`) with an account
already created/unlocked (`genlayer account create`, then
`genlayer account unlock`).

```bash
genlayer network set testnet-bradbury
genlayer deploy --contract contracts/ai_escrow.py
# or, via the wrapper script:
python scripts/deploy.py --network testnet-bradbury
```

Deployment works entirely locally through the CLI — no Docker and no
CI pipeline needed for a testnet deploy (Docker is only required if
you also want to run a local `studionet`/localnet node).

### Run frontend

Deployed via Vercel (see `vercel.json`):

```bash
vercel --prod
```

Or preview locally with any static server, e.g.:

```bash
npx serve frontend
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
vercel.json                ← Static deploy config for Vercel
scripts/deploy.py         ← Deployment helper (wraps the genlayer CLI)
```
ploading README.md…]()


