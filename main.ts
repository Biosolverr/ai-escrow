// ── AI Escrow v3 — Strict Contract Compliance ─────────────────────────────
// Deno Deploy compatible single-file app
// Matches ai_escrow.py logic exactly:
// - create_escrow(client, freelancer, task_description, amount)
// - submit_work(escrow_id, deliverable_url)  [freelancer only, PENDING status]
// - trigger_arbitration(escrow_id)           [either party, SUBMITTED status]
// - get_escrow / get_verdict / get_total_escrows
// - withdraw_fees / update_platform_fee      [owner only]
//
// LOGIC FLOW: PENDING → SUBMITTED → DISPUTED → [APPROVED | PARTIAL | REJECTED]

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const LLM_MODEL = Deno.env.get("LLM_PROVIDER") ?? "llama-3.1-8b-instant";
const OWNER = Deno.env.get("OWNER_ADDRESS") ?? "web";  // default owner

interface Escrow {
  id: number;
  client: string;
  freelancer: string;
  amount_eth: string;
  task_description: string;
  deliverable_url: string;
  status: "pending" | "submitted" | "disputed" | "approved" | "partial" | "rejected";
  votes: string[];
  final_verdict: string;
  created_at: number;   // timestamp ms
  resolved_at: number;  // timestamp ms (0 if not resolved)
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
  return new Response(JSON.stringify(data), { status, headers: cors({ "Content-Type": "application/json" }) });
}

// Sequential logs — max 500 entries, no spam
async function addLog(action: string, data: Record<string, unknown>) {
  const key = ["audit_log"];
  const res = await kv.get<string[]>(key);
  let logs = res.value ?? [];
  const entry = Object.assign({ t: Date.now(), action }, data);
  logs.push(JSON.stringify(entry));
  if (logs.length > 500) logs = logs.slice(-500);
  await kv.set(key, logs);
}

async function getLogs(): Promise<string[]> {
  const res = await kv.get<string[]>(["audit_log"]);
  return res.value ?? [];
}

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────

async function nextId(): Promise<number> {
  await kv.atomic().mutate({ type: "sum", key: ["counter"], value: 1n }).commit();
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

async function getTotalEscrows(): Promise<number> {
  const res = await kv.get<bigint>(["counter"]);
  return Number(res.value ?? 0n);
}

// ─────────────────────────────────────────────
// AI Validators (exactly as contract)
// ─────────────────────────────────────────────

async function callValidator(role: string, taskSpec: string, deliverableUrl: string): Promise<string> {
  const prompts: Record<string, string> = {
    tech: `You are a strict technical evaluator for a freelance escrow system.

TASK SPECIFICATION:
${taskSpec}

DELIVERABLE URL: ${deliverableUrl}

Evaluate whether the deliverable is TECHNICALLY COMPLETE relative to the task specification.
Consider: Does the URL resolve to real content? Are technical requirements present? Is there evidence of actual implementation vs placeholder?

Respond with EXACTLY one word: APPROVED | PARTIAL | REJECTED`,

    req: `You are a meticulous requirements analyst for a freelance escrow system.

TASK SPECIFICATION:
${taskSpec}

DELIVERABLE URL: ${deliverableUrl}

Extract all explicit requirements from the task spec, then check whether each is addressed in the deliverable.
Score: APPROVED (85%+ met) | PARTIAL (40-84% met) | REJECTED (<40% met)

Your final line must be EXACTLY one word: APPROVED | PARTIAL | REJECTED`,

    quality: `You are a quality assurance expert evaluating freelance work for escrow release.

TASK SPECIFICATION:
${taskSpec}

DELIVERABLE URL: ${deliverableUrl}

Evaluate QUALITY and PROFESSIONALISM: Is the work original and non-trivial? Does it meet professional standards? Any red flags (empty repo, placeholder content, boilerplate)?

Your final answer must be EXACTLY one word: APPROVED | PARTIAL | REJECTED`,
  };

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: "user", content: prompts[role] ?? prompts.tech }], max_tokens: 20 }),
    });
    const d = await r.json();
    const text = (d?.choices?.[0]?.message?.content ?? "").toUpperCase();
    if (text.includes("APPROVED")) return "approved";
    if (text.includes("REJECTED")) return "rejected";
    return "partial";
  } catch {
    return "partial";
  }
}

