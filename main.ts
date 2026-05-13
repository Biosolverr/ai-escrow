// main.ts
console.log("🚀 AI Escrow Backend starting...");

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

  // ====================== HEALTH ======================
  if (path === "/" || path === "/health") {
    return Response.json({
      status: "ok",
      message: "AI Escrow Backend — Real Groq Agents",
      version: "1.0"
    }, { headers });
  }

  // ====================== CREATE ESCROW ======================
  if (path === "/api/create-escrow" && req.method === "POST") {
    const { freelancer, task_description } = await req.json();
    const escrow_id = Math.floor(Math.random() * 100000);

    return Response.json({
      success: true,
      escrow_id,
      message: "Escrow created successfully"
    }, { headers });
  }

  // ====================== SUBMIT WORK ======================
  if (path === "/api/submit-work" && req.method === "POST") {
    const { escrow_id, deliverable_url } = await req.json();

    return Response.json({
      success: true,
      escrow_id,
      deliverable_url
    }, { headers });
  }

  // ====================== TRIGGER ARBITRATION (3 Groq Agents) ======================
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    const { escrow_id, task_description, deliverable_url } = await req.json();

    if (!task_description || !deliverable_url) {
      return Response.json({ 
        success: false, 
        error: "task_description and deliverable_url are required" 
      }, { status: 400, headers });
    }

    const votes = await runThreeRealAgents(task_description, deliverable_url);
    const final_verdict = getMajorityVote(votes);

    return Response.json({
      success: true,
      escrow_id,
      votes,
      final_verdict,
      status: final_verdict.toUpperCase()
    }, { headers });
  }

  return new Response("Not Found", { status: 404, headers });
});

// ==================== GROQ + 3 AGENTS ====================
async function callGroq(prompt: string): Promise<string> {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: 300,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Groq API error");

  return data.choices[0].message.content.trim();
}

async function runThreeRealAgents(task: string, url: string): Promise<string[]> {
  const prompts = [
    `You are a strict technical evaluator.\n\nTASK: ${task}\n\nURL: ${url}\n\nAnswer with exactly one word: APPROVED, PARTIAL or REJECTED`,
    `You are a meticulous requirements analyst.\n\nTASK: ${task}\n\nURL: ${url}\n\nAnswer with exactly one word: APPROVED, PARTIAL or REJECTED`,
    `You are a quality assurance expert.\n\nTASK: ${task}\n\nURL: ${url}\n\nAnswer with exactly one word: APPROVED, PARTIAL or REJECTED`
  ];

  const votes: string[] = [];

  for (let i = 0; i < 3; i++) {
    try {
      const result = await callGroq(prompts[i]);
      const vote = result.toUpperCase().includes("APPROVED") ? "approved" :
                   result.toUpperCase().includes("REJECTED") ? "rejected" : "partial";
      votes.push(vote);
      console.log(`Agent ${i+1}: ${vote}`);
    } catch (e) {
      console.error(`Agent ${i+1} failed:`, e);
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
