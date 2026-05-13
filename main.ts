// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");

console.log(`🚀 AI Escrow Backend (Real Groq Agents) запущен на порту ${PORT}`);

serve(async (req: Request) => {
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
      message: "AI Escrow Backend — Real 3 LLM Agents",
      port: PORT
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

  // ====================== TRIGGER ARBITRATION ======================
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

// ==================== GROQ HELPERS ====================
async function callGroq(prompt: string): Promise<string> {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");

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
  if (!res.ok) throw new Error(data.error?.message || "Groq API error");
  
  return data.choices[0].message.content.trim();
}

// ==================== 3 AGENTS ====================
async function runThreeRealAgents(task: string, url: string): Promise<string[]> {
  const agentPrompts = [
    // Agent 1: Technical Completeness
    `You are a strict technical evaluator for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL: ${url}

Respond with EXACTLY one word: APPROVED, PARTIAL or REJECTED`,

    // Agent 2: Requirement Coverage
    `You are a meticulous requirements analyst for a freelance escrow system.

TASK SPECIFICATION:
${task}

DELIVERABLE URL: ${url}

Respond with EXACTLY one word: APPROVED, PARTIAL or REJECTED`,

    // Agent 3: Quality & Professionalism
    `You are a quality assurance expert evaluating freelance work for escrow release.

TASK SPECIFICATION:
${task}

DELIVERABLE URL: ${url}

Respond with EXACTLY one word: APPROVED, PARTIAL or REJECTED`
  ];

  const votes: string[] = [];
  const names = ["Technical", "Requirements", "Quality"];

  for (let i = 0; i < 3; i++) {
    try {
      const result = await callGroq(agentPrompts[i]);
      const vote = parseVerdict(result);
      votes.push(vote);
      console.log(`✅ Agent ${names[i]}: ${vote}`);
    } catch (e) {
      console.error(`Agent ${i+1} failed`, e);
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
