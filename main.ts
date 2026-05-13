// main.ts
console.log("🚀 AI Escrow Backend starting on Deno Deploy...");

Deno.serve((req: Request) => {
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

  if (path === "/" || path === "/health") {
    return Response.json({
      status: "ok",
      message: "AI Escrow Backend is LIVE",
      backend_url: "working"
    }, { headers });
  }

  // Простой тестовый эндпоинт для фронтенда
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    return Response.json({
      success: true,
      votes: ["approved", "partial", "approved"],
      final_verdict: "approved",
      status: "APPROVED"
    }, { headers });
  }

  return new Response("Not Found", { status: 404, headers });
});
