// ─────────────────────────────────────────────────────────────
// AI ESCROW — GENLAYER EXECUTION RUNTIME (UI FIXED + STATE FIXED)
// single-file Deno Deploy
// ─────────────────────────────────────────────────────────────

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL =
  Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

const FEE_BPS = 100;

type Status =
  | "pending"
  | "submitted"
  | "disputed"
  | "approved"
  | "partial"
  | "rejected";

type Vote = "approved" | "partial" | "rejected";

interface ValidatorResult {
  validator: string;
  verdict: Vote;
  reasoning: string;
}

interface Settlement {
  freelancer_payout_eth: number;
  client_refund_eth: number;
  platform_fee_eth: number;
}

interface Escrow {
  id: number;
  client: string;
  freelancer: string;
  amount_eth: number;
  task_description: string;
  deliverable_url: string;
  status: Status;
  validator_results: ValidatorResult[];
  votes: Vote[];
  final_verdict: Vote | "";
  settlement: Settlement | null;
  created_at: string;
  resolved_at: string | null;
}

const kv = await Deno.openKv();

// ─────────────────────────────────────────────
// CORE UTILS
// ─────────────────────────────────────────────

function cors(h: HeadersInit = {}) {
  const x = new Headers(h);
  x.set("Access-Control-Allow-Origin", "*");
  x.set("Access-Control-Allow-Headers", "Content-Type");
  x.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return x;
}

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: cors({ "Content-Type": "application/json" }),
  });
}

async function getEscrow(id: number) {
  return (await kv.get<Escrow>(["e", id])).value ?? null;
}

async function setEscrow(e: Escrow) {
  await kv.set(["e", e.id], e);
}

async function nextId() {
  const c = await kv.get<number>(["c"]);
  const id = c.value ?? 0;
  await kv.set(["c"], id + 1);
  return id;
}

// ─────────────────────────────────────────────
// CONSENSUS
// ─────────────────────────────────────────────

function fee(a: number) {
  return (a * FEE_BPS) / 10000;
}

function settle(a: number, v: Vote): Settlement {
  const f = fee(a);
  const net = a - f;

  if (v === "approved")
    return { freelancer_payout_eth: net, client_refund_eth: 0, platform_fee_eth: f };

  if (v === "partial")
    return { freelancer_payout_eth: net / 2, client_refund_eth: net / 2, platform_fee_eth: f };

  return { freelancer_payout_eth: 0, client_refund_eth: net, platform_fee_eth: f };
}

function majority(v: Vote[]): Vote {
  const c = { approved: 0, partial: 0, rejected: 0 };
  for (const x of v) c[x]++;

  if (c.approved >= 2) return "approved";
  if (c.rejected >= 2) return "rejected";
  if (c.partial >= 2) return "partial";

  return "partial";
}

// ─────────────────────────────────────────────
// AI
// ─────────────────────────────────────────────

async function call(role: string, task: string, url: string): Promise<ValidatorResult> {
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: `ROLE:${role}
TASK:${task}
URL:${url}
Return JSON: {"verdict":"approved|partial|rejected","reasoning":"..."}`,
          },
        ],
      }),
    });

    const d = await r.json();
    const text = d?.choices?.[0]?.message?.content ?? "";

    let p;
    try {
      p = JSON.parse(text);
    } catch {
      return { validator: role, verdict: "partial", reasoning: "parse" };
    }

    const v = (p.verdict ?? "").toLowerCase();

    return {
      validator: role,
      verdict: v === "approved" || v === "rejected" ? v : "partial",
      reasoning: p.reasoning ?? "",
    };
  } catch {
    return { validator: role, verdict: "partial", reasoning: "error" };
  }
}

// ─────────────────────────────────────────────
// FRONTEND (FIXED: ORANGE DARK UI + LOG PANEL + NO POPUPS + LIVE STATE)
// ─────────────────────────────────────────────

function ui() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>AI Escrow</title>

<style>
body{
  margin:0;
  font-family:Arial;
  background:#0b0a08;
  color:#fff;
}

header{
  padding:16px;
  font-weight:800;
  color:#ff7a18;
}

.container{
  padding:16px;
}

