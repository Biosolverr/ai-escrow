#!/usr/bin/env python3
"""
scripts/interact.py
End-to-end demo of the AIEscrow contract.

Demonstrates the full freelance escrow flow:
  1. Client creates escrow with task spec + deposits funds
  2. Freelancer submits deliverable URL
  3. AI arbitration is triggered (3 LLM validators)
  4. Funds are released based on consensus verdict

Usage:
    python scripts/interact.py --contract <ADDRESS> [--network studionet]
"""

import argparse
import json
import time
from pathlib import Path


def load_deployment() -> dict:
    path = Path(__file__).parent.parent / "deployment.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {}


def demo_flow(contract_address: str, network: str = "studionet"):
    try:
        from genlayer import GenLayerClient, Account
    except ImportError:
        print("❌  genlayer SDK not found. Run: pip install genlayer")
        return

    rpc_urls = {
        "studionet": "http://localhost:8080",
        "testnet":   "https://rpc.testnet.genlayer.com",
    }

    client  = GenLayerClient(rpc_url=rpc_urls[network])
    accounts = client.get_accounts()

    # Use first two test accounts
    owner      = accounts[0]
    client_acc = accounts[1]
    freelancer = accounts[2]

    print("\n" + "═" * 60)
    print("  AI ESCROW — Smart Dispute Resolver Demo")
    print("═" * 60)
    print(f"  Contract:   {contract_address}")
    print(f"  Network:    {network}")
    print(f"  Client:     {client_acc.address}")
    print(f"  Freelancer: {freelancer.address}")
    print("═" * 60 + "\n")

    # ── Step 1: Create Escrow ────────────────────────────────────────────────
    print("📋  Step 1: Client creates escrow...")
    task_spec = (
        "Build a responsive SaaS landing page. "
        "Must include: hero section with CTA, features grid (3 cards), "
        "pricing table (3 tiers: Free/Pro/Enterprise), and a footer. "
        "Use semantic HTML5, CSS Grid, and ensure mobile responsiveness. "
        "Deliver as a GitHub repository with index.html and style.css."
    )

    tx_hash = client.write_contract(
        account=client_acc,
        contract_address=contract_address,
        function="create_escrow",
        args=[str(freelancer.address), task_spec],
        value=10**18,  # 1 ETH
    )

    print(f"   TX: {tx_hash}")
    receipt = client.wait_for_transaction(tx_hash)
    escrow_id = receipt.get("return_value", 0)
    print(f"   ✅  Escrow #{escrow_id} created with 1 ETH")

    # Check status
    status = client.read_contract(
        contract_address=contract_address,
        function="get_escrow_status",
        args=[escrow_id],
    )
    print(f"   📊  Status: {status}")

    print()

    # ── Step 2: Freelancer Submits Work ──────────────────────────────────────
    print("🛠   Step 2: Freelancer submits deliverable...")
    deliverable_url = "https://github.com/freelancer-demo/saas-landing-page"

    tx_hash = client.write_contract(
        account=freelancer,
        contract_address=contract_address,
        function="submit_work",
        args=[escrow_id, deliverable_url],
    )

    print(f"   TX: {tx_hash}")
    client.wait_for_transaction(tx_hash)
    print(f"   ✅  Work submitted: {deliverable_url}")

    status = client.read_contract(
        contract_address=contract_address,
        function="get_escrow_status",
        args=[escrow_id],
    )
    print(f"   📊  Status: {status}")

    print()

    # ── Step 3: Trigger AI Arbitration ───────────────────────────────────────
    print("🤖  Step 3: Triggering AI arbitration...")
    print("   ⏳  3 LLM validators evaluating the work...")
    print("       • Agent 1: Technical Completeness")
    print("       • Agent 2: Requirement Coverage")
    print("       • Agent 3: Quality & Professionalism")

    tx_hash = client.write_contract(
        account=client_acc,
        contract_address=contract_address,
        function="trigger_arbitration",
        args=[escrow_id],
    )

    print(f"   TX: {tx_hash}")
    print("   ⏳  Waiting for GenLayer consensus (this may take ~30s)...")
    receipt = client.wait_for_transaction(tx_hash, timeout=120)
    print(f"   ✅  Arbitration complete!")

    # ── Step 4: Read Verdict ─────────────────────────────────────────────────
    print()
    print("⚖️   Step 4: Final Verdict")
    verdict = client.read_contract(
        contract_address=contract_address,
        function="get_verdict",
        args=[escrow_id],
    )

    votes   = verdict["votes"]
    final   = verdict["final_verdict"]
    status  = verdict["status"]

    print(f"   🗳   Validator votes: {votes}")
    print(f"   🏆  Final verdict:   {final.upper()}")
    print(f"   📊  Escrow status:   {status}")

    print()
    if final == "approved":
        print("   💰  RESULT: Full payment released to freelancer!")
    elif final == "partial":
        print("   💰  RESULT: 50% paid to freelancer, 50% refunded to client.")
    else:
        print("   💰  RESULT: Full refund to client.")

    print()
    print("═" * 60)
    print("  Demo complete! Check the escrow record:")
    escrow = client.read_contract(
        contract_address=contract_address,
        function="get_escrow",
        args=[escrow_id],
    )
    print(json.dumps({
        "escrow_id":        escrow_id,
        "status":           escrow.status,
        "votes":            escrow.votes,
        "final_verdict":    escrow.final_verdict,
        "amount_wei":       str(escrow.amount_wei),
    }, indent=2))
    print("═" * 60)


def main():
    parser = argparse.ArgumentParser(description="AIEscrow interaction demo")
    parser.add_argument("--contract", "-c", default=None,
                        help="Contract address (reads deployment.json if not set)")
    parser.add_argument("--network", "-n", default="studionet",
                        choices=["studionet", "testnet"])
    args = parser.parse_args()

    contract_address = args.contract
    if not contract_address:
        info = load_deployment()
        contract_address = info.get("contract_address")
        if not contract_address:
            print("❌  No contract address. Deploy first or pass --contract <ADDRESS>")
            return

    demo_flow(contract_address=contract_address, network=args.network)


if __name__ == "__main__":
    main()
