// ─────────────────────────────────────────────────────────────
// AI ESCROW — GENLAYER STYLE EXECUTION RUNTIME
// main.ts
//
// Deno Deploy / Deno KV compatible
//
// Features:
// - Contract-parity lifecycle
// - 3 independent AI validators
// - Consensus / majority vote
// - Settlement simulation
// - Disputed state
// - Validator reasoning
// - Platform fee simulation
// - GenLayer-style execution flow
//
// Run locally:
// deno run --unstable-kv --allow-env --allow-net main.ts
//
// Required ENV:
// GROQ_API_KEY=xxx
// LLM_PROVIDER=llama-3.1-8b-instant
// ─────────────────────────────────────────────────────────────

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL =
  Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

const PLATFORM_FEE_BPS = 100; // 1%

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

console.log("✅ KV initialized");

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────

function cors(headers: HeadersInit = {}) {
  const h = new Headers(headers);

  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");

  return h;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: cors({
      "Content-Type": "application/json",
    }),
  });
}

async function logAudit(
  action: string,
  details: Record<string, unknown>,
) {
  await kv.set(["audit", Date.now()], {
    action,
    details,
    timestamp: new Date().toISOString(),
  });

  console.log("📜", action, details);
}

async function getEscrow(id: number): Promise<Escrow | null> {
  const res = await kv.get<Escrow>(["escrow", id]);
  return res.value ?? null;
}

async function setEscrow(escrow: Escrow) {
  await kv.set(["escrow", escrow.id], escrow);

  await logAudit("escrow_updated", {
    id: escrow.id,
    status: escrow.status,
  });
}

async function nextId() {
  const counter = await kv.get<number>(["counter"]);

  const id = counter.value ?? 0;

  await kv.set(["counter"], id + 1);

  return id;
}

async function countEscrows() {
  const counter = await kv.get<number>(["counter"]);
  return counter.value ?? 0;
}

async function getAllEscrows(): Promise<Escrow[]> {
  const list: Escrow[] = [];

  for await (const entry of kv.list<Escrow>({
    prefix: ["escrow"],
  })) {
    list.push(entry.value);
  }

  return list;
}

// ─────────────────────────────────────────────────────────────
// CONSENSUS
// ─────────────────────────────────────────────────────────────

function computePlatformFee(amount: number) {
  return Number(
    ((amount * PLATFORM_FEE_BPS) / 10000).toFixed(6),
  );
}

function computeSettlement(
  amount: number,
  verdict: VoteResult,
): Settlement {
  const fee = computePlatformFee(amount);

  const net = amount - fee;

  if (verdict === "approved") {
    return {
      freelancer_payout_eth: Number(net.toFixed(6)),
      client_refund_eth: 0,
      platform_fee_eth: fee,
    };
  }

  if (verdict === "partial") {
    return {
      freelancer_payout_eth: Number((net / 2).toFixed(6)),
      client_refund_eth: Number((net / 2).toFixed(6)),
      platform_fee_eth: fee,
    };
  }

  return {
    freelancer_payout_eth: 0,
    client_refund_eth: Number(net.toFixed(6)),
    platform_fee_eth: fee,
  };
}

function majorityVote(votes: VoteResult[]): VoteResult {
  const counts = {
    approved: 0,
    partial: 0,
    rejected: 0,
  };

  for (const v of votes) {
    counts[v]++;
  }

  let max = 0;
  let winner: VoteResult = "partial";

  for (const [k, v] of Object.entries(counts)) {
    if (v > max) {
      max = v;
      winner = k as VoteResult;
    }
  }

  if (max >= 2) return winner;

  return "partial";
}

function parseVerdict(text: string): VoteResult {
  const t = text.trim().toLowerCase();

  if (t === "approved") return "approved";
  if (t === "rejected") return "rejected";
  if (t === "partial") return "partial";

  return "partial";
}

// ─────────────────────────────────────────────────────────────
// AI AGENTS
// ─────────────────────────────────────────────────────────────

