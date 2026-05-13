// ─────────────────────────────────────────────────────────────
// AI ESCROW — GENLAYER EXECUTION RUNTIME (FIXED FRONTEND + BACKEND)
// single-file Deno Deploy version
// ─────────────────────────────────────────────────────────────

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL =
  Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

const PLATFORM_FEE_BPS = 100;

type EscrowStatus =
  | "pending"
  | "submitted"
  | "disputed"
  | "approved"
  | "partial"
  | "rejected";

type VoteResult = "approved" | "partial" | "rejected";

interface ValidatorResult {
  validator: string;
  verdict: VoteResult;
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
  status: EscrowStatus;
  validator_results: ValidatorResult[];
  votes: VoteResult[];
  final_verdict: VoteResult | "";
  settlement: Settlement | null;
  created_at: string;
  resolved_at: string | null;
}

const kv = await Deno.openKv();

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────

function cors(headers: HeadersInit = {}) {
  const h = new Headers(headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json" }),
  });
}

async function getEscrow(id: number): Promise<Escrow | null> {
  return (await kv.get<Escrow>(["escrow", id])).value ?? null;
}

async function setEscrow(e: Escrow) {
  await kv.set(["escrow", e.id], e);
}

// ─────────────────────────────────────────────
// ID
// ─────────────────────────────────────────────

async function nextId() {
  const c = await kv.get<number>(["counter"]);
  const id = c.value ?? 0;
  await kv.set(["counter"], id + 1);
  return id;
}

// ─────────────────────────────────────────────
// CONSENSUS
// ─────────────────────────────────────────────

function fee(amount: number) {
  return (amount * PLATFORM_FEE_BPS) / 10000;
}

function settlement(amount: number, v: VoteResult): Settlement {
  const f = fee(amount);
  const net = amount - f;

  if (v === "approved") {
    return {
      freelancer_payout_eth: net,
      client_refund_eth: 0,
      platform_fee_eth: f,
    };
  }

  if (v === "partial") {
    return {
      freelancer_payout_eth: net / 2,
      client_refund_eth: net / 2,
      platform_fee_eth: f,
    };
  }

  return {
    freelancer_payout_eth: 0,
    client_refund_eth: net,
    platform_fee_eth: f,
  };
}

function majority(votes: VoteResult[]): VoteResult {
  const c = { approved: 0, partial: 0, rejected: 0 };
  for (const v of votes) c[v]++;

  if (c.approved >= 2) return "approved";
  if (c.rejected >= 2) return "rejected";
  if (c.partial >= 2) return "partial";

  return "partial";
}

// ─────────────────────────────────────────────
// AI
// ─────────────────────────────────────────────

async function callValidator(
  role: string,
  task: string,
  url: string,
): Promise<ValidatorResult> {
  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          temperature: 0.2,
          max_tokens: 120,
          messages: [
            {
              role: "user",
              content: `
ROLE:${role}
TASK:${task}
URL:${url}

Return JSON:
{"verdict":"approved|partial|rejected","reasoning":"..."}`,
            },
          ],
        }),
      },
    );

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { validator: role, verdict: "partial", reasoning: "parse error" };
    }

    const v = (parsed.verdict ?? "partial").toLowerCase();

    return {
      validator: role,
      verdict: v === "approved" || v === "rejected" ? v : "partial",
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return { validator: role, verdict: "partial", reasoning: "error" };
  }
}

// ─────────────────────────────────────────────
// FRONTEND (FIXED: NO CONFIRM POPUP, NO STATE BUG)
// ─────────────────────────────────────────────

