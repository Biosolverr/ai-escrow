// main.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/genlayer-js@latest";

const PORT = Deno.env.get("PORT") || 8000;
const CONTRACT_ADDRESS = Deno.env.get("CONTRACT_ADDRESS") || "";
const RPC_URL = Deno.env.get("GENLAYER_RPC_URL") || "https://rpc.testnet.genlayer.com";

console.log(`🚀 AI Escrow Backend запущен на http://localhost:${PORT}`);
console.log(`📄 Contract Address: ${CONTRACT_ADDRESS}`);

const client = createClient({
  chain: { rpcUrl: RPC_URL },
});

serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // ==================== HEALTH ====================
  if (path === "/" || path === "/health") {
    return Response.json({
      status: "ok",
      message: "AI Escrow Backend is running",
      contract: CONTRACT_ADDRESS,
      network: Deno.env.get("GENLAYER_NETWORK") || "studionet"
    }, { headers });
  }

  // ==================== CREATE ESCROW ====================
  if (path === "/api/create-escrow" && req.method === "POST") {
    const { freelancer, task_description, value } = await req.json();

    try {
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "create_escrow",
        args: [freelancer, task_description],
        value: value || "1000000000000000000", // 1 ETH
      });

      return Response.json({ success: true, txHash }, { headers });
    } catch (e: any) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // ==================== SUBMIT WORK ====================
  if (path === "/api/submit-work" && req.method === "POST") {
    const { escrow_id, deliverable_url } = await req.json();

    try {
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "submit_work",
        args: [Number(escrow_id), deliverable_url],
      });
      return Response.json({ success: true, txHash }, { headers });
    } catch (e: any) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // ==================== TRIGGER ARBITRATION ====================
  if (path === "/api/trigger-arbitration" && req.method === "POST") {
    const { escrow_id } = await req.json();

    try {
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "trigger_arbitration",
        args: [Number(escrow_id)],
      });
      return Response.json({ success: true, txHash }, { headers });
    } catch (e: any) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // ==================== GET SINGLE ESCROW ====================
  if (path.startsWith("/api/escrow/") && req.method === "GET") {
    const escrow_id = parseInt(path.split("/").pop() || "0");

    try {
      const data = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_escrow",
        args: [escrow_id],
      });
      return Response.json({ success: true, data }, { headers });
    } catch (e: any) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // ==================== GET VERDICT ====================
  if (path === "/api/get-verdict" && req.method === "POST") {
    const { escrow_id } = await req.json();

    try {
      const data = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_verdict",
        args: [Number(escrow_id)],
      });
      return Response.json({ success: true, data }, { headers });
    } catch (e: any) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  // ==================== LIST ALL ESCROWS ====================
  if (path === "/api/escrows" && req.method === "GET") {
    try {
      const total = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_total_escrows",
        args: [],
      });

      const escrows = [];
      for (let i = 0; i < Number(total); i++) {
        try {
          const escrow = await client.readContract({
            address: CONTRACT_ADDRESS,
            functionName: "get_escrow",
            args: [i],
          });
          escrows.push({ id: i, ...escrow });
        } catch (_) {}
      }

      return Response.json({ success: true, total: Number(total), escrows }, { headers });
    } catch (e: any) {
      return Response.json({ success: false, error: e.message }, { status: 500, headers });
    }
  }

  return new Response("Not Found", { status: 404, headers });
});