.row{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

.card{
  flex:1;
  min-width:220px;
  background:#14110f;
  border:1px solid #2a1d12;
  border-radius:12px;
  padding:12px;
}

input,textarea{
  width:100%;
  margin-top:6px;
  margin-bottom:10px;
  padding:8px;
  background:#0e0c0a;
  border:1px solid #3a2416;
  color:#fff;
  border-radius:8px;
  font-size:12px;
}

button{
  background:#ff7a18;
  border:none;
  padding:8px 10px;
  border-radius:8px;
  font-weight:700;
  cursor:pointer;
  width:100%;
}

button:hover{
  background:#ff9a3d;
}

.small{
  font-size:11px;
  opacity:0.8;
}

.status{
  display:flex;
  justify-content:space-between;
  font-size:12px;
  margin-top:6px;
  padding:6px;
  background:#0e0c0a;
  border-radius:8px;
  border:1px solid #2a1d12;
}

.logs{
  position:fixed;
  bottom:0;
  left:0;
  right:0;
  height:160px;
  background:#0a0705;
  border-top:1px solid #3a2416;
  overflow:auto;
  font-size:11px;
  padding:10px;
}

.logline{
  margin-bottom:4px;
  color:#ffb37a;
}

.grid{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

.title{
  color:#ff7a18;
  font-weight:700;
  margin-bottom:6px;
}

.idbox{
  font-size:12px;
  margin-top:6px;
  color:#ffb37a;
}
</style>
</head>

<body>

<header>⚖ AI ESCROW GENLAYER</header>

<div class="container">

<div class="grid">

<div class="card">
<div class="title">CREATE</div>
<input id="f" placeholder="freelancer"/>
<input id="a" type="number" placeholder="eth"/>
<textarea id="t" placeholder="task"></textarea>
<button onclick="create()">create</button>
<div class="idbox" id="cid">id: -</div>
</div>

<div class="card">
<div class="title">SUBMIT</div>
<input id="sid" type="number"/>
<input id="u" placeholder="url"/>
<button onclick="submitW()">submit</button>
<div class="idbox" id="sstat">status: -</div>
</div>

<div class="card">
<div class="title">ARBITRATE</div>
<input id="aid" type="number"/>
<button onclick="arb()">run ai</button>
<div class="idbox" id="astat">status: -</div>
</div>

<div class="card">
<div class="title">CHECK</div>
<input id="gid" type="number"/>
<button onclick="get()">refresh</button>
<pre id="out"></pre>
</div>

</div>

</div>

<div class="logs" id="logs"></div>

<script>

function log(x){
  const el=document.getElementById('logs');
  const d=document.createElement('div');
  d.className='logline';
  d.textContent=new Date().toLocaleTimeString()+': '+x;
  el.appendChild(d);
  el.scrollTop=el.scrollHeight;
}

async function create(){
  const r=await fetch('/api/escrow/create',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      freelancer:f.value,
      amount_eth:Number(a.value),
      task_description:t.value,
      client:'web'
    })
  });

  const d=await r.json();

  cid.innerText='id: '+d.escrow_id;
  log('created escrow '+d.escrow_id);
}

async function submitW(){
  const r=await fetch('/api/escrow/'+sid.value+'/submit',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({deliverable_url:u.value})
  });

  const d=await r.json();

  sstat.innerText='status: submitted';
  log('submitted '+sid.value);
}

async function arb(){
  const r=await fetch('/api/escrow/'+aid.value+'/arbitrate',{
    method:'POST'
  });

  const d=await r.json();

  astat.innerText='status: '+d.final;
  log('arbitrated '+aid.value+' -> '+d.final);
}

async function get(){
  const r=await fetch('/api/escrow/'+gid.value);
  const d=await r.json();

  out.textContent=JSON.stringify(d,null,2);
}

</script>

</body>
</html>`;
}

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const u = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  if (u.pathname === "/") return new Response(ui(), { headers: cors({ "Content-Type": "text/html" }) });

  if (u.pathname === "/api/escrow/create") {
    const b = await req.json();

    const id = await nextId();

    const e: Escrow = {
      id,
      client: b.client,
      freelancer: b.freelancer,
      amount_eth: Number(b.amount_eth),
      task_description: b.task_description,
      deliverable_url: "",
      status: "pending",
      validator_results: [],
      votes: [],
      final_verdict: "",
      settlement: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };

    await setEscrow(e);

    return json({ escrow_id: id });
  }

  const s = u.pathname.match(/\/api\/escrow\/(\d+)\/submit/);
  if (s) {
    const id = Number(s[1]);
    const e = await getEscrow(id);
    if (!e) return json({ error: "not found" }, 404);

    const b = await req.json();

    e.deliverable_url = b.deliverable_url;
    e.status = "submitted";

    await setEscrow(e);

    return json({ ok: true });
  }

  const a = u.pathname.match(/\/api\/escrow\/(\d+)\/arbitrate/);
  if (a) {
    const id = Number(a[1]);
    const e = await getEscrow(id);
    if (!e) return json({ error: "not found" }, 404);

    if (e.status !== "submitted") {
      return json({ error: "bad state" }, 400);
    }

    e.status = "disputed";
    await setEscrow(e);

    const v1 = await call("technical", e.task_description, e.deliverable_url);
    const v2 = await call("coverage", e.task_description, e.deliverable_url);
    const v3 = await call("quality", e.task_description, e.deliverable_url);

    const votes = [v1.verdict, v2.verdict, v3.verdict];
    const final = majority(votes);

    e.validator_results = [v1, v2, v3];
    e.votes = votes;
    e.final_verdict = final;
    e.status = final;
    e.settlement = settle(e.amount_eth, final);
    e.resolved_at = new Date().toISOString();

    await setEscrow(e);

    return json({ final });
  }

  const g = u.pathname.match(/\/api\/escrow\/(\d+)$/);
  if (g) {
    const e = await getEscrow(Number(g[1]));
    if (!e) return json({ error: "not found" }, 404);
    return json(e);
  }

  return json({ error: "not found" }, 404);
});
