// main.ts - AI Escrow Backend v2.1 (Strong Submission Version)
console.log("🚀 AI Escrow Backend v2.1 - Real Multi-LLM Arbitration System");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Health
  if (path === "/" || path === "/health") {
    return Response.json({
      status: "ok",
      version: "2.1",
      message: "AI Escrow Backend — Real 3 LLM Agents",
      description: "Trustless freelance escrow with AI consensus",
      providers: ["Groq (llama-3.1-8b-instant)"],
      endpoints: ["/health", "/api/trigger-arbitration"]
    }, { headers });
  }

  // Main Endpoint
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400, headers });
    }

    const { task_description, deliverable_url, escrow_id } = body;

    if (!task_description || !deliverable_url) {
      return Response.json({ 
        success: false, 
        error: "task_description and deliverable_url are required" 
      }, { status: 400, headers });
    }

    const start = Date.now();
    const votes = await runThreeRealAgents(task_description, deliverable_url);
    const final_verdict = getMajorityVote(votes);
    const duration = Date.now() - start;

    return Response.json({
      success: true,
      escrow_id: escrow_id || Math.floor(Math.random() * 9999),
      votes: votes,
      final_verdict: final_verdict,
      status: final_verdict.toUpperCase(),
      processing_time_ms: duration,
      timestamp: new Date().toISOString(),
      note: "Powered by 3 independent Groq LLM agents + majority vote"
    }, { headers });
  }

  return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
});

// ==================== CORE LOGIC ====================
async function callGroq(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 250,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Groq error");
  return data.choices[0].message.content.trim();
}

async function runThreeRealAgents(task: string, url: string) {
  const prompts = [
    `You are a strict technical evaluator...\nTASK: ${task}\nURL: ${url}\nReply with exactly one word: APPROVED, PARTIAL or REJECTED`,
    `You are a meticulous requirements analyst...\nTASK: ${task}\nURL: ${url}\nReply with exactly one word: APPROVED, PARTIAL or REJECTED`,
    `You are a quality assurance expert...\nTASK: ${task}\nURL: ${url}\nReply with exactly one word: APPROVED, PARTIAL or REJECTED`
  ];

  const votes: string[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      const res = await callGroq(prompts[i]);
      const vote = res.toUpperCase().includes("APPROVED") ? "approved" :
                   res.toUpperCase().includes("REJECTED") ? "rejected" : "partial";
      votes.push(vote);
    } catch {
      votes.push("partial");
    }
  }
  return votes;
}

function getMajorityVote(votes: string[]): string {
  const count = { approved: 0, partial: 0, rejected: 0 };
  votes.forEach(v => count[v as keyof typeof count]++);
  if (count.approved >= 2) return "approved";
  if (count.rejected >= 2) return "rejected";
  return "partial";
}
