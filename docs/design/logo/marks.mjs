/* Bring2Bring! logo explorations — shared geometry.
   All marks live on a 128 x 128 grid. Every mark is one SVG <mask>: the
   B forms are painted white, the "2" is stroked black through them, so the
   number is literally the shared negative space of the two letters. */
export const S = 128;

/* Two B's sharing a central spine, bowls bulging outward. dy staggers the
   right-hand pair so the letters interlock instead of mirroring. */
function spineB({ sx, sw, y, R, dy = 0 }) {
  const x2 = sx + sw, H = 4 * R;
  const left = cy => `M${sx},${cy - R}A${R},${R} 0 0 0 ${sx},${cy + R}Z`;
  const right = cy => `M${x2},${cy - R}A${R},${R} 0 0 1 ${x2},${cy + R}Z`;
  const top = Math.min(y, y + dy), bottom = Math.max(y + H, y + H + dy);
  return `M${sx},${top}h${sw}v${bottom - top}h${-sw}Z`
    + left(y + R) + left(y + 3 * R) + right(y + R + dy) + right(y + 3 * R + dy);
}

/* Classic B: stem on the left, two bowls on the right. */
function plainB({ x, y, T, R }) {
  const disc = yy => `M${x + T},${yy}A${R},${R} 0 0 1 ${x + T},${yy + 2 * R}Z`;
  return `M${x},${y}h${T}v${4 * R}h${-T}Z` + disc(y) + disc(y + 2 * R);
}

/* Open-stroke B for the monoline direction; bowls may be wider than tall. */
function monoB({ x, y, w, R }) {
  const bowl = cy => `M${x},${cy - R}A${w},${R} 0 0 1 ${x},${cy + R}`;
  return `M${x},${y}V${y + 4 * R}` + bowl(y + R) + bowl(y + 3 * R);
}

/* The "2" as an open path — stroked to become the negative channel.
   Arc over the top, straight diagonal down-left, flat base. */
function two({ cx, cy, r, a0 = 191, a1 = 44, fx, fy, fw }) {
  const at = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [sx, sy] = at(a0), [ex, ey] = at(a1);
  const large = ((a1 - a0 + 360) % 360) > 180 ? 1 : 0;
  return `M${sx.toFixed(1)},${sy.toFixed(1)}A${r},${r} 0 ${large} 1 ${ex.toFixed(1)},${ey.toFixed(1)}`
    + `L${fx},${fy}H${fx + fw}`;
}

export const MARKS = [
  {
    id: 'spine', n: '01', name: 'Spine',
    idea: 'Both B’s share one central stem and turn their bowls outward, so the whole interior is free for the 2.',
    trade: 'The calmest and most compact of the five — but it reads as a 2 first, and resolves into two B’s only on a second look.',
    fills: [spineB({ sx: 54, sw: 20, y: 10, R: 27 })],
    cuts: [{ d: two({ cx: 64, cy: 42, r: 23, fx: 42, fy: 100, fw: 46 }), w: 14 }],
    notches: [[25, 64, 12], [103, 64, 12]],
  },
  {
    id: 'slab', n: '02', name: 'Slab',
    idea: 'A B and a reversed B pressed into one solid block; the 2 is the only cut in it.',
    trade: 'Holds together at 16 px better than anything else here, which makes it the natural app icon and favicon.',
    fills: [plainB({ x: 24, y: 16, T: 19, R: 24 }), { d: plainB({ x: 24, y: 16, T: 19, R: 24 }), tf: 'translate(128,0) scale(-1,1)' }],
    cuts: [{ d: two({ cx: 68, cy: 44, r: 22, fx: 46, fy: 96, fw: 48 }), w: 17 }],
  },
  {
    id: 'interlock', n: '03', name: 'Interlock',
    idea: 'The same shared stem, but the right-hand B is dropped half a bowl so the two letters lock rather than mirror.',
    trade: 'The most letter-like of the bold marks; the stagger costs it some of the Spine’s calm.',
    fills: [spineB({ sx: 52, sw: 19, y: 6, R: 24, dy: 24 })],
    cuts: [{ d: two({ cx: 62, cy: 44, r: 22, fx: 42, fy: 102, fw: 46 }), w: 13 }],
    notches: [[31, 54, 10], [92, 78, 10]],
  },
  {
    id: 'rotor', n: '04', name: 'Rotor',
    idea: 'Two identical B’s, the second turned a half turn, so the letters lock point-symmetrically around the centre.',
    trade: 'Reads as an exchange between two people, which suits passing a list around; busiest of the five up close.',
    fills: (() => { const T = 16, R = 22, x = 28, y = 12; const b = plainB({ x, y, T, R });
      return [b, { d: b, tf: `rotate(180 ${x + (T + R) / 2 + 17} ${y + 2 * R + 8})` }]; })(),
    cuts: [{ d: two({ cx: 66, cy: 46, r: 21, fx: 45, fy: 98, fw: 44 }), w: 14 }],
  },
  {
    id: 'monoline', n: '05', name: 'Monoline',
    idea: 'Both B’s drawn in one even stroke and overlapped like a knot, with the 2 opened out of the shared white.',
    trade: 'By far the clearest as two B’s, and the weakest as a 2 — the lightest, most editorial register of the set.',
    strokes: [{ d: monoB({ x: 34, y: 12, w: 32, R: 22 }), w: 11 }, { d: monoB({ x: 62, y: 34, w: 32, R: 22 }), w: 11 }],
    cuts: [{ d: two({ cx: 64, cy: 46, r: 22, fx: 44, fy: 100, fw: 42 }), w: 14 }],
  },
];

/* Render one mark as a standalone <svg>. Colour comes from `currentColor`. */
export function glyph(mark, uid, px, { label = false } = {}) {
  const asList = a => (a || []).map(p => (typeof p === 'string' ? { d: p } : p));
  const fills = asList(mark.fills)
    .map(p => `<path fill="#fff" d="${p.d}"${p.tf ? ` transform="${p.tf}"` : ''}/>`).join('');
  const strokes = asList(mark.strokes)
    .map(p => `<path fill="none" stroke="#fff" stroke-width="${p.w}" stroke-linecap="round" stroke-linejoin="round" d="${p.d}"/>`).join('');
  const cuts = asList(mark.cuts)
    .map(p => `<path fill="none" stroke="#000" stroke-width="${p.w}" stroke-linecap="round" stroke-linejoin="round" d="${p.d}"/>`).join('');
  const notches = (mark.notches || [])
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#000"/>`).join('');
  const a11y = label ? ` role="img" aria-label="${mark.name} mark"` : ' aria-hidden="true"';
  return `<svg width="${px}" height="${px}" viewBox="0 0 ${S} ${S}"${a11y}>`
    + `<mask id="${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">`
    + `<rect width="${S}" height="${S}" fill="#000"/>${fills}${strokes}${cuts}${notches}</mask>`
    + `<rect width="${S}" height="${S}" fill="currentColor" mask="url(#${uid})"/></svg>`;
}
