// main.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PORT = Deno.env.get("PORT") || 8000;

console.log(`🚀 AI Escrow Backend запущен на порту ${PORT}`);

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Главная страница
  if (path === "/" || path === "") {
    return new Response(
      JSON.stringify({
        message: "AI Escrow Backend is running",
        endpoints: [
          "/health",
          "/contract/info",
          "/api/arbitrate"
        ],
        network: Deno.env.get("GENLAYER_NETWORK") || "studionet"
      }),
      { headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  // Health check
  if (path === "/health") {
    return new Response(
      JSON.stringify({ status: "ok", time: new Date().toISOString() }),
      { headers: { ...headers, "Content-Type": "application/json" } }
    );
  }

  return new Response("Not Found", { status: 404, headers });
});
