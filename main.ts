// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PORT = Deno.env.get("PORT") || 8000;

console.log(`🚀 AI Escrow Backend запущен на http://localhost:${PORT}`);

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Health
  if (path === "/" || path === "/health") {
    return Response.json({ 
      status: "ok", 
      message: "AI Escrow Backend (Standalone Mode)",
      mode: "demo"
    }, { headers });
  }

  // ====================== CREATE ESCROW ======================
  if (path === "/api/create-escrow" && req.method === "POST") {
    const body = await req.json();
    const escrow_id = Math.floor(Math.random() * 10000);

    return Response.json({
      success: true,
      escrow_id: escrow_id,
      message: "Escrow created (demo mode)"
    }, { headers });
  }

  // ====================== SUBMIT WORK ======================
  if (path === "/api/submit-work" && req.method === "POST") {
    const { escrow_id, deliverable_url } = await req.json();

    return Response.json({
      success: true,
      message: `Work submitted for escrow #${escrow_id}`,
      deliverable_url
    }, { headers });
  }

  // ====================== TRIGGER ARBITRATION (3 агента) ======================
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    const { escrow_id, task_description, deliverable_url } = await req.json();

    // Здесь будет вызов 3 LLM-агентов
    const votes = await runThreeAgents(task_description, deliverable_url);

    const final_verdict = getMajorityVote(votes);

    return Response.json({
      success: true,
      escrow_id,
      votes: votes,
      final_verdict: final_verdict,
      status: final_verdict === "approved" ? "APPROVED" : 
              final_verdict === "rejected" ? "REJECTED" : "PARTIAL"
    }, { headers });
  }

  return new Response("Not Found", { status: 404, headers });
});

// ==================== 3 LLM АГЕНТА ====================
async function runThreeAgents(task: string, url: string) {
  const prompts = [
    "technical_completeness",
    "requirement_coverage",
    "quality_professionalism"
  ];

  const votes = [];

  for (const type of prompts) {
    const vote = await callLLMAgent(type, task, url);
    votes.push(vote);
  }

  return votes;
}

async function callLLMAgent(agentType: string, task: string, url: string): Promise<string> {
  const provider = Deno.env.get("LLM_PROVIDER") || "groq/llama-3.1-8b-instant";
  
  // Здесь можно сделать реальный вызов Groq, но для начала — имитация
  // Чтобы работало сразу — оставляем умную имитацию

  await new Promise(r => setTimeout(r, 800)); // имитация задержки

  // Простая логика для демо (можно потом заменить на реальный Groq)
  const random = Math.random();
  if (random > 0.75) return "approved";
  if (random > 0.4) return "partial";
  return "rejected";
}

function getMajorityVote(votes: string[]): string {
  const count = { approved: 0, partial: 0, rejected: 0 };
  votes.forEach(v => count[v as keyof typeof count]++);

  if (count.approved >= 2) return "approved";
  if (count.rejected >= 2) return "rejected";
  return "partial";
}
