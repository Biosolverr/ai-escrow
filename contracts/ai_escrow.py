// ── AI Escrow — Production Fixed v2 (GenLayer-style) ─────────────────────
// Deno Deploy compatible single-file app
// FIXES v2:
// - Anti-spam logs (single array, max 200 entries)
// - Full contract fields display (client, dates, votes, verdict)
// - Escrow list view with status filtering
// - Detailed escrow inspector
// - Status color coding
// - KV consistency fixes

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL = Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";

interface Escrow {
  id: number;
  client: string;
  freelancer: string;
  amount_eth: string;
  task_description: string;
  deliverable_url: string;
  status: "pending" | "submitted" | "approved" | "partial" | "rejected" | "disputed";
  votes: string[];
  final_verdict: string;
  created_at: string;
  resolved_at: string;
}

const kv = await Deno.openKv();
console.info("KV initialized");

// ─────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────

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

// FIXED: Anti-spam logging - single array with max 200 entries
async function log(action: string, data: unknown) {
  const key = ["logs"];
  const res = await kv.get<string[]>(key);
  let logs = res.value ?? [];

  const entry = {
    t: new Date().toISOString(),
    action,
    data: typeof data === "object" ? JSON.stringify(data) : String(data),
  };

  logs.push(JSON.stringify(entry));

  // Keep only last 200 entries to prevent KV spam
  if (logs.length > 200) {
    logs = logs.slice(-200);
  }

  await kv.set(key, logs);
}

async function getLogs(): Promise<string[]> {
  const res = await kv.get<string[]>(["logs"]);
  return res.value ?? [];
}

// ─────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────

async function nextId(): Promise<number> {
  await kv.atomic().mutate({
    type: "sum",
    key: ["counter"],
    value: 1n,
  }).commit();

  const res = await kv.get<bigint>(["counter"]);
  return Number(res.value ?? 0n) - 1;
}

async function getEscrow(id: number): Promise<Escrow | null> {
  const res = await kv.get<Escrow>(["escrow", id]);
  return res.value ?? null;
}

async function setEscrow(e: Escrow) {
  await kv.set(["escrow", e.id], e);
}

async function getAllEscrows(): Promise<Escrow[]> {
  const out: Escrow[] = [];
  for await (const e of kv.list<Escrow>({ prefix: ["escrow"] })) {
    if (typeof e.value?.id === "number") out.push(e.value);
  }
  return out.sort((a, b) => b.id - a.id);
}

// ─────────────────────────────────────────────
// AI AGENT
// ─────────────────────────────────────────────

async function callAgent(role: string, task: string, url: string) {
  const prompt = `
Role: ${role}
Task: ${task}
URL: ${url}

Return ONLY: approved | partial | rejected
`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 10,
      }),
    });

    const d = await r.json();
    const t = (d?.choices?.[0]?.message?.content ?? "").toLowerCase();

    if (t.includes("approved")) return "approved";
    if (t.includes("rejected")) return "rejected";
    return "partial";
  } catch {
    return "partial";
  }
}

function majority(votes: string[]) {
  const c = { approved: 0, partial: 0, rejected: 0 };
  for (const v of votes) if (v in c) c[v as keyof typeof c]++;

  const max = Math.max(...Object.values(c));
  if (max >= 2) {
    return (Object.entries(c).find(([, v]) => v === max)?.[0] ??
      "partial");
  }
  return "partial";
}

// ─────────────────────────────────────────────
// FRONTEND v2 — Full Contract UI
// ─────────────────────────────────────────────