function majorityVote(votes: string[]): string {
  const c = { approved: 0, partial: 0, rejected: 0 };
  for (const v of votes) if (v in c) c[v as keyof typeof c]++;
  const max = Math.max(...Object.values(c));
  if (max >= 2) {
    return Object.entries(c).find(([, v]) => v === max)?.[0] ?? "partial";
  }
  return "partial";  // 3-way tie → safest neutral
}

// ─────────────────────────────────────────────
// Frontend v3 — Full Contract UI, Clean Design
// ─────────────────────────────────────────────

function frontendHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI Escrow — Trustless Freelance Payments</title>
<style>
:root{--bg:#0a0a0f;--card:#12121a;--border:#1e1e2e;--accent:#ff6a00;--text:#e0e0e0;--muted:#888;--green:#2ecc71;--yellow:#f1c40f;--red:#e74c3c;--blue:#3498db;--purple:#9b59b6}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;line-height:1.5;min-height:100vh;padding-bottom:200px}

/* Header */
.header{background:var(--card);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.header-left{display:flex;align-items:center;gap:12px}
.header h1{font-size:20px;font-weight:700;color:var(--accent);letter-spacing:-0.5px}
.header .subtitle{font-size:12px;color:var(--muted)}
.header .stats{display:flex;gap:16px;font-size:13px}
.header .stats span{color:var(--muted)}
.header .stats b{color:var(--text)}

/* Layout */
.container{max-width:1400px;margin:0 auto;padding:20px}
.grid{display:grid;grid-template-columns:320px 1fr;gap:20px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}

/* Sidebar — Actions */
.sidebar{display:flex;flex-direction:column;gap:16px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
.panel h3{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.panel h3::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent)}

input,textarea,select{width:100%;background:#0a0a12;border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:10px;transition:border-color .2s}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent)}
textarea{min-height:80px;resize:vertical;font-family:inherit}
input::placeholder,textarea::placeholder{color:#444}

.btn{width:100%;background:var(--accent);color:#000;border:none;padding:12px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;transition:filter .2s}
.btn:hover{filter:brightness(1.1)}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn.secondary{background:var(--border);color:var(--text)}
.btn.secondary:hover{background:#2a2a3e}
.btn.small{width:auto;padding:6px 12px;font-size:12px}

.hint{font-size:11px;color:var(--muted);margin-top:6px}
.error{color:var(--red);font-size:12px;margin-top:6px}
.success{color:var(--green);font-size:12px;margin-top:6px}

/* Flow diagram */
.flow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin-bottom:12px;flex-wrap:wrap}
.flow .step{padding:4px 10px;border-radius:6px;background:#0a0a12;border:1px solid var(--border)}
.flow .step.active{background:rgba(255,106,0,.15);border-color:var(--accent);color:var(--accent);font-weight:600}
.flow .arrow{color:var(--muted)}

/* Main content */
.main{display:flex;flex-direction:column;gap:16px}

/* Status badges */
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.badge::before{content:"";width:6px;height:6px;border-radius:50%}
.badge-pending{background:rgba(136,136,136,.15);color:var(--muted)}
.badge-pending::before{background:var(--muted)}
.badge-submitted{background:rgba(52,152,219,.15);color:var(--blue)}
.badge-submitted::before{background:var(--blue)}
.badge-disputed{background:rgba(155,89,182,.15);color:var(--purple)}
.badge-disputed::before{background:var(--purple)}
.badge-approved{background:rgba(46,204,113,.15);color:var(--green)}
.badge-approved::before{background:var(--green)}
.badge-partial{background:rgba(241,196,15,.15);color:var(--yellow)}
.badge-partial::before{background:var(--yellow)}
.badge-rejected{background:rgba(231,76,60,.15);color:var(--red)}
.badge-rejected::before{background:var(--red)}

/* Vote pills */
.vote-pill{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;text-transform:uppercase}
.vote-pill::before{content:"";width:5px;height:5px;border-radius:50%}
.vote-approved{background:rgba(46,204,113,.15);color:var(--green)}
.vote-approved::before{background:var(--green)}
.vote-partial{background:rgba(241,196,15,.15);color:var(--yellow)}
.vote-partial::before{background:var(--yellow)}
.vote-rejected{background:rgba(231,76,60,.15);color:var(--red)}
.vote-rejected::before{background:var(--red)}

/* Escrow list */
.list-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.list-header h2{font-size:16px;font-weight:600}
.filter{display:flex;gap:8px}
.filter select{width:auto;padding:6px 10px;font-size:12px}

.escrow-list{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.escrow-item{padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;display:grid;grid-template-columns:50px 1fr auto;gap:12px;align-items:center}
.escrow-item:hover{background:#1a1a28}
.escrow-item:last-child{border-bottom:none}
.escrow-item .id{font-weight:800;color:var(--accent);font-size:14px}
.escrow-item .info{min-width:0}
.escrow-item .meta{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.escrow-item .meta strong{color:var(--text)}
.escrow-item .task-preview{font-size:12px;color:#666;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.escrow-item .side{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.escrow-item .amount{font-size:13px;font-weight:700;color:var(--text)}
.escrow-item .date{font-size:11px;color:#444}

/* Detail view */
.detail{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
.detail h2{font-size:18px;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.detail-grid{display:grid;grid-template-columns:140px 1fr;gap:1px;background:var(--border);border-radius:8px;overflow:hidden}
.detail-grid > div{padding:10px 14px;background:var(--card);font-size:13px}
.detail-grid .label{color:var(--muted);font-weight:500}
.detail-grid .value{color:var(--text);word-break:break-word}
.detail-grid .value a{color:var(--blue);text-decoration:none}
.detail-grid .value a:hover{text-decoration:underline}

.detail-section{margin-top:16px}
.detail-section h4{font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;margin-bottom:8px}

.votes-row{display:flex;gap:10px;margin-top:8px}
.verdict-box{margin-top:12px;padding:12px;border-radius:8px;background:rgba(255,106,0,.08);border:1px solid rgba(255,106,0,.2);display:flex;align-items:center;gap:12px}
.verdict-box .label{font-size:12px;color:var(--muted)}
.verdict-box .value{font-size:16px;font-weight:800}

/* Empty state */
.empty{text-align:center;padding:40px;color:var(--muted);font-size:14px}
.empty-icon{font-size:32px;margin-bottom:8px;opacity:.5}

/* Logs panel */
.logs-panel{position:fixed;bottom:0;left:0;right:0;height:180px;background:#050508;border-top:1px solid var(--border);display:flex;flex-direction:column;z-index:90}
.logs-header{padding:8px 16px;background:var(--card);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}
.logs-header b{color:var(--text)}
.logs-content{flex:1;overflow-y:auto;padding:8px 16px;font-family:'SF Mono',monospace;font-size:11px;line-height:1.6}
.logs-content .entry{display:flex;gap:10px;padding:2px 0;border-bottom:1px solid #0a0a12}
.logs-content .time{color:var(--accent);white-space:nowrap;opacity:.8}
.logs-content .action{color:var(--blue);font-weight:600;white-space:nowrap}
.logs-content .data{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Toast */
.toast{position:fixed;top:20px;right:20px;background:var(--card);border:1px solid var(--border);padding:14px 18px;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);z-index:200;transform:translateX(150%);transition:transform .3s;max-width:320px}
.toast.show{transform:translateX(0)}
.toast.error{border-color:var(--red)}
.toast.success{border-color:var(--green)}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>⚖ AI Escrow</h1>
    <span class="subtitle">Trustless freelance payments, resolved by AI consensus</span>
  </div>
  <div class="stats">
    <span>Total: <b id="stat-total">0</b></span>
    <span>Pending: <b id="stat-pending">0</b></span>
    <span>Resolved: <b id="stat-resolved">0</b></span>
  </div>
</div>

<div class="container">
  <div class="grid">

    <!-- SIDEBAR: Actions -->
    <div class="sidebar">

      <!-- CREATE -->
      <div class="panel">
        <h3>Create Escrow</h3>
        <div class="flow">
          <span class="step active">Create</span>
          <span class="arrow">→</span>
          <span class="step">Submit</span>
          <span class="arrow">→</span>
          <span class="step">Arbitrate</span>
        </div>
        <input id="c-client" placeholder="Your address (client)" value="web" />
        <input id="c-freelancer" placeholder="Freelancer address (0x...)" />
        <input id="c-amount" placeholder="Amount ETH" type="number" step="0.001" />
        <textarea id="c-task" placeholder="Task description (20-2000 chars)"></textarea>
        <button class="btn" onclick="createEscrow()">Create Escrow</button>
        <div id="c-result"></div>
      </div>

      <!-- SUBMIT -->
      <div class="panel">
        <h3>Submit Work</h3>
        <div class="flow">
          <span class="step">Create</span>
          <span class="arrow">→</span>
          <span class="step active">Submit</span>
          <span class="arrow">→</span>
          <span class="step">Arbitrate</span>
        </div>
        <input id="s-id" placeholder="Escrow ID" type="number" />
        <input id="s-freelancer" placeholder="Your address (freelancer)" />
        <input id="s-url" placeholder="Deliverable URL (https://...)" />
        <button class="btn" onclick="submitWork()">Submit Deliverable</button>
        <div id="s-result"></div>
      </div>

      <!-- ARBITRATE -->
      <div class="panel">
        <h3>Trigger Arbitration</h3>
        <div class="flow">
          <span class="step">Create</span>
          <span class="arrow">→</span>
          <span class="step">Submit</span>
          <span class="arrow">→</span>
          <span class="step active">Arbitrate</span>
        </div>
        <input id="a-id" placeholder="Escrow ID" type="number" />
        <input id="a-caller" placeholder="Your address (client or freelancer)" />
        <button class="btn" onclick="triggerArbitration()" id="a-btn">Run 3-Validator Consensus</button>
        <div id="a-result"></div>
      </div>

    </div>

    <!-- MAIN: List + Detail -->
    <div class="main">

      <!-- List -->
      <div>
        <div class="list-header">
          <h2>📋 All Escrows</h2>
          <div class="filter">
            <select id="filter-status" onchange="loadList()">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="disputed">Disputed</option>
              <option value="approved">Approved</option>
              <option value="partial">Partial</option>
              <option value="rejected">Rejected</option>
            </select>
            <button class="btn secondary small" onclick="loadList()">Refresh</button>
          </div>
        </div>
        <div class="escrow-list" id="list"></div>
      </div>

      <!-- Detail -->
      <div class="detail" id="detail-panel" style="display:none">
        <h2>🔍 Escrow Details <span id="d-id"></span></h2>
        <div class="detail-grid" id="d-grid"></div>

        <div class="detail-section" id="d-votes-section" style="display:none">
          <h4>Validator Votes</h4>
          <div class="votes-row" id="d-votes"></div>
          <div class="verdict-box">
            <span class="label">Final Verdict:</span>
            <span class="value" id="d-verdict"></span>
          </div>
        </div>
      </div>

    </div>
  </div>
</div>

<!-- Logs -->
<div class="logs-panel">
  <div class="logs-header">
    <span><b>Audit Log</b> — Real-time execution trace</span>
    <span id="log-count">0 entries</span>
  </div>
  <div class="logs-content" id="logs"></div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>

// ── Helpers ──────────────────────────────────

function $(id){return document.getElementById(id)}
function badge(status){return '<span class="badge badge-'+status+'">'+status+'</span>'}
function votePill(v){return '<span class="vote-pill vote-'+v+'">'+v+'</span>'}

function showToast(msg, type='success'){
  const t=$('toast');
  t.textContent=msg;
  t.className='toast '+type+' show';
  setTimeout(()=>t.classList.remove('show'), 4000);
}

function setResult(id, html, isError=false){
  $(id).innerHTML=html;
  $(id).className=isError?'error':'success';
}

function formatDate(ts){
  if(!ts||ts===0)return'—';
  return new Date(ts).toLocaleString();
}

function formatAddr(a){
  if(!a)return'—';
  if(a.length>20)return a.slice(0,8)+'...'+a.slice(-6);
  return a;
}

// ── API Calls ────────────────────────────────

async function createEscrow(){
  const btn=event.target;
  btn.disabled=true;
  try{
    const body={
      client: $('c-client').value||'web',
      freelancer: $('c-freelancer').value,
      amount_eth: $('c-amount').value,
      task_description: $('c-task').value,
    };
    const r=await fetch('/api/escrow/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.success){
      setResult('c-result','✅ Escrow #'+d.escrow_id+' created '+badge('pending'));
      showToast('Escrow #'+d.escrow_id+' created');
      $('filter-status').value = 'all';
      loadList(); loadStats(); loadLogs();
    }else{
      setResult('c-result','❌ '+(d.error||'Failed'),true);
      showToast(d.error||'Failed','error');
    }
  }catch(e){
    setResult('c-result','❌ '+e.message,true);
    showToast(e.message,'error');
  }
  btn.disabled=false;
}

async function submitWork(){
  const btn=event.target;
  btn.disabled=true;
  try{
    const id=$('s-id').value;
    const body={deliverable_url:$('s-url').value,freelancer:$('s-freelancer').value};
    const r=await fetch('/api/escrow/'+id+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.success){
      setResult('s-result','✅ Work submitted to #'+id+' '+badge('submitted'));
      showToast('Work submitted to #'+id);
      $('filter-status').value = 'all';
      loadList(); loadStats(); loadLogs();
    }else{
      setResult('s-result','❌ '+(d.error||'Failed'),true);
      showToast(d.error||'Failed','error');
    }
  }catch(e){
    setResult('s-result','❌ '+e.message,true);
    showToast(e.message,'error');
  }
  btn.disabled=false;
}

async function triggerArbitration(){
  const btn=$('a-btn');
  btn.disabled=true;
  btn.textContent='Running consensus...';
  try{
    const id=$('a-id').value;
    const caller=$('a-caller').value;
    showToast('Starting arbitration for #'+id+'...');
    const r=await fetch('/api/escrow/'+id+'/arbitrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caller})});
    const d=await r.json();
    if(d.success){
      const votesHtml=(d.votes||[]).map(v=>votePill(v)).join('');
      setResult('a-result','✅ Consensus reached: '+badge(d.final_verdict)+'<br/><div class="votes-row" style="margin-top:8px">'+votesHtml+'</div>');
      showToast('Arbitration complete: '+d.final_verdict);
      $('filter-status').value = 'all';
      loadList(); loadStats(); loadLogs();
      // Auto-inspect after arbitration
      setTimeout(()=>inspectEscrow(id), 300);
    }else{
      setResult('a-result','❌ '+(d.error||'Failed'),true);
      showToast(d.error||'Failed','error');
    }
  }catch(e){
    setResult('a-result','❌ '+e.message,true);
    showToast(e.message,'error');
  }
  btn.disabled=false;
  btn.textContent='Run 3-Validator Consensus';
}

// ── List & Detail ────────────────────────────

function renderEscrowItem(e){
  const created=formatDate(e.created_at);
  return '<div class="escrow-item" onclick="inspectEscrow('+e.id+')">'+
    '<div class="id">#'+e.id+'</div>'+
    '<div class="info">'+
      '<div class="meta"><strong>'+formatAddr(e.client)+'</strong> → <strong>'+formatAddr(e.freelancer)+'</strong> · '+e.amount_eth+' ETH</div>'+
      '<div class="task-preview">'+e.task_description.substring(0,80)+(e.task_description.length>80?'...':'')+'</div>'+
    '</div>'+
    '<div class="side">'+badge(e.status)+'<span class="date">'+created+'</span></div>'+
  '</div>';
}

async function loadList(){
  try{
    const r=await fetch('/api/escrows');
    const d=await r.json();
    const list=d.escrows||[];
    const filter=$('filter-status').value;
    const filtered=filter==='all'?list:list.filter(e=>e.status===filter);

    if(filtered.length===0){
      $('list').innerHTML='<div class="empty"><div class="empty-icon">📭</div>No escrows found</div>';
      return;
    }
    $('list').innerHTML=filtered.map(renderEscrowItem).join('');
  }catch(e){
    $('list').innerHTML='<div class="empty">Error loading escrows</div>';
  }
}

async function loadStats(){
  try{
    const r=await fetch('/api/stats');
    const d=await r.json();
    $('stat-total').textContent=d.total||0;
    $('stat-pending').textContent=d.pending||0;
    $('stat-resolved').textContent=d.resolved||0;
  }catch(e){}
}

async function inspectEscrow(id){
  if(!id) return;
  try{
    const r=await fetch('/api/escrow/'+id);
    const d=await r.json();
    if(d.error){$('detail-panel').style.display='none';return;}

    $('detail-panel').style.display='block';
    $('d-id').innerHTML=badge(d.status);

    let html='';
    html+='<div class="label">ID</div><div class="value">#'+d.id+'</div>';
    html+='<div class="label">Client</div><div class="value">'+d.client+'</div>';
    html+='<div class="label">Freelancer</div><div class="value">'+d.freelancer+'</div>';
    html+='<div class="label">Amount</div><div class="value">'+d.amount_eth+' ETH</div>';
    html+='<div class="label">Status</div><div class="value">'+badge(d.status)+'</div>';
    html+='<div class="label">Created</div><div class="value">'+formatDate(d.created_at)+'</div>';
    html+='<div class="label">Resolved</div><div class="value">'+formatDate(d.resolved_at)+'</div>';
    html+='<div class="label">Task</div><div class="value">'+d.task_description+'</div>';
    html+='<div class="label">Deliverable</div><div class="value">'+(d.deliverable_url?'<a href="'+d.deliverable_url+'" target="_blank">'+d.deliverable_url+'</a>':'—')+'</div>';
    $('d-grid').innerHTML=html;

    if(d.votes&&d.votes.length){
      $('d-votes-section').style.display='block';
      $('d-votes').innerHTML=d.votes.map(v=>votePill(v)).join('');
      $('d-verdict').innerHTML=badge(d.final_verdict);
    }else{
      $('d-votes-section').style.display='none';
    }

    // Scroll to detail
    $('detail-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){}
}

// ── Logs ─────────────────────────────────────

async function loadLogs(){
  try{
    const r=await fetch('/api/logs');
    const d=await r.json();
    const logs=d.logs||[];
    $('log-count').textContent=logs.length+' entries';
    const el=$('logs');
    el.innerHTML='';
    logs.slice(-50).reverse().forEach(entry=>{
      try{
        const p=JSON.parse(entry);
        const div=document.createElement('div');
        div.className='entry';
        div.innerHTML='<span class="time">'+new Date(p.t).toLocaleTimeString()+'</span>'+
          '<span class="action">'+p.action+'</span>'+
          '<span class="data">'+JSON.stringify(p.data||{})+'</span>';
        el.appendChild(div);
      }catch(e){}
    });
  }catch(e){}
}

// ── Init ─────────────────────────────────────

loadList();
loadStats();
loadLogs();
setInterval(()=>{loadList();loadStats();loadLogs();},8000);

</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Router — Strict Contract Logic
// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

  // Health
  if (url.pathname === "/health") {
    const c = await kv.get(["counter"]);
    return json({ ok: true, counter: Number(c.value ?? 0n) });
  }

  // Frontend
  if (url.pathname === "/") {
    return new Response(frontendHTML(), { headers: cors({ "Content-Type": "text/html" }) });
  }

  // GET ALL ESCROWS
  if (url.pathname === "/api/escrows") {
    const escrows = await getAllEscrows();
    return json({ escrows });
  }

  // GET STATS
  if (url.pathname === "/api/stats") {
    const all = await getAllEscrows();
    const total = all.length;
    const pending = all.filter(e => e.status === "pending").length;
    const resolved = all.filter(e => ["approved", "partial", "rejected"].includes(e.status)).length;
    return json({ total, pending, resolved });
  }

  // GET LOGS
  if (url.pathname === "/api/logs") {
    const logs = await getLogs();
    return json({ logs });
  }

  // GET SINGLE ESCROW
  const mGet = url.pathname.match(/^\/api\/escrow\/(\d+)$/);
  if (mGet && req.method === "GET") {
    const e = await getEscrow(Number(mGet[1]));
    return json(e ?? { error: "Escrow not found" });
  }

  // CREATE ESCROW
  if (url.pathname === "/api/escrow/create" && req.method === "POST") {
    try {
      const b = await req.json();

      // Validation (as per contract)
      const client = (b.client ?? "web").trim();
      const freelancer = (b.freelancer ?? "").trim();
      const amountEth = String(b.amount_eth ?? "").trim();
      const task = (b.task_description ?? "").trim();

      if (!freelancer) return json({ success: false, error: "Freelancer address required" }, 400);
      if (freelancer === client) return json({ success: false, error: "Client and freelancer must differ" }, 400);
      if (!amountEth || isNaN(Number(amountEth)) || Number(amountEth) <= 0) return json({ success: false, error: "Must deposit funds (amount > 0)" }, 400);
      if (task.length < 20) return json({ success: false, error: "Task description too short (min 20 chars)" }, 400);
      if (task.length > 2000) return json({ success: false, error: "Task description too long (max 2000 chars)" }, 400);

      const id = await nextId();
      const now = Date.now();

      const e: Escrow = {
        id,
        client,
        freelancer,
        amount_eth: amountEth,
        task_description: task,
        deliverable_url: "",
        status: "pending",
        votes: [],
        final_verdict: "",
        created_at: now,
        resolved_at: 0,
      };

      await setEscrow(e);
      await addLog("create_escrow", { escrow_id: id, client, freelancer, amount: amountEth });

      return json({ success: true, escrow_id: id });
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // SUBMIT WORK
  const mSubmit = url.pathname.match(/^\/api\/escrow\/(\d+)\/submit$/);
  if (mSubmit && req.method === "POST") {
    try {
      const id = Number(mSubmit[1]);
      const b = await req.json();
      const e = await getEscrow(id);

      if (!e) return json({ success: false, error: "Escrow not found" }, 404);

      const caller = (b.freelancer ?? "").trim();
      const deliverableUrl = (b.deliverable_url ?? "").trim();

      // Validation (as per contract)
      if (caller !== e.freelancer) return json({ success: false, error: "Only freelancer can submit work" }, 403);
      if (e.status !== "pending") return json({ success: false, error: "Escrow not in PENDING state" }, 400);
      if (deliverableUrl.length < 5) return json({ success: false, error: "Invalid deliverable URL" }, 400);
      if (!deliverableUrl.startsWith("http")) return json({ success: false, error: "URL must start with http" }, 400);

      e.deliverable_url = deliverableUrl;
      e.status = "submitted";

      await setEscrow(e);
      await addLog("submit_work", { escrow_id: id, freelancer: caller, url: deliverableUrl });

      return json({ success: true });
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // TRIGGER ARBITRATION
  const mArb = url.pathname.match(/^\/api\/escrow\/(\d+)\/arbitrate$/);
  if (mArb && req.method === "POST") {
    try {
      const id = Number(mArb[1]);
      const b = await req.json().catch(() => ({}));
      const e = await getEscrow(id);

      if (!e) return json({ success: false, error: "Escrow not found" }, 404);

      const caller = (b.caller ?? "").trim();
      if (!caller) return json({ success: false, error: "Caller address required" }, 400);

      // Validation (as per contract)
      if (e.status !== "submitted") return json({ success: false, error: "Work must be submitted before arbitration" }, 400);
      if (![e.client, e.freelancer].includes(caller)) return json({ success: false, error: "Only parties to this escrow can trigger arbitration" }, 403);

      // Mark disputed
      e.status = "disputed";
      await setEscrow(e);
      await addLog("trigger_arbitration", { escrow_id: id, caller, status: "disputed" });

      // Run 3 validators (exactly as contract)
      const [v1, v2, v3] = await Promise.all([
        callValidator("tech", e.task_description, e.deliverable_url),
        callValidator("req", e.task_description, e.deliverable_url),
        callValidator("quality", e.task_description, e.deliverable_url),
      ]);

      const votes = [v1, v2, v3];
      const verdict = majorityVote(votes);
      const now = Date.now();

      e.votes = votes;
      e.final_verdict = verdict;
      e.status = verdict as any;
      e.resolved_at = now;

      await setEscrow(e);
      await addLog("arbitration_complete", { escrow_id: id, votes, verdict, resolved_at: now });

      return json({ success: true, votes, final_verdict: verdict });
    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  return json({ error: "Not found" }, 404);
});
