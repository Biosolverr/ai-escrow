// ── AI Escrow — Production Ready (Improved) ─────────────────────────────
// ℹ️ Requires: deno.json + GROQ_API_KEY in environment variables
// ℹ️ Run locally:
// deno run --unstable-kv --allow-env --allow-net main.ts

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL =
  Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

interface Escrow {
  id: number;
  client: string;
  freelancer: string;
  amount_eth: string;
  task_description: string;
  deliverable_url: string;
  status:
    | "pending"
    | "submitted"
    | "approved"
    | "partial"
    | "rejected";
  votes: string[];
  final_verdict: string;
  created_at: string;
}

const kv = await Deno.openKv();

console.info("✅ Deno KV initialized successfully");

// ── Helpers ──────────────────────────────────────────────────────────────

async function logAudit(
  action: string,
  details: Record<string, unknown>,
) {
  const entry = {
    action,
    details,
    timestamp: new Date().toISOString(),
  };

  await kv.set(["log", Date.now()], entry);

  console.info(`📜 AUDIT: ${action}`, JSON.stringify(details));
}

async function getEscrow(id: number): Promise<Escrow | null> {
  const res = await kv.get<Escrow>(["escrow", id]);
  return res.value ?? null;
}

async function setEscrow(escrow: Escrow): Promise<void> {
  await kv.set(["escrow", escrow.id], escrow);

  await logAudit("escrow_updated", {
    id: escrow.id,
    status: escrow.status,
  });
}

// ✅ FIXED: atomic counter (race-condition safe)
async function nextId(): Promise<number> {
  while (true) {
    const counter = await kv.get<number>(["counter"]);

    const current = counter.value ?? 0;

    const res = await kv.atomic()
      .check(counter)
      .set(["counter"], current + 1)
      .commit();

    if (res.ok) {
      console.info(
        `🆔 Generated ID: ${current} (counter updated to ${current + 1})`,
      );

      return current;
    }

    console.warn("⚠️ Counter race detected, retrying...");
  }
}

async function countEscrows(): Promise<number> {
  const res = await kv.get<number>(["counter"]);
  return res.value ?? 0;
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
    headers: cors({
      "Content-Type": "application/json",
    }),
  });
}

// ── AI Validators ────────────────────────────────────────────────────────

async function callAgent(
  role: string,
  task: string,
  url: string,
): Promise<"approved" | "partial" | "rejected"> {
  const prompt = `
You are an AI escrow arbitration agent.

Role:
${role}

Task:
${task}

Deliverable URL:
${url}

Respond with EXACTLY ONE WORD:
approved
partial
rejected
`;

  try {
    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          max_tokens: 10,
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

    const text = data?.choices?.[0]?.message?.content
      ?.trim()
      ?.toLowerCase() ?? "";

    if (text.includes("approved")) return "approved";
    if (text.includes("rejected")) return "rejected";

    return "partial";
  } catch (e) {
    console.warn("⚠️ AI agent failed:", e);

    return "partial";
  }
}

// ✅ safer consensus logic
function majority(votes: string[]): string {
  const counts: Record<string, number> = {
    approved: 0,
    partial: 0,
    rejected: 0,
  };

  for (const v of votes) {
    if (counts[v] !== undefined) {
      counts[v]++;
    }
  }

  if (counts.approved >= 2) return "approved";
  if (counts.rejected >= 2) return "rejected";

  return "partial";
}

// ── Frontend ─────────────────────────────────────────────────────────────

function frontendHTML(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AI Escrow</title>
</head>
<body style="background:#0b0f1a;color:white;font-family:sans-serif;padding:40px">

<h1>⚖️ AI Escrow</h1>

<h3>Create Escrow</h3>

<input id="freelancer" placeholder="Freelancer address"><br><br>
<input id="amount" placeholder="ETH amount"><br><br>

<textarea id="task" placeholder="Task description"></textarea><br><br>

<button onclick="createEscrow()">Create Escrow</button>

<hr>

<h3>Submit Work</h3>

<input id="submitId" placeholder="Escrow ID"><br><br>
<input id="url" placeholder="Deliverable URL"><br><br>

<button onclick="submitWork()">Submit</button>

<hr>

<h3>Run Arbitration</h3>

<input id="arbId" placeholder="Escrow ID"><br><br>

<button onclick="runArb()">Arbitrate</button>

<hr>

<pre id="log"></pre>

<script>

function log(msg) {
  document.getElementById("log").textContent += msg + "\\n";
}

async function createEscrow() {
  const freelancer =
    document.getElementById("freelancer").value;

  const amount =
    document.getElementById("amount").value;

  const task =
    document.getElementById("task").value;

  const res = await fetch("/api/escrow/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      freelancer,
      amount_eth: amount,
      task_description: task,
      client: "web-user"
    })
  });

  const data = await res.json();

  log(JSON.stringify(data, null, 2));
}

async function submitWork() {
  const id =
    document.getElementById("submitId").value;

  const url =
    document.getElementById("url").value;

  const res = await fetch(
    "/api/escrow/" + id + "/submit",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deliverable_url: url
      })
    }
  );

  const data = await res.json();

  log(JSON.stringify(data, null, 2));
}

