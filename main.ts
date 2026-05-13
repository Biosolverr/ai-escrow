// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PORT = Deno.env.get("PORT") || 8000;

console.log(`🚀 AI Escrow Backend (Real Groq Agents) запущен на порту ${PORT}`);

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  if (path === "/" || path === "/health") {
    return Response.json({ 
      status: "ok", 
      message: "AI Escrow Backend — Real 3 LLM Agents",
    }, { headers });
  }

  // Create Escrow
  if (path === "/api/create-escrow" && req.method === "POST") {
    const { freelancer, task_description } = await req.json();
    const escrow_id = Math.floor(Math.random() * 100000);
    return Response.json({ success: true, escrow_id }, { headers });
  }

  // Submit Work
  if (path === "/api/submit-work" && req.method === "POST") {
    const { escrow_id, deliverable_url } = await req.json();
    return Response.json({ success: true, escrow_id, deliverable_url }, { headers });
  }

  // Trigger Arbitration — 3 реальных агента
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    const { escrow_id, task_description, deliverable_url } = await req.json();

    if (!task_description || !deliverable_url) {
      return Response.json({ success: false, error: "task_description и deliverable_url обязательны" }, { status: 400, headers });
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

// ==================== REAL GROQ CALL ====================
async function callGroq(prompt: string): Promise<string> {
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
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Groq error");
  return data.choices[0].message.content.trim();
}

// ==================== 3 АГЕНТА ИЗ КОНТРАКТА ====================
async function runThreeRealAgents(task: string, url: string) {
  const agents = [
    // Agent 1 — Technical Completeness
    `You are a strict technical evaluator for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL: ${url}

Evaluate whether the deliverable is TECHNICALLY COMPLETE.
Respond with EXACTLY one of these words and nothing else:
APPROVED
PARTIAL
REJECTED`,

    // Agent 2 — Requirement Coverage
    `You are a meticulous requirements analyst for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL: ${url}

Extract explicit requirements and check coverage.
Respond with EXACTLY one of these words and nothing else:
APPROVED
PARTIAL
REJECTED`,

    // Agent 3 — Quality & Professionalism
    `You are a quality assurance expert evaluating freelance work for escrow release.

TASK SPECIFICATION:
${task}

DELIVERABLE URL: ${url}

Evaluate overall QUALITY and PROFESSIONALISM.
Respond with EXACTLY one of these words and nothing else:
APPROVED
PARTIAL
REJECTED`
  ];

  const votes: string[] = [];
  const names = ["Technical Completeness", "Requirement Coverage", "Quality & Professionalism"];

  for (let i = 0; i < 3; i++) {
    try {
      console.log(`🤖 Agent ${i+1} (${names[i]}) running...`);
      const result = await callGroq(agents[i]);
      const vote = parseVerdict(result);
      votes.push(vote);
      console.log(`   → ${names[i]}: ${vote}`);
    } catch (e) {
      console.error(`Agent ${i+1} failed:`, e);
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
