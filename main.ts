// main.ts — AI Escrow Backend v3.0
// Endpoints:
//   GET  /health
//   POST /api/escrow/create
//   POST /api/escrow/:id/submit
//   POST /api/escrow/:id/arbitrate
//   GET  /api/escrow/:id
//   GET  /api/escrows

console.log("🚀 AI Escrow Backend v3.0 — Full API");

// ── In-memory store (замени на KV для персистентности) ──────────────────────
interface EscrowRecord {
  id: number;
  client: string;
  freelancer: string;
  task_description: string;
  deliverable_url: string;
  amount_eth: string;
  status: "pending" | "submitted" | "disputed" | "approved" | "partial" | "rejected";
  votes: string[];
  final_verdict: string;
  created_at: string;
  resolved_at: string | null;
}

const db = new Map<number, EscrowRecord>();
let counter = 0;

// ── CORS headers ─────────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ── Router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const url  = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── GET /health ────────────────────────────────────────────────────────────
  if (path === "/" || path === "/health") {
    return json({
      status: "ok",
      version: "3.0",
      message: "AI Escrow Backend — Full API",
      escrows_in_memory: db.size,
      endpoints: [
        "GET  /health",
        "POST /api/escrow/create",
        "POST /api/escrow/:id/submit",
        "POST /api/escrow/:id/arbitrate",
        "GET  /api/escrow/:id",
        "GET  /api/escrows",
        "POST /api/trigger-arbitration",  // legacy
      ],
    });
  }

  // ── GET /api/escrows — list all ────────────────────────────────────────────
  if (path === "/api/escrows" && method === "GET") {
    const list = Array.from(db.values()).sort((a, b) => b.id - a.id);
    return json({ success: true, escrows: list, total: list.length });
  }

  // ── POST /api/escrow/create ────────────────────────────────────────────────
  if (path === "/api/escrow/create" && method === "POST") {
    let body: Record<string, string>;
    try { body = await req.json(); } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }

    const { freelancer, amount_eth, task_description } = body;

    if (!freelancer || !amount_eth || !task_description) {
      return json({ success: false, error: "freelancer, amount_eth and task_description are required" }, 400);
    }
    if (task_description.length < 20) {
      return json({ success: false, error: "Task description too short (min 20 chars)" }, 400);
    }
    if (!freelancer.startsWith("0x") || freelancer.length < 10) {
      return json({ success: false, error: "Invalid freelancer address" }, 400);
    }

    const id = counter++;
    const record: EscrowRecord = {
      id,
      client: "0xClient_" + Math.random().toString(16).slice(2, 8), // в реале — из подписи
      freelancer,
      task_description,
      deliverable_url: "",
      amount_eth,
      status: "pending",
      votes: [],
      final_verdict: "",
      created_at: new Date().toISOString(),
      resolved_at: null,
    };

    db.set(id, record);

    return json({
      success: true,
      escrow_id: id,
      message: `Escrow #${id} created — ${amount_eth} ETH locked`,
      record,
    });
  }

  // ── POST /api/escrow/:id/submit ────────────────────────────────────────────
  const submitMatch = path.match(/^\/api\/escrow\/(\d+)\/submit$/);
  if (submitMatch && method === "POST") {
    const id = parseInt(submitMatch[1]);
    const record = db.get(id);

    if (!record) return json({ success: false, error: `Escrow #${id} not found` }, 404);
    if (record.status !== "pending") {
      return json({ success: false, error: `Escrow is ${record.status}, expected pending` }, 400);
    }

    let body: Record<string, string>;
    try { body = await req.json(); } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }

    const { deliverable_url } = body;
    if (!deliverable_url || !deliverable_url.startsWith("http")) {
      return json({ success: false, error: "Valid deliverable_url required (must start with http)" }, 400);
    }

    record.deliverable_url = deliverable_url;
    record.status = "submitted";
    db.set(id, record);

    return json({
      success: true,
      ok: true,
      message: `Work submitted for escrow #${id}`,
      escrow_id: id,
      status: "submitted",
      deliverable_url,
    });
  }

  // ── POST /api/escrow/:id/arbitrate ─────────────────────────────────────────
  const arbitrateMatch = path.match(/^\/api\/escrow\/(\d+)\/arbitrate$/);
  if (arbitrateMatch && method === "POST") {
    const id = parseInt(arbitrateMatch[1]);
    const record = db.get(id);

    if (!record) return json({ success: false, error: `Escrow #${id} not found` }, 404);
    if (record.status !== "submitted") {
      return json({ success: false, error: `Escrow is ${record.status}, expected submitted` }, 400);
    }

    record.status = "disputed";
    db.set(id, record);

    const start = Date.now();
    const votes = await runThreeAgents(record.task_description, record.deliverable_url);
    const final_verdict = getMajorityVote(votes);
    const duration = Date.now() - start;

    record.votes = votes;
    record.final_verdict = final_verdict;
    record.status = final_verdict as EscrowRecord["status"];
    record.resolved_at = new Date().toISOString();
    db.set(id, record);

    return json({
      success: true,
      escrow_id: id,
      votes,
      final_verdict,
      status: final_verdict.toUpperCase(),
      processing_time_ms: duration,
      timestamp: new Date().toISOString(),
    });
  }

  // ── GET /api/escrow/:id ────────────────────────────────────────────────────
  const getMatch = path.match(/^\/api\/escrow\/(\d+)$/);
  if (getMatch && method === "GET") {
    const id = parseInt(getMatch[1]);
    const record = db.get(id);

    if (!record) return json({ success: false, error: `Escrow #${id} not found` }, 404);

    return json({ success: true, ...record });
  }

  // ── POST /api/trigger-arbitration — legacy, без хранения ──────────────────
  if (path === "/api/trigger-arbitration" && method === "POST") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }

    const { task_description, deliverable_url, escrow_id } = body as Record<string, string>;

    if (!task_description || !deliverable_url) {
      return json({ success: false, error: "task_description and deliverable_url are required" }, 400);
    }

    const start = Date.now();
    const votes = await runThreeAgents(task_description, deliverable_url);
    const final_verdict = getMajorityVote(votes);

    return json({
      success: true,
      escrow_id: escrow_id || Math.floor(Math.random() * 9999),
      votes,
      final_verdict,
      status: final_verdict.toUpperCase(),
      processing_time_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  }

  return json({ error: "Not Found" }, 404);
});

