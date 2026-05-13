// ── AI Escrow Backend — main.ts ────────────────────────────────────────────
// Deploy on Deno Deploy. Serves frontend + full REST API.
// Uses Groq API for 3-agent arbitration.

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL = Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

// ── In-memory storage ──────────────────────────────────────────────────────
interface Escrow {
  id: number;
  client: string;
  freelancer: string;
  amount_eth: string;
  task_description: string;
  deliverable_url: string;
  status: "pending" | "submitted" | "approved" | "partial" | "rejected";
  votes: string[];
  final_verdict: string;
  created_at: string;
}

const escrows = new Map<number, Escrow>();
let escrowCounter = 0;

// ── CORS headers ───────────────────────────────────────────────────────────
function cors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json" }),
  });
}

// ── AI Agent call via Groq ─────────────────────────────────────────────────
async function callAgent(
  agentRole: string,
  taskDescription: string,
  deliverableUrl: string
): Promise<"approved" | "partial" | "rejected"> {
  const prompt = `You are an AI escrow arbitration agent. Your role: ${agentRole}.

Task that was agreed upon:
${taskDescription}

Deliverable URL submitted by freelancer:
${deliverableUrl}

Evaluate whether the freelancer completed the task as specified.
Respond with EXACTLY one word — your verdict:
- "approved" — task fully completed
- "partial" — task partially completed
- "rejected" — task not completed or does not meet requirements

Your verdict (one word only):`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 10,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";

    if (text.includes("approved")) return "approved";
    if (text.includes("rejected")) return "rejected";
    return "partial";
  } catch {
    return "partial";
  }
}

// ── Majority vote ──────────────────────────────────────────────────────────
function majority(votes: string[]): string {
  const count: Record<string, number> = { approved: 0, partial: 0, rejected: 0 };
  votes.forEach((v) => { if (count[v] !== undefined) count[v]++; });
  const max = Math.max(...Object.values(count));
  for (const [k, v] of Object.entries(count)) {
    if (v === max && max >= 2) return k;
  }
  return "partial";
}

