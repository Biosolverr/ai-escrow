// main.ts - Powerful AI Escrow Backend v2.0
console.log("🚀 AI Escrow Backend v2.0 - Real Multi-Agent System Started");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // ====================== HEALTH ======================
  if (path === "/" || path === "/health") {
    return Response.json({
      status: "ok",
      version: "2.0",
      message: "AI Escrow Backend — Real 3 LLM Agents",
      providers: ["Groq"],
      endpoints: ["/health", "/api/trigger-arbitration"]
    }, { headers });
  }

  // ====================== TRIGGER ARBITRATION ======================
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, error: "Invalid JSON" }, { status: 400, headers });
    }

    const { task_description, deliverable_url, escrow_id } = body;

    if (!task_description || !deliverable_url) {
      return Response.json({ 
        success: false, 
        error: "task_description and deliverable_url are required" 
      }, { status: 400, headers });
    }

    console.log(`⚖️ Arbitration started for escrow #${escrow_id || 'unknown'}`);

    const startTime = Date.now();
    const votes = await runThreeRealAgents(task_description, deliverable_url);
    const final_verdict = getMajorityVote(votes);
    const duration = Date.now() - startTime;

    return Response.json({
      success: true,
      escrow_id: escrow_id || Math.floor(Math.random() * 10000),
      votes: votes,
      final_verdict: final_verdict,
      status: final_verdict.toUpperCase(),
      processing_time_ms: duration,
      timestamp: new Date().toISOString()
    }, { headers });
  }

  return new Response(JSON.stringify({ error: "Not Found" }), { 
    status: 404, 
    headers 
  });
});

// ==================== REAL GROQ AGENTS (улучшенные промпты) ====================
async function callGroq(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 250,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Groq API Error");
  return data.choices[0].message.content.trim();
}

async function runThreeRealAgents(task: string, url: string): Promise<string[]> {
  const prompts = [
    // Agent 1: Technical Completeness
    `You are a strict technical evaluator for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL:
${url}

Evaluate if the deliverable is technically complete and functional.
Respond with **EXACTLY** one word: APPROVED, PARTIAL or REJECTED`,

    // Agent 2: Requirement Coverage
    `You are a meticulous requirements analyst for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL:
${url}

Check how well the deliverable covers the requirements.
Respond with **EXACTLY** one word: APPROVED, PARTIAL or REJECTED`,

    // Agent 3: Quality & Professionalism
    `You are a quality assurance expert for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL:
${url}

Evaluate overall quality, polish and professionalism.
Respond with **EXACTLY** one word: APPROVED, PARTIAL or REJECTED`
  ];

  const votes: string[] = [];
  const names = ["Technical Completeness", "Requirement Coverage", "Quality & Professionalism"];

  for (let i = 0; i < 3; i++) {
    try {
      const result = await callGroq(prompts[i]);
      const verdict = parseVerdict(result);
      votes.push(verdict);
      console.log(`✅ ${names[i]} → ${verdict}`);
    } catch (err) {
      console.error(`❌ Agent ${i+1} failed:`, err);
      votes.push("partial");
    }
  }

  return votes;
}

function parseVerdict(text: string): string {
  const t = text.toUpperCase();
  if (t.includes("APPROVED")) return "approved";
  if (t.includes("REJECTED")) return "rejected";
  return "partial";
}

function getMajorityVote(votes: string[]): string {
  const count = { approved: 0, partial: 0, rejected: 0 };
  votes.forEach(v => count[v as keyof typeof count]++);

  if (count.approved >= 2) return "approved";
  if (count.rejected >= 2) return "rejected";
  return "partial";
}
