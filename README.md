# AI Escrow — Smart Dispute Resolver

> **Trustless freelance payments, resolved by AI consensus.**  
> Built on [GenLayer](https://genlayer.com) — the intelligence layer of the Internet.

---

## What is this?

AI Escrow is an **Intelligent Contract** that acts as a trustless escrow for freelance work.  
Instead of human arbitrators or on-chain voting (à la Kleros), **three independent LLM agents** evaluate whether delivered work satisfies the agreed task specification — then a **majority vote** releases funds automatically.

No middlemen. No tribunals. No waiting weeks.

```
Client deposits funds + task spec
          │
          ▼
    [Escrow Created]  ← status: PENDING
          │
  Freelancer submits deliverable URL
          │
          ▼
    [Work Submitted]  ← status: SUBMITTED
          │
  Either party triggers arbitration
          │
          ▼
  ┌───────────────────────────────────┐
  │     GenLayer Validator Network     │
  │                                   │
  │  Agent 1: Technical Completeness  │
  │  Agent 2: Requirement Coverage    │  ← 3 LLMs read the
  │  Agent 3: Quality & Polish        │    actual deliverable URL
  │                                   │
  │  Each returns: APPROVED / PARTIAL / REJECTED
  └───────────────────────────────────┘
          │
    Majority Vote (2-of-3)
          │
    ┌─────┴──────────────────────────────┐
    │             │                      │
  APPROVED      PARTIAL               REJECTED
    │             │                      │
100% →        50% each               100% →
Freelancer    (split)                  Client
```

GenLayer's **Equivalence Principle** handles LLM non-determinism: each validator independently runs the LLM call, and the protocol reconciles results via its Optimistic Democracy consensus mechanism.

---

## Architecture

```
ai-escrow/
├── contracts/
│   └── ai_escrow.py          # The Intelligent Contract (Python)
├── tests/
│   └── test_ai_escrow.py     # Full test suite (pytest + genlayer testing)
├── scripts/
│   ├── deploy.py             # Deployment script
│   └── interact.py           # End-to-end demo script
├── docs/
│   └── FLOW.md               # Detailed flow documentation
├── genlayer.json             # Project config
├── pyproject.toml
└── README.md
```

### Contract: `ai_escrow.py`

| Function | Access | Description |
|---|---|---|
| `create_escrow(freelancer, task_spec)` | Client | Creates escrow, deposits funds |
| `submit_work(escrow_id, url)` | Freelancer | Submits deliverable URL |
| `trigger_arbitration(escrow_id)` | Either party | Runs 3 LLM validators, settles funds |
| `get_escrow(escrow_id)` | Public | Read full escrow record |
| `get_verdict(escrow_id)` | Public | Read votes + final verdict |
| `withdraw_fees()` | Owner | Withdraw 1% platform fee |

### Escrow States

```
PENDING → SUBMITTED → DISPUTED → APPROVED
                               → PARTIAL
                               → REJECTED
```

---

## Why GenLayer?

| Feature | Traditional Escrow | Kleros (on-chain) | **AI Escrow (GenLayer)** |
|---|---|---|---|
| Arbitration | Human middleman | Human jury | **AI consensus** |
| Speed | Days/weeks | Days | **Minutes** |
| Cost | High fees | Juror fees | **1% platform fee** |
| Subjectivity | High | Medium | **Structured LLM eval** |
| Web Access | Manual | None | **Real URL fetching** |
| Programmable | No | Limited | **Full Python logic** |

GenLayer gives us three capabilities no other chain has:

1. **`gl.get_webpage(url)`** — validators actually fetch and read the GitHub repo or demo URL
2. **`gl.exec_prompt(prompt)`** — LLM reasoning is a first-class blockchain primitive
3. **Equivalence Principle** — non-deterministic LLM outputs converge to consensus without every validator agreeing byte-for-byte

---

## Getting Started

### Prerequisites

```bash
pip install genlayer
npm install -g @genlayer/cli   # or: pip install genlayer-cli
```

### 1. Start GenLayer Studio (local testnet)

```bash
genlayer init
genlayer up
```

Open `http://localhost:8080` to see the Studio.

### 2. Deploy the contract

```bash
# Via CLI
genlayer deploy contracts/ai_escrow.py

# Or via Python script
python scripts/deploy.py --network studionet
```

### 3. Run the demo

```bash
python scripts/interact.py --network studionet
```

This runs the full flow:
- Creates an escrow with a sample task spec
- Submits a deliverable URL
- Triggers AI arbitration
- Prints the 3 validator votes and final verdict

### 4. Run tests

```bash
genlayer test
# or
pytest tests/
```

---

## Example Interaction

```python
from genlayer import GenLayerClient, Account

client = GenLayerClient(rpc_url="http://localhost:8080")
account = client.get_default_account()

# 1. Create escrow
tx = client.write_contract(
    account=account,
    contract_address="0x...",
    function="create_escrow",
    args=["0xFreelancerAddress", "Build a landing page with hero + pricing table"],
    value=10**18,  # 1 ETH
)

# 2. Freelancer submits (from their account)
tx = client.write_contract(
    account=freelancer_account,
    contract_address="0x...",
    function="submit_work",
    args=[0, "https://github.com/user/landing-page"],
)

# 3. Trigger arbitration
tx = client.write_contract(
    account=account,
    contract_address="0x...",
    function="trigger_arbitration",
    args=[0],
)

# 4. Read verdict
verdict = client.read_contract(
    contract_address="0x...",
    function="get_verdict",
    args=[0],
)
# → {"votes": ["approved", "approved", "partial"], "final_verdict": "approved", ...}
```

---

## The Three LLM Validators

Each validator evaluates the work independently using a different analytical lens:

**Agent 1 — Technical Completeness**  
Asks: *"Is the technical implementation present and functional?"*  
Checks for working code, real files, not just placeholder scaffolding.

**Agent 2 — Requirement Coverage**  
Asks: *"What percentage of explicit requirements are met?"*  
Extracts each requirement from the spec and checks it one by one.  
APPROVED ≥ 85% | PARTIAL 40–84% | REJECTED < 40%

**Agent 3 — Quality & Professionalism**  
Asks: *"Would a reasonable client accept this?"*  
Flags empty repos, copy-paste boilerplate, or missing implementation.

**Consensus: majority vote (2-of-3)**  
Three-way ties → PARTIAL (the safe neutral outcome).

---

## Payment Logic

| Verdict | Freelancer | Client | Platform |
|---|---|---|---|
| APPROVED | 99% | 0% | 1% |
| PARTIAL | ~49.5% | ~49.5% | 1% |
| REJECTED | 0% | 99% | 1% |

Platform fees accumulate in the contract and are withdrawn by the owner.

---

## Comparison: AI Escrow vs Kleros

Kleros is the leading decentralized dispute resolution protocol. It uses human jurors who stake tokens and vote on disputes. AI Escrow takes a different approach:

- **No juror coordination** needed — LLM evaluation is instant
- **No human bias** — consistent criteria applied every time  
- **Web access** — validators read the actual deliverable, not just a description
- **Cheaper** — no juror fees, just LLM inference cost

The trade-off: LLMs can be fooled by misleading content. Future versions will add prompt-injection hardening and multi-model diversity (GPT-4o + Claude + Gemini).

---

## Roadmap

- [ ] Multi-milestone escrows (release funds in tranches)
- [ ] Dispute appeals via GenLayer's on-chain appeal mechanism  
- [ ] Multi-model diversity (GPT-4o + Claude + Gemini per validator)
- [ ] Frontend DApp (React + genlayer-js)
- [ ] Reputation scoring for freelancers
- [ ] Time-locked auto-release (if no arbitration after N days)

---

## License

MIT

---

*Built for the GenLayer Intelligent Contracts submission. Competing with Kleros — but with AI.*