// ── LLM ──────────────────────────────────────────────────────────────────────
async function callGroq(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 250,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Groq error");
  return data.choices[0].message.content.trim();
}

async function runThreeAgents(task: string, url: string): Promise<string[]> {
  const prompts = [
    `You are a strict technical evaluator for a freelance escrow system.\nTASK: ${task}\nDELIVERABLE URL: ${url}\nEvaluate if the deliverable is technically complete. Reply with exactly one word: APPROVED, PARTIAL or REJECTED`,
    `You are a meticulous requirements analyst for a freelance escrow system.\nTASK: ${task}\nDELIVERABLE URL: ${url}\nCheck if all requirements are covered. APPROVED=85%+, PARTIAL=40-84%, REJECTED=<40%. Reply with exactly one word: APPROVED, PARTIAL or REJECTED`,
    `You are a quality assurance expert for a freelance escrow system.\nTASK: ${task}\nDELIVERABLE URL: ${url}\nEvaluate quality and professionalism. Check for empty repos, placeholders, boilerplate. Reply with exactly one word: APPROVED, PARTIAL or REJECTED`,
  ];

  const votes: string[] = [];
  for (const prompt of prompts) {
    try {
      const res = await callGroq(prompt);
      const up = res.toUpperCase();
      votes.push(up.includes("APPROVED") ? "approved" : up.includes("REJECTED") ? "rejected" : "partial");
    } catch {
      votes.push("partial");
    }
  }
  return votes;
}

function getMajorityVote(votes: string[]): string {
  const c = { approved: 0, partial: 0, rejected: 0 };
  votes.forEach(v => { if (v in c) c[v as keyof typeof c]++; });
  if (c.approved >= 2) return "approved";
  if (c.rejected >= 2) return "rejected";
  return "partial";
}