function frontendHTML() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI Escrow v2</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b0b0f;color:#fff;font-family:'Segoe UI',Arial,sans-serif;min-height:100vh;padding-bottom:180px}
.top{display:flex;gap:10px;padding:12px 16px;background:#111;flex-wrap:wrap;align-items:center;border-bottom:1px solid #222}
.top h1{margin:0;font-size:18px;color:#ff6a00}
.top .badge{background:#1a1a2e;padding:4px 10px;border-radius:12px;font-size:11px;color:#888}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;padding:12px}
.card{background:#161622;padding:14px;border-radius:12px;border:1px solid #222}
.card h3{margin:0 0 12px 0;font-size:14px;color:#ccc;text-transform:uppercase;letter-spacing:1px}

input,textarea,select{background:#0f0f1a;color:#fff;border:1px solid #333;padding:8px 10px;border-radius:6px;width:100%;font-size:13px;margin-bottom:8px}
input:focus,textarea:focus,select:focus{outline:none;border-color:#ff6a00}
textarea{min-height:60px;resize:vertical}

button{background:#ff6a00;color:#000;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;transition:opacity .2s}
button:hover{opacity:.9}
button:disabled{opacity:.4;cursor:not-allowed}
button.secondary{background:#333;color:#fff}
button.secondary:hover{background:#444}

.status-badge{display:inline-block;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:bold;text-transform:uppercase}
.status-pending{background:#333;color:#aaa}
.status-submitted{background:#1a3a5c;color:#4aa8ff}
.status-approved{background:#1a3a1a;color:#4aff4a}
.status-partial{background:#3a3a1a;color:#ffaa4a}
.status-rejected{background:#3a1a1a;color:#ff4a4a}
.status-disputed{background:#3a1a3a;color:#ff4aff}

.escrow-list{max-height:300px;overflow-y:auto}
.escrow-item{padding:10px;border-bottom:1px solid #222;cursor:pointer;transition:background .2s}
.escrow-item:hover{background:#1a1a2e}
.escrow-item:last-child{border-bottom:none}
.escrow-item .id{font-weight:bold;color:#ff6a00;font-size:13px}
.escrow-item .meta{font-size:11px;color:#888;margin-top:4px}

.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px}
.detail-grid .label{color:#888}
.detail-grid .value{color:#fff;word-break:break-all}

.votes-bar{display:flex;gap:6px;margin-top:8px}
.vote-pill{padding:4px 10px;border-radius:8px;font-size:11px;font-weight:bold}
.vote-approved{background:#1a3a1a;color:#4aff4a}
.vote-partial{background:#3a3a1a;color:#ffaa4a}
.vote-rejected{background:#3a1a1a;color:#ff4a4a}

.log{position:fixed;bottom:0;left:0;right:0;height:160px;overflow:auto;background:#000;border-top:1px solid #333;font-size:11px;font-family:monospace}
.log div{padding:3px 10px;border-bottom:1px solid #111;color:#aaa}
.log div .time{color:#ff6a00;margin-right:6px}

.tabs{display:flex;gap:4px;margin-bottom:12px}
.tab{padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;background:#0f0f1a;border:1px solid #333}
.tab.active{background:#ff6a00;color:#000;border-color:#ff6a00;font-weight:bold}

.empty{text-align:center;padding:20px;color:#555;font-size:13px}

.filter-row{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
</style>
</head>
<body>

<div class="top">
  <h1>⚖ AI ESCROW</h1>
  <div class="badge">GenLayer Consensus v2</div>
  <div class="badge" id="total-count">Total: 0</div>
</div>

<div class="grid">

  <!-- CREATE -->
  <div class="card">
    <h3>📝 Create Escrow</h3>
    <input id="client" placeholder="Client address (0x...)" value="web" />
    <input id="freelancer" placeholder="Freelancer address (0x...)" />
    <input id="amount" placeholder="Amount ETH" />
    <textarea id="task" placeholder="Task description (min 20 chars)"></textarea>
    <button onclick="create()">Create Escrow</button>
    <div id="cid" style="margin-top:8px;font-size:12px;color:#4aff4a"></div>
  </div>

  <!-- SUBMIT -->
  <div class="card">
    <h3>📤 Submit Work</h3>
    <input id="sid" placeholder="Escrow ID" type="number" />
    <input id="url" placeholder="Deliverable URL (http...)" />
    <button onclick="submitW()">Submit Deliverable</button>
    <div id="sout" style="margin-top:8px;font-size:12px"></div>
  </div>

  <!-- ARBITRATE -->
  <div class="card">
    <h3>⚖ AI Arbitration</h3>
    <input id="aid" placeholder="Escrow ID" type="number" />
    <button onclick="arb()" id="arb-btn">Run 3-Validator Consensus</button>
    <div style="margin-top:10px">
      <div id="votes" class="votes-bar"></div>
      <div id="final" style="margin-top:8px;font-weight:bold;font-size:14px"></div>
    </div>
  </div>

  <!-- STATUS / DETAIL -->
  <div class="card">
    <h3>🔍 Inspect Escrow</h3>
    <input id="stid" placeholder="Escrow ID" type="number" />
    <button onclick="inspect()">View Details</button>
    <div id="detail" style="margin-top:10px"></div>
  </div>

</div>

<!-- ESCROW LIST -->
<div class="card" style="margin:0 12px">
  <h3>📋 All Escrows</h3>
  <div class="filter-row">
    <select id="filter-status" onchange="loadList()">
      <option value="all">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="submitted">Submitted</option>
      <option value="disputed">Disputed</option>
      <option value="approved">Approved</option>
      <option value="partial">Partial</option>
      <option value="rejected">Rejected</option>
    </select>
    <button class="secondary" onclick="loadList()">Refresh</button>
  </div>
  <div class="escrow-list" id="list"></div>
</div>

<!-- LOGS -->
<div class="log" id="log"></div>

<script>

let currentList = [];

function log(m){
  const el=document.getElementById('log');
  const d=document.createElement('div');
  d.innerHTML='<span class="time">'+new Date().toLocaleTimeString()+'</span>'+m;
  el.appendChild(d);
  el.scrollTop=999999;
  if(el.children.length>100) el.removeChild(el.firstChild);
}

function statusBadge(s){
  return '<span class="status-badge status-'+s+'">'+s+'</span>';
}

function votePill(v){
  return '<span class="vote-pill vote-'+v+'">'+v+'</span>';
}

async function create(){
  const btn = event.target;
  btn.disabled = true;
  try{
    const r=await fetch('/api/escrow/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      client: client.value || "web",
      freelancer: freelancer.value,
      amount_eth: amount.value,
      task_description: task.value,
    })});
    const d=await r.json();
    if(d.success){
      log("✅ Created escrow #"+d.escrow_id);
      cid.innerHTML = "Created: <b>#"+d.escrow_id+"</b> — "+statusBadge('pending');
      loadList();
    } else {
      log("❌ Create failed: "+(d.error||'unknown'));
      cid.innerHTML = '<span style="color:#ff4a4a">Error: '+(d.error||'unknown')+'</span>';
    }
  } catch(e){
    log("❌ Network error: "+e.message);
  }
  btn.disabled = false;
}

async function submitW(){
  const btn = event.target;
  btn.disabled = true;
  try{
    const r=await fetch('/api/escrow/'+sid.value+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deliverable_url:url.value})});
    const d=await r.json();
    if(d.success){
      log("📤 Submitted work for #"+sid.value);
      sout.innerHTML = "Submitted to <b>#"+sid.value+"</b> — "+statusBadge('submitted');
      loadList();
    } else {
      log("❌ Submit failed: "+(d.error||'not found'));
      sout.innerHTML = '<span style="color:#ff4a4a">Error: '+(d.error||'not found')+'</span>';
    }
  } catch(e){
    log("❌ Network error: "+e.message);
  }
  btn.disabled = false;
}

async function arb(){
  const btn = document.getElementById('arb-btn');
  btn.disabled = true;
  btn.textContent = "Running consensus...";
  try{
    log("⚖ Starting arbitration for #"+aid.value+"...");
    const r=await fetch('/api/escrow/'+aid.value+'/arbitrate',{method:'POST'});
    const d=await r.json();
    if(d.success){
      log("✅ Arbitration complete #"+aid.value+" → "+d.final_verdict);
      votes.innerHTML = (d.votes||[]).map(v=>votePill(v)).join('');
      final.innerHTML = "Verdict: "+statusBadge(d.final_verdict);
      loadList();
    } else {
      log("❌ Arbitration failed: "+(d.error||'unknown'));
      votes.innerHTML = '';
      final.innerHTML = '<span style="color:#ff4a4a">Error: '+(d.error||'unknown')+'</span>';
    }
  } catch(e){
    log("❌ Network error: "+e.message);
  }
  btn.disabled = false;
  btn.textContent = "Run 3-Validator Consensus";
}

async function inspect(){
  try{
    const r=await fetch('/api/escrow/'+stid.value);
    const d=await r.json();
    if(d.error){
      detail.innerHTML = '<span style="color:#ff4a4a">Not found</span>';
      return;
    }

    const created = d.created_at ? new Date(d.created_at).toLocaleString() : 'N/A';
    const resolved = d.resolved_at ? new Date(d.resolved_at).toLocaleString() : 'N/A';

    let html = '<div class="detail-grid">';
    html += '<div class="label">ID</div><div class="value">#'+d.id+'</div>';
    html += '<div class="label">Status</div><div class="value">'+statusBadge(d.status)+'</div>';
    html += '<div class="label">Client</div><div class="value">'+d.client+'</div>';
    html += '<div class="label">Freelancer</div><div class="value">'+d.freelancer+'</div>';
    html += '<div class="label">Amount</div><div class="value">'+d.amount_eth+' ETH</div>';
    html += '<div class="label">Created</div><div class="value">'+created+'</div>';
    html += '<div class="label">Resolved</div><div class="value">'+resolved+'</div>';
    html += '</div>';

    html += '<div style="margin-top:10px"><div class="label">Task:</div><div style="font-size:12px;color:#ccc;margin-top:4px">'+d.task_description+'</div></div>';

    if(d.deliverable_url){
      html += '<div style="margin-top:8px"><div class="label">Deliverable:</div><a href="'+d.deliverable_url+'" target="_blank" style="font-size:12px;color:#4aa8ff">'+d.deliverable_url+'</a></div>';
    }

    if(d.votes && d.votes.length){
      html += '<div style="margin-top:10px"><div class="label">Votes:</div><div class="votes-bar" style="margin-top:4px">'+d.votes.map(v=>votePill(v)).join('')+'</div></div>';
    }

    if(d.final_verdict){
      html += '<div style="margin-top:8px"><div class="label">Final Verdict:</div>'+statusBadge(d.final_verdict)+'</div>';
    }

    detail.innerHTML = html;
    log("🔍 Inspected escrow #"+stid.value);
  } catch(e){
    detail.innerHTML = '<span style="color:#ff4a4a">Error: '+e.message+'</span>';
  }
}

function renderEscrowItem(e){
  const created = e.created_at ? new Date(e.created_at).toLocaleDateString() : '';
  return '<div class="escrow-item" onclick="stid.value='+e.id+';inspect()">'+
    '<span class="id">#'+e.id+'</span> '+statusBadge(e.status)+'<br/>'+
    '<div class="meta">'+e.client+' → '+e.freelancer+' | '+e.amount_eth+' ETH | '+created+'</div>'+
    '<div class="meta" style="color:#666;margin-top:2px">'+e.task_description.substring(0,60)+(e.task_description.length>60?'...':'')+'</div>'+
    '</div>';
}

async function loadList(){
  try{
    const r=await fetch('/api/escrows');
    const d=await r.json();
    currentList = d.escrows || [];

    const filter = filter-status.value;
    const filtered = filter === 'all' ? currentList : currentList.filter(e=>e.status===filter);

    document.getElementById('total-count').textContent = 'Total: ' + currentList.length;

    if(filtered.length === 0){
      list.innerHTML = '<div class="empty">No escrows found</div>';
      return;
    }

    list.innerHTML = filtered.map(renderEscrowItem).join('');
  } catch(e){
    list.innerHTML = '<div class="empty">Error loading list</div>';
  }
}

// Load logs from backend
async function loadLogs(){
  try{
    const r=await fetch('/api/logs');
    const d=await r.json();
    const logs = d.logs || [];
    const el = document.getElementById('log');
    el.innerHTML = '';
    logs.slice(-50).forEach(entry => {
      try{
        const parsed = JSON.parse(entry);
        const d2 = document.createElement('div');
        d2.innerHTML = '<span class="time">'+new Date(parsed.t).toLocaleTimeString()+'</span>'+parsed.action+': '+parsed.data;
        el.appendChild(d2);
      } catch(e){}
    });
    el.scrollTop = 999999;
  } catch(e){}
}

// Auto-refresh
setInterval(()=>{ loadList(); loadLogs(); }, 10000);

// Initial load
loadList();
loadLogs();

</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  if (url.pathname === "/") {
    return new Response(frontendHTML(), {
      headers: cors({ "Content-Type": "text/html" }),
    });
  }

  if (url.pathname === "/health") {
    const c = await kv.get(["counter"]);
    return json({ ok: true, counter: c.value ?? 0n });
  }

  // GET ALL LOGS (anti-spam)
  if (url.pathname === "/api/logs") {
    const logs = await getLogs();
    return json({ logs });
  }

  // GET ALL ESCROWS
  if (url.pathname === "/api/escrows") {
    const escrows = await getAllEscrows();
    return json({ escrows });
  }

  // CREATE
  if (url.pathname === "/api/escrow/create") {
    const b = await req.json();
    const id = await nextId();

    const e: Escrow = {
      id,
      client: b.client || "web",
      freelancer: b.freelancer,
      amount_eth: String(b.amount_eth),
      task_description: b.task_description,
      deliverable_url: "",
      status: "pending",
      votes: [],
      final_verdict: "",
      created_at: new Date().toISOString(),
      resolved_at: "",
    };

    await setEscrow(e);
    await log("create", { id, client: e.client, freelancer: e.freelancer, amount: e.amount_eth });

    return json({ success: true, escrow_id: id, total: id + 1 });
  }

  // GET ESCROW
  const m1 = url.pathname.match(/\/api\/escrow\/(\d+)$/);
  if (m1 && req.method === "GET") {
    const e = await getEscrow(Number(m1[1]));
    return json(e ?? { error: "not found" });
  }

  // SUBMIT
  const m2 = url.pathname.match(/\/api\/escrow\/(\d+)\/submit/);
  if (m2) {
    const id = Number(m2[1]);
    const e = await getEscrow(id);
    if (!e) return json({ success: false, error: "not found" }, 404);

    const b = await req.json();
    e.deliverable_url = b.deliverable_url;
    e.status = "submitted";

    await setEscrow(e);
    await log("submit", { id, url: b.deliverable_url });

    return json({ success: true });
  }

  // ARBITRATE
  const m3 = url.pathname.match(/\/api\/escrow\/(\d+)\/arbitrate/);
  if (m3) {
    const id = Number(m3[1]);
    const e = await getEscrow(id);
    if (!e) return json({ success: false, error: "not found" }, 404);

    const [v1, v2, v3] = await Promise.all([
      callAgent("tech", e.task_description, e.deliverable_url),
      callAgent("req", e.task_description, e.deliverable_url),
      callAgent("quality", e.task_description, e.deliverable_url),
    ]);

    const votes = [v1, v2, v3];
    const verdict = majority(votes);

    e.votes = votes;
    e.final_verdict = verdict;
    e.status = verdict as any;
    e.resolved_at = new Date().toISOString();

    await setEscrow(e);
    await log("arbitrate", { id, votes, verdict });

    return json({ success: true, votes, final_verdict: verdict });
  }

  return json({ error: "not found" }, 404);
});