// ── Frontend HTML ──────────────────────────────────────────────────────────
function frontendHTML(): string {
  // Inline the frontend — API_BASE points to same origin
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Escrow — Smart Dispute Resolver</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#080a0f;--surface:#0e1118;--border:#1c2030;--border2:#252d40;
    --accent:#00e5ff;--accent2:#7b61ff;--warn:#ff6b35;--green:#00ff88;
    --red:#ff3b5c;--text:#e8eaf0;--muted:#5a6380;
    --mono:'JetBrains Mono',monospace;--display:'Syne',sans-serif;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:var(--display);min-height:100vh;overflow-x:hidden}
  body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(0,229,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
  .orb{position:fixed;border-radius:50%;filter:blur(120px);pointer-events:none;z-index:0}
  .orb-1{width:500px;height:500px;background:radial-gradient(circle,rgba(0,229,255,0.06),transparent 70%);top:-100px;left:-100px}
  .orb-2{width:400px;height:400px;background:radial-gradient(circle,rgba(123,97,255,0.07),transparent 70%);bottom:0;right:-50px}
  .wrap{position:relative;z-index:1;max-width:900px;margin:0 auto;padding:0 24px 80px}
  header{position:relative;z-index:1;padding:32px 24px 0;max-width:900px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
  .logo{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .logo-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px}
  .badge{font-family:var(--mono);font-size:10px;padding:3px 8px;border:1px solid var(--border2);border-radius:4px;color:var(--muted);letter-spacing:.1em}
  .hero{padding:64px 0 48px;animation:fadeUp .7s ease both}
  .hero-tag{font-family:var(--mono);font-size:11px;color:var(--accent);letter-spacing:.2em;text-transform:uppercase;margin-bottom:20px;display:flex;align-items:center;gap:8px}
  .hero-tag::before{content:'';width:24px;height:1px;background:var(--accent)}
  h1{font-size:clamp(36px,6vw,64px);font-weight:800;line-height:1.05;letter-spacing:-.02em;margin-bottom:20px}
  h1 span{background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .hero-sub{font-family:var(--mono);font-size:14px;color:var(--muted);line-height:1.7;max-width:560px}
  .flow{display:flex;align-items:center;gap:0;margin:40px 0;overflow-x:auto;padding-bottom:8px;animation:fadeUp .7s .15s ease both}
  .flow-step{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0}
  .flow-node{width:48px;height:48px;border:1px solid var(--border2);border-radius:12px;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:20px;transition:border-color .2s,box-shadow .2s}
  .flow-node:hover{border-color:var(--accent);box-shadow:0 0 20px rgba(0,229,255,.15)}
  .flow-label{font-family:var(--mono);font-size:9px;color:var(--muted);text-align:center;letter-spacing:.05em;max-width:60px}
  .flow-arrow{width:32px;height:1px;background:linear-gradient(90deg,var(--border2),var(--accent),var(--border2));flex-shrink:0;margin-bottom:20px;position:relative}
  .flow-arrow::after{content:'▶';position:absolute;right:-6px;top:-7px;font-size:8px;color:var(--accent)}
  .section-title{font-family:var(--mono);font-size:10px;color:var(--accent);letter-spacing:.2em;text-transform:uppercase;margin-bottom:16px;display:flex;align-items:center;gap:8px}
  .section-title::after{content:'';flex:1;height:1px;background:var(--border)}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:16px;transition:border-color .2s;animation:fadeUp .6s ease both}
  .card:hover{border-color:var(--border2)}
  label{display:block;font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
  input,textarea{width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px 16px;color:var(--text);font-family:var(--mono);font-size:13px;outline:none;transition:border-color .2s,box-shadow .2s;margin-bottom:16px}
  input:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,229,255,.08)}
  textarea{resize:vertical;min-height:100px}
  .field-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:600px){.field-row{grid-template-columns:1fr}}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:13px 24px;border-radius:10px;font-family:var(--display);font-size:13px;font-weight:700;letter-spacing:.05em;cursor:pointer;border:none;transition:all .2s;text-transform:uppercase}
  .btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#000}
  .btn-primary:hover{opacity:.9;transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,229,255,.25)}
  .btn-outline{background:transparent;border:1px solid var(--border2);color:var(--text)}
  .btn-outline:hover{border-color:var(--accent);color:var(--accent)}
  .btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important}
  .amount-wrap{position:relative}
  .amount-wrap input{padding-right:60px}
  .amount-unit{position:absolute;right:16px;top:50%;transform:translateY(-60%);font-family:var(--mono);font-size:11px;color:var(--muted)}
  .tabs{display:flex;gap:4px;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:4px;margin-bottom:24px}
  .tab{flex:1;padding:10px;border-radius:8px;border:none;background:transparent;color:var(--muted);font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;transition:all .2s}
  .tab.active{background:var(--surface);color:var(--text);border:1px solid var(--border2)}
  .tab-panel{display:none}
  .tab-panel.active{display:block}
  .verdict-box{border-radius:16px;padding:32px;text-align:center;border:1px solid var(--border2);margin-top:20px;display:none}
  .verdict-box.show{display:block;animation:fadeUp .5s ease both}
  .verdict-box.approved{border-color:var(--green);background:rgba(0,255,136,.04)}
  .verdict-box.partial{border-color:var(--warn);background:rgba(255,107,53,.04)}
  .verdict-box.rejected{border-color:var(--red);background:rgba(255,59,92,.04)}
  .verdict-emoji{font-size:48px;margin-bottom:12px}
  .verdict-label{font-size:28px;font-weight:800;letter-spacing:.05em;margin-bottom:8px}
  .verdict-box.approved .verdict-label{color:var(--green)}
  .verdict-box.partial .verdict-label{color:var(--warn)}
  .verdict-box.rejected .verdict-label{color:var(--red)}
  .verdict-desc{font-family:var(--mono);font-size:12px;color:var(--muted);margin-bottom:20px}
  .votes-row{display:flex;gap:12px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}
  .vote-chip{font-family:var(--mono);font-size:11px;padding:6px 14px;border-radius:20px;border:1px solid;display:flex;align-items:center;gap:6px}
  .vote-chip.approved{border-color:var(--green);color:var(--green);background:rgba(0,255,136,.08)}
  .vote-chip.partial{border-color:var(--warn);color:var(--warn);background:rgba(255,107,53,.08)}
  .vote-chip.rejected{border-color:var(--red);color:var(--red);background:rgba(255,59,92,.08)}
  .status-pill{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;padding:4px 10px;border-radius:20px;border:1px solid var(--border2);color:var(--muted);letter-spacing:.08em}
  .status-pill.pending{border-color:#ffd60a33;color:#ffd60a}
  .status-pill.submitted{border-color:#5e9cff33;color:#5e9cff}
  .status-pill.approved{border-color:var(--green);color:var(--green)}
  .status-pill.rejected{border-color:var(--red);color:var(--red)}
  .status-pill.partial{border-color:var(--warn);color:var(--warn)}
  .pulse{width:6px;height:6px;border-radius:50%;background:currentColor;animation:pulse 1.5s infinite}
  .terminal{background:#050709;border:1px solid var(--border);border-radius:12px;padding:16px;font-family:var(--mono);font-size:12px;line-height:1.8;max-height:200px;overflow-y:auto;margin-top:16px}
  .log-line{display:flex;gap:12px}
  .log-time{color:var(--muted);flex-shrink:0}
  .log-info{color:var(--accent)}
  .log-warn{color:var(--warn)}
  .log-ok{color:var(--green)}
  .log-err{color:var(--red)}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px;animation:fadeUp .6s .1s ease both}
  .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center}
  .stat-val{font-size:28px;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .stat-key{font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-top:4px}
  .loader{display:inline-block;width:14px;height:14px;border:2px solid rgba(0,229,255,.2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
  .agents{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
  .agent-card{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center;transition:border-color .3s}
  .agent-card.thinking{border-color:var(--accent);box-shadow:0 0 16px rgba(0,229,255,.1)}
  .agent-card.done-approved{border-color:var(--green)}
  .agent-card.done-partial{border-color:var(--warn)}
  .agent-card.done-rejected{border-color:var(--red)}
  .agent-icon{font-size:24px;margin-bottom:8px}
  .agent-name{font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:.08em}
  .agent-verdict{font-size:11px;font-weight:700;margin-top:6px;letter-spacing:.05em}
  .escrow-id-display{background:var(--bg);border:1px solid var(--border2);border-radius:10px;padding:12px 16px;font-family:var(--mono);font-size:13px;color:var(--accent);margin-bottom:16px;display:none}
  .escrow-id-display.show{display:flex;align-items:center;justify-content:space-between}
  .copy-btn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;transition:color .2s}
  .copy-btn:hover{color:var(--accent)}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<div class="orb orb-1"></div>
<div class="orb orb-2"></div>
<header>
  <div class="logo"><div class="logo-icon">⚖</div>AI ESCROW</div>
  <div style="display:flex;gap:8px;align-items:center">
    <span class="badge">GENLAYER</span>
    <span class="badge" id="networkBadge">CONNECTING...</span>
  </div>
</header>
<div class="wrap">
  <div class="hero">
    <div class="hero-tag">Powered by 3 LLM Validators</div>
    <h1>Trustless Freelance<br><span>Smart Dispute</span> Resolution</h1>
    <p class="hero-sub">Escrow funds released by AI consensus — not humans.<br>Three independent agents evaluate deliverables. Majority rules.</p>
  </div>
  <div class="flow">
    <div class="flow-step"><div class="flow-node">💼</div><div class="flow-label">CREATE ESCROW</div></div>
    <div class="flow-arrow"></div>
    <div class="flow-step"><div class="flow-node">🛠</div><div class="flow-label">SUBMIT WORK</div></div>
    <div class="flow-arrow"></div>
    <div class="flow-step"><div class="flow-node">🤖</div><div class="flow-label">AI ARBITRATION</div></div>
    <div class="flow-arrow"></div>
    <div class="flow-step"><div class="flow-node">⚡</div><div class="flow-label">CONSENSUS VOTE</div></div>
    <div class="flow-arrow"></div>
    <div class="flow-step"><div class="flow-node">💰</div><div class="flow-label">FUNDS RELEASED</div></div>
  </div>
  <div class="stats">
    <div class="stat-card"><div class="stat-val" id="statEscrows">0</div><div class="stat-key">Total Escrows</div></div>
    <div class="stat-card"><div class="stat-val">3</div><div class="stat-key">AI Validators</div></div>
    <div class="stat-card"><div class="stat-val">1%</div><div class="stat-key">Platform Fee</div></div>
  </div>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('create',this)">💼 Create Escrow</button>
    <button class="tab" onclick="switchTab('submit',this)">🛠 Submit Work</button>
    <button class="tab" onclick="switchTab('arbitrate',this)">⚖ Arbitrate</button>
    <button class="tab" onclick="switchTab('status',this)">📊 Check Status</button>
  </div>

  <!-- CREATE -->
  <div id="tab-create" class="tab-panel active">
    <div class="section-title">New Escrow</div>
    <div class="card">
      <div class="field-row">
        <div><label>Freelancer Address</label><input type="text" id="freelancerAddr" placeholder="0x..."></div>
        <div><label>Amount (ETH)</label><div class="amount-wrap"><input type="number" id="escrowAmount" placeholder="1.0" min="0.001" step="0.001"><span class="amount-unit">ETH</span></div></div>
      </div>
      <label>Task Specification</label>
      <textarea id="taskSpec" placeholder="Describe the deliverable in detail..."></textarea>
      <button class="btn btn-primary" onclick="createEscrow()"><span>Create Escrow</span> →</button>
    </div>
    <div class="escrow-id-display" id="newEscrowId">
      <span>Escrow ID: <strong id="newEscrowIdVal">—</strong></span>
      <button class="copy-btn" onclick="copyId()">⎘</button>
    </div>
    <div class="terminal" id="createLog" style="display:none"></div>
  </div>

  <!-- SUBMIT -->
  <div id="tab-submit" class="tab-panel">
    <div class="section-title">Submit Deliverable</div>
    <div class="card">
      <label>Escrow ID</label><input type="number" id="submitEscrowId" placeholder="0">
      <label>Deliverable URL</label><input type="text" id="deliverableUrl" placeholder="https://github.com/user/repo">
      <button class="btn btn-primary" onclick="submitWork()"><span>Submit Work</span> →</button>
    </div>
    <div class="terminal" id="submitLog" style="display:none"></div>
  </div>

  <!-- ARBITRATE -->
  <div id="tab-arbitrate" class="tab-panel">
    <div class="section-title">AI Arbitration</div>
    <div class="card">
      <label>Escrow ID</label><input type="number" id="arbitrateId" placeholder="0">
      <label>Task Specification</label>
      <textarea id="arbitrateTaskSpec" placeholder="Describe the task requirements..."></textarea>
      <label>Deliverable URL</label>
      <input type="text" id="arbitrateDeliverableUrl" placeholder="https://github.com/user/repo">
      <div class="agents" id="agentsDisplay" style="display:none">
        <div class="agent-card" id="agent1"><div class="agent-icon">🔍</div><div class="agent-name">TECHNICAL<br>COMPLETENESS</div><div class="agent-verdict" id="a1verdict">—</div></div>
        <div class="agent-card" id="agent2"><div class="agent-icon">📋</div><div class="agent-name">REQUIREMENT<br>COVERAGE</div><div class="agent-verdict" id="a2verdict">—</div></div>
        <div class="agent-card" id="agent3"><div class="agent-icon">⭐</div><div class="agent-name">QUALITY &<br>PROFESSIONALISM</div><div class="agent-verdict" id="a3verdict">—</div></div>
      </div>
      <button class="btn btn-primary" id="arbitrateBtn" onclick="triggerArbitration()" style="margin-top:8px"><span>Trigger AI Arbitration</span> →</button>
    </div>
    <div class="verdict-box" id="verdictBox">
      <div class="verdict-emoji" id="verdictEmoji">—</div>
      <div class="verdict-label" id="verdictLabel">—</div>
      <div class="verdict-desc" id="verdictDesc">—</div>
      <div class="votes-row" id="votesRow"></div>
    </div>
    <div class="terminal" id="arbitrateLog" style="display:none"></div>
  </div>

  <!-- STATUS -->
  <div id="tab-status" class="tab-panel">
    <div class="section-title">Escrow Status</div>
    <div class="card">
      <label>Escrow ID</label><input type="number" id="statusId" placeholder="0">
      <button class="btn btn-outline" onclick="checkStatus()">Check Status</button>
    </div>
    <div id="statusResult" style="display:none" class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <span style="font-size:18px;font-weight:700">Escrow #<span id="statusIdDisplay">—</span></span>
        <span class="status-pill" id="statusPill"><span class="pulse"></span><span id="statusText">—</span></span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">CLIENT</div><div style="font-family:var(--mono);font-size:12px;word-break:break-all" id="statusClient">—</div></div>
        <div><div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">FREELANCER</div><div style="font-family:var(--mono);font-size:12px;word-break:break-all" id="statusFreelancer">—</div></div>
        <div><div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">AMOUNT</div><div style="font-family:var(--mono);font-size:12px" id="statusAmount">—</div></div>
        <div><div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">VERDICT</div><div style="font-family:var(--mono);font-size:12px" id="statusVerdict">—</div></div>
      </div>
    </div>
  </div>
</div>

<script>
  // Same-origin — no need for absolute URL
  const API_BASE = '';

  function switchTab(name, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    btn.classList.add('active');
  }

  function log(id, msg, type='info') {
    const el = document.getElementById(id);
    el.style.display = 'block';
    const t = new Date().toLocaleTimeString('en',{hour12:false});
    const d = document.createElement('div');
    d.className = 'log-line';
    d.innerHTML = '<span class="log-time">'+t+'</span><span class="log-'+type+'">'+msg+'</span>';
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }

  async function createEscrow() {
    const freelancer = document.getElementById('freelancerAddr').value.trim();
    const amount = document.getElementById('escrowAmount').value;
    const taskSpec = document.getElementById('taskSpec').value.trim();
    if (!freelancer || !amount || !taskSpec) { log('createLog','ERROR: all fields required','err'); return; }
    if (taskSpec.length < 20) { log('createLog','ERROR: task spec too short','err'); return; }
    log('createLog','Sending create_escrow transaction...','info');
    try {
      const res = await fetch(API_BASE+'/api/escrow/create', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({freelancer, amount_eth: amount, task_description: taskSpec, client: 'web-user'})
      });
      const data = await res.json();
      if (data.success) {
        log('createLog','✓ Escrow #'+data.escrow_id+' created — '+amount+' ETH locked','ok');
        document.getElementById('newEscrowIdVal').textContent = data.escrow_id;
        document.getElementById('newEscrowId').classList.add('show');
        document.getElementById('statEscrows').textContent = data.total;
      } else { log('createLog','ERROR: '+data.error,'err'); }
    } catch(e) { log('createLog','ERROR: '+e.message,'err'); }
  }

  function copyId() { navigator.clipboard.writeText(document.getElementById('newEscrowIdVal').textContent); }

  async function submitWork() {
    const id = document.getElementById('submitEscrowId').value;
    const url = document.getElementById('deliverableUrl').value.trim();
    if (!id || !url) { log('submitLog','ERROR: fill all fields','err'); return; }
    if (!url.startsWith('http')) { log('submitLog','ERROR: URL must start with http','err'); return; }
    log('submitLog','Submitting deliverable for escrow #'+id+'...','info');
    try {
      const res = await fetch(API_BASE+'/api/escrow/'+id+'/submit', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({deliverable_url: url})
      });
      const data = await res.json();
      if (data.success) { log('submitLog','✓ Work submitted: '+url,'ok'); log('submitLog','Status → SUBMITTED','info'); }
      else { log('submitLog','ERROR: '+data.error,'err'); }
    } catch(e) { log('submitLog','ERROR: '+e.message,'err'); }
  }

  async function triggerArbitration() {
    const id = document.getElementById('arbitrateId').value.trim();
    const task = document.getElementById('arbitrateTaskSpec').value.trim();
    const url = document.getElementById('arbitrateDeliverableUrl').value.trim();
    if (!task) { log('arbitrateLog','ERROR: Task specification required','err'); return; }
    if (!url) { log('arbitrateLog','ERROR: Deliverable URL required','err'); return; }

    const btn = document.getElementById('arbitrateBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Running 3 AI Agents...';
    document.getElementById('agentsDisplay').style.display = 'grid';
    document.getElementById('verdictBox').className = 'verdict-box';
    ['agent1','agent2','agent3'].forEach(a => { document.getElementById(a).className='agent-card thinking'; });
    ['a1verdict','a2verdict','a3verdict'].forEach(a => { document.getElementById(a).textContent='...'; document.getElementById(a).style.color='var(--accent)'; });

    log('arbitrateLog','Starting AI arbitration...','info');
    log('arbitrateLog','Sending to 3 independent AI agents...','info');

    try {
      const res = await fetch(API_BASE+'/api/trigger-arbitration', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({escrow_id: parseInt(id)||0, task_description: task, deliverable_url: url})
      });
      const data = await res.json();
      if (data.success) {
        const votes = data.votes || [];
        ['agent1','agent2','agent3'].forEach((el,i) => {
          const v = votes[i]||'partial';
          document.getElementById(el).className='agent-card done-'+v;
          document.getElementById('a'+(i+1)+'verdict').textContent=v.toUpperCase();
          document.getElementById('a'+(i+1)+'verdict').style.color=v==='approved'?'var(--green)':v==='rejected'?'var(--red)':'var(--warn)';
          log('arbitrateLog','Agent '+(i+1)+' → '+v.toUpperCase(), v==='approved'?'ok':v==='rejected'?'err':'warn');
        });
        const verdict = data.final_verdict;
        const cfg = {approved:{emoji:'✅',label:'APPROVED',desc:'Full payment released to freelancer.'},partial:{emoji:'⚡',label:'PARTIAL',desc:'50% to freelancer · 50% refunded to client.'},rejected:{emoji:'❌',label:'REJECTED',desc:'Full refund to client.'}}[verdict]||{emoji:'⚡',label:'PARTIAL',desc:''};
        document.getElementById('verdictEmoji').textContent=cfg.emoji;
        document.getElementById('verdictLabel').textContent=cfg.label;
        document.getElementById('verdictDesc').textContent=cfg.desc;
        document.getElementById('votesRow').innerHTML=votes.map((v,i)=>'<span class="vote-chip '+v+'">Agent '+(i+1)+': '+v.toUpperCase()+'</span>').join('');
        document.getElementById('verdictBox').className='verdict-box show '+verdict;
        log('arbitrateLog','Final Verdict: '+verdict.toUpperCase(),'ok');
        if (data.processing_time_ms) log('arbitrateLog','Processing time: '+data.processing_time_ms+'ms','info');
      } else { log('arbitrateLog','ERROR: '+(data.error||'Unknown'),'err'); }
    } catch(e) { log('arbitrateLog','Connection error: '+e.message,'err'); }

    btn.disabled=false;
    btn.innerHTML='<span>Trigger AI Arbitration</span> →';
  }

  async function checkStatus() {
    const id = document.getElementById('statusId').value;
    if (!id) return;
    try {
      const res = await fetch(API_BASE+'/api/escrow/'+id);
      const data = await res.json();
      if (data.success) {
        document.getElementById('statusIdDisplay').textContent=id;
        document.getElementById('statusClient').textContent=data.client||'—';
        document.getElementById('statusFreelancer').textContent=data.freelancer||'—';
        document.getElementById('statusAmount').textContent=(data.amount_eth||'—')+' ETH';
        document.getElementById('statusVerdict').textContent=data.final_verdict||'—';
        document.getElementById('statusPill').className='status-pill '+data.status;
        document.getElementById('statusText').textContent=data.status.toUpperCase();
        document.getElementById('statusResult').style.display='block';
      }
    } catch(e) { alert('Error: '+e.message); }
  }

  // Ping
  (async()=>{
    try {
      const r = await fetch('/health');
      const d = await r.json();
      document.getElementById('networkBadge').textContent=d.network||'CONNECTED';
      document.getElementById('statEscrows').textContent=d.total_escrows||0;
    } catch { document.getElementById('networkBadge').textContent='OFFLINE'; }
  })();
</script>
</body>
</html>`;
}

// ── Router ─────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  // ── GET / — serve frontend ───────────────────────────────────────────────
  if (method === "GET" && (path === "/" || path === "")) {
    return new Response(frontendHTML(), {
      headers: cors({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  // ── GET /health ──────────────────────────────────────────────────────────
  if (method === "GET" && path === "/health") {
    return json({
      status: "ok",
      version: "4.0",
      message: "AI Escrow Backend — Full API",
      network: "DENO-DEPLOY",
      total_escrows: escrows.size,
      endpoints: [
        "GET  /health",
        "GET  /api/escrows",
        "GET  /api/escrow/:id",
        "POST /api/escrow/create",
        "POST /api/escrow/:id/submit",
        "POST /api/escrow/:id/arbitrate",
        "POST /api/trigger-arbitration",
      ],
    });
  }

  // ── GET /api/escrows ─────────────────────────────────────────────────────
  if (method === "GET" && path === "/api/escrows") {
    return json({ success: true, escrows: Array.from(escrows.values()) });
  }

  // ── GET /api/escrow/:id ──────────────────────────────────────────────────
  const getMatch = path.match(/^\/api\/escrow\/(\d+)$/);
  if (method === "GET" && getMatch) {
    const id = parseInt(getMatch[1]);
    const escrow = escrows.get(id);
    if (!escrow) return json({ success: false, error: "Escrow not found" }, 404);
    return json({ success: true, ...escrow });
  }

  // ── POST /api/escrow/create ──────────────────────────────────────────────
  if (method === "POST" && path === "/api/escrow/create") {
    try {
      const body = await req.json();
      const { freelancer, amount_eth, task_description, client } = body;

      if (!freelancer || !amount_eth || !task_description) {
        return json({ success: false, error: "Missing required fields: freelancer, amount_eth, task_description" }, 400);
      }

      const id = escrowCounter++;
      const escrow: Escrow = {
        id,
        client: client || "anonymous",
        freelancer,
        amount_eth: String(amount_eth),
        task_description,
        deliverable_url: "",
        status: "pending",
        votes: [],
        final_verdict: "",
        created_at: new Date().toISOString(),
      };
      escrows.set(id, escrow);

      return json({ success: true, escrow_id: id, total: escrows.size, record: escrow });
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }
  }

  // ── POST /api/escrow/:id/submit ──────────────────────────────────────────
  const submitMatch = path.match(/^\/api\/escrow\/(\d+)\/submit$/);
  if (method === "POST" && submitMatch) {
    const id = parseInt(submitMatch[1]);
    const escrow = escrows.get(id);
    if (!escrow) return json({ success: false, error: "Escrow not found" }, 404);

    try {
      const body = await req.json();
      const { deliverable_url } = body;
      if (!deliverable_url) return json({ success: false, error: "deliverable_url required" }, 400);

      escrow.deliverable_url = deliverable_url;
      escrow.status = "submitted";
      escrows.set(id, escrow);

      return json({ success: true, escrow_id: id, status: "submitted" });
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }
  }

  // ── POST /api/escrow/:id/arbitrate ───────────────────────────────────────
  const arbMatch = path.match(/^\/api\/escrow\/(\d+)\/arbitrate$/);
  if (method === "POST" && arbMatch) {
    const id = parseInt(arbMatch[1]);
    const escrow = escrows.get(id);
    if (!escrow) return json({ success: false, error: "Escrow not found" }, 404);
    if (escrow.status !== "submitted") return json({ success: false, error: "Escrow must be in submitted status" }, 400);

    const start = Date.now();
    const [v1, v2, v3] = await Promise.all([
      callAgent("Technical Completeness — evaluate if the deliverable is technically complete", escrow.task_description, escrow.deliverable_url),
      callAgent("Requirement Coverage — evaluate if all requirements are met", escrow.task_description, escrow.deliverable_url),
      callAgent("Quality & Professionalism — evaluate the quality of the work", escrow.task_description, escrow.deliverable_url),
    ]);
    const votes = [v1, v2, v3];
    const final_verdict = majority(votes);

    escrow.votes = votes;
    escrow.final_verdict = final_verdict;
    escrow.status = final_verdict as Escrow["status"];
    escrows.set(id, escrow);

    return json({ success: true, escrow_id: id, votes, final_verdict, processing_time_ms: Date.now() - start });
  }

  // ── POST /api/trigger-arbitration ────────────────────────────────────────
  if (method === "POST" && path === "/api/trigger-arbitration") {
    try {
      const body = await req.json();
      const { task_description, deliverable_url } = body;

      if (!task_description || !deliverable_url) {
        return json({ success: false, error: "task_description and deliverable_url required" }, 400);
      }

      const start = Date.now();
      const [v1, v2, v3] = await Promise.all([
        callAgent("Technical Completeness — evaluate if the deliverable is technically complete", task_description, deliverable_url),
        callAgent("Requirement Coverage — evaluate if all requirements are met", task_description, deliverable_url),
        callAgent("Quality & Professionalism — evaluate the quality of the work", task_description, deliverable_url),
      ]);
      const votes = [v1, v2, v3];
      const final_verdict = majority(votes);

      return json({ success: true, votes, final_verdict, processing_time_ms: Date.now() - start });
    } catch {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  return json({ error: "Not Found", path }, 404);
});
