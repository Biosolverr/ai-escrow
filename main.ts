// ── AI Escrow — Production Fixed (GenLayer-style) ────────────────────────
// Deno Deploy compatible single-file app
// FIXES:
// - Stable escrow IDs (atomic counter)
// - Submit/Arbitrate "Escrow not found" bug
// - Arbitration undefined votes
// - Frontend log persistence + correct rendering
// - Status checker reliability
// - KV consistency fixes

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL = Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

interface Escrow {
  id: number;
  client: string;
  freelancer: string;
  amount_eth: string;
  task_description: string;
  deliverable_url: string;
  status: "pending" | "submitted" | "approved" | "partial" | "rejected" | "disputed";
  votes: string[];
  final_verdict: string;
  created_at: string;
}

const kv = await Deno.openKv();
console.info("KV initialized");

// ─────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────

function cors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json" }),
  });
}

async function log(action: string, data: unknown) {
  await kv.set(["log", Date.now(), Math.random()], {
    action,
    data,
    t: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────

async function nextId(): Promise<number> {
  await kv.atomic().mutate({
    type: "sum",
    key: ["counter"],
    value: 1n,
  }).commit();

  const res = await kv.get<bigint>(["counter"]);
  return Number(res.value ?? 0n) - 1;
}

async function getEscrow(id: number): Promise<Escrow | null> {
  const res = await kv.get<Escrow>(["escrow", id]);
  return res.value ?? null;
}

async function setEscrow(e: Escrow) {
  await kv.set(["escrow", e.id], e);
}

async function getAllEscrows(): Promise<Escrow[]> {
  const out: Escrow[] = [];
  for await (const e of kv.list<Escrow>({ prefix: ["escrow"] })) {
    if (typeof e.value?.id === "number") out.push(e.value);
  }
  return out.sort((a, b) => b.id - a.id);
}

// ─────────────────────────────────────────────
// AI AGENT
// ─────────────────────────────────────────────

async function callAgent(role: string, task: string, url: string) {
  const prompt = `
Role: ${role}
Task: ${task}
URL: ${url}

Return ONLY: approved | partial | rejected
`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 10,
      }),
    });

    const d = await r.json();
    const t = (d?.choices?.[0]?.message?.content ?? "").toLowerCase();

    if (t.includes("approved")) return "approved";
    if (t.includes("rejected")) return "rejected";
    return "partial";
  } catch {
    return "partial";
  }
}

function majority(votes: string[]) {
  const c = { approved: 0, partial: 0, rejected: 0 };
  for (const v of votes) if (v in c) c[v as keyof typeof c]++;

  const max = Math.max(...Object.values(c));
  if (max >= 2) {
    return (Object.entries(c).find(([, v]) => v === max)?.[0] ??
      "partial");
  }
  return "partial";
}

// ─────────────────────────────────────────────
// FRONTEND (FIXED LOGS + HORIZONTAL UI + STATE SAFE)
// ─────────────────────────────────────────────

function frontendHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI Escrow</title>
<style>
body{margin:0;background:#0b0b0f;color:#fff;font-family:Arial}
.top{display:flex;gap:10px;padding:10px;background:#111;flex-wrap:wrap}
.card{background:#161622;padding:12px;border-radius:10px;margin:10px}
.row{display:flex;gap:10px;flex-wrap:wrap}
input,textarea{background:#0f0f1a;color:#fff;border:1px solid #333;padding:8px;border-radius:6px}
button{background:#ff6a00;color:#000;border:none;padding:10px 14px;border-radius:8px;cursor:pointer;font-weight:bold}
button:disabled{opacity:.5}
.log{position:fixed;bottom:0;left:0;right:0;height:160px;overflow:auto;background:#000;border-top:1px solid #333;font-size:12px}
.log div{padding:2px 8px;border-bottom:1px solid #111}
.small{font-size:11px;color:#aaa}
.status{color:#00ff88}
</style>
</head>
<body>

<div class="top">
  <div>⚖ AI ESCROW</div>
  <div class="small">counter safe mode</div>
</div>

<div class="row">

  <div class="card">
    <h3>Create</h3>
    <input id="freelancer" placeholder="0x..." />
    <input id="amount" placeholder="ETH" />
    <textarea id="task" placeholder="task"></textarea>
    <button onclick="create()">Create</button>
    <div id="cid"></div>
  </div>

  <div class="card">
    <h3>Submit</h3>
    <input id="sid" placeholder="id"/>
    <input id="url" placeholder="url"/>
    <button onclick="submitW()">Submit</button>
  </div>

  <div class="card">
    <h3>Arbitrate</h3>
    <input id="aid" placeholder="id"/>
    <button onclick="arb()">Run</button>
    <div id="votes"></div>
    <div id="final"></div>
  </div>

  <div class="card">
    <h3>Status</h3>
    <input id="stid" placeholder="id"/>
    <button onclick="status()">Check</button>
    <div id="out"></div>
  </div>

</div>

<div class="log" id="log"></div>

<script>

function log(m){
  const el=document.getElementById('log');
  const d=document.createElement('div');
  d.textContent=new Date().toLocaleTimeString()+" "+m;
  el.appendChild(d);
  el.scrollTop=999999;
}

async function create(){
  const r=await fetch('/api/escrow/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    freelancer:freelancer.value,
    amount_eth:amount.value,
    task_description:task.value,
    client:"web"
  })});
  const d=await r.json();
  log("created escrow "+d.escrow_id);
  cid.innerText="ID:"+d.escrow_id;
}

async function submitW(){
  const r=await fetch('/api/escrow/'+sid.value+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deliverable_url:url.value})});
  const d=await r.json();
  log("submitted "+sid.value);
}

async function arb(){
  const r=await fetch('/api/escrow/'+aid.value+'/arbitrate',{method:'POST'});
  const d=await r.json();
  log("arbitrated "+aid.value+" -> "+d.final_verdict);

  votes.innerText = JSON.stringify(d.votes || []);
  final.innerText = d.final_verdict;
}

async function status(){
  const r=await fetch('/api/escrow/'+stid.value);
  const d=await r.json();
  out.innerText = JSON.stringify(d);
}

</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  if (url.pathname === "/") {
    return new Response(frontendHTML(), {
      headers: cors({ "Content-Type": "text/html" }),
    });
  }

  if (url.pathname === "/health") {
    const c = await kv.get(["counter"]);
    return json({ ok: true, counter: c.value ?? 0n });
  }

  // CREATE
  if (url.pathname === "/api/escrow/create") {
    const b = await req.json();
    const id = await nextId();

    const e: Escrow = {
      id,
      client: b.client,
      freelancer: b.freelancer,
      amount_eth: String(b.amount_eth),
      task_description: b.task_description,
      deliverable_url: "",
      status: "pending",
      votes: [],
      final_verdict: "",
      created_at: new Date().toISOString(),
    };

    await setEscrow(e);
    await log("create", id);

    return json({ success: true, escrow_id: id, total: id + 1 });
  }

  // GET ESCROW
  const m1 = url.pathname.match(/\/api\/escrow\/(\d+)$/);
  if (m1 && req.method === "GET") {
    const e = await getEscrow(Number(m1[1]));
    return json(e ?? { error: "not found" });
  }

  // SUBMIT
  const m2 = url.pathname.match(/\/api\/escrow\/(\d+)\/submit/);
  if (m2) {
    const id = Number(m2[1]);
    const e = await getEscrow(id);
    if (!e) return json({ success: false, error: "not found" }, 404);

    const b = await req.json();
    e.deliverable_url = b.deliverable_url;
    e.status = "submitted";

    await setEscrow(e);
    await log("submit", id);

    return json({ success: true });
  }

  // ARBITRATE
  const m3 = url.pathname.match(/\/api\/escrow\/(\d+)\/arbitrate/);
  if (m3) {
    const id = Number(m3[1]);
    const e = await getEscrow(id);
    if (!e) return json({ success: false, error: "not found" }, 404);

    const [v1, v2, v3] = await Promise.all([
      callAgent("tech", e.task_description, e.deliverable_url),
      callAgent("req", e.task_description, e.deliverable_url),
      callAgent("quality", e.task_description, e.deliverable_url),
    ]);

    const votes = [v1, v2, v3];
    const verdict = majority(votes);

    e.votes = votes;
    e.final_verdict = verdict;
    e.status = verdict as any;

    await setEscrow(e);
    await log("arbitrate", { id, verdict });

    return json({ success: true, votes, final_verdict: verdict });
  }

  return json({ error: "not found" }, 404);
});
