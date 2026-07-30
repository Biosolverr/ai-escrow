#!/usr/bin/env python3
"""
scripts/deploy.py
Deploy the AIEscrow contract to a GenLayer network via the official
`genlayer` CLI (npm package "genlayer"). This is a thin wrapper — the
actual deployment work is done by the CLI's own account/keystore and
network configuration, which must be set up beforehand:

    npm install -g genlayer
    genlayer network set testnet-bradbury
    genlayer account create      # or `genlayer account unlock` if you
                                  # already have an account

Usage:
    python scripts/deploy.py --network testnet-bradbury
    python scripts/deploy.py --network studionet

This script does NOT talk to the chain directly — there is no
"genlayer" pip package with a GenLayerClient/Account API. All signing
and RPC calls go through the CLI's own keystore/config, which is why
`genlayer account unlock` must be run once beforehand (the key is then
cached in the OS keychain).
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
CONTRACT_PATH = REPO_ROOT / "contracts" / "ai_escrow.py"
DEPLOYMENT_INFO_PATH = REPO_ROOT / "deployment.json"

KNOWN_NETWORKS = ["studionet", "testnet-bradbury", "mainnet"]


def _require_cli() -> None:
    if shutil.which("genlayer") is None:
        print("❌  'genlayer' CLI not found on PATH. Install it with:")
        print("    npm install -g genlayer")
        sys.exit(1)


def _run(cmd: list[str]) -> str:
    print(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, shell=False)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    print(result.stdout)
    return result.stdout


def deploy(network: str) -> dict:
    if network not in KNOWN_NETWORKS:
        print(f"⚠️  '{network}' is not in the known list {KNOWN_NETWORKS} — "
              f"continuing anyway in case it's a custom network you configured.")

    if not CONTRACT_PATH.exists():
        raise FileNotFoundError(f"Contract not found: {CONTRACT_PATH}")

    _require_cli()

    print(f"\n🚀  Deploying AIEscrow to {network}")
    _run(["genlayer", "network", "set", network])
    _run(["genlayer", "account"])  # sanity check: prints active account + balance

    output = _run(["genlayer", "deploy", "--contract", str(CONTRACT_PATH)])

    # The CLI prints a JSON-ish result block; try to recover the address/hash
    # for our own record. If parsing fails, the raw CLI output above already
    # has everything — this is just a convenience file.
    deployment_info = {
        "network": network,
        "contract_path": str(CONTRACT_PATH.relative_to(REPO_ROOT)),
        "raw_cli_output": output.strip(),
    }

    with open(DEPLOYMENT_INFO_PATH, "w") as f:
        json.dump(deployment_info, f, indent=2)

    print(f"\n💾  Raw deploy output saved to: {DEPLOYMENT_INFO_PATH}")
    print("   (copy the Contract Address from the CLI output above into")
    print("    frontend/index.html's CONTRACT_ADDRESS constant)")
    return deployment_info


def main():
    parser = argparse.ArgumentParser(
        description="Deploy AIEscrow via the genlayer CLI"
    )
    parser.add_argument(
        "--network", "-n",
        default="testnet-bradbury",
        help="Target network alias known to the genlayer CLI "
             "(e.g. studionet, testnet-bradbury)",
    )
    args = parser.parse_args()

    try:
        deploy(network=args.network)
        print("\n🎉  Done.")
    except Exception as e:
        print(f"\n❌  Deployment failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
