"""
Upgrade Tree Game — Flask backend
Handles game state persistence, tree loading, prestige logic, and art serving.
"""

from flask import Flask, jsonify, request, render_template, send_from_directory
import json, os, time, math, sqlite3, hashlib, pathlib

app = Flask(__name__)

DB_PATH   = os.environ.get("DB_PATH", "data/game.db")
TREES_DIR = os.environ.get("TREES_DIR", "trees")
ART_DIR   = os.environ.get("ART_DIR", "static/art")

# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(TREES_DIR, exist_ok=True)
    os.makedirs(ART_DIR, exist_ok=True)
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS saves (
                id          INTEGER PRIMARY KEY,
                session_id  TEXT UNIQUE NOT NULL,
                tree_id     TEXT NOT NULL DEFAULT 'default',
                resources   TEXT NOT NULL DEFAULT '{}',
                unlocked    TEXT NOT NULL DEFAULT '[]',
                in_progress TEXT NOT NULL DEFAULT '{}',
                prestige_count INTEGER NOT NULL DEFAULT 0,
                prestige_points REAL NOT NULL DEFAULT 0,
                prestige_upgrades TEXT NOT NULL DEFAULT '[]',
                total_earned REAL NOT NULL DEFAULT 0,
                run_start   REAL NOT NULL DEFAULT 0,
                updated_at  REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS trees (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                definition  TEXT NOT NULL,
                created_at  REAL NOT NULL
            );
        """)
    # Seed the default tree if missing
    _seed_default_tree()

def _seed_default_tree():
    default_path = os.path.join(TREES_DIR, "default.json")
    if not os.path.exists(default_path):
        # Write the built-in default tree to disk
        with open(default_path, "w") as f:
            json.dump(DEFAULT_TREE, f, indent=2)
    # Load it into DB
    with open(default_path) as f:
        tree_def = json.load(f)
    with get_db() as db:
        existing = db.execute("SELECT id FROM trees WHERE id='default'").fetchone()
        if not existing:
            db.execute(
                "INSERT INTO trees (id,name,description,definition,created_at) VALUES (?,?,?,?,?)",
                ("default", tree_def.get("name","Default"), tree_def.get("description",""),
                 json.dumps(tree_def), time.time())
            )

# ── Default Tree Definition ───────────────────────────────────────────────────

DEFAULT_TREE = {
    "name": "Ascension",
    "description": "From dust to divinity — the default upgrade tree.",
    "version": "1.0",
    "resource": {"name": "Energy", "icon": "⚡", "color": "#f0c040"},
    "base_rate": 0.5,
    "prestige_resource": {"name": "Essence", "icon": "✨", "color": "#c080ff"},
    "nodes": [
        # ── Tier 0 – Root ─────────────────────────────────────────────────────
        {
            "id": "spark",
            "name": "Spark",
            "tier": 0,
            "x": 0, "y": 0,
            "description": "The first flicker of potential.",
            "cost": 10,
            "effect": {"type": "rate_add", "value": 0.5},
            "requires": [],
            "shape": "diamond", "color": "#f0c040", "accent": "#fff8d0"
        },
        # ── Tier 1 ────────────────────────────────────────────────────────────
        {
            "id": "kindle",
            "name": "Kindle",
            "tier": 1,
            "x": -2, "y": 1,
            "description": "Fan the spark into a steady flame.",
            "cost": 50,
            "effect": {"type": "rate_add", "value": 2},
            "requires": ["spark"],
            "shape": "circle", "color": "#e07830", "accent": "#ffd090"
        },
        {
            "id": "focus",
            "name": "Focus",
            "tier": 1,
            "x": 2, "y": 1,
            "description": "Direct your energy with precision.",
            "cost": 60,
            "effect": {"type": "rate_mult", "value": 1.5},
            "requires": ["spark"],
            "shape": "hexagon", "color": "#3090e0", "accent": "#90d0ff"
        },
        # ── Tier 2 ────────────────────────────────────────────────────────────
        {
            "id": "furnace",
            "name": "Furnace",
            "tier": 2,
            "x": -3, "y": 2,
            "description": "A roaring engine of production.",
            "cost": 300,
            "effect": {"type": "rate_add", "value": 10},
            "requires": ["kindle"],
            "shape": "square", "color": "#c04020", "accent": "#ff9060"
        },
        {
            "id": "lens",
            "name": "Lens",
            "tier": 2,
            "x": 0, "y": 2,
            "description": "Concentrate all sources to a point.",
            "cost": 350,
            "effect": {"type": "rate_mult", "value": 2.0},
            "requires": ["kindle", "focus"],
            "shape": "triangle", "color": "#20a0c0", "accent": "#80e8ff"
        },
        {
            "id": "resonance",
            "name": "Resonance",
            "tier": 2,
            "x": 3, "y": 2,
            "description": "Your energy hums in harmony.",
            "cost": 400,
            "effect": {"type": "rate_mult", "value": 1.8},
            "requires": ["focus"],
            "shape": "star", "color": "#8030d0", "accent": "#d090ff"
        },
        # ── Tier 3 ────────────────────────────────────────────────────────────
        {
            "id": "forge",
            "name": "Forge",
            "tier": 3,
            "x": -4, "y": 3,
            "description": "Smelt raw potential into pure power.",
            "cost": 2000,
            "effect": {"type": "rate_add", "value": 50},
            "requires": ["furnace"],
            "shape": "square", "color": "#901010", "accent": "#ff6030"
        },
        {
            "id": "prism",
            "name": "Prism",
            "tier": 3,
            "x": -1, "y": 3,
            "description": "Split your output into spectrum paths.",
            "cost": 2500,
            "effect": {"type": "rate_mult", "value": 2.5},
            "requires": ["furnace", "lens"],
            "shape": "triangle", "color": "#10a060", "accent": "#60ffb0"
        },
        {
            "id": "amplifier",
            "name": "Amplifier",
            "tier": 3,
            "x": 2, "y": 3,
            "description": "Boost all multipliers by resonating.",
            "cost": 3000,
            "effect": {"type": "rate_mult", "value": 3.0},
            "requires": ["lens", "resonance"],
            "shape": "hexagon", "color": "#6020b0", "accent": "#c080ff"
        },
        {
            "id": "beacon",
            "name": "Beacon",
            "tier": 3,
            "x": 4, "y": 3,
            "description": "Broadcast your power outward.",
            "cost": 3500,
            "effect": {"type": "rate_add", "value": 80},
            "requires": ["resonance"],
            "shape": "star", "color": "#b08000", "accent": "#ffe060"
        },
        # ── Tier 4 ────────────────────────────────────────────────────────────
        {
            "id": "reactor",
            "name": "Reactor",
            "tier": 4,
            "x": -3, "y": 4,
            "description": "Sustained chain reaction — perpetual output.",
            "cost": 20000,
            "effect": {"type": "rate_mult", "value": 4.0},
            "requires": ["forge", "prism"],
            "shape": "circle", "color": "#c00040", "accent": "#ff60a0"
        },
        {
            "id": "nexus",
            "name": "Nexus",
            "tier": 4,
            "x": 0, "y": 4,
            "description": "All paths converge here.",
            "cost": 25000,
            "effect": {"type": "rate_mult", "value": 5.0},
            "requires": ["prism", "amplifier"],
            "shape": "diamond", "color": "#0060c0", "accent": "#60c0ff"
        },
        {
            "id": "pylon",
            "name": "Pylon",
            "tier": 4,
            "x": 3, "y": 4,
            "description": "A towering monument to progress.",
            "cost": 30000,
            "effect": {"type": "rate_add", "value": 500},
            "requires": ["amplifier", "beacon"],
            "shape": "triangle", "color": "#404000", "accent": "#c0c000"
        },
        # ── Tier 5 ────────────────────────────────────────────────────────────
        {
            "id": "singularity",
            "name": "Singularity",
            "tier": 5,
            "x": 0, "y": 5,
            "description": "Energy beyond comprehension. The threshold.",
            "cost": 500000,
            "effect": {"type": "rate_mult", "value": 10.0},
            "requires": ["reactor", "nexus", "pylon"],
            "shape": "star", "color": "#8000ff", "accent": "#ffffff"
        }
    ],
    # Prestige meta-upgrades (bought with prestige points)
    "prestige_nodes": [
        {
            "id": "p_momentum",
            "name": "Momentum",
            "description": "Each prestige adds +10% global multiplier.",
            "cost": 1,
            "effect": {"type": "prestige_mult_per_prestige", "value": 0.1},
            "requires": [],
            "shape": "circle", "color": "#c080ff", "accent": "#ffffff"
        },
        {
            "id": "p_headstart",
            "name": "Head Start",
            "description": "Begin each run with 100 free Energy.",
            "cost": 2,
            "effect": {"type": "start_bonus", "value": 100},
            "requires": ["p_momentum"],
            "shape": "diamond", "color": "#ff80c0", "accent": "#ffffff"
        },
        {
            "id": "p_recall",
            "name": "Recall",
            "description": "Unlock your first tier-1 upgrades for free at run start.",
            "cost": 3,
            "effect": {"type": "auto_unlock_tier", "value": 1},
            "requires": ["p_momentum"],
            "shape": "hexagon", "color": "#80c0ff", "accent": "#ffffff"
        },
        {
            "id": "p_echo",
            "name": "Echo",
            "description": "Idle production is 2× faster while the tab is closed.",
            "cost": 5,
            "effect": {"type": "offline_mult", "value": 2.0},
            "requires": ["p_headstart", "p_recall"],
            "shape": "square", "color": "#c0ff80", "accent": "#ffffff"
        },
        {
            "id": "p_transcendence",
            "name": "Transcendence",
            "description": "Global ×5 — the universe bends to your will.",
            "cost": 15,
            "effect": {"type": "global_mult", "value": 5.0},
            "requires": ["p_echo"],
            "shape": "star", "color": "#ffffff", "accent": "#8000ff"
        }
    ]
}

# ── Game Logic Helpers ────────────────────────────────────────────────────────

def compute_rate(tree_def, unlocked_ids, prestige_count, prestige_upgrades):
    """Return per-second resource rate given current unlocks."""
    node_map = {n["id"]: n for n in tree_def["nodes"]}
    base = tree_def.get("base_rate", 0.1)
    additive = base
    multiplier = 1.0

    for nid in unlocked_ids:
        node = node_map.get(nid)
        if not node:
            continue
        eff = node.get("effect", {})
        if eff["type"] == "rate_add":
            additive += eff["value"]
        elif eff["type"] == "rate_mult":
            multiplier *= eff["value"]

    # Prestige bonuses
    p_node_map = {n["id"]: n for n in tree_def.get("prestige_nodes", [])}
    global_mult = 1.0
    per_prestige_bonus = 0.0
    for pid in prestige_upgrades:
        pn = p_node_map.get(pid)
        if not pn:
            continue
        eff = pn.get("effect", {})
        if eff["type"] == "prestige_mult_per_prestige":
            per_prestige_bonus += eff["value"]
        elif eff["type"] == "global_mult":
            global_mult *= eff["value"]

    prestige_mult = 1.0 + per_prestige_bonus * prestige_count
    return additive * multiplier * prestige_mult * global_mult

def prestige_points_earned(total_earned, prestige_count):
    """Formula: floor(sqrt(total_earned / 1000)) — increases each run."""
    return max(1, math.floor(math.sqrt(total_earned / 1000)))

def can_unlock(node, unlocked_set):
    return all(r in unlocked_set for r in node.get("requires", []))

# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ── Save / Load ───────────────────────────────────────────────────────────────

@app.route("/api/save", methods=["POST"])
def save_game():
    d = request.json
    sid = d.get("session_id")
    if not sid:
        return jsonify({"ok": False, "error": "No session_id"})
    with get_db() as db:
        db.execute("""
            INSERT INTO saves
              (session_id,tree_id,resources,unlocked,in_progress,
               prestige_count,prestige_points,prestige_upgrades,
               total_earned,run_start,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET
              tree_id=excluded.tree_id,
              resources=excluded.resources,
              unlocked=excluded.unlocked,
              in_progress=excluded.in_progress,
              prestige_count=excluded.prestige_count,
              prestige_points=excluded.prestige_points,
              prestige_upgrades=excluded.prestige_upgrades,
              total_earned=excluded.total_earned,
              run_start=excluded.run_start,
              updated_at=excluded.updated_at
        """, (
            sid,
            d.get("tree_id", "default"),
            json.dumps(d.get("resources", {})),
            json.dumps(d.get("unlocked", [])),
            json.dumps(d.get("in_progress", {})),
            d.get("prestige_count", 0),
            d.get("prestige_points", 0),
            json.dumps(d.get("prestige_upgrades", [])),
            d.get("total_earned", 0),
            d.get("run_start", time.time()),
            time.time()
        ))
    return jsonify({"ok": True})

@app.route("/api/load/<session_id>")
def load_game(session_id):
    with get_db() as db:
        row = db.execute("SELECT * FROM saves WHERE session_id=?", (session_id,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "No save found"})
    data = dict(row)
    for field in ("resources","unlocked","in_progress","prestige_upgrades"):
        data[field] = json.loads(data[field])
    return jsonify({"ok": True, "save": data})

# ── Tree ──────────────────────────────────────────────────────────────────────

@app.route("/api/tree/<tree_id>")
def get_tree(tree_id):
    with get_db() as db:
        row = db.execute("SELECT definition FROM trees WHERE id=?", (tree_id,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "Tree not found"})
    return jsonify({"ok": True, "tree": json.loads(row["definition"])})

@app.route("/api/trees")
def list_trees():
    with get_db() as db:
        rows = db.execute("SELECT id,name,description FROM trees").fetchall()
    return jsonify({"ok": True, "trees": [dict(r) for r in rows]})

@app.route("/api/tree/import", methods=["POST"])
def import_tree():
    """Accept a JSON tree definition uploaded by the user."""
    tree_def = request.json
    if not tree_def or "nodes" not in tree_def:
        return jsonify({"ok": False, "error": "Invalid tree definition"})
    # Generate a stable ID from content hash
    content_hash = hashlib.sha1(json.dumps(tree_def, sort_keys=True).encode()).hexdigest()[:8]
    tree_id = tree_def.get("id") or f"custom_{content_hash}"
    tree_def["id"] = tree_id
    with get_db() as db:
        db.execute("""
            INSERT INTO trees (id,name,description,definition,created_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name,
              description=excluded.description,
              definition=excluded.definition
        """, (
            tree_id,
            tree_def.get("name", "Unnamed Tree"),
            tree_def.get("description", ""),
            json.dumps(tree_def),
            time.time()
        ))
    # Also save to disk
    path = os.path.join(TREES_DIR, f"{tree_id}.json")
    with open(path, "w") as f:
        json.dump(tree_def, f, indent=2)
    return jsonify({"ok": True, "tree_id": tree_id})

@app.route("/api/tree/export/<tree_id>")
def export_tree(tree_id):
    with get_db() as db:
        row = db.execute("SELECT definition FROM trees WHERE id=?", (tree_id,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "Tree not found"})
    resp = app.response_class(
        response=row["definition"],
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{tree_id}.json"'}
    )
    return resp

# ── Upgrade Logic ─────────────────────────────────────────────────────────────

@app.route("/api/tick", methods=["POST"])
def tick():
    """
    Called periodically by the client.  Returns resources earned since last tick
    and the current rate (for display).  All real computation is client-side for
    snappiness; this endpoint validates + persists.
    """
    d = request.json
    tree_def = json.loads(
        get_db().execute("SELECT definition FROM trees WHERE id=?",
                         (d.get("tree_id","default"),)).fetchone()["definition"]
    )
    unlocked   = d.get("unlocked", [])
    prestige_c = d.get("prestige_count", 0)
    prestige_u = d.get("prestige_upgrades", [])
    rate = compute_rate(tree_def, unlocked, prestige_c, prestige_u)
    return jsonify({"ok": True, "rate": rate})

@app.route("/api/prestige", methods=["POST"])
def do_prestige():
    d = request.json
    sid = d.get("session_id")
    total_earned = d.get("total_earned", 0)
    prestige_count = d.get("prestige_count", 0)
    prestige_upgrades = d.get("prestige_upgrades", [])
    tree_id = d.get("tree_id", "default")

    earned_pts = prestige_points_earned(total_earned, prestige_count)
    new_prestige_count = prestige_count + 1
    new_prestige_points = d.get("prestige_points", 0) + earned_pts

    # Reset run
    with get_db() as db:
        db.execute("""
            UPDATE saves SET
              resources='{}', unlocked='[]', in_progress='{}',
              prestige_count=?, prestige_points=?,
              total_earned=0, run_start=?, updated_at=?
            WHERE session_id=?
        """, (new_prestige_count, new_prestige_points, time.time(), time.time(), sid))

    return jsonify({
        "ok": True,
        "prestige_count": new_prestige_count,
        "prestige_points": new_prestige_points,
        "earned_pts": earned_pts,
    })

# ── Art ───────────────────────────────────────────────────────────────────────

@app.route("/static/art/<path:filename>")
def serve_art(filename):
    return send_from_directory(ART_DIR, filename)

@app.route("/api/art/check/<node_id>")
def check_art(node_id):
    """Check if custom art exists for this node."""
    for ext in ("png","jpg","jpeg","gif","webp","svg"):
        path = os.path.join(ART_DIR, f"{node_id}.{ext}")
        if os.path.exists(path):
            return jsonify({"ok": True, "url": f"/static/art/{node_id}.{ext}"})
    return jsonify({"ok": False})

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
