/**
 * svg_art.js  — Procedural geometric node art generator
 *
 * Each node gets a deterministic, unique SVG based on its id, shape, color,
 * and accent. No two nodes look the same. Art adapts to unlock state.
 */

const SvgArt = (() => {

  // Seeded PRNG so art is deterministic per-node
  function mkRng(seed) {
    let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0x9e3779b9);
    return () => {
      s ^= s << 13; s ^= s >> 17; s ^= s << 5;
      return ((s >>> 0) / 0xffffffff);
    };
  }

  // Lighten / darken hex color
  function adjustColor(hex, factor) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const clamp = v => Math.min(255, Math.max(0, Math.round(v * factor)));
    return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
  }

  function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Build polygon points
  function poly(cx, cy, r, sides, rng, wobble=0.08) {
    return Array.from({length: sides}, (_,i) => {
      const a = (i / sides) * Math.PI * 2 - Math.PI/2;
      const rf = r * (1 + (rng() - 0.5) * wobble);
      return `${cx + Math.cos(a)*rf},${cy + Math.sin(a)*rf}`;
    }).join(' ');
  }

  // Main generator
  function generate(node, unlocked, inProgress, size=64) {
    const { id, shape='circle', color='#6060ff', accent='#c0c0ff', tier=0 } = node;
    const rng = mkRng(id);
    const W = size, H = size, cx = W/2, cy = H/2;
    const locked = !unlocked;
    const mainColor  = locked ? '#2a2a4a' : color;
    const accentColor = locked ? '#3a3a6a' : accent;
    const dimColor   = locked ? '#1a1a2a' : adjustColor(color, 0.4);
    const glowColor  = locked ? 'none'    : hexToRgba(color, 0.35);

    const pid = `grad_${id.replace(/\W/g,'_')}`;
    const mid = `glow_${id.replace(/\W/g,'_')}`;

    // Background ring count scales with tier
    const ringCount = Math.min(3, 1 + tier);
    let rings = '';
    for (let i = ringCount; i >= 1; i--) {
      const r = (cx - 2) * (i / ringCount);
      rings += `<circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="${mainColor}" stroke-width="0.5" opacity="${0.2 + i*0.08}"/>`;
    }

    // Decorative background particles (more per tier)
    let particles = '';
    const pCount = 4 + tier * 2;
    for (let i = 0; i < pCount; i++) {
      const px = rng() * W;
      const py = rng() * H;
      const pr = 0.5 + rng() * 1.5;
      const op = 0.2 + rng() * 0.4;
      particles += `<circle cx="${px}" cy="${py}" r="${pr}" fill="${accentColor}" opacity="${op}"/>`;
    }

    // Inner orbit dots
    let orbitDots = '';
    if (!locked) {
      const orbitR = cx * 0.55;
      const dotCount = 3 + tier;
      for (let i = 0; i < dotCount; i++) {
        const a = (i / dotCount) * Math.PI * 2;
        const ox = cx + Math.cos(a) * orbitR;
        const oy = cy + Math.sin(a) * orbitR;
        orbitDots += `<circle cx="${ox}" cy="${oy}" r="1.5" fill="${accentColor}" opacity="0.6"/>`;
      }
    }

    // Central shape
    let shapeEl = '';
    const r = cx * 0.48;
    if (shape === 'circle') {
      shapeEl = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${pid})" stroke="${accentColor}" stroke-width="1.2"/>`;
    } else if (shape === 'diamond') {
      const pts = poly(cx, cy, r, 4, mkRng(id+'d'), 0.04);
      shapeEl = `<polygon points="${pts}" fill="url(#${pid})" stroke="${accentColor}" stroke-width="1.2"/>`;
    } else if (shape === 'hexagon') {
      const pts = poly(cx, cy, r, 6, mkRng(id+'h'), 0.04);
      shapeEl = `<polygon points="${pts}" fill="url(#${pid})" stroke="${accentColor}" stroke-width="1.2"/>`;
    } else if (shape === 'triangle') {
      const pts = poly(cx, cy, r, 3, mkRng(id+'t'), 0.04);
      shapeEl = `<polygon points="${pts}" fill="url(#${pid})" stroke="${accentColor}" stroke-width="1.2"/>`;
    } else if (shape === 'square') {
      const pts = poly(cx, cy, r, 4, mkRng(id+'s'), 0.12);
      // rotate 45 degrees
      shapeEl = `<polygon points="${pts}" fill="url(#${pid})" stroke="${accentColor}" stroke-width="1.2"
        transform="rotate(45,${cx},${cy})"/>`;
    } else if (shape === 'star') {
      const outer = r, inner = r * 0.5;
      const starPts = Array.from({length:10}, (_,i) => {
        const a = (i/10)*Math.PI*2 - Math.PI/2;
        const ro = i%2===0 ? outer : inner;
        return `${cx+Math.cos(a)*ro},${cy+Math.sin(a)*ro}`;
      }).join(' ');
      shapeEl = `<polygon points="${starPts}" fill="url(#${pid})" stroke="${accentColor}" stroke-width="1.2"/>`;
    }

    // Inner highlight
    const hlEl = `<circle cx="${cx*0.8}" cy="${cy*0.7}" r="${r*0.28}" fill="${accentColor}" opacity="0.18"/>`;

    // Progress arc (if upgrade in progress)
    let progressArc = '';
    if (inProgress && inProgress > 0 && inProgress < 1) {
      const sweep = inProgress * 2 * Math.PI;
      const pr2 = cx - 3;
      const ex = cx + pr2 * Math.cos(-Math.PI/2 + sweep);
      const ey = cy + pr2 * Math.sin(-Math.PI/2 + sweep);
      const lg = sweep > Math.PI ? 1 : 0;
      progressArc = `<path d="M ${cx},${cy - pr2} A ${pr2} ${pr2} 0 ${lg} 1 ${ex} ${ey}"
        fill="none" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>`;
    }

    // Unlocked glow ring
    const glowRing = unlocked
      ? `<circle cx="${cx}" cy="${cy}" r="${cx-1}" fill="none" stroke="${mainColor}" stroke-width="2" opacity="0.5"/>`
      : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <radialGradient id="${pid}" cx="38%" cy="35%" r="65%">
      <stop offset="0%"   stop-color="${accentColor}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${dimColor}"    stop-opacity="1"/>
    </radialGradient>
    <filter id="${mid}">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- bg -->
  <rect width="${W}" height="${H}" rx="8" fill="#0a0a18"/>
  ${rings}
  ${particles}
  <!-- glow -->
  ${unlocked ? `<circle cx="${cx}" cy="${cy}" r="${cx*0.6}" fill="${glowColor}" filter="url(#${mid})"/>` : ''}
  ${glowRing}
  ${orbitDots}
  <!-- shape -->
  ${shapeEl}
  ${hlEl}
  ${progressArc}
</svg>`;
  }

  // Larger version for the modal (120×120)
  function generateLarge(node, unlocked) {
    return generate(node, unlocked, 0, 120);
  }

  return { generate, generateLarge };
})();