async function callValidator(
  validator: string,
  task: string,
  url: string,
): Promise<ValidatorResult> {
  if (!GROQ_API_KEY) {
    return {
      validator,
      verdict: "partial",
      reasoning: "Missing GROQ_API_KEY",
    };
  }

  const prompt = `
You are an AI validator for a GenLayer intelligent escrow contract.

VALIDATOR ROLE:
${validator}

TASK:
${task}

DELIVERABLE URL:
${url}

Evaluate the work.

Return STRICT JSON only:

{
  "verdict": "approved" | "partial" | "rejected",
  "reasoning": "short explanation"
}
`;

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
              content: prompt,
            },
          ],
        }),
      },
    );

    const data = await res.json();

    const content =
      data?.choices?.[0]?.message?.content ?? "";

    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        validator,
        verdict: "partial",
        reasoning: "Validator returned invalid JSON",
      };
    }

    return {
      validator,
      verdict: parseVerdict(parsed.verdict ?? ""),
      reasoning:
        String(parsed.reasoning ?? "").slice(0, 300),
    };
  } catch (e) {
    return {
      validator,
      verdict: "partial",
      reasoning: "Validator error: " + e.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// FRONTEND
// ─────────────────────────────────────────────────────────────

function frontendHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>AI Escrow</title>

<style>
body{
  background:#0b0f18;
  color:white;
  font-family:Arial;
  max-width:900px;
  margin:auto;
  padding:40px;
}

.card{
  background:#121826;
  padding:20px;
  border-radius:14px;
  margin-bottom:20px;
}

input,textarea{
  width:100%;
  padding:12px;
  margin-top:8px;
  margin-bottom:16px;
  background:#0b1220;
  border:1px solid #263041;
  color:white;
  border-radius:8px;
}

button{
  padding:12px 18px;
  border:none;
  border-radius:10px;
  cursor:pointer;
  background:#00d4ff;
  font-weight:bold;
}

pre{
  overflow:auto;
  background:#081018;
  padding:14px;
  border-radius:10px;
}

.status{
  padding:6px 12px;
  border-radius:999px;
  display:inline-block;
  font-size:12px;
  margin-bottom:10px;
  background:#182338;
}

h1{
  margin-bottom:30px;
}
</style>
</head>

<body>

<h1>⚖️ AI Escrow</h1>

<div class="card">

<h2>Create Escrow</h2>

<input id="freelancer" placeholder="0xFreelancer">

<input id="amount" type="number" placeholder="ETH amount">

<textarea id="task" placeholder="Task description"></textarea>

<button onclick="createEscrow()">
Create Escrow
</button>

</div>

<div class="card">

<h2>Submit Work</h2>

<input id="submitId" type="number" placeholder="Escrow ID">

<input id="deliverable" placeholder="https://github.com/...">

<button onclick="submitWork()">
Submit
</button>

</div>

<div class="card">

<h2>Run Arbitration</h2>

<input id="arbId" type="number" placeholder="Escrow ID">

<button onclick="arbitrate()">
Arbitrate
</button>

</div>

<div class="card">

<h2>Check Status</h2>

<input id="statusId" type="number" placeholder="Escrow ID">

<button onclick="checkStatus()">
Check
</button>

<pre id="statusOutput"></pre>

</div>

<script>

async function createEscrow(){

  const res = await fetch('/api/escrow/create',{
    method:'POST',
    headers:{
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      client:'web-user',
      freelancer:document.getElementById('freelancer').value,
      amount_eth:Number(document.getElementById('amount').value),
      task_description:document.getElementById('task').value
    })
  });

  const data = await res.json();

  alert(JSON.stringify(data,null,2));
}

async function submitWork(){

  const id=document.getElementById('submitId').value;

  const res = await fetch('/api/escrow/'+id+'/submit',{
    method:'POST',
    headers:{
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      deliverable_url:document.getElementById('deliverable').value
    })
  });

  const data = await res.json();

  alert(JSON.stringify(data,null,2));
}

async function arbitrate(){

  const id=document.getElementById('arbId').value;

  const res = await fetch('/api/escrow/'+id+'/arbitrate',{
    method:'POST'
  });

  const data = await res.json();

  alert(JSON.stringify(data,null,2));
}

async function checkStatus(){

  const id=document.getElementById('statusId').value;

  const res = await fetch('/api/escrow/'+id);

  const data = await res.json();

  document.getElementById('statusOutput').textContent=
    JSON.stringify(data,null,2);
}
</script>

