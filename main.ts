<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Escrow — Smart Dispute Resolver</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:        #080a0f;
    --surface:   #0e1118;
    --border:    #1c2030;
    --border2:   #252d40;
    --accent:    #00e5ff;
    --accent2:   #7b61ff;
    --warn:      #ff6b35;
    --green:     #00ff88;
    --red:       #ff3b5c;
    --text:      #e8eaf0;
    --muted:     #5a6380;
    --mono:      'JetBrains Mono', monospace;
    --display:   'Syne', sans-serif;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--display);
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── Grid background ── */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(rgba(0,229,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,229,255,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
  }

  /* ── Glow orbs ── */
  .orb {
    position: fixed;
    border-radius: 50%;
    filter: blur(120px);
    pointer-events: none;
    z-index: 0;
  }
  .orb-1 {
    width: 500px; height: 500px;
    background: radial-gradient(circle, rgba(0,229,255,0.06), transparent 70%);
    top: -100px; left: -100px;
  }
  .orb-2 {
    width: 400px; height: 400px;
    background: radial-gradient(circle, rgba(123,97,255,0.07), transparent 70%);
    bottom: 0; right: -50px;
  }

  /* ── Layout ── */
  .wrap {
    position: relative;
    z-index: 1;
    max-width: 900px;
    margin: 0 auto;
    padding: 0 24px 80px;
  }

  /* ── Header ── */
  header {
    position: relative;
    z-index: 1;
    padding: 32px 24px 0;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .logo-icon {
    width: 32px; height: 32px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
  }

  .badge {
    font-family: var(--mono);
    font-size: 10px;
    padding: 3px 8px;
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--muted);
    letter-spacing: 0.1em;
  }

  /* ── Hero ── */
  .hero {
    padding: 64px 0 48px;
    animation: fadeUp 0.7s ease both;
  }

  .hero-tag {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--accent);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hero-tag::before {
    content: '';
    width: 24px; height: 1px;
    background: var(--accent);
  }

  h1 {
    font-size: clamp(36px, 6vw, 64px);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.02em;
    margin-bottom: 20px;
  }

  h1 span {
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero-sub {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--muted);
    line-height: 1.7;
    max-width: 560px;
  }

  /* ── Flow diagram ── */
  .flow {
    display: flex;
    align-items: center;
    gap: 0;
    margin: 40px 0;
    overflow-x: auto;
    padding-bottom: 8px;
    animation: fadeUp 0.7s 0.15s ease both;
  }

  .flow-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .flow-node {
    width: 48px; height: 48px;
    border: 1px solid var(--border2);
    border-radius: 12px;
    background: var(--surface);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .flow-node:hover {
    border-color: var(--accent);
    box-shadow: 0 0 20px rgba(0,229,255,0.15);
  }

  .flow-label {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--muted);
    text-align: center;
    letter-spacing: 0.05em;
    max-width: 60px;
  }

  .flow-arrow {
    width: 32px;
    height: 1px;
    background: linear-gradient(90deg, var(--border2), var(--accent), var(--border2));
    flex-shrink: 0;
    margin-bottom: 20px;
    position: relative;
  }

  .flow-arrow::after {
    content: '▶';
    position: absolute;
    right: -6px;
    top: -7px;
    font-size: 8px;
    color: var(--accent);
  }

  /* ── Section titles ── */
  .section-title {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--accent);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* ── Cards ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 16px;
    transition: border-color 0.2s;
    animation: fadeUp 0.6s ease both;
  }

  .card:hover { border-color: var(--border2); }

  /* ── Form elements ── */
  label {
    display: block;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  input, textarea, select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 10px;
    padding: 12px 16px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    margin-bottom: 16px;
  }

  input:focus, textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(0,229,255,0.08);
  }

  textarea { resize: vertical; min-height: 100px; }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 600px) { .field-row { grid-template-columns: 1fr; } }

  /* ── Buttons ── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 13px 24px;
    border-radius: 10px;
    font-family: var(--display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.05em;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    text-transform: uppercase;
  }

  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: #000;
  }

  .btn-primary:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(0,229,255,0.25);
  }

  .btn-primary:active { transform: translateY(0); }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border2);
    color: var(--text);
  }

  .btn-outline:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none !important;
  }

  /* ── Amount input ── */
  .amount-wrap {
    position: relative;
  }

  .amount-wrap input { padding-right: 60px; }

  .amount-unit {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-60%);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  /* ── Tabs ── */
  .tabs {
    display: flex;
    gap: 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 4px;
    margin-bottom: 24px;
  }

  .tab {
    flex: 1;
    padding: 10px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--muted);
    font-family: var(--display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab.active {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border2);
  }

  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  /* ── Verdict display ── */
  .verdict-box {
    border-radius: 16px;
    padding: 32px;
    text-align: center;
    border: 1px solid var(--border2);
    margin-top: 20px;
    display: none;
  }

  .verdict-box.show { display: block; animation: fadeUp 0.5s ease both; }

  .verdict-box.approved { border-color: var(--green); background: rgba(0,255,136,0.04); }
  .verdict-box.partial  { border-color: var(--warn);  background: rgba(255,107,53,0.04); }
  .verdict-box.rejected { border-color: var(--red);   background: rgba(255,59,92,0.04); }

  .verdict-emoji { font-size: 48px; margin-bottom: 12px; }

  .verdict-label {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .verdict-box.approved .verdict-label { color: var(--green); }
  .verdict-box.partial  .verdict-label { color: var(--warn); }
  .verdict-box.rejected .verdict-label { color: var(--red); }

  .verdict-desc {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 20px;
  }

  /* ── Votes row ── */
  .votes-row {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .vote-chip {
    font-family: var(--mono);
    font-size: 11px;
    padding: 6px 14px;
    border-radius: 20px;
    border: 1px solid;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vote-chip.approved { border-color: var(--green); color: var(--green); background: rgba(0,255,136,0.08); }
  .vote-chip.partial  { border-color: var(--warn);  color: var(--warn);  background: rgba(255,107,53,0.08); }
  .vote-chip.rejected { border-color: var(--red);   color: var(--red);   background: rgba(255,59,92,0.08); }

  /* ── Status badge ── */
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 10px;
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid var(--border2);
    color: var(--muted);
    letter-spacing: 0.08em;
  }

  .status-pill.pending  { border-color: #ffd60a33; color: #ffd60a; }
  .status-pill.submitted{ border-color: #5e9cff33; color: #5e9cff; }
  .status-pill.disputed { border-color: var(--warn); color: var(--warn); }
  .status-pill.approved { border-color: var(--green); color: var(--green); }
  .status-pill.rejected { border-color: var(--red); color: var(--red); }

  .pulse {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.5s infinite;
  }

  /* ── Log terminal ── */
  .terminal {
    background: #050709;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.8;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 16px;
  }

  .log-line { display: flex; gap: 12px; }
  .log-time { color: var(--muted); flex-shrink: 0; }
  .log-info { color: var(--accent); }
  .log-warn { color: var(--warn); }
  .log-ok   { color: var(--green); }
  .log-err  { color: var(--red); }

  /* ── Stats row ── */
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 32px;
    animation: fadeUp 0.6s 0.1s ease both;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    text-align: center;
  }

  .stat-val {
    font-size: 28px;
    font-weight: 800;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .stat-key {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-top: 4px;
  }

  /* ── Loader ── */
  .loader {
    display: inline-block;
    width: 14px; height: 14px;
    border: 2px solid rgba(0,229,255,0.2);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  /* ── Agents live ── */
  .agents {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 16px 0;
  }

  .agent-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    text-align: center;
    transition: border-color 0.3s;
  }

  .agent-card.thinking { border-color: var(--accent); box-shadow: 0 0 16px rgba(0,229,255,0.1); }
  .agent-card.done-approved { border-color: var(--green); }
  .agent-card.done-partial  { border-color: var(--warn); }
  .agent-card.done-rejected { border-color: var(--red); }

  .agent-icon { font-size: 24px; margin-bottom: 8px; }
  .agent-name { font-family: var(--mono); font-size: 10px; color: var(--muted); letter-spacing: 0.08em; }
  .agent-verdict { font-size: 11px; font-weight: 700; margin-top: 6px; letter-spacing: 0.05em; }

  /* ── Animations ── */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* ── Divider ── */
  .divider { height: 1px; background: var(--border); margin: 32px 0; }

  /* ── Escrow ID display ── */
  .escrow-id-display {
    background: var(--bg);
    border: 1px solid var(--border2);
    border-radius: 10px;
    padding: 12px 16px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--accent);
    margin-bottom: 16px;
    display: none;
  }

  .escrow-id-display.show { display: flex; align-items: center; justify-content: space-between; }

  .copy-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    transition: color 0.2s;
  }

  .copy-btn:hover { color: var(--accent); }

</style>
</head>
<body>

<div class="orb orb-1"></div>
<div class="orb orb-2"></div>

<header>
  <div class="logo">
    <div class="logo-icon">⚖</div>
    AI ESCROW
  </div>
  <div style="display:flex;gap:8px;align-items:center;">
    <span class="badge">GENLAYER</span>
    <span class="badge" id="networkBadge">STUDIONET</span>
  </div>
</header>

<div class="wrap">

  <!-- Hero -->
  <div class="hero">
    <div class="hero-tag">Powered by 3 LLM Validators</div>
    <h1>Trustless Freelance<br><span>Smart Dispute</span> Resolution</h1>
    <p class="hero-sub">
      Escrow funds released by AI consensus — not humans.<br>
      Three independent agents evaluate deliverables. Majority rules.
    </p>
  </div>

  <!-- Flow -->
  <div class="flow">
    <div class="flow-step">
      <div class="flow-node">💼</div>
      <div class="flow-label">CREATE ESCROW</div>
    </div>
    <div class="flow-arrow"></div>
    <div class="flow-step">
      <div class="flow-node">🛠</div>
      <div class="flow-label">SUBMIT WORK</div>
    </div>
    <div class="flow-arrow"></div>
    <div class="flow-step">
      <div class="flow-node">🤖</div>
      <div class="flow-label">AI ARBITRATION</div>
    </div>
    <div class="flow-arrow"></div>
    <div class="flow-step">
      <div class="flow-node">⚡</div>
      <div class="flow-label">CONSENSUS VOTE</div>
    </div>
    <div class="flow-arrow"></div>
    <div class="flow-step">
      <div class="flow-node">💰</div>
      <div class="flow-label">FUNDS RELEASED</div>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats">
    <div class="stat-card">
      <div class="stat-val" id="statEscrows">0</div>
      <div class="stat-key">Total Escrows</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">3</div>
      <div class="stat-key">AI Validators</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">1%</div>
      <div class="stat-key">Platform Fee</div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab active" onclick="switchTab('create')">💼 Create Escrow</button>
    <button class="tab" onclick="switchTab('submit')">🛠 Submit Work</button>
    <button class="tab" onclick="switchTab('arbitrate')">⚖ Arbitrate</button>
    <button class="tab" onclick="switchTab('status')">📊 Check Status</button>
  </div>

  <!-- TAB: Create -->
  <div id="tab-create" class="tab-panel active">
    <div class="section-title">New Escrow</div>
    <div class="card">
      <div class="field-row">
        <div>
          <label>Freelancer Address</label>
          <input type="text" id="freelancerAddr" placeholder="0x...">
        </div>
        <div>
          <label>Amount (ETH)</label>
          <div class="amount-wrap">
            <input type="number" id="escrowAmount" placeholder="1.0" min="0.001" step="0.001">
            <span class="amount-unit">ETH</span>
          </div>
        </div>
      </div>
      <label>Task Specification</label>
      <textarea id="taskSpec" placeholder="Describe the deliverable in detail. Be specific: what must be built, what format, what requirements must be met. The more precise, the better the AI evaluation."></textarea>
      <button class="btn btn-primary" onclick="createEscrow()">
        <span>Create Escrow</span> →
      </button>
    </div>

    <div class="escrow-id-display" id="newEscrowId">
      <span>Escrow ID: <strong id="newEscrowIdVal">—</strong></span>
      <button class="copy-btn" onclick="copyId()" title="Copy ID">⎘</button>
    </div>
    <div class="terminal" id="createLog" style="display:none"></div>
  </div>

  <!-- TAB: Submit -->
  <div id="tab-submit" class="tab-panel">
    <div class="section-title">Submit Deliverable</div>
    <div class="card">
      <label>Escrow ID</label>
      <input type="number" id="submitEscrowId" placeholder="0">
      <label>Deliverable URL</label>
      <input type="text" id="deliverableUrl" placeholder="https://github.com/user/repo">
      <button class="btn btn-primary" onclick="submitWork()">
        <span>Submit Work</span> →
      </button>
    </div>
    <div class="terminal" id="submitLog" style="display:none"></div>
  </div>

  <!-- TAB: Arbitrate -->
  <div id="tab-arbitrate" class="tab-panel">
    <div class="section-title">AI Arbitration</div>
    <div class="card">
      <label>Escrow ID</label>
      <input type="number" id="arbitrateId" placeholder="0">
      <label>Task Specification</label>
      <textarea id="arbitrateTaskSpec" placeholder="Describe the task requirements that were agreed upon..."></textarea>
      <label>Deliverable URL</label>
      <input type="text" id="arbitrateDeliverableUrl" placeholder="https://github.com/user/repo">

      <div class="agents" id="agentsDisplay" style="display:none">
        <div class="agent-card" id="agent1">
          <div class="agent-icon">🔍</div>
          <div class="agent-name">TECHNICAL<br>COMPLETENESS</div>
          <div class="agent-verdict" id="a1verdict">—</div>
        </div>
        <div class="agent-card" id="agent2">
          <div class="agent-icon">📋</div>
          <div class="agent-name">REQUIREMENT<br>COVERAGE</div>
          <div class="agent-verdict" id="a2verdict">—</div>
        </div>
        <div class="agent-card" id="agent3">
          <div class="agent-icon">⭐</div>
          <div class="agent-name">QUALITY &<br>PROFESSIONALISM</div>
          <div class="agent-verdict" id="a3verdict">—</div>
        </div>
      </div>

      <button class="btn btn-primary" id="arbitrateBtn" onclick="triggerArbitration()" style="margin-top:8px">
        <span>Trigger AI Arbitration</span> →
      </button>
    </div>

    <div class="verdict-box" id="verdictBox">
      <div class="verdict-emoji" id="verdictEmoji">—</div>
      <div class="verdict-label" id="verdictLabel">—</div>
      <div class="verdict-desc" id="verdictDesc">—</div>
      <div class="votes-row" id="votesRow"></div>
      <div id="payoutInfo" style="font-family:var(--mono);font-size:12px;color:var(--muted)"></div>
    </div>
    <div class="terminal" id="arbitrateLog" style="display:none"></div>
  </div>

  <!-- TAB: Status -->
  <div id="tab-status" class="tab-panel">
    <div class="section-title">Escrow Status</div>
    <div class="card">
      <label>Escrow ID</label>
      <input type="number" id="statusId" placeholder="0">
      <button class="btn btn-outline" onclick="checkStatus()">Check Status</button>
    </div>
    <div id="statusResult" style="display:none" class="card" style="animation-delay:0.1s">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <span style="font-size:18px;font-weight:700">Escrow #<span id="statusIdDisplay">—</span></span>
        <span class="status-pill" id="statusPill"><span class="pulse"></span><span id="statusText">—</span></span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">CLIENT</div>
          <div style="font-family:var(--mono);font-size:12px;word-break:break-all" id="statusClient">—</div>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">FREELANCER</div>
          <div style="font-family:var(--mono);font-size:12px;word-break:break-all" id="statusFreelancer">—</div>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">AMOUNT</div>
          <div style="font-family:var(--mono);font-size:12px" id="statusAmount">—</div>
        </div>
        <div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-bottom:4px">VERDICT</div>
          <div style="font-family:var(--mono);font-size:12px" id="statusVerdict">—</div>
        </div>
      </div>
    </div>
  </div>

</div>

<script>
  // ── Config ─────────────────────────────────────────────────────────────────
  const API_BASE = 'https://ai-escrow.biosolverr.deno.net';
  const API = window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : API_BASE;

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    event.target.classList.add('active');
  }

  // ── Logger ─────────────────────────────────────────────────────────────────
  function log(terminalId, msg, type = 'info') {
    const el = document.getElementById(terminalId);
    el.style.display = 'block';
    const time = new Date().toLocaleTimeString('en', {hour12:false});
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${msg}</span>`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  // ── Simulate demo mode (no real backend yet) ───────────────────────────────
  // Заглушка — реальные вызовы пойдут через бекенд на Deno
  const DEMO_MODE = false;

  let escrowCounter = 0;
  const escrows = {};

  // ── Create Escrow ──────────────────────────────────────────────────────────
  async function createEscrow() {
    const freelancer = document.getElementById('freelancerAddr').value.trim();
    const amount     = document.getElementById('escrowAmount').value;
    const taskSpec   = document.getElementById('taskSpec').value.trim();

    if (!freelancer || !amount || !taskSpec) {
      log('createLog', 'ERROR: all fields required', 'err'); return;
    }
    if (taskSpec.length < 20) {
      log('createLog', 'ERROR: task spec too short (min 20 chars)', 'err'); return;
    }

    log('createLog', 'Sending create_escrow transaction...', 'info');

    if (DEMO_MODE) {
      await sleep(800);
      const id = escrowCounter++;
      escrows[id] = { id, freelancer, amount, taskSpec, status: 'pending', votes: [], verdict: '' };
      log('createLog', `✓ Escrow #${id} created — ${amount} ETH locked`, 'ok');
      log('createLog', `Freelancer: ${freelancer.slice(0,10)}...`, 'info');
      showEscrowId(id);
      updateStats();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/escrow/create`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ freelancer, amount_eth: amount, task_description: taskSpec })
      });
      const data = await res.json();
      if (data.success) {
        log('createLog', `✓ Escrow #${data.escrow_id} created — ${amount} ETH locked`, 'ok');
        log('createLog', `Freelancer: ${freelancer.slice(0,10)}...`, 'info');
        showEscrowId(data.escrow_id);
        escrows[data.escrow_id] = data.record;
        escrowCounter = data.escrow_id + 1;
        updateStats();
      } else {
        log('createLog', `ERROR: ${data.error}`, 'err');
      }
    } catch(e) {
      log('createLog', `ERROR: ${e.message}`, 'err');
    }
  }

  function showEscrowId(id) {
    const el = document.getElementById('newEscrowId');
    document.getElementById('newEscrowIdVal').textContent = id;
    el.classList.add('show');
  }

  function copyId() {
    const id = document.getElementById('newEscrowIdVal').textContent;
    navigator.clipboard.writeText(id);
  }

  // ── Submit Work ────────────────────────────────────────────────────────────
  async function submitWork() {
    const id  = document.getElementById('submitEscrowId').value;
    const url = document.getElementById('deliverableUrl').value.trim();

    if (id === '' || !url) { log('submitLog', 'ERROR: fill all fields', 'err'); return; }
    if (!url.startsWith('http')) { log('submitLog', 'ERROR: URL must start with http', 'err'); return; }

    log('submitLog', `Submitting deliverable for escrow #${id}...`, 'info');

    if (DEMO_MODE) {
      await sleep(600);
      if (escrows[id]) {
        escrows[id].status = 'submitted';
        escrows[id].url    = url;
      }
      log('submitLog', `✓ Work submitted: ${url}`, 'ok');
      log('submitLog', `Status → SUBMITTED`, 'info');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/escrow/${id}/submit`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ deliverable_url: url })
      });
      const data = await res.json();
      if (data.success) {
        log('submitLog', `✓ Work submitted: ${url}`, 'ok');
        log('submitLog', `Status → SUBMITTED`, 'info');
        if (escrows[id]) escrows[id].status = 'submitted';
      } else {
        log('submitLog', `ERROR: ${data.error}`, 'err');
      }
    } catch(e) {
      log('submitLog', `ERROR: ${e.message}`, 'err');
    }
  }

  // ── Arbitration ────────────────────────────────────────────────────────────
  async function triggerArbitration() {
    const id      = document.getElementById('arbitrateId').value.trim();
    const task    = document.getElementById('arbitrateTaskSpec').value.trim();
    const url     = document.getElementById('arbitrateDeliverableUrl').value.trim();

    if (!url) { log('arbitrateLog', 'ERROR: Deliverable URL is required', 'err'); return; }
    if (!task) { log('arbitrateLog', 'ERROR: Task specification is required', 'err'); return; }

    const btn = document.getElementById('arbitrateBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loader"></span> Running 3 AI Agents...';

    document.getElementById('agentsDisplay').style.display = 'grid';
    document.getElementById('verdictBox').classList.remove('show','approved','partial','rejected');

    // Reset agents to thinking state
    ['agent1','agent2','agent3'].forEach(a => {
      document.getElementById(a).className = 'agent-card thinking';
    });
    ['a1verdict','a2verdict','a3verdict'].forEach(a => {
      document.getElementById(a).textContent = '...';
      document.getElementById(a).style.color = 'var(--accent)';
    });

    log('arbitrateLog', `Starting AI arbitration for escrow #${id || 'new'}...`, 'info');
    log('arbitrateLog', 'Sending to 3 independent AI agents...', 'info');

    try {
      // Если ID указан и эскроу в статусе submitted — используем /arbitrate
      // Иначе — прямой вызов с task+url (legacy режим)
      let res;
      if (id && escrows[id] && escrows[id].status === 'submitted') {
        res = await fetch(`${API_BASE}/api/escrow/${id}/arbitrate`, { method: 'POST', headers: {'Content-Type':'application/json'} });
      } else {
        res = await fetch(`${API_BASE}/api/trigger-arbitration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            escrow_id: parseInt(id) || 1,
            task_description: task,
            deliverable_url: url
          })
        });
      }

      const data = await res.json();

      if (data.success) {
        const votes = data.votes || [];
        ['agent1','agent2','agent3'].forEach((el, i) => {
          const verdict = votes[i] || 'partial';
          setAgentResult(el, `a${i+1}verdict`, verdict);
          log('arbitrateLog', `Agent ${i+1} → ${verdict.toUpperCase()}`,
            verdict === 'approved' ? 'ok' : verdict === 'rejected' ? 'err' : 'warn');
        });

        showVerdict(data.final_verdict, votes, id);
        log('arbitrateLog', `Final Verdict: ${data.final_verdict.toUpperCase()}`, 'ok');
        if (data.processing_time_ms) {
          log('arbitrateLog', `Processing time: ${data.processing_time_ms}ms`, 'info');
        }
      } else {
        log('arbitrateLog', `ERROR: ${data.error || 'Unknown error'}`, 'err');
        ['agent1','agent2','agent3'].forEach(a => {
          document.getElementById(a).className = 'agent-card';
        });
      }
    } catch(e) {
      log('arbitrateLog', `Connection error: ${e.message}`, 'err');
      ['agent1','agent2','agent3'].forEach(a => {
        document.getElementById(a).className = 'agent-card';
      });
    }

    btn.disabled = false;
    btn.innerHTML = '<span>Trigger AI Arbitration</span> →';
  }

  function simulateVerdicts() {
    const opts = ['approved','approved','rejected','partial'];
    return [
      opts[Math.floor(Math.random() * opts.length)],
      opts[Math.floor(Math.random() * opts.length)],
      opts[Math.floor(Math.random() * opts.length)],
    ];
  }

  function majorityVote(votes) {
    const c = {approved:0, partial:0, rejected:0};
    votes.forEach(v => { if (c[v] !== undefined) c[v]++; });
    const max = Math.max(...Object.values(c));
    for (const [k,v] of Object.entries(c)) {
      if (v === max && max >= 2) return k;
    }
    return 'partial';
  }

  function setAgentResult(cardId, verdictId, verdict) {
    const card = document.getElementById(cardId);
    const vEl  = document.getElementById(verdictId);
    card.className = `agent-card done-${verdict}`;
    vEl.textContent = verdict.toUpperCase();
    vEl.style.color = verdict === 'approved' ? 'var(--green)' : verdict === 'rejected' ? 'var(--red)' : 'var(--warn)';
  }

  function showVerdict(verdict, votes, id) {
    const box = document.getElementById('verdictBox');
    const configs = {
      approved: { emoji:'✅', label:'APPROVED', desc:'Full payment released to freelancer.' },
      partial:  { emoji:'⚡', label:'PARTIAL',  desc:'50% to freelancer · 50% refunded to client.' },
      rejected: { emoji:'❌', label:'REJECTED', desc:'Full refund to client.' },
    };
    const cfg = configs[verdict] || configs.partial;

    document.getElementById('verdictEmoji').textContent = cfg.emoji;
    document.getElementById('verdictLabel').textContent = cfg.label;
    document.getElementById('verdictDesc').textContent  = cfg.desc;

    const vRow = document.getElementById('votesRow');
    vRow.innerHTML = votes.map((v,i) =>
      `<span class="vote-chip ${v}">Agent ${i+1}: ${v.toUpperCase()}</span>`
    ).join('');

    box.className = `verdict-box show ${verdict}`;

    if (escrows[id]) { escrows[id].status = verdict; escrows[id].votes = votes; escrows[id].verdict = verdict; }
  }

  // ── Check Status ───────────────────────────────────────────────────────────
  async function checkStatus() {
    const id = document.getElementById('statusId').value;
    if (id === '') return;

    try {
      const res = await fetch(`${API_BASE}/api/escrow/${id}`);
      const data = await res.json();
      if (data.success) {
        renderStatus(id, data.status, data.client, data.freelancer, data.amount_eth + ' ETH', data.final_verdict || '—');
      } else {
        log('statusLog', `ERROR: ${data.error}`, 'err');
      }
    } catch(e) {
      renderStatus(id, 'pending', '—', '—', '—', '—');
    }
  }

  function renderStatus(id, status, client, freelancer, amount, verdict) {
    document.getElementById('statusIdDisplay').textContent = id;
    document.getElementById('statusClient').textContent    = client;
    document.getElementById('statusFreelancer').textContent= freelancer;
    document.getElementById('statusAmount').textContent    = amount;
    document.getElementById('statusVerdict').textContent   = verdict;

    const pill = document.getElementById('statusPill');
    pill.className = `status-pill ${status}`;
    document.getElementById('statusText').textContent = status.toUpperCase();

    document.getElementById('statusResult').style.display = 'block';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function updateStats() {
    document.getElementById('statEscrows').textContent = escrowCounter;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  // Ping backend
  (async () => {
    if (!DEMO_MODE) {
      try {
        const r = await fetch(`${API}/health`);
        const d = await r.json();
        document.getElementById('networkBadge').textContent = d.network || 'CONNECTED';
      } catch {}
    }
  })();
</script>
</body>
</html>
