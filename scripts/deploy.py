#!/usr/bin/env python3
"""
scripts/deploy.py
Deploy the AIEscrow contract to GenLayer testnet/mainnet.

Usage:
    python scripts/deploy.py --network studionet
    python scripts/deploy.py --network testnet
    python scripts/deploy.py --network mainnet

Or via CLI:
    genlayer deploy contracts/ai_escrow.py
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from genlayer import GenLayerClient, Account
except ImportError:
    print("❌  genlayer SDK not found. Run: pip install genlayer")
    sys.exit(1)


NETWORKS = {
    "studionet": "http://localhost:8080",
    "testnet":   "https://rpc.testnet.genlayer.com",
    "mainnet":   "https://rpc.genlayer.com",
}


def deploy(network: str, private_key: str | None = None) -> dict:
    rpc_url = NETWORKS.get(network)
    if not rpc_url:
        raise ValueError(f"Unknown network: {network}. Choose from {list(NETWORKS)}")

    print(f"\n🚀  Deploying AIEscrow to {network} ({rpc_url})")

    client = GenLayerClient(rpc_url=rpc_url)

    if private_key:
        account = Account.from_private_key(private_key)
    else:
        # Use the default account configured in genlayer CLI
        account = client.get_default_account()

    print(f"👤  Deployer: {account.address}")
    print(f"💰  Balance:  {client.get_balance(account.address)} wei")

    contract_path = Path(__file__).parent.parent / "contracts" / "ai_escrow.py"
    if not contract_path.exists():
        raise FileNotFoundError(f"Contract not found: {contract_path}")

    print(f"📄  Contract: {contract_path}")
    print("⏳  Sending deployment transaction...")

    tx_hash = client.deploy_contract(
        account=account,
        contract_file=str(contract_path),
        args=[],
    )

    print(f"📨  TX Hash:  {tx_hash}")
    print("⏳  Waiting for confirmation...")

    receipt = client.wait_for_transaction(tx_hash)
    contract_address = receipt["contract_address"]

    print(f"\n✅  Contract deployed!")
    print(f"📋  Address: {contract_address}")
    print(f"🔗  Explorer: https://explorer.genlayer.com/contract/{contract_address}")

    deployment_info = {
        "network":          network,
        "contract_address": contract_address,
        "deployer":         str(account.address),
        "tx_hash":          tx_hash,
        "block_number":     receipt.get("block_number"),
        "abi_schema":       _get_contract_schema(client, contract_address),
    }

    # Save deployment info
    output_path = Path(__file__).parent.parent / "deployment.json"
    with open(output_path, "w") as f:
        json.dump(deployment_info, f, indent=2)

    print(f"\n💾  Deployment info saved to: {output_path}")
    return deployment_info


def _get_contract_schema(client, address: str) -> dict:
    try:
        return client.get_contract_schema(address)
    except Exception:
        return {}


def main():
    parser = argparse.ArgumentParser(description="Deploy AIEscrow to GenLayer")
    parser.add_argument(
        "--network", "-n",
        default="studionet",
        choices=list(NETWORKS),
        help="Target network (default: studionet)",
    )
    parser.add_argument(
        "--private-key", "-k",
        default=None,
        help="Deployer private key (optional, uses genlayer config if not set)",
    )
    args = parser.parse_args()

    try:
        result = deploy(network=args.network, private_key=args.private_key)
        print(f"\n🎉  Done! Contract address: {result['contract_address']}")
    except Exception as e:
        print(f"\n❌  Deployment failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
