# Demo Deliverable

A minimal static page used to test the AI arbitration flow end-to-end.
The task description used in `create_escrow` asks for a page with an
H1 heading reading "Hello GenLayer" and the text "AI Escrow Test"
somewhere on the page - this file satisfies that exactly, so
`resolve_escrow()` can fetch it via `gl.nondet.web.render()` and
return a genuine `approved` verdict instead of guessing against a
non-existent URL.

Hosted separately via GitHub Pages (not build-integrated with this
repo) so it stays a plain static fetch target:

Live page:https://biosolverr.github.io/ai-escrow-demo-deliverable/
https://zksync-os-testnet-genlayer.explorer.zksync.dev/tx/0xc52394e543acf5aa20c7f5c31cd184ab5e96795caf15942d1f40120da38032ee#overview
