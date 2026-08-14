"""
Pytest bootstrap for LOCAL, GenVM-free unit tests.

`contracts/ai_escrow.py` starts with `from genlayer import *`. That module
only exists inside the GenVM WASM sandbox -- `pip install genlayer-test`
(gltest) gives you the *client* SDK (genlayer-py) and the `gltest` CLI for
integration testing against a running studio/local node, but it does NOT
provide an importable `genlayer` package for plain `pytest` to use offline.

To unit-test the contract's pure helper functions (_extract_cid,
_canonicalize_verdict, _compute_payout, _hash_excerpt) -- none of which
call any gl.* API -- we register a minimal fake `genlayer` module in
sys.modules before the contract module is imported. It provides just
enough surface (Address, u256, TreeMap, allow_storage, gl.Contract,
gl.public.write/.view/.write.payable) for the class body and type
annotations in ai_escrow.py to evaluate without error. Nothing inside any
gl.* runtime call path (gl.message.*, gl.nondet.*, gl.eq_principle.*,
gl.storage.*, gl.get_contract_at, gl.message_raw) is exercised by these
tests, since we only call the module-level pure functions directly, never
an AIEscrow instance method.

Adversarial / consensus-level scenarios (hash-mismatch fail-closed,
retrieval-failure fail-closed, prompt-injection resistance, double-claim
prevention) are NOT covered here -- they need the real GenVM/eq_principle
machinery and belong in gltest-based integration tests against a local
node (see tests/test_arbitration_gltest.py).
"""
import sys
import types
import pathlib


def _install_genlayer_stub() -> None:
    if "genlayer" in sys.modules:
        return

    stub = types.ModuleType("genlayer")

    class Address(str):
        pass

    class u256(int):
        pass

    class TreeMap(dict):
        def __class_getitem__(cls, item):
            return cls

    def allow_storage(cls):
        return cls

    def _write(fn):
        return fn

    def _write_payable(fn):
        return fn

    def _view(fn):
        return fn

    _write.payable = _write_payable  # `@gl.public.write.payable` usage

    class _Public:
        write = staticmethod(_write)
        view = staticmethod(_view)

    class _StubContract:
        pass

    class _GL:
        pass

    _GL.Contract = _StubContract
    _GL.public = _Public()

    stub.Address = Address
    stub.u256 = u256
    stub.TreeMap = TreeMap
    stub.allow_storage = allow_storage
    stub.gl = _GL()

    sys.modules["genlayer"] = stub


def _add_contracts_dir_to_path() -> None:
    contracts_dir = pathlib.Path(__file__).resolve().parent.parent / "contracts"
    sys.path.insert(0, str(contracts_dir))


_install_genlayer_stub()
_add_contracts_dir_to_path()
