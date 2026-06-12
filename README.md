# ◈ Ascension — Infinite Upgrade Tree Game

An idle upgrade tree game inspired by Cell to Singularity.  
Runs in Docker, served via Flask + Gunicorn, deployable behind nginx on any Linux server.

---

## Features

- **Infinite upgrade tree** — idle resource accumulation, time-gated unlocks
- **Prestige system** — reset runs for a global multiplier + a permanent prestige upgrade tree
- **Shareable trees** — every tree is a JSON file you can send to friends
- **Custom art** — drop images in `static/art/` named after node IDs; falls back to auto-generated SVG
- **Auto-generated SVG art** — procedural geometric art per node, no external dependencies
- **Save/load** — server-side SQLite + localStorage fallback + JSON export/import

---

## Quick Start

```bash
# 1. Build and start
docker compose up -d --build

# 2. Open in browser
http://localhost:5000
```

---

## Custom Art

Drop image files into `static/art/` named after the node ID:

```
static/art/spark.png        → art for the "spark" node
static/art/singularity.svg  → art for the "singularity" node
```

Supported formats: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`  
If no custom art exists, procedural SVG geometry is shown instead.

---

## Tree JSON Format

A tree is a single JSON file. Share it with friends — they import it via the Settings panel.

```jsonc
{
  "id": "my_tree",                    // optional; auto-generated from hash if missing
  "name": "My Custom Tree",
  "description": "A short description shown in-game.",
  "version": "1.0",

  "resource": {
    "name": "Energy",                 // what you're accumulating
    "icon": "⚡",
    "color": "#f0c040"
  },
  "base_rate": 0.5,                   // resources/second before any upgrades

  "prestige_resource": {
    "name": "Essence",                // earnable only via prestige
    "icon": "✨",
    "color": "#c080ff"
  },

  "nodes": [
    {
      "id": "root",                   // unique string ID
      "name": "Root Node",            // display name
      "tier": 0,                      // affects unlock time (tier × 3 seconds)
      "x": 0, "y": 0,                 // grid position on the canvas
      "description": "The beginning.",
      "cost": 10,                     // resource cost to purchase
      "effect": {
        "type": "rate_add",           // see Effect Types below
        "value": 1.0
      },
      "requires": [],                 // list of node IDs that must be unlocked first
      "shape": "circle",              // circle | diamond | hexagon | triangle | square | star
      "color":  "#6060ff",            // main fill color (hex)
      "accent": "#c0c0ff"             // highlight color (hex)
    }
    // ... more nodes
  ],

  "prestige_nodes": [
    // Same format as nodes, but cost is in prestige_resource (Essence)
    // and they are never reset on prestige.
    {
      "id": "p_bonus",
      "name": "Eternal Bonus",
      "description": "+20% per prestige.",
      "cost": 1,
      "effect": { "type": "prestige_mult_per_prestige", "value": 0.2 },
      "requires": [],
      "shape": "star", "color": "#c080ff", "accent": "#ffffff"
    }
  ]
}
```

### Effect Types

| type | description |
|---|---|
| `rate_add` | Adds `value` resources/sec |
| `rate_mult` | Multiplies production by `value` |
| `prestige_mult_per_prestige` | Adds `value * prestige_count` as a global multiplier |
| `start_bonus` | Grants `value` resources at the start of each run |
| `auto_unlock_tier` | Auto-unlocks all nodes up to tier `value` at run start |
| `offline_mult` | Multiplies production by `value` while tab is in background |
| `global_mult` | A flat global multiplier on all production |

### Layout Tips

- Use `x` and `y` as grid coordinates. `GRID = 120px` per unit at 100% zoom.
- Negative `x` = left branch, positive = right. Increasing `y` = deeper tiers.
- Nodes with the same `y` value appear on the same horizontal row.
- `requires` edges are automatically drawn as curves.
- Players can pan and zoom the canvas freely.

---

## Server Deployment (Linux Mint + nginx)

See `nginx.conf` for the full config with comments. Summary:

```bash
# On your server:
scp -r ./upgradegame user@yourserver:~/

cd ~/upgradegame
docker compose up -d --build

sudo apt install nginx certbot python3-certbot-nginx
sudo cp nginx.conf /etc/nginx/sites-available/ascension
# Edit YOUR_DOMAIN in the file
sudo ln -s /etc/nginx/sites-available/ascension /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com
sudo systemctl reload nginx
```

---

## Data Persistence

| What | Where |
|---|---|
| Game database | `./data/game.db` (mounted into container) |
| Custom trees | `./data/trees/*.json` |
| Custom art | `./static/art/*.png/svg/etc` |

Both `data/` and `static/art/` are bind-mounted via `docker-compose.yml`, so they survive container rebuilds.

---

## Adding More Nodes (Infinite Expansion)

The tree is infinite — just add more nodes to `trees/default.json` (or your custom tree).  
The canvas pans and zooms to fit any size. Use higher `tier` values and larger `x`/`y` coordinates for deeper nodes.

Restart (or re-import) after editing the JSON file:
```bash
docker compose restart
```
