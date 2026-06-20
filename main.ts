// ── AI Escrow — main.ts ──────────────────────────────────────────────────────
// Minimal static server for the GenLayer frontend.
// ALL business logic lives in contracts/ai_escrow.py on the GenLayer chain.
// The browser talks directly to the GenLayer node via genlayer-js — this
// server only serves the HTML file; it has no LLM calls, no KV store, and
// no reimplementation of contract logic.

import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8000);
const STATIC_DIR = join(Deno.cwd(), "frontend");

function cors(extra: HeadersInit = {}): Headers {
  const h = new Headers(extra);
  h.set("Access-Control-Allow-Origin", "*");
  return h;
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  // Health endpoint (useful for deploy-platform health checks)
  if (url.pathname === "/health") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: cors({ "Content-Type": "application/json" }),
    });
  }

  // Serve frontend/index.html for all other paths
  try {
    const filePath = join(STATIC_DIR, "index.html");
    const content = await Deno.readFile(filePath);
    return new Response(content, {
      headers: cors({ "Content-Type": "text/html; charset=utf-8" }),
    });
  } catch {
    return new Response("Not found", { status: 404, headers: cors() });
  }
});

console.log(`AI Escrow frontend serving on http://localhost:${PORT}`);
console.log("All contract interactions go directly to the GenLayer chain.");
console.log("Supported contract methods:");
console.log("  Write: create_escrow, submit_deliverable, resolve_escrow, claim_payment, dispute_escrow, re_resolve_escrow");
console.log("  View:  get_escrow, get_total_escrows, get_verdict, get_platform_fee_bps, get_owner");