async function runArb() {
  const id =
    document.getElementById("arbId").value;

  const res = await fetch(
    "/api/escrow/" + id + "/arbitrate",
    {
      method: "POST"
    }
  );

  const data = await res.json();

  log(JSON.stringify(data, null, 2));
}

</script>

</body>
</html>
`;
}

// ── Router ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  const path = url.pathname;

  const method = req.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors(),
    });
  }

  // ── Frontend ───────────────────────────────────────────────────────────

  if (method === "GET" && (path === "/" || path === "")) {
    return new Response(frontendHTML(), {
      headers: cors({
        "Content-Type": "text/html; charset=utf-8",
      }),
    });
  }

  // ── Health ─────────────────────────────────────────────────────────────

  if (method === "GET" && path === "/health") {
    return json({
      status: "ok",
      version: "5.0",
      network: "DENO-DEPLOY",
      total_escrows: await countEscrows(),
    });
  }

  // ── All escrows ────────────────────────────────────────────────────────

  if (method === "GET" && path === "/api/escrows") {
    return json({
      success: true,
      escrows: await getAllEscrows(),
    });
  }

  // ── Single escrow ──────────────────────────────────────────────────────

  const getMatch = path.match(/^\/api\/escrow\/(\d+)$/);

  if (method === "GET" && getMatch) {
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
      ...escrow,
    });
  }

  // ── Create escrow ──────────────────────────────────────────────────────

  if (method === "POST" && path === "/api/escrow/create") {
    try {
      const {
        freelancer,
        amount_eth,
        task_description,
        client,
      } = await req.json();

      if (!freelancer) {
        throw new Error("Freelancer required");
      }

      if (!amount_eth || Number(amount_eth) <= 0) {
        throw new Error("Invalid escrow amount");
      }

      if (
        !task_description ||
        task_description.trim().length < 20
      ) {
        throw new Error(
          "Task description too short (min 20 chars)",
        );
      }

      const id = await nextId();

      const escrow: Escrow = {
        id,
        client: client || "anonymous",
        freelancer,
        amount_eth: String(amount_eth),
        task_description,
        deliverable_url: "",
        status: "pending",
        votes: [],
        final_verdict: "",
        created_at: new Date().toISOString(),
      };

      await setEscrow(escrow);

      console.info(
        `💼 Escrow #${id} created (${amount_eth} ETH)`,
      );

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

  // ── Submit work ────────────────────────────────────────────────────────

  const submitMatch =
    path.match(/^\/api\/escrow\/(\d+)\/submit$/);

  if (method === "POST" && submitMatch) {
    try {
      const id = Number(submitMatch[1]);

      const escrow = await getEscrow(id);

      if (!escrow) {
        throw new Error("Escrow not found");
      }

      // ✅ prevent re-submit
      if (escrow.status !== "pending") {
        throw new Error(
          "Escrow already submitted or finalized",
        );
      }

      const { deliverable_url } = await req.json();

      if (!deliverable_url) {
        throw new Error("deliverable_url required");
      }

      if (
        !deliverable_url.match(/^https?:\/\//i)
      ) {
        throw new Error(
          "URL must start with http:// or https://",
        );
      }

      escrow.deliverable_url = deliverable_url;
      escrow.status = "submitted";

      await setEscrow(escrow);

      console.info(
        `📦 Escrow #${id} submitted`,
      );

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

  // ── Arbitration ────────────────────────────────────────────────────────

  const arbMatch =
    path.match(/^\/api\/escrow\/(\d+)\/arbitrate$/);

  if (method === "POST" && arbMatch) {
    try {
      const id = Number(arbMatch[1]);

      const escrow = await getEscrow(id);

      if (!escrow) {
        throw new Error("Escrow not found");
      }

      if (escrow.status !== "submitted") {
        throw new Error(
          "Escrow must be submitted first",
        );
      }

      // ✅ prevent re-arbitration
      if (escrow.final_verdict) {
        throw new Error(
          "Arbitration already completed",
        );
      }

      const start = Date.now();

      console.info(
        `🤖 Starting arbitration for escrow #${id}`,
      );

      const [v1, v2, v3] = await Promise.all([
        callAgent(
          "Technical Completeness",
          escrow.task_description,
          escrow.deliverable_url,
        ),

        callAgent(
          "Requirement Coverage",
          escrow.task_description,
          escrow.deliverable_url,
        ),

        callAgent(
          "Quality & Professionalism",
          escrow.task_description,
          escrow.deliverable_url,
        ),
      ]);

      const votes = [v1, v2, v3];

      const final_verdict = majority(votes);

      escrow.votes = votes;
      escrow.final_verdict = final_verdict;
      escrow.status = final_verdict as Escrow["status"];

      await setEscrow(escrow);

      console.info(
        `🏁 Escrow #${id} verdict: ${final_verdict}`,
      );

      return json({
        success: true,
        escrow_id: id,
        votes,
        final_verdict,
        processing_time_ms: Date.now() - start,
      });
    } catch (e) {
      return json({
        success: false,
        error: e.message,
      }, 400);
    }
  }

  // ── Not Found ──────────────────────────────────────────────────────────

  return json({
    success: false,
    error: "Not Found",
    path,
  }, 404);
});
