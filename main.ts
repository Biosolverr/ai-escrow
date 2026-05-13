// main.ts
console.log("🚀 AI Escrow Backend v1.0 (Real Agents Mode)");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Health check
  if (path === "/" || path === "/health") {
    return Response.json({
      status: "ok",
      message: "AI Escrow Backend — Real Groq Agents",
      mode: "production"
    }, { headers });
  }

  // ==================== TRIGGER ARBITRATION ====================
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { task_description, deliverable_url, escrow_id } = body;

    if (!task_description || !deliverable_url) {
      return Response.json({
        success: false,
        error: "task_description and deliverable_url are required"
      }, { status: 400, headers });
    }

    console.log(`⚖️ Starting arbitration for escrow #${escrow_id || '?'}`);

    const votes = await runThreeRealAgents(task_description, deliverable_url);
    const final_verdict = getMajorityVote(votes);

    return Response.json({
      success: true,
      escrow_id: escrow_id || 1,
      votes: votes,
      final_verdict: final_verdict,
      status: final_verdict.toUpperCase(),
      timestamp: new Date().toISOString()
    }, { headers });
  }

  return new Response("Not Found", { status: 404, headers });
});

// ==================== REAL GROQ AGENTS ====================
async function callGroq(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY not found");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 150,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Groq error");
  
  return data.choices[0].message.content.trim();
}

async function runThreeRealAgents(task: string, url: string) {
  const prompts = [
    // Agent 1 - Technical Completeness
    `You are a strict technical evaluator.\n\nTASK:\n${task}\n\nDELIVERABLE:\n${url}\n\nReply with exactly one word: APPROVED, PARTIAL or REJECTED`,

    // Agent 2 - Requirement Coverage
    `You are a meticulous requirements analyst.\n\nTASK:\n${task}\n\nDELIVERABLE:\n${url}\n\nReply with exactly one word: APPROVED, PARTIAL or REJECTED`,

    // Agent 3 - Quality & Professionalism
    `You are a quality assurance expert.\n\nTASK:\n${task}\n\nDELIVERABLE:\n${url}\n\nReply with exactly one word: APPROVED, PARTIAL or REJECTED`
  ];

  const votes: string[] = [];
  const agentNames = ["Technical", "Requirements", "Quality"];

  for (let i = 0; i < 3; i++) {
    try {
      const result = await callGroq(prompts[i]);
      const verdict = result.toUpperCase().includes("APPROVED") ? "approved" :
                      result.toUpperCase().includes("REJECTED") ? "rejected" : "partial";
      votes.push(verdict);
      console.log(`✅ Agent ${agentNames[i]} → ${verdict}`);
    } catch (e) {
      console.error(`Agent ${i+1} failed`, e);
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
