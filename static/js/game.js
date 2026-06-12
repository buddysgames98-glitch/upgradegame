/**
 * game.js — Ascension Upgrade Tree Game
 *
 * Handles:
 *  - Idle resource accumulation with real-time display
 *  - Upgrade tree rendering on canvas (pan + zoom)
 *  - Node purchasing with visual feedback
 *  - Prestige system (reset + meta-upgrade tree)
 *  - Save/load (local + server)
 *  - Tree JSON import/export
 *  - Custom art loading with SVG fallback
 */

const Game = (() => {

  // ── State ─────────────────────────────────────────────────────────────────
  let S = {
    sessionId:        null,
    treeId:           'default',
    treeDef:          null,
    resources:        0,
    totalEarned:      0,
    rate:             0,
    unlocked:         new Set(),
    inProgress:       {},   // nodeId → { startTime, duration }
    prestigeCount:    0,
    prestigePoints:   0,
    prestigeUnlocked: new Set(),
    lastTick:         Date.now(),
    runStart:         Date.now(),
  };

  // ── Tree viewport state ───────────────────────────────────────────────────
  const TV = {
    canvas: null, ctx: null,
    pan: { x: 0, y: 0 }, zoom: 1,
    drag: null, nodeHit: null,
    GRID: 120,    // px per grid unit at zoom=1
  };

  const PV = {   // prestige viewport
    canvas: null, ctx: null,
    pan: { x: 0, y: 0 }, zoom: 1,
    drag: null, nodeHit: null,
    GRID: 120,
  };

  let activeTab = 'tree';
  let modalNode = null;
  let modalIsPrestige = false;
  let artCache = {};   // nodeId → url | 'svg'

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    setLoadMsg('Generating session…', 20);
    S.sessionId = getOrCreateSession();
    document.getElementById('session-id-display').textContent = S.sessionId;

    setLoadMsg('Loading tree…', 45);
    await loadTree('default');

    setLoadMsg('Restoring save…', 70);
    await loadSave();

    setLoadMsg('Rendering…', 90);
    initCanvases();
    setupEvents();
    startLoop();

    setLoadMsg('Ready!', 100);
    await sleep(300);
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    renderTree(TV, S.treeDef.nodes, false);
    renderTree(PV, S.treeDef.prestige_nodes || [], true);
  }

  function setLoadMsg(msg, pct) {
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading-bar').style.width = pct + '%';
  }

  // ── Session ───────────────────────────────────────────────────────────────
  function getOrCreateSession() {
    let sid = localStorage.getItem('ascension_session');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('ascension_session', sid);
    }
    return sid;
  }

  // ── Tree Loading ──────────────────────────────────────────────────────────
  async function loadTree(treeId) {
    const res = await fetch(`/api/tree/${treeId}`);
    const data = await res.json();
    if (!data.ok) { console.error('Tree load failed', data); return; }
    S.treeDef = data.tree;
    S.treeId  = treeId;
    updateResourceUI();
  }

  // ── Save / Load ───────────────────────────────────────────────────────────
  async function loadSave() {
    // Try server first, then localStorage fallback
    try {
      const res  = await fetch(`/api/load/${S.sessionId}`);
      const data = await res.json();
      if (data.ok) {
        applySave(data.save);
        return;
      }
    } catch(e) {}
    // localStorage fallback
    const lsSave = localStorage.getItem('ascension_save');
    if (lsSave) { try { applySave(JSON.parse(lsSave)); } catch(e) {} }
  }

  function applySave(save) {
    S.resources        = save.resources?.main || 0;
    S.totalEarned      = save.total_earned     || 0;
    S.unlocked         = new Set(save.unlocked || []);
    S.inProgress       = save.in_progress       || {};
    S.prestigeCount    = save.prestige_count    || 0;
    S.prestigePoints   = save.prestige_points   || 0;
    S.prestigeUnlocked = new Set(save.prestige_upgrades || []);
    S.runStart         = save.run_start         || Date.now();
    recomputeRate();
  }

  async function saveGame() {
    const saveData = {
      session_id:        S.sessionId,
      tree_id:           S.treeId,
      resources:         { main: S.resources },
      unlocked:          [...S.unlocked],
      in_progress:       S.inProgress,
      prestige_count:    S.prestigeCount,
      prestige_points:   S.prestigePoints,
      prestige_upgrades: [...S.prestigeUnlocked],
      total_earned:      S.totalEarned,
      run_start:         S.runStart,
    };
    // Always localStorage for reliability
    localStorage.setItem('ascension_save', JSON.stringify(saveData));
    // Server save (best-effort)
    try { await fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(saveData) }); } catch(e) {}
  }

  // ── Rate Computation ──────────────────────────────────────────────────────
  function recomputeRate() {
    if (!S.treeDef) return;
    const nodeMap = Object.fromEntries(S.treeDef.nodes.map(n => [n.id, n]));
    let add  = S.treeDef.base_rate || 0.1;
    let mult = 1.0;

    for (const nid of S.unlocked) {
      const n = nodeMap[nid];
      if (!n) continue;
      const eff = n.effect || {};
      if (eff.type === 'rate_add')  add  += eff.value;
      if (eff.type === 'rate_mult') mult *= eff.value;
    }

    // Prestige bonuses
    const pMap = Object.fromEntries((S.treeDef.prestige_nodes||[]).map(n=>[n.id,n]));
    let globalMult = 1.0;
    let perPrestige = 0;
    for (const pid of S.prestigeUnlocked) {
      const pn = pMap[pid]; if (!pn) continue;
      const eff = pn.effect || {};
      if (eff.type === 'prestige_mult_per_prestige') perPrestige += eff.value;
      if (eff.type === 'global_mult')                globalMult  *= eff.value;
    }
    const prestigeMult = 1 + perPrestige * S.prestigeCount;

    // Offline mult
    let offlineMult = 1;
    if (!document.hasFocus && S.prestigeUnlocked.has('p_echo')) offlineMult = 2;

    S.rate = add * mult * prestigeMult * globalMult * offlineMult;
    return S.rate;
  }

  // ── Game Loop ─────────────────────────────────────────────────────────────
  let saveTimer = 0;
  function startLoop() {
    let lastFrame = performance.now();
    function frame(now) {
      const dt = Math.min((now - lastFrame) / 1000, 5);  // cap at 5s
      lastFrame = now;

      // Tick resources
      S.resources   += S.rate * dt;
      S.totalEarned += S.rate * dt;

      // Advance in-progress upgrades
      tickInProgress();

      // Update HUD every frame
      updateHUD();

      // Auto-save every 10s
      saveTimer += dt;
      if (saveTimer > 10) { saveTimer = 0; saveGame(); }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function tickInProgress() {
    const now = Date.now();
    let changed = false;
    for (const [nid, prog] of Object.entries(S.inProgress)) {
      if (now >= prog.endTime) {
        S.unlocked.add(nid);
        delete S.inProgress[nid];
        recomputeRate();
        renderTree(TV, S.treeDef.nodes, false);
        toast(`✓ ${getNode(nid)?.name || nid} unlocked!`);
        changed = true;
      }
    }
    if (changed) renderTree(TV, S.treeDef.nodes, false);
  }

  // ── HUD Updates ───────────────────────────────────────────────────────────
  function updateHUD() {
    document.getElementById('resource-amount').textContent = fmtNum(S.resources);
    document.getElementById('rate-value').textContent = '+' + fmtNum(S.rate, 2);
    document.getElementById('prestige-amount').textContent = fmtNum(S.prestigePoints, 0);

    // Show prestige badge
    if (S.prestigeCount > 0) {
      const b = document.getElementById('prestige-count-badge');
      b.textContent = `×${S.prestigeCount}`;
      b.classList.remove('hidden');
    }

    // Show prestige button when player has meaningful progress
    const canPrestige = S.totalEarned >= 1000;
    document.getElementById('btn-prestige').classList.toggle('hidden', !canPrestige);
  }

  function updateResourceUI() {
    if (!S.treeDef) return;
    const res = S.treeDef.resource || {};
    document.getElementById('resource-icon').textContent  = res.icon  || '⚡';
    document.getElementById('resource-name').textContent  = res.name  || 'Energy';
    const pr = S.treeDef.prestige_resource || {};
    document.getElementById('prestige-icon').textContent  = pr.icon   || '✨';
    document.getElementById('prestige-label').textContent = pr.name   || 'Essence';
    document.title = `${S.treeDef.name || 'Ascension'} — Upgrade Tree`;
  }

  // ── Canvas Setup ──────────────────────────────────────────────────────────
  function initCanvases() {
    TV.canvas = document.getElementById('tree-canvas');
    TV.ctx    = TV.canvas.getContext('2d');
    PV.canvas = document.getElementById('prestige-canvas');
    PV.ctx    = PV.canvas.getContext('2d');

    [TV, PV].forEach(v => {
      const wrap = v.canvas.parentElement;
      resizeCanvas(v, wrap);
      new ResizeObserver(() => resizeCanvas(v, wrap)).observe(wrap);
    });

    // Center initial view
    centerView(TV, S.treeDef?.nodes    || []);
    centerView(PV, S.treeDef?.prestige_nodes || []);
  }

  function resizeCanvas(v, wrap) {
    v.canvas.width  = wrap.clientWidth;
    v.canvas.height = wrap.clientHeight;
    renderTree(v, v === TV ? (S.treeDef?.nodes||[]) : (S.treeDef?.prestige_nodes||[]), v === PV);
  }

  function centerView(v, nodes) {
    if (!nodes.length) return;
    const xs = nodes.map(n=>n.x||0);
    const ys = nodes.map(n=>n.y||0);
    const cx = (Math.min(...xs)+Math.max(...xs))/2;
    const cy = (Math.min(...ys)+Math.max(...ys))/2;
    v.pan.x = (v.canvas.width  || 800)/2 - cx*v.GRID*v.zoom;
    v.pan.y = (v.canvas.height || 600)/2 - cy*v.GRID*v.zoom;
  }

  // ── Tree Rendering ────────────────────────────────────────────────────────
  function renderTree(v, nodes, isPrestige) {
    if (!v.canvas || !v.ctx) return;
    const ctx = v.ctx;
    const W = v.canvas.width, H = v.canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.save();
    ctx.translate(v.pan.x, v.pan.y);
    ctx.scale(v.zoom, v.zoom);

    const nodeMap = Object.fromEntries(nodes.map(n=>[n.id,n]));
    const unlockedSet = isPrestige ? S.prestigeUnlocked : S.unlocked;

    // Draw edges first
    for (const node of nodes) {
      for (const req of (node.requires||[])) {
        const from = nodeMap[req];
        if (!from) continue;
        const x1 = (from.x||0)*v.GRID, y1 = (from.y||0)*v.GRID;
        const x2 = (node.x||0)*v.GRID, y2 = (node.y||0)*v.GRID;
        const unlocked = unlockedSet.has(req) && unlockedSet.has(node.id);
        const available = unlockedSet.has(req);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        // slight bezier curve
        const mx = (x1+x2)/2, my = (y1+y2)/2 - 10;
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.strokeStyle = unlocked ? (isPrestige ? '#c080ff60' : '#6060ff60')
                       : available ? '#3a3a6a'
                                   : '#1e1e2e';
        ctx.lineWidth = unlocked ? 2 : 1;
        ctx.setLineDash(unlocked ? [] : [4,4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw nodes
    for (const node of nodes) {
      drawNode(ctx, v, node, unlockedSet, isPrestige);
    }

    ctx.restore();
  }

  function drawNode(ctx, v, node, unlockedSet, isPrestige) {
    const NR = 32;   // node radius in px at zoom=1
    const nx = (node.x||0)*v.GRID;
    const ny = (node.y||0)*v.GRID;
    const unlocked = unlockedSet.has(node.id);
    const inProg   = !isPrestige && S.inProgress[node.id];
    const canBuy   = canUnlock(node, unlockedSet);
    const affordable = isPrestige
      ? S.prestigePoints >= (node.cost||1)
      : S.resources      >= (node.cost||0);

    // Outer glow for available+affordable nodes
    if (!unlocked && canBuy && affordable) {
      ctx.beginPath();
      ctx.arc(nx, ny, NR + 6, 0, Math.PI*2);
      const grd = ctx.createRadialGradient(nx,ny,NR-2, nx,ny,NR+12);
      grd.addColorStop(0, (node.color||'#6060ff')+'60');
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fill();
    }

    // Progress arc ring
    if (inProg) {
      const pct = 1 - (inProg.endTime - Date.now()) / inProg.duration;
      const clamped = Math.min(1, Math.max(0, pct));
      ctx.beginPath();
      ctx.arc(nx, ny, NR+3, -Math.PI/2, -Math.PI/2 + clamped*Math.PI*2);
      ctx.strokeStyle = node.accent || '#c0c0ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Node circle background
    ctx.beginPath();
    ctx.arc(nx, ny, NR, 0, Math.PI*2);
    const bgGrd = ctx.createRadialGradient(nx-NR*0.3,ny-NR*0.3,2, nx,ny,NR);
    bgGrd.addColorStop(0, unlocked ? (node.accent||'#c0c0ff')+'cc' : '#1e1e30');
    bgGrd.addColorStop(1, unlocked ? (node.color||'#6060ff')+'cc' : '#12121e');
    ctx.fillStyle = bgGrd;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(nx, ny, NR, 0, Math.PI*2);
    ctx.strokeStyle = unlocked  ? (node.color||'#6060ff')
                    : canBuy && affordable ? (node.color||'#6060ff')+'80'
                    : '#2a2a4a';
    ctx.lineWidth = unlocked ? 2 : 1;
    ctx.stroke();

    // Tier indicator dots in top-left
    for (let t=0; t<=Math.min(5, node.tier||0); t++) {
      ctx.beginPath();
      ctx.arc(nx - NR*0.75 + t*6, ny - NR*0.8, 2, 0, Math.PI*2);
      ctx.fillStyle = unlocked ? (node.color||'#6060ff') : '#2a2a4a';
      ctx.fill();
    }

    // Icon / label — name abbreviated
    const label = node.name || node.id;
    const short  = label.length > 8 ? label.slice(0,7)+'…' : label;
    ctx.font = `bold ${Math.max(8, 12 - Math.floor(short.length/4))}px 'Share Tech Mono'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = unlocked ? '#ffffff' : canBuy ? '#8080a0' : '#404060';
    ctx.fillText(short, nx, ny);

    // Cost below
    if (!unlocked && !inProg) {
      const costStr = isPrestige
        ? `✨${fmtNum(node.cost,0)}`
        : `⚡${fmtNum(node.cost,0)}`;
      ctx.font = '9px Share Tech Mono';
      ctx.fillStyle = affordable ? '#f0c040' : '#604020';
      ctx.fillText(costStr, nx, ny+NR+10);
    } else if (unlocked) {
      ctx.font = '9px Share Tech Mono';
      ctx.fillStyle = '#40ff80';
      ctx.fillText('✓', nx, ny+NR+10);
    }
  }

  // ── Canvas Interactions ───────────────────────────────────────────────────
  function setupEvents() {
    setupViewportEvents(TV, false);
    setupViewportEvents(PV, true);
  }

  function setupViewportEvents(v, isPrestige) {
    const wrap = v.canvas.parentElement;

    wrap.addEventListener('mousedown', e => {
      v.drag = { sx: e.clientX, sy: e.clientY, px: v.pan.x, py: v.pan.y };
    });
    wrap.addEventListener('mousemove', e => {
      if (!v.drag) return;
      v.pan.x = v.drag.px + (e.clientX - v.drag.sx);
      v.pan.y = v.drag.py + (e.clientY - v.drag.sy);
      renderTree(v, isPrestige ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]), isPrestige);
    });
    wrap.addEventListener('mouseup', e => {
      const dx = Math.abs(e.clientX - (v.drag?.sx||0));
      const dy = Math.abs(e.clientY - (v.drag?.sy||0));
      v.drag = null;
      if (dx < 5 && dy < 5) handleCanvasClick(v, e, isPrestige);
    });
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect   = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      v.pan.x = mx - (mx - v.pan.x) * factor;
      v.pan.y = my - (my - v.pan.y) * factor;
      v.zoom  = Math.min(3, Math.max(0.2, v.zoom * factor));
      document.getElementById('zoom-label').textContent = Math.round(v.zoom*100)+'%';
      renderTree(v, isPrestige ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]), isPrestige);
    }, {passive:false});

    // Touch support
    let lastTouchDist = null;
    wrap.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        v.drag = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, px: v.pan.x, py: v.pan.y };
      }
    });
    wrap.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
        if (lastTouchDist) {
          const factor = d / lastTouchDist;
          v.zoom = Math.min(3, Math.max(0.2, v.zoom * factor));
          renderTree(v, isPrestige ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]), isPrestige);
        }
        lastTouchDist = d;
      } else if (e.touches.length === 1 && v.drag) {
        v.pan.x = v.drag.px + (e.touches[0].clientX - v.drag.sx);
        v.pan.y = v.drag.py + (e.touches[0].clientY - v.drag.sy);
        renderTree(v, isPrestige ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]), isPrestige);
        lastTouchDist = null;
      }
    }, {passive:false});
    wrap.addEventListener('touchend', e => { v.drag=null; lastTouchDist=null; });
  }

  function handleCanvasClick(v, e, isPrestige) {
    const rect  = v.canvas.getBoundingClientRect();
    const mx    = (e.clientX - rect.left - v.pan.x) / v.zoom;
    const my    = (e.clientY - rect.top  - v.pan.y) / v.zoom;
    const nodes = isPrestige ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]);
    const NR    = 32;
    for (const node of nodes) {
      const nx = (node.x||0)*v.GRID;
      const ny = (node.y||0)*v.GRID;
      const dist = Math.hypot(mx-nx, my-ny);
      if (dist < NR+8) {
        openNodeModal(node, isPrestige);
        return;
      }
    }
  }

  // ── Node Modal ────────────────────────────────────────────────────────────
  async function openNodeModal(node, isPrestige) {
    modalNode = node;
    modalIsPrestige = isPrestige;
    const unlockedSet = isPrestige ? S.prestigeUnlocked : S.unlocked;
    const unlocked = unlockedSet.has(node.id);
    const inProg   = !isPrestige && S.inProgress[node.id];

    // Art
    const artEl = document.getElementById('node-modal-art');
    artEl.innerHTML = '';
    const artUrl = await getArt(node.id);
    if (artUrl && artUrl !== 'svg') {
      const img = document.createElement('img');
      img.src = artUrl;
      artEl.appendChild(img);
    } else {
      artEl.innerHTML = SvgArt.generateLarge(node, unlocked);
    }

    document.getElementById('node-modal-name').textContent  = node.name || node.id;
    document.getElementById('node-modal-tier').textContent  = isPrestige ? 'PRESTIGE UPGRADE' : `TIER ${node.tier ?? '?'}`;
    document.getElementById('node-modal-desc').textContent  = node.description || '';

    const eff = node.effect || {};
    const effText = {
      rate_add:                 v => `+${v} ${S.treeDef?.resource?.name||'Energy'}/sec`,
      rate_mult:                v => `×${v} production multiplier`,
      prestige_mult_per_prestige: v => `+${v*100}% per prestige level`,
      start_bonus:              v => `Start with ${v} ${S.treeDef?.resource?.name||'Energy'}`,
      auto_unlock_tier:         v => `Auto-unlock tier ${v} at run start`,
      offline_mult:             v => `×${v} offline production`,
      global_mult:              v => `×${v} GLOBAL multiplier`,
    }[eff.type]?.(eff.value) || `${eff.type}: ${eff.value}`;
    document.getElementById('node-modal-effect').textContent = '⚡ ' + effText;

    const costRes = isPrestige ? (S.treeDef?.prestige_resource?.icon||'✨') : (S.treeDef?.resource?.icon||'⚡');
    document.getElementById('node-modal-cost').textContent = unlocked ? '✓ Unlocked'
      : inProg ? `⏳ Unlocking…`
      : `${costRes} ${fmtNum(node.cost, 2)} ${isPrestige ? (S.treeDef?.prestige_resource?.name||'Essence') : (S.treeDef?.resource?.name||'Energy')}`;

    const reqs = (node.requires||[]).map(r => getNode(r, isPrestige)?.name || r);
    document.getElementById('node-modal-requires').textContent = reqs.length
      ? 'Requires: ' + reqs.join(', ') : '';

    const btn = document.getElementById('node-modal-btn');
    if (unlocked) {
      btn.textContent = '✓ Already Unlocked';
      btn.disabled = true;
    } else if (inProg) {
      btn.textContent = '⏳ Unlocking…';
      btn.disabled = true;
    } else {
      const canBuy = canUnlock(node, unlockedSet);
      const affordable = isPrestige ? S.prestigePoints >= node.cost : S.resources >= node.cost;
      btn.disabled = !canBuy || !affordable;
      btn.textContent = !canBuy ? '🔒 Requires Prerequisites'
                     : !affordable ? '⚡ Not Enough Resources'
                     : `▶ Purchase (${costRes}${fmtNum(node.cost,0)})`;
    }

    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('node-modal').classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('node-modal').classList.add('hidden');
    modalNode = null;
  }

  function purchaseFromModal() {
    if (!modalNode) return;
    purchaseNode(modalNode, modalIsPrestige);
    closeModal();
  }

  // ── Purchasing ────────────────────────────────────────────────────────────
  function purchaseNode(node, isPrestige) {
    const unlockedSet = isPrestige ? S.prestigeUnlocked : S.unlocked;
    if (unlockedSet.has(node.id)) return;
    if (!canUnlock(node, unlockedSet)) return;

    if (isPrestige) {
      if (S.prestigePoints < node.cost) { toast('Not enough Essence!'); return; }
      S.prestigePoints -= node.cost;
      S.prestigeUnlocked.add(node.id);
      recomputeRate();
      renderTree(PV, S.treeDef.prestige_nodes||[], true);
      toast(`✨ ${node.name} unlocked!`);
      saveGame();
      return;
    }

    // Regular upgrade: costs resources, takes time (tier × 3 seconds)
    if (S.resources < node.cost) { toast('Not enough resources!'); return; }
    S.resources -= node.cost;

    const tierDur = ((node.tier||0) * 3 + 1) * 1000;  // ms
    S.inProgress[node.id] = { endTime: Date.now() + tierDur, duration: tierDur };
    toast(`⏳ ${node.name} unlocking in ${((node.tier||0)*3+1)}s…`);
    renderTree(TV, S.treeDef.nodes, false);
    saveGame();
  }

  function canUnlock(node, unlockedSet) {
    return (node.requires||[]).every(r => unlockedSet.has(r));
  }

  function getNode(id, isPrestige=false) {
    const nodes = isPrestige ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]);
    return nodes.find(n=>n.id===id);
  }

  // ── Prestige ──────────────────────────────────────────────────────────────
  function showPrestigeModal() {
    const pts = prestigePointsEarned();
    document.getElementById('prestige-modal-desc').textContent =
      `Resetting your run will wipe all current upgrades and resources, but you'll carry forward a permanent multiplier and earn Essence to spend on the Prestige tree.`;
    document.getElementById('prestige-modal-earnings').innerHTML =
      `You will earn: <strong>✨ ${pts} Essence</strong><br>
       Total after reset: <strong>✨ ${S.prestigePoints + pts} Essence</strong><br>
       Prestige count: <strong>×${S.prestigeCount + 1}</strong>`;
    document.getElementById('prestige-modal').classList.remove('hidden');
  }

  function closePrestigeModal() {
    document.getElementById('prestige-modal').classList.add('hidden');
  }

  async function confirmPrestige() {
    closePrestigeModal();
    const pts = prestigePointsEarned();
    try {
      await fetch('/api/prestige', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          session_id:      S.sessionId,
          total_earned:    S.totalEarned,
          prestige_count:  S.prestigeCount,
          prestige_points: S.prestigePoints,
          prestige_upgrades: [...S.prestigeUnlocked],
          tree_id:         S.treeId,
        })
      });
    } catch(e) {}

    // Apply prestige locally
    S.prestigeCount++;
    S.prestigePoints += pts;
    S.resources      = 0;
    S.totalEarned    = 0;
    S.unlocked       = new Set();
    S.inProgress     = {};
    S.runStart       = Date.now();

    // Auto-unlock tier 1 if p_recall is owned
    if (S.prestigeUnlocked.has('p_recall')) {
      for (const n of (S.treeDef?.nodes||[])) {
        if ((n.tier||0) <= 1) S.unlocked.add(n.id);
      }
    }
    // Start bonus
    for (const pid of S.prestigeUnlocked) {
      const pn = (S.treeDef?.prestige_nodes||[]).find(n=>n.id===pid);
      if (pn?.effect?.type === 'start_bonus') S.resources += pn.effect.value;
    }

    recomputeRate();
    renderTree(TV, S.treeDef.nodes||[], false);
    renderTree(PV, S.treeDef.prestige_nodes||[], true);
    saveGame();
    toast(`⟳ Prestige! +✨${pts} Essence earned.`);
  }

  function prestigePointsEarned() {
    return Math.max(1, Math.floor(Math.sqrt(S.totalEarned / 1000)));
  }

  // ── Tab Switching ─────────────────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    ['tree','prestige','settings'].forEach(t => {
      document.getElementById(`panel-${t}`).classList.toggle('active', t===tab);
      document.getElementById(`panel-${t}`).classList.toggle('hidden', t!==tab);
      document.getElementById(`tab-${t}`)?.classList.toggle('active', t===tab);
    });
    if (tab==='tree')     renderTree(TV, S.treeDef?.nodes||[], false);
    if (tab==='prestige') renderTree(PV, S.treeDef?.prestige_nodes||[], true);
  }

  // ── Zoom Controls ─────────────────────────────────────────────────────────
  function treeZoom(factor) {
    const v = activeTab==='prestige' ? PV : TV;
    const isP = activeTab==='prestige';
    const cx = v.canvas.width/2, cy = v.canvas.height/2;
    v.pan.x = cx - (cx - v.pan.x) * factor;
    v.pan.y = cy - (cy - v.pan.y) * factor;
    v.zoom  = Math.min(3, Math.max(0.2, v.zoom * factor));
    document.getElementById('zoom-label').textContent = Math.round(v.zoom*100)+'%';
    renderTree(v, isP ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]), isP);
  }

  function treeReset() {
    const v = activeTab==='prestige' ? PV : TV;
    const isP = activeTab==='prestige';
    v.zoom = 1;
    centerView(v, isP ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]));
    document.getElementById('zoom-label').textContent = '100%';
    renderTree(v, isP ? (S.treeDef?.prestige_nodes||[]) : (S.treeDef?.nodes||[]), isP);
  }

  // ── Art Loading ───────────────────────────────────────────────────────────
  async function getArt(nodeId) {
    if (artCache[nodeId]) return artCache[nodeId];
    try {
      const res  = await fetch(`/api/art/check/${nodeId}`);
      const data = await res.json();
      if (data.ok) { artCache[nodeId] = data.url; return data.url; }
    } catch(e) {}
    artCache[nodeId] = 'svg';
    return 'svg';
  }

  // ── Tree Import / Export ──────────────────────────────────────────────────
  function exportTree() {
    if (!S.treeDef) return;
    const blob = new Blob([JSON.stringify(S.treeDef, null, 2)], {type:'application/json'});
    downloadBlob(blob, `${S.treeId}.json`);
    toast('Tree exported!');
  }

  function importTree() {
    document.getElementById('import-tree-input').click();
  }

  async function handleImportTree(e) {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    let tree;
    try { tree = JSON.parse(text); } catch { toast('Invalid JSON!'); return; }
    if (!tree.nodes) { toast('Not a valid tree file!'); return; }
    const res  = await fetch('/api/tree/import', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: text
    });
    const data = await res.json();
    if (!data.ok) { toast('Import failed: '+data.error); return; }
    await loadTree(data.tree_id);
    // Reset run for new tree
    S.unlocked   = new Set();
    S.inProgress = {};
    S.resources  = 0;
    S.totalEarned = 0;
    recomputeRate();
    centerView(TV, S.treeDef.nodes||[]);
    centerView(PV, S.treeDef.prestige_nodes||[]);
    renderTree(TV, S.treeDef.nodes||[], false);
    renderTree(PV, S.treeDef.prestige_nodes||[], true);
    updateResourceUI();
    saveGame();
    toast(`Tree "${tree.name}" loaded!`);
    e.target.value = '';
  }

  // ── Save Import / Export ──────────────────────────────────────────────────
  function exportSave() {
    const save = {
      session_id:        S.sessionId,
      tree_id:           S.treeId,
      resources:         { main: S.resources },
      unlocked:          [...S.unlocked],
      in_progress:       S.inProgress,
      prestige_count:    S.prestigeCount,
      prestige_points:   S.prestigePoints,
      prestige_upgrades: [...S.prestigeUnlocked],
      total_earned:      S.totalEarned,
      run_start:         S.runStart,
      exported_at:       Date.now(),
    };
    downloadBlob(new Blob([JSON.stringify(save,null,2)],{type:'application/json'}), 'ascension_save.json');
    toast('Save exported!');
  }

  function importSave() {
    document.getElementById('import-save-input').click();
  }

  async function handleImportSave(e) {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    let save;
    try { save = JSON.parse(text); } catch { toast('Invalid save file!'); return; }
    applySave(save);
    if (save.tree_id && save.tree_id !== S.treeId) await loadTree(save.tree_id);
    recomputeRate();
    renderTree(TV, S.treeDef?.nodes||[], false);
    renderTree(PV, S.treeDef?.prestige_nodes||[], true);
    await saveGame();
    toast('Save restored!');
    e.target.value = '';
  }

  function hardReset() {
    if (!confirm('DELETE ALL DATA? This cannot be undone.')) return;
    localStorage.removeItem('ascension_save');
    S.resources=0; S.totalEarned=0; S.unlocked=new Set();
    S.inProgress={}; S.prestigeCount=0; S.prestigePoints=0;
    S.prestigeUnlocked=new Set(); S.runStart=Date.now();
    recomputeRate();
    renderTree(TV, S.treeDef?.nodes||[], false);
    saveGame();
    toast('Save deleted. Starting fresh.');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmtNum(n, decimals=0) {
    if (n === undefined || isNaN(n)) return '0';
    const abs = Math.abs(n);
    if (abs >= 1e15) return (n/1e15).toFixed(2)+'Q';
    if (abs >= 1e12) return (n/1e12).toFixed(2)+'T';
    if (abs >= 1e9)  return (n/1e9 ).toFixed(2)+'B';
    if (abs >= 1e6)  return (n/1e6 ).toFixed(2)+'M';
    if (abs >= 1e3)  return (n/1e3 ).toFixed(1)+'K';
    return n.toFixed(decimals);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    init, switchTab,
    treeZoom, treeReset,
    openNodeModal, closeModal, purchaseFromModal,
    showPrestigeModal, closePrestigeModal, confirmPrestige,
    exportTree, importTree, handleImportTree,
    exportSave, importSave, handleImportSave,
    hardReset,
  };
})();

window.addEventListener('DOMContentLoaded', () => Game.init());
window.addEventListener('beforeunload', () => {
  // Sync save on unload
  const save = {
    session_id: localStorage.getItem('ascension_session'),
  };
  // localStorage save already kept live; just ensure it's written
});