function frontend() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>AI Escrow</title>
<style>
body{background:#0b0f18;color:#fff;font-family:Arial;max-width:900px;margin:auto;padding:40px}
.card{background:#121826;padding:20px;border-radius:12px;margin-bottom:20px}
input,textarea{width:100%;padding:10px;margin:8px 0;background:#0a0f1a;color:#fff;border:1px solid #2a3550;border-radius:8px}
button{padding:10px 14px;border:0;border-radius:8px;background:#00d4ff;font-weight:700;cursor:pointer}
pre{background:#0a0f1a;padding:12px;border-radius:10px;overflow:auto}
.status{padding:6px 10px;background:#1b2335;border-radius:20px;display:inline-block}
</style>
</head>
<body>

<h2>AI ESCROW</h2>

<div class="card">
<h3>Create</h3>
<input id="f"/>
<input id="a" type="number"/>
<textarea id="t"></textarea>
<button onclick="create()">CREATE</button>
</div>

<div class="card">
<h3>Submit</h3>
<input id="sid" type="number"/>
<input id="u"/>
<button onclick="submitW()">SUBMIT</button>
</div>

<div class="card">
<h3>Arbitrate</h3>
<input id="aid" type="number"/>
<button onclick="arb()">RUN</button>
</div>

<div class="card">
<h3>Status</h3>
<input id="st" type="number"/>
<button onclick="stat()">CHECK</button>
<pre id="out"></pre>
</div>

<script>

async function create(){
  const r = await fetch('/api/escrow/create',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      freelancer: f.value,
      amount_eth: Number(a.value),
      task_description: t.value,
      client:'web'
    })
  });
  alert(JSON.stringify(await r.json(),null,2));
}

async function submitW(){
  const r = await fetch('/api/escrow/'+sid.value+'/submit',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({deliverable_url:u.value})
  });
  alert(JSON.stringify(await r.json(),null,2));
}

async function arb(){
  const r = await fetch('/api/escrow/'+aid.value+'/arbitrate',{
    method:'POST'
  });
  alert(JSON.stringify(await r.json(),null,2));
}

async function stat(){
  const r = await fetch('/api/escrow/'+st.value);
  const d = await r.json();
  out.textContent = JSON.stringify(d,null,2);
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

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  if (url.pathname === "/") {
    return new Response(frontend(), { headers: cors({ "Content-Type": "text/html" }) });
  }

  if (url.pathname === "/health") {
    return json({ ok: true });
  }

  if (url.pathname === "/api/escrow/create") {
    const b = await req.json();

    const id = await nextId();

    const escrow: Escrow = {
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

    await setEscrow(escrow);

    return json({ success: true, escrow_id: id });
  }

  const submit = url.pathname.match(/\/api\/escrow\/(\d+)\/submit/);
  if (submit) {
    const id = Number(submit[1]);
    const e = await getEscrow(id);
    if (!e) return json({ error: "not found" }, 404);

    const b = await req.json();

    e.deliverable_url = b.deliverable_url;
    e.status = "submitted";

    await setEscrow(e);

    return json({ success: true });
  }

  const arb = url.pathname.match(/\/api\/escrow\/(\d+)\/arbitrate/);
  if (arb) {
    const id = Number(arb[1]);
    const e = await getEscrow(id);
    if (!e) return json({ error: "not found" }, 404);

    if (e.status !== "submitted") {
      return json({ error: "bad state" }, 400);
    }

    e.status = "disputed";
    await setEscrow(e);

    const v1 = await callValidator("technical", e.task_description, e.deliverable_url);
    const v2 = await callValidator("coverage", e.task_description, e.deliverable_url);
    const v3 = await callValidator("quality", e.task_description, e.deliverable_url);

    const votes = [v1.verdict, v2.verdict, v3.verdict];

    const final = majority(votes);

    e.validator_results = [v1, v2, v3];
    e.votes = votes;
    e.final_verdict = final;
    e.status = final;
    e.settlement = settlement(e.amount_eth, final);
    e.resolved_at = new Date().toISOString();

    await setEscrow(e);

    return json({ success: true, votes, final });
  }

  const get = url.pathname.match(/\/api\/escrow\/(\d+)$/);
  if (get) {
    const e = await getEscrow(Number(get[1]));
    if (!e) return json({ error: "not found" }, 404);
    return json({ success: true, escrow: e });
  }

  return json({ error: "not found" }, 404);
});
