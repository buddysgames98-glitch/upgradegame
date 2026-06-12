// ── Upgrade Tree Maker ────────────────────────────────────────────────────────

// ── Shared canvas renderer (used by game, builder preview, generator preview) ─
const TreeRenderer = (() => {
  const GRID = 120;
  const NR   = 32;

  function render(canvas, nodes, unlockedSet, inProgress = {}, pan, zoom) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    for (const node of nodes) {
      for (const req of (node.requires || [])) {
        const from = nodeMap[req];
        if (!from) continue;
        const x1 = (from.x || 0) * GRID, y1 = (from.y || 0) * GRID;
        const x2 = (node.x  || 0) * GRID, y2 = (node.y  || 0) * GRID;
        const unlocked = unlockedSet.has(req) && unlockedSet.has(node.id);
        const available = unlockedSet.has(req);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 10;
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.strokeStyle = unlocked ? '#6060ff60' : available ? '#3a3a6a' : '#1e1e2e';
        ctx.lineWidth   = unlocked ? 2 : 1;
        ctx.setLineDash(unlocked ? [] : [4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const node of nodes) {
      drawNode(ctx, node, unlockedSet, inProgress);
    }

    ctx.restore();
  }

  function drawNode(ctx, node, unlockedSet, inProgress) {
    const nx = (node.x || 0) * GRID;
    const ny = (node.y || 0) * GRID;
    const unlocked  = unlockedSet.has(node.id);
    const inProg    = inProgress[node.id];
    const canBuy    = (node.requires || []).every(r => unlockedSet.has(r));

    if (!unlocked && canBuy) {
      ctx.beginPath();
      ctx.arc(nx, ny, NR + 6, 0, Math.PI * 2);
      const grd = ctx.createRadialGradient(nx, ny, NR - 2, nx, ny, NR + 12);
      grd.addColorStop(0, (node.color || '#6060ff') + '50');
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fill();
    }

    if (inProg) {
      const pct = Math.min(1, Math.max(0, 1 - (inProg.endTime - Date.now()) / inProg.duration));
      ctx.beginPath();
      ctx.arc(nx, ny, NR + 3, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
      ctx.strokeStyle = node.accent || '#c0c0ff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(nx, ny, NR, 0, Math.PI * 2);
    const bgGrd = ctx.createRadialGradient(nx - NR * 0.3, ny - NR * 0.3, 2, nx, ny, NR);
    bgGrd.addColorStop(0, unlocked ? (node.accent || '#c0c0ff') + 'cc' : '#1e1e30');
    bgGrd.addColorStop(1, unlocked ? (node.color  || '#6060ff') + 'cc' : '#12121e');
    ctx.fillStyle = bgGrd;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(nx, ny, NR, 0, Math.PI * 2);
    ctx.strokeStyle = unlocked  ? (node.color || '#6060ff')
                    : canBuy    ? (node.color || '#6060ff') + '80'
                    :             '#2a2a4a';
    ctx.lineWidth = unlocked ? 2 : 1;
    ctx.stroke();

    const label = node.name || node.id;
    const short = label.length > 8 ? label.slice(0, 7) + '…' : label;
    ctx.font = `bold ${Math.max(8, 12 - Math.floor(short.length / 4))}px 'Share Tech Mono'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = unlocked ? '#ffffff' : canBuy ? '#8080a0' : '#404060';
    ctx.fillText(short, nx, ny);

    if (!unlocked && !inProg) {
      ctx.font = '9px Share Tech Mono';
      ctx.fillStyle = '#f0c040';
      ctx.fillText('⚡' + fmtNum(node.cost, 0), nx, ny + NR + 10);
    } else if (unlocked) {
      ctx.font = '9px Share Tech Mono';
      ctx.fillStyle = '#40ff80';
      ctx.fillText('✓', nx, ny + NR + 10);
    }
  }

  function centerPan(canvas, nodes) {
    if (!nodes.length) return { x: (canvas.width || 600) / 2, y: (canvas.height || 400) / 2 };
    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return {
      x: (canvas.width  || 600) / 2 - cx * GRID,
      y: (canvas.height || 400) / 2 - cy * GRID,
    };
  }

  return { render, centerPan, GRID, NR };
})();

function fmtNum(n, decimals = 0) {
  if (n === undefined || isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15) return (n / 1e15).toFixed(2) + 'Q';
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (abs >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (abs >= 1e3)  return (n / 1e3).toFixed(1)  + 'K';
  return n.toFixed(decimals);
}

let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Tree Generator ────────────────────────────────────────────────────────────
const TreeGenerator = (() => {
  const THEMES = {
    fantasy: {
      name: 'Fantasy',
      resource: { name: 'Mana', icon: '🔮', color: '#9060ff' },
      prestige_resource: { name: 'Arcana', icon: '⭐', color: '#ffdd40' },
      words: ['Ember','Wisp','Sigil','Rune','Aether','Glyph','Veil','Shard','Hex','Rite',
              'Charm','Flux','Tome','Boon','Fade','Bolt','Rift','Ward','Sage','Crest'],
    },
    scifi: {
      name: 'Sci-Fi',
      resource: { name: 'Power', icon: '⚡', color: '#40ddff' },
      prestige_resource: { name: 'Quanta', icon: '◈', color: '#c080ff' },
      words: ['Core','Node','Grid','Flux','Pulse','Drive','Array','Cell','Link','Gate',
              'Sync','Loop','Wave','Port','Nano','Beam','Chip','Coil','Data','Warp'],
    },
    nature: {
      name: 'Nature',
      resource: { name: 'Essence', icon: '🌿', color: '#40c060' },
      prestige_resource: { name: 'Spirit', icon: '✨', color: '#c0ff80' },
      words: ['Root','Seed','Leaf','Bloom','Grove','Spore','Vine','Bark','Moss','Dew',
              'Fern','Soil','Rain','Thorn','Gust','Tide','Ash','Reed','Dawn','Glow'],
    },
    tech: {
      name: 'Tech',
      resource: { name: 'Credits', icon: '💎', color: '#40e0b0' },
      prestige_resource: { name: 'Tokens', icon: '🔑', color: '#f0c040' },
      words: ['Hub','Bus','Cache','Stack','Heap','Queue','Fork','Pipe','Flag','Hook',
              'Task','Proc','Byte','Bit','Hash','Spawn','Bind','Poll','Emit','Chunk'],
    },
    cosmic: {
      name: 'Cosmic',
      resource: { name: 'Stars', icon: '⭐', color: '#f0d060' },
      prestige_resource: { name: 'Voids', icon: '🌌', color: '#6040ff' },
      words: ['Nova','Pulsar','Quasar','Nebula','Warp','Orbit','Zenith','Flux','Apex','Rift',
              'Void','Surge','Crest','Beacon','Bloom','Prism','Core','Halo','Drift','Echo'],
    },
  };

  const COLORS = ['#f0c040','#e07830','#3090e0','#c04020','#20a0c0','#8030d0',
                  '#901010','#10a060','#6020b0','#b08000','#c00040','#0060c0','#8000ff'];

  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function generate(themeKey, size) {
    const theme  = THEMES[themeKey] || THEMES.scifi;
    const counts = { small: [1,2,2,2], medium: [1,3,3,4,3,1], large: [1,3,4,5,5,4,2] };
    const tiers  = counts[size] || counts.medium;
    const usedWords = new Set();

    function pickWord() {
      let w;
      let tries = 0;
      do { w = rand(theme.words); tries++; } while (usedWords.has(w) && tries < 30);
      usedWords.add(w);
      return w;
    }

    const nodes = [];
    const byTier = [];

    for (let t = 0; t < tiers.length; t++) {
      const count = tiers[t];
      byTier[t] = [];
      const spread = count - 1;

      for (let i = 0; i < count; i++) {
        const x = spread === 0 ? 0 : (i - spread / 2) * (4 / Math.max(1, count - 1)) * 2;
        const y = t * 1.8;
        const color = rand(COLORS);
        const isRoot = t === 0;

        // Requires: pick 1-2 from previous tier
        let requires = [];
        if (t > 0) {
          const prev = byTier[t - 1];
          const maxReqs = Math.min(2, prev.length);
          const numReqs = randInt(1, maxReqs);
          const shuffled = [...prev].sort(() => Math.random() - 0.5);
          requires = shuffled.slice(0, numReqs).map(n => n.id);
        }

        const isHighTier = t >= tiers.length / 2;
        const effectType  = isHighTier ? (Math.random() < 0.6 ? 'rate_mult' : 'rate_add')
                                       : (Math.random() < 0.7 ? 'rate_add'  : 'rate_mult');
        const baseCost    = Math.pow(5, t + 1) * randInt(1, 4);
        const effectValue = effectType === 'rate_mult'
          ? Math.round((1.3 + t * 0.4 + Math.random() * 0.5) * 10) / 10
          : Math.round((1 + t * 3 + Math.random() * t * 2) * 10) / 10;

        const word = pickWord();
        const id   = word.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + t + '_' + i;
        const descriptions = [
          `Unlock the power of ${word.toLowerCase()}.`,
          `Channel the ${word.toLowerCase()} within.`,
          `${word} surges through the system.`,
          `A new path opens through ${word.toLowerCase()}.`,
        ];

        const node = {
          id, name: word,
          tier: t,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          description: rand(descriptions),
          cost: Math.max(1, Math.round(baseCost)),
          effect: { type: effectType, value: effectValue },
          requires,
          color,
          accent: color + 'aa',
          shape: 'circle',
        };

        nodes.push(node);
        byTier[t].push(node);
      }
    }

    return {
      name: `${theme.name} Tree`,
      description: `A generated ${theme.name.toLowerCase()} upgrade tree.`,
      version: '1.0',
      resource: theme.resource,
      base_rate: 0.5,
      prestige_resource: theme.prestige_resource,
      nodes,
      prestige_nodes: defaultPrestigeNodes(),
    };
  }

  function defaultPrestigeNodes() {
    return [
      { id:'p_momentum', name:'Momentum', description:'Each prestige +10% global multiplier.',
        cost:1, effect:{type:'prestige_mult_per_prestige',value:0.1}, requires:[],
        shape:'circle', color:'#c080ff', accent:'#ffffff' },
      { id:'p_headstart', name:'Head Start', description:'Begin each run with 100 free resources.',
        cost:2, effect:{type:'start_bonus',value:100}, requires:['p_momentum'],
        shape:'diamond', color:'#ff80c0', accent:'#ffffff' },
      { id:'p_echo', name:'Echo', description:'2× offline production.',
        cost:5, effect:{type:'offline_mult',value:2.0}, requires:['p_headstart'],
        shape:'square', color:'#c0ff80', accent:'#ffffff' },
    ];
  }

  return { generate, THEMES };
})();

// ── Menu ──────────────────────────────────────────────────────────────────────
const Menu = (() => {
  let _generatedTree = null;

  function showScreen(id) {
    ['main-menu','newgame-menu','generator-screen','builder-screen'].forEach(s => {
      document.getElementById(s).classList.add('hidden');
    });
    document.getElementById('app').classList.add('hidden');
    if (id) document.getElementById(id).classList.remove('hidden');
  }

  function showMain() {
    // Auto-save if game is running
    if (!document.getElementById('app').classList.contains('hidden')) {
      Game.saveGame();
    }
    showScreen('main-menu');
    const hasSave = !!localStorage.getItem('utm_save');
    const btn = document.getElementById('btn-continue');
    btn.classList.toggle('hidden', !hasSave);
    if (hasSave) {
      try {
        const save = JSON.parse(localStorage.getItem('utm_save'));
        const treeName = save.tree_name || 'your tree';
        document.getElementById('continue-sub').textContent = `Resume playing ${treeName}`;
      } catch(e) {}
    }
  }

  function showNewGame() { showScreen('newgame-menu'); }

  function continueGame() {
    const raw = localStorage.getItem('utm_save');
    if (!raw) { showMain(); return; }
    try {
      const save = JSON.parse(raw);
      Game.startFromSave(save);
    } catch(e) {
      showMain();
    }
  }

  function loadSave() {
    document.getElementById('import-save-input').click();
  }

  async function handleLoadSave(e) {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    let save;
    try { save = JSON.parse(text); } catch { showToast('Invalid save file!'); return; }
    Game.startFromSave(save);
    e.target.value = '';
  }

  // ── Generator ───────────────────────────────────────────────────
  function showGenerator() {
    showScreen('generator-screen');
    document.getElementById('btn-play-generated').classList.add('hidden');
    _generatedTree = null;
    const canvas = document.getElementById('gen-canvas');
    sizeCanvas(canvas);
  }

  function generatePreview() {
    const theme = document.getElementById('gen-theme').value;
    const size  = document.querySelector('input[name="gen-size"]:checked').value;
    _generatedTree = TreeGenerator.generate(theme, size);

    const withPrestige = document.querySelector('input[name="gen-prestige"]:checked').value === 'yes';
    if (!withPrestige) _generatedTree.prestige_nodes = [];

    const canvas = document.getElementById('gen-canvas');
    sizeCanvas(canvas);
    const pan = TreeRenderer.centerPan(canvas, _generatedTree.nodes);
    TreeRenderer.render(canvas, _generatedTree.nodes, new Set(), {}, pan, 0.8);

    document.getElementById('btn-play-generated').classList.remove('hidden');
    showToast(`Generated "${_generatedTree.name}" — ${_generatedTree.nodes.length} nodes`);
  }

  function playGenerated() {
    if (!_generatedTree) return;
    Game.startNewGame(_generatedTree);
  }

  // ── Builder ─────────────────────────────────────────────────────
  function showBuilder() {
    showScreen('builder-screen');
    Builder.init();
  }

  function sizeCanvas(canvas) {
    const wrap = canvas.parentElement;
    canvas.width  = wrap.clientWidth  || 600;
    canvas.height = wrap.clientHeight || 400;
  }

  return { showMain, showNewGame, continueGame, loadSave, handleLoadSave,
           showGenerator, generatePreview, playGenerated, showBuilder };
})();

// ── Tree Builder ──────────────────────────────────────────────────────────────
const Builder = (() => {
  let nodes = [];
  let nextId = 0;

  const SHAPE_COLORS = ['#f0c040','#e07830','#3090e0','#c04020','#20a0c0',
                        '#8030d0','#10a060','#b08000','#c00040','#8000ff'];

  function init() {
    nodes = [];
    nextId = 0;
    renderNodeList();
    renderRequiresList();
    updatePreview();
    updatePlayBtn();
  }

  function onEffectTypeChange() {
    const type = document.getElementById('node-effect-type').value;
    const valInput = document.getElementById('node-effect-value');
    if (type === 'rate_mult') {
      valInput.value = 1.5;
      valInput.step  = 0.1;
    } else {
      valInput.value = 1;
      valInput.step  = 1;
    }
  }

  function addNode() {
    const name = document.getElementById('node-name').value.trim();
    if (!name) { showToast('Node needs a name!'); return; }

    const tier   = parseInt(document.getElementById('node-tier').value) || 0;
    const cost   = parseFloat(document.getElementById('node-cost').value) || 1;
    const eType  = document.getElementById('node-effect-type').value;
    const eVal   = parseFloat(document.getElementById('node-effect-value').value) || 1;
    const desc   = document.getElementById('node-desc').value.trim();

    const requires = [...document.querySelectorAll('#node-requires-list input:checked')]
      .map(cb => cb.value);

    // Auto-layout: place by tier
    const sameX = nodes.filter(n => n.tier === tier);
    const x = sameX.length - (sameX.length > 0 ? Math.floor(sameX.length / 2) : 0);
    const y = tier * 1.8;

    const color = SHAPE_COLORS[nextId % SHAPE_COLORS.length];
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + nextId;

    nodes.push({ id, name, description: desc, tier, cost,
                 effect: { type: eType, value: eVal },
                 requires, color, accent: color + 'aa',
                 x: recalcX(tier, nodes.length), y });
    recalcLayout();
    nextId++;

    // Reset form fields
    document.getElementById('node-name').value    = '';
    document.getElementById('node-desc').value    = '';
    document.getElementById('node-cost').value    = '10';
    document.getElementById('node-tier').value    = String(tier + 1);
    document.getElementById('node-effect-value').value = '1';

    renderNodeList();
    renderRequiresList();
    updatePreview();
    updatePlayBtn();
    showToast(`+ ${name} added`);
  }

  function recalcX(tier, _total) {
    const inTier = nodes.filter(n => n.tier === tier);
    return inTier.length;
  }

  function recalcLayout() {
    const byTier = {};
    for (const n of nodes) {
      byTier[n.tier] = byTier[n.tier] || [];
      byTier[n.tier].push(n);
    }
    for (const [tier, group] of Object.entries(byTier)) {
      const count = group.length;
      group.forEach((n, i) => {
        n.x = count === 1 ? 0 : (i - (count - 1) / 2) * 2;
        n.y = parseInt(tier) * 1.8;
      });
    }
  }

  function deleteNode(id) {
    nodes = nodes.filter(n => n.id !== id);
    // Remove from requires of other nodes
    for (const n of nodes) n.requires = n.requires.filter(r => r !== id);
    recalcLayout();
    renderNodeList();
    renderRequiresList();
    updatePreview();
    updatePlayBtn();
  }

  function renderNodeList() {
    const list = document.getElementById('builder-node-list');
    document.getElementById('node-count-label').textContent = `(${nodes.length})`;
    if (!nodes.length) {
      list.innerHTML = '<span style="font-size:10px;color:var(--text-dim)">No nodes yet.</span>';
      return;
    }
    list.innerHTML = nodes.map(n => `
      <div class="builder-node-item">
        <div>
          <div class="builder-node-item-name">${n.name}</div>
          <div class="builder-node-item-info">Tier ${n.tier} · ⚡${fmtNum(n.cost)} · ${n.effect.type === 'rate_mult' ? '×' : '+'}${n.effect.value}</div>
        </div>
        <button class="node-delete-btn" onclick="Builder.deleteNode('${n.id}')">✕</button>
      </div>
    `).join('');
  }

  function renderRequiresList() {
    const container = document.getElementById('node-requires-list');
    if (!nodes.length) {
      container.innerHTML = '<span class="requires-empty">No nodes yet</span>';
      return;
    }
    container.innerHTML = nodes.map(n => `
      <label class="requires-check">
        <input type="checkbox" value="${n.id}">
        ${n.name} <span style="color:var(--text-dim);font-size:9px">(T${n.tier})</span>
      </label>
    `).join('');
  }

  function updatePreview() {
    const canvas = document.getElementById('builder-canvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    canvas.width  = wrap.clientWidth  || 600;
    canvas.height = wrap.clientHeight || 400;
    if (!nodes.length) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#6070a040';
      ctx.font = '12px Share Tech Mono';
      ctx.textAlign = 'center';
      ctx.fillText('Add nodes to see a preview', canvas.width / 2, canvas.height / 2);
      return;
    }
    const pan = TreeRenderer.centerPan(canvas, nodes);
    TreeRenderer.render(canvas, nodes, new Set(), {}, pan, 0.9);
  }

  function updatePlayBtn() {
    const btn = document.getElementById('btn-play-built');
    btn.disabled = nodes.length === 0;
  }

  function playTree() {
    if (!nodes.length) return;
    const treeName    = document.getElementById('tree-name').value.trim()          || 'My Tree';
    const resName     = document.getElementById('tree-resource-name').value.trim() || 'Energy';
    const resIcon     = document.getElementById('tree-resource-icon').value.trim() || '⚡';
    const baseRate    = parseFloat(document.getElementById('tree-base-rate').value) || 0.5;

    const tree = {
      name: treeName,
      description: 'A custom-built upgrade tree.',
      version: '1.0',
      resource: { name: resName, icon: resIcon, color: '#f0c040' },
      base_rate: baseRate,
      prestige_resource: { name: 'Essence', icon: '✨', color: '#c080ff' },
      nodes,
      prestige_nodes: [],
    };

    Game.startNewGame(tree);
  }

  return { init, addNode, deleteNode, onEffectTypeChange, playTree, updatePreview };
})();

// ── Game ──────────────────────────────────────────────────────────────────────
const Game = (() => {
  let S = {
    sessionId:        null,
    treeId:           'custom',
    treeDef:          null,
    resources:        0,
    totalEarned:      0,
    rate:             0,
    unlocked:         new Set(),
    inProgress:       {},
    prestigeCount:    0,
    prestigePoints:   0,
    prestigeUnlocked: new Set(),
    runStart:         Date.now(),
  };

  const TV = { canvas: null, ctx: null, pan: { x: 0, y: 0 }, zoom: 1, drag: null };
  const PV = { canvas: null, ctx: null, pan: { x: 0, y: 0 }, zoom: 1, drag: null };

  let activeTab    = 'tree';
  let modalNode    = null;
  let modalIsPrestige = false;
  let artCache     = {};
  let saveTimer    = 0;
  let loopRunning  = false;

  // ── Boot ────────────────────────────────────────────────────────
  async function boot() {
    setLoadMsg('Initializing…', 20);
    S.sessionId = getOrCreateSession();

    setLoadMsg('Ready!', 100);
    await sleep(300);
    document.getElementById('loading-screen').classList.add('hidden');

    Menu.showMain();
  }

  function setLoadMsg(msg, pct) {
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading-bar').style.width = pct + '%';
  }

  function getOrCreateSession() {
    let sid = localStorage.getItem('utm_session');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('utm_session', sid);
    }
    return sid;
  }

  // ── Start game from a tree definition ───────────────────────────
  async function startNewGame(treeDef) {
    S.treeDef          = JSON.parse(JSON.stringify(treeDef)); // deep copy — sever any shared references
    S.treeId           = 'custom';
    S.resources        = 0;
    S.totalEarned      = 0;
    S.unlocked         = new Set();
    S.inProgress       = {};
    S.prestigeCount    = 0;
    S.prestigePoints   = 0;
    S.prestigeUnlocked = new Set();
    S.runStart         = Date.now();

    // Upload tree to server (best effort)
    try {
      const res = await fetch('/api/tree/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(treeDef),
      });
      const data = await res.json();
      if (data.ok) S.treeId = data.tree_id;
    } catch(e) {}

    recomputeRate();
    enterGame();
    saveGame();
  }

  async function startFromSave(save) {
    // Load tree def
    let treeDef = null;
    if (save.tree_def) {
      treeDef = save.tree_def;
    } else if (save.tree_id && save.tree_id !== 'custom') {
      try {
        const res  = await fetch(`/api/tree/${save.tree_id}`);
        const data = await res.json();
        if (data.ok) treeDef = data.tree;
      } catch(e) {}
    }

    if (!treeDef) {
      showToast('Could not load tree — starting fresh.');
      Menu.showMain();
      return;
    }

    S.treeDef          = treeDef;
    S.treeId           = save.tree_id || 'custom';
    S.resources        = save.resources?.main || 0;
    S.totalEarned      = save.total_earned     || 0;
    S.unlocked         = new Set(save.unlocked || []);
    S.inProgress       = save.in_progress       || {};
    S.prestigeCount    = save.prestige_count    || 0;
    S.prestigePoints   = save.prestige_points   || 0;
    S.prestigeUnlocked = new Set(save.prestige_upgrades || []);
    S.runStart         = save.run_start         || Date.now();

    recomputeRate();
    enterGame();
  }

  function enterGame() {
    ['main-menu','newgame-menu','generator-screen','builder-screen'].forEach(id => {
      document.getElementById(id).classList.add('hidden');
    });

    document.getElementById('app').classList.remove('hidden');
    document.getElementById('session-id-display').textContent = S.sessionId;

    updateResourceUI();
    activeTab = 'tree';
    switchTab('tree');

    if (!loopRunning) {
      loopRunning = true;
      initCanvases();
      setupEvents();
      startLoop();
    } else {
      // Re-init canvases for new tree
      TV.zoom = 1;
      PV.zoom = 1;
      const nodes = S.treeDef?.nodes || [];
      const pnodes = S.treeDef?.prestige_nodes || [];
      TV.pan = TreeRenderer.centerPan(TV.canvas, nodes);
      PV.pan = TreeRenderer.centerPan(PV.canvas, pnodes);
      renderTree(TV, nodes, false);
      renderTree(PV, pnodes, true);
    }
  }

  // ── Rate ────────────────────────────────────────────────────────
  function recomputeRate() {
    if (!S.treeDef) return;
    const nodeMap = Object.fromEntries(S.treeDef.nodes.map(n => [n.id, n]));
    let add  = S.treeDef.base_rate || 0.5;
    let mult = 1.0;

    for (const nid of S.unlocked) {
      const n = nodeMap[nid]; if (!n) continue;
      const eff = n.effect || {};
      if (eff.type === 'rate_add')  add  += eff.value;
      if (eff.type === 'rate_mult') mult *= eff.value;
    }

    const pMap = Object.fromEntries((S.treeDef.prestige_nodes || []).map(n => [n.id, n]));
    let globalMult  = 1.0;
    let perPrestige = 0;
    for (const pid of S.prestigeUnlocked) {
      const pn = pMap[pid]; if (!pn) continue;
      const eff = pn.effect || {};
      if (eff.type === 'prestige_mult_per_prestige') perPrestige += eff.value;
      if (eff.type === 'global_mult')                globalMult  *= eff.value;
    }

    S.rate = add * mult * (1 + perPrestige * S.prestigeCount) * globalMult;
  }

  // ── Game Loop ───────────────────────────────────────────────────
  function startLoop() {
    let lastFrame = performance.now();
    function frame(now) {
      const dt = Math.min((now - lastFrame) / 1000, 5);
      lastFrame = now;

      if (!document.getElementById('app').classList.contains('hidden')) {
        S.resources   += S.rate * dt;
        S.totalEarned += S.rate * dt;
        tickInProgress();
        updateHUD();
        // always re-render tree so progress arcs animate and canvas stays valid
        if (S.treeDef) {
          renderTree(TV, S.treeDef.nodes || [], false);
          if (activeTab === 'prestige') renderTree(PV, S.treeDef.prestige_nodes || [], true);
        }
        saveTimer += dt;
        if (saveTimer > 15) { saveTimer = 0; saveGame(); }
      }

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
        changed = true;
        showToast(`✓ ${getNode(nid)?.name || nid} unlocked!`);
      }
    }
  }

  // ── HUD ─────────────────────────────────────────────────────────
  function updateHUD() {
    document.getElementById('resource-amount').textContent = fmtNum(S.resources);
    document.getElementById('rate-value').textContent      = '+' + fmtNum(S.rate, 2);
    document.getElementById('prestige-amount').textContent = fmtNum(S.prestigePoints, 0);

    if (S.prestigeCount > 0) {
      const b = document.getElementById('prestige-count-badge');
      b.textContent = `×${S.prestigeCount}`;
      b.classList.remove('hidden');
    }

    document.getElementById('btn-prestige').classList.toggle('hidden', S.totalEarned < 1000);
  }

  function updateResourceUI() {
    if (!S.treeDef) return;
    const res = S.treeDef.resource || {};
    document.getElementById('resource-icon').textContent  = res.icon  || '⚡';
    document.getElementById('resource-name').textContent  = res.name  || 'Energy';
    const pr = S.treeDef.prestige_resource || {};
    document.getElementById('prestige-icon').textContent  = pr.icon   || '✨';
    document.getElementById('prestige-label').textContent = pr.name   || 'Essence';
    document.getElementById('game-title').textContent     = S.treeDef.name || 'UPGRADE TREE MAKER';
    document.title = S.treeDef.name || 'Upgrade Tree Maker';
  }

  // ── Canvases ────────────────────────────────────────────────────
  function initCanvases() {
    TV.canvas = document.getElementById('tree-canvas');
    PV.canvas = document.getElementById('prestige-canvas');

    [[TV, 'tree-viewport-wrap'], [PV, 'prestige-viewport-wrap']].forEach(([v, wrapId]) => {
      const wrap = document.getElementById(wrapId);
      resizeCanvas(v, wrap);
      new ResizeObserver(() => resizeCanvas(v, wrap)).observe(wrap);
    });

    const nodes  = S.treeDef?.nodes || [];
    const pnodes = S.treeDef?.prestige_nodes || [];
    TV.pan = TreeRenderer.centerPan(TV.canvas, nodes);
    PV.pan = TreeRenderer.centerPan(PV.canvas, pnodes);
    renderTree(TV, nodes, false);
    renderTree(PV, pnodes, true);
  }

  function resizeCanvas(v, wrap) {
    v.canvas.width  = wrap.clientWidth;
    v.canvas.height = wrap.clientHeight;
    const isP  = v === PV;
    const nodes = isP ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []);
    renderTree(v, nodes, isP);
  }

  function renderTree(v, nodes, isPrestige) {
    if (!v.canvas) return;
    const unlockedSet = isPrestige ? S.prestigeUnlocked : S.unlocked;
    TreeRenderer.render(v.canvas, nodes, unlockedSet, isPrestige ? {} : S.inProgress, v.pan, v.zoom);
  }

  // ── Events ──────────────────────────────────────────────────────
  function setupEvents() {
    setupViewport(TV, false);
    setupViewport(PV, true);
  }

  function setupViewport(v, isPrestige) {
    const wrap = document.getElementById(isPrestige ? 'prestige-viewport-wrap' : 'tree-viewport-wrap');

    wrap.addEventListener('mousedown', e => {
      v.drag = { sx: e.clientX, sy: e.clientY, px: v.pan.x, py: v.pan.y };
    });
    wrap.addEventListener('mousemove', e => {
      if (!v.drag) return;
      v.pan.x = v.drag.px + (e.clientX - v.drag.sx);
      v.pan.y = v.drag.py + (e.clientY - v.drag.sy);
      renderTree(v, isPrestige ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []), isPrestige);
    });
    wrap.addEventListener('mouseup', e => {
      const dx = Math.abs(e.clientX - (v.drag?.sx || 0));
      const dy = Math.abs(e.clientY - (v.drag?.sy || 0));
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
      v.zoom  = Math.min(3, Math.max(0.15, v.zoom * factor));
      document.getElementById('zoom-label').textContent = Math.round(v.zoom * 100) + '%';
      renderTree(v, isPrestige ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []), isPrestige);
    }, { passive: false });
  }

  function handleCanvasClick(v, e, isPrestige) {
    const rect  = v.canvas.getBoundingClientRect();
    const mx    = (e.clientX - rect.left  - v.pan.x) / v.zoom;
    const my    = (e.clientY - rect.top   - v.pan.y) / v.zoom;
    const nodes = isPrestige ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []);
    for (const node of nodes) {
      const nx = (node.x || 0) * TreeRenderer.GRID;
      const ny = (node.y || 0) * TreeRenderer.GRID;
      if (Math.hypot(mx - nx, my - ny) < TreeRenderer.NR + 8) {
        openNodeModal(node, isPrestige);
        return;
      }
    }
  }

  // ── Node Modal ──────────────────────────────────────────────────
  async function openNodeModal(node, isPrestige) {
    modalNode       = node;
    modalIsPrestige = isPrestige;
    const unlockedSet = isPrestige ? S.prestigeUnlocked : S.unlocked;
    const unlocked    = unlockedSet.has(node.id);
    const inProg      = !isPrestige && S.inProgress[node.id];

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

    document.getElementById('node-modal-name').textContent = node.name || node.id;
    document.getElementById('node-modal-tier').textContent = isPrestige ? 'PRESTIGE UPGRADE' : `TIER ${node.tier ?? '?'}`;
    document.getElementById('node-modal-desc').textContent = node.description || '';

    const eff = node.effect || {};
    const effText = {
      rate_add:  v => `+${v} ${S.treeDef?.resource?.name || 'Energy'}/sec`,
      rate_mult: v => `×${v} production multiplier`,
      prestige_mult_per_prestige: v => `+${v * 100}% per prestige level`,
      start_bonus:     v => `Start with ${v} ${S.treeDef?.resource?.name || 'Energy'}`,
      auto_unlock_tier: v => `Auto-unlock tier ${v} at run start`,
      offline_mult:    v => `×${v} offline production`,
      global_mult:     v => `×${v} GLOBAL multiplier`,
    }[eff.type]?.(eff.value) || `${eff.type}: ${eff.value}`;
    document.getElementById('node-modal-effect').textContent = '⚡ ' + effText;

    const costRes = isPrestige ? (S.treeDef?.prestige_resource?.icon || '✨') : (S.treeDef?.resource?.icon || '⚡');
    document.getElementById('node-modal-cost').textContent =
      unlocked ? '✓ Unlocked'
      : inProg ? '⏳ Unlocking…'
      : `${costRes} ${fmtNum(node.cost, 2)}`;

    const reqs = (node.requires || []).map(r => getNode(r, isPrestige)?.name || r);
    document.getElementById('node-modal-requires').textContent =
      reqs.length ? 'Requires: ' + reqs.join(', ') : '';

    const btn = document.getElementById('node-modal-btn');
    if (unlocked) {
      btn.textContent = '✓ Already Unlocked'; btn.disabled = true;
    } else if (inProg) {
      btn.textContent = '⏳ Unlocking…';       btn.disabled = true;
    } else {
      const canBuy     = (node.requires || []).every(r => unlockedSet.has(r));
      const affordable = isPrestige ? S.prestigePoints >= node.cost : S.resources >= node.cost;
      btn.disabled    = !canBuy || !affordable;
      btn.textContent = !canBuy     ? '🔒 Requires Prerequisites'
                      : !affordable ? '⚡ Not Enough Resources'
                      :               `▶ Purchase (${costRes}${fmtNum(node.cost, 0)})`;
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

  function purchaseNode(node, isPrestige) {
    const unlockedSet = isPrestige ? S.prestigeUnlocked : S.unlocked;
    if (unlockedSet.has(node.id)) return;
    if (!(node.requires || []).every(r => unlockedSet.has(r))) return;

    if (isPrestige) {
      if (S.prestigePoints < node.cost) { showToast('Not enough!'); return; }
      S.prestigePoints -= node.cost;
      S.prestigeUnlocked.add(node.id);
      recomputeRate();
      renderTree(PV, S.treeDef.prestige_nodes || [], true);
      showToast(`✨ ${node.name} unlocked!`);
      saveGame();
      return;
    }

    if (S.resources < node.cost) { showToast('Not enough resources!'); return; }
    S.resources -= node.cost;
    const dur = ((node.tier || 0) * 3 + 1) * 1000;
    S.inProgress[node.id] = { endTime: Date.now() + dur, duration: dur };
    showToast(`⏳ ${node.name} unlocking in ${(node.tier || 0) * 3 + 1}s…`);
    renderTree(TV, S.treeDef.nodes, false);
    saveGame();
  }

  function getNode(id, isPrestige = false) {
    const nodes = isPrestige ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []);
    return nodes.find(n => n.id === id);
  }

  // ── Prestige ────────────────────────────────────────────────────
  function showPrestigeModal() {
    const pts = Math.max(1, Math.floor(Math.sqrt(S.totalEarned / 1000)));
    document.getElementById('prestige-modal-desc').textContent =
      'Resetting your run wipes upgrades and resources but earns Essence for permanent upgrades.';
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
    const pts = Math.max(1, Math.floor(Math.sqrt(S.totalEarned / 1000)));

    try {
      await fetch('/api/prestige', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: S.sessionId, total_earned: S.totalEarned,
          prestige_count: S.prestigeCount, prestige_points: S.prestigePoints,
          prestige_upgrades: [...S.prestigeUnlocked], tree_id: S.treeId,
        }),
      });
    } catch(e) {}

    S.prestigeCount++;
    S.prestigePoints += pts;
    S.resources   = 0;
    S.totalEarned = 0;
    S.unlocked    = new Set();
    S.inProgress  = {};
    S.runStart    = Date.now();

    for (const pid of S.prestigeUnlocked) {
      const pn = (S.treeDef?.prestige_nodes || []).find(n => n.id === pid);
      if (pn?.effect?.type === 'start_bonus') S.resources += pn.effect.value;
    }

    recomputeRate();
    renderTree(TV, S.treeDef?.nodes || [], false);
    renderTree(PV, S.treeDef?.prestige_nodes || [], true);
    saveGame();
    showToast(`⟳ Prestige! +✨${pts} Essence earned.`);
  }

  // ── Tab Switching ───────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    ['tree', 'prestige', 'settings'].forEach(t => {
      document.getElementById(`panel-${t}`).classList.toggle('active', t === tab);
      document.getElementById(`panel-${t}`).classList.toggle('hidden',  t !== tab);
      document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
    });
    if (tab === 'tree')     renderTree(TV, S.treeDef?.nodes || [], false);
    if (tab === 'prestige') renderTree(PV, S.treeDef?.prestige_nodes || [], true);
  }

  // ── Zoom ────────────────────────────────────────────────────────
  function treeZoom(factor) {
    const v   = activeTab === 'prestige' ? PV : TV;
    const isP = activeTab === 'prestige';
    const cx  = v.canvas.width / 2, cy = v.canvas.height / 2;
    v.pan.x = cx - (cx - v.pan.x) * factor;
    v.pan.y = cy - (cy - v.pan.y) * factor;
    v.zoom  = Math.min(3, Math.max(0.15, v.zoom * factor));
    document.getElementById('zoom-label').textContent = Math.round(v.zoom * 100) + '%';
    renderTree(v, isP ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []), isP);
  }

  function treeReset() {
    const v   = activeTab === 'prestige' ? PV : TV;
    const isP = activeTab === 'prestige';
    const nodes = isP ? (S.treeDef?.prestige_nodes || []) : (S.treeDef?.nodes || []);
    v.zoom  = 1;
    v.pan   = TreeRenderer.centerPan(v.canvas, nodes);
    document.getElementById('zoom-label').textContent = '100%';
    renderTree(v, nodes, isP);
  }

  // ── Art ─────────────────────────────────────────────────────────
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

  // ── Save / Load ─────────────────────────────────────────────────
  function saveGame() {
    if (!S.treeDef) return;
    const data = {
      session_id:        S.sessionId,
      tree_id:           S.treeId,
      tree_name:         S.treeDef.name,
      tree_def:          S.treeDef,
      resources:         { main: S.resources },
      unlocked:          [...S.unlocked],
      in_progress:       S.inProgress,
      prestige_count:    S.prestigeCount,
      prestige_points:   S.prestigePoints,
      prestige_upgrades: [...S.prestigeUnlocked],
      total_earned:      S.totalEarned,
      run_start:         S.runStart,
    };
    localStorage.setItem('utm_save', JSON.stringify(data));
    try {
      fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    } catch(e) {}
  }

  function exportSave() {
    if (!S.treeDef) return;
    const data = {
      session_id: S.sessionId, tree_id: S.treeId, tree_name: S.treeDef?.name,
      tree_def: S.treeDef, resources: { main: S.resources },
      unlocked: [...S.unlocked], in_progress: S.inProgress,
      prestige_count: S.prestigeCount, prestige_points: S.prestigePoints,
      prestige_upgrades: [...S.prestigeUnlocked],
      total_earned: S.totalEarned, run_start: S.runStart, exported_at: Date.now(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'utm_save.json'; a.click();
    URL.revokeObjectURL(url);
    showToast('Save exported!');
  }

  function exportTree() {
    if (!S.treeDef) return;
    const blob = new Blob([JSON.stringify(S.treeDef, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${S.treeId}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('Tree exported!');
  }

  function importTree() { document.getElementById('import-tree-input').click(); }

  async function handleImportTree(e) {
    const file = e.target.files[0]; if (!file) return;
    const text = await file.text();
    let tree;
    try { tree = JSON.parse(text); } catch { showToast('Invalid JSON!'); return; }
    if (!tree.nodes) { showToast('Not a valid tree file!'); return; }
    await startNewGame(tree);
    e.target.value = '';
  }

  function hardReset() {
    if (!confirm('Delete ALL save data? This cannot be undone.')) return;
    localStorage.removeItem('utm_save');
    Menu.showMain();
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const toast = showToast;

  return {
    boot, startNewGame, startFromSave,
    saveGame, exportSave, exportTree, importTree, handleImportTree, hardReset,
    switchTab, treeZoom, treeReset,
    openNodeModal, closeModal, purchaseFromModal,
    showPrestigeModal, closePrestigeModal, confirmPrestige,
    toast,
  };
})();

window.addEventListener('DOMContentLoaded', () => Game.boot());