</body>
</html>
`;
}

// ─────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(),
    });
  }

  // FRONTEND

  if (path === "/") {
    return new Response(frontendHTML(), {
      headers: cors({
        "Content-Type": "text/html",
      }),
    });
  }

  // HEALTH

  if (path === "/health") {
    return json({
      status: "ok",
      total_escrows: await countEscrows(),
      llm_model: LLM_MODEL,
    });
  }

  // ALL ESCROWS

  if (path === "/api/escrows") {
    return json({
      success: true,
      escrows: await getAllEscrows(),
    });
  }

  // GET ESCROW

  const getMatch = path.match(/^\/api\/escrow\/(\d+)$/);

  if (req.method === "GET" && getMatch) {
    const id = Number(getMatch[1]);

    const escrow = await getEscrow(id);

    if (!escrow) {
      return json({
        success: false,
        error: "Escrow not found",
      }, 404);
    }

    return json({
      success: true,
      escrow,
    });
  }

  // CREATE

  if (
    req.method === "POST" &&
    path === "/api/escrow/create"
  ) {
    try {
      const body = await req.json();

      const {
        client,
        freelancer,
        amount_eth,
        task_description,
      } = body;

      if (!freelancer) {
        throw new Error("Freelancer required");
      }

      if (!amount_eth || amount_eth <= 0) {
        throw new Error("Invalid amount");
      }

      if (
        !task_description ||
        task_description.length < 20
      ) {
        throw new Error(
          "Task description too short",
        );
      }

      const id = await nextId();

      const escrow: Escrow = {
        id,

        client: client || "anonymous",
        freelancer,

        amount_eth: Number(amount_eth),

        task_description,

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

      return json({
        success: true,
        escrow_id: id,
        total: await countEscrows(),
      });
    } catch (e) {
      return json({
        success: false,
        error: e.message,
      }, 400);
    }
  }

  // SUBMIT

  const submitMatch = path.match(
    /^\/api\/escrow\/(\d+)\/submit$/,
  );

  if (req.method === "POST" && submitMatch) {
    try {
      const id = Number(submitMatch[1]);

      const escrow = await getEscrow(id);

      if (!escrow) {
        throw new Error("Escrow not found");
      }

      if (escrow.status !== "pending") {
        throw new Error(
          "Escrow must be pending",
        );
      }

      const body = await req.json();

      const { deliverable_url } = body;

      if (!deliverable_url) {
        throw new Error(
          "deliverable_url required",
        );
      }

      if (
        !deliverable_url.startsWith("http")
      ) {
        throw new Error(
          "URL must start with http",
        );
      }

      escrow.deliverable_url =
        deliverable_url;

      escrow.status = "submitted";

      await setEscrow(escrow);

      return json({
        success: true,
        escrow_id: id,
        status: escrow.status,
      });
    } catch (e) {
      return json({
        success: false,
        error: e.message,
      }, 400);
    }
  }

  // ARBITRATION

  const arbMatch = path.match(
    /^\/api\/escrow\/(\d+)\/arbitrate$/,
  );

  if (req.method === "POST" && arbMatch) {
    try {
      const id = Number(arbMatch[1]);

      const escrow = await getEscrow(id);

      if (!escrow) {
        throw new Error("Escrow not found");
      }

      if (escrow.status !== "submitted") {
        throw new Error(
          "Escrow must be submitted",
        );
      }

      // LOCK
      escrow.status = "disputed";

      await setEscrow(escrow);

      const start = Date.now();

      const validators = await Promise.all([
        callValidator(
          "Technical Completeness",
          escrow.task_description,
          escrow.deliverable_url,
        ),

        callValidator(
          "Requirement Coverage",
          escrow.task_description,
          escrow.deliverable_url,
        ),

        callValidator(
          "Quality & Professionalism",
          escrow.task_description,
          escrow.deliverable_url,
        ),
      ]);

      const votes = validators.map(
        (v) => v.verdict,
      );

      const finalVerdict =
        majorityVote(votes);

      escrow.validator_results =
        validators;

      escrow.votes = votes;

      escrow.final_verdict =
        finalVerdict;

      escrow.status = finalVerdict;

      escrow.settlement =
        computeSettlement(
          escrow.amount_eth,
          finalVerdict,
        );

      escrow.resolved_at =
        new Date().toISOString();

      await setEscrow(escrow);

      return json({
        success: true,

        escrow_id: id,

        votes,

        final_verdict:
          finalVerdict,

        validator_results:
          validators,

        settlement:
          escrow.settlement,

        processing_time_ms:
          Date.now() - start,
      });
    } catch (e) {
      return json({
        success: false,
        error: e.message,
      }, 400);
    }
  }

  return json({
    success: false,
    error: "Not found",
    path,
  }, 404);
});
