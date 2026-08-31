import { writeFileSync } from 'node:fs';
import { MARKS, glyph } from './marks.mjs';

const C = {
  bg: '#fafaf8', surface: '#ffffff', border: '#e3e6ea', line: '#eceef0',
  text: '#0d0f11', muted: '#4b535c', faint: '#8a9199',
  dark: '#0f1113', darkAccent: '#6bcb77', darkText: '#e8ecef',
};
const FONT = "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const BODY = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const head = (title, w, h, extra = '') => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap">
  <style>
    body { margin: 0; background: ${C.bg}; color: ${C.text}; font-family: ${BODY}; }
    a { color: ${C.accent || '#2e7d32'}; text-decoration: none; }
    a:hover { color: #1f5c24; text-decoration: underline; }
    .eyebrow { font-family: ${FONT}; font-weight: 600; font-size: 12px; letter-spacing: 0.16em;
               text-transform: uppercase; color: ${C.faint}; }
    .rule { height: 1px; background: ${C.border}; }
    ${extra}
  </style>
</helmet>`;

const foot = (props) => `</x-dc>
<script data-dc-script data-props='${props}'>
class Component extends DCLogic {
  renderVals() {
    return { accent: this.props.accent ?? '#2e7d32' };
  }
}
</script>
</body>
</html>
`;

const PROPS = JSON.stringify({
  accent: { editor: 'color', default: '#2e7d32',
            options: ['#2e7d32', '#0d0f11', '#b4531f', '#1f5f6b'] },
  $preview: { width: 600, height: 1060 },
}).replace(/'/g, '&#39;');

/* ---------- per-concept artboard ---------------------------------- */
function conceptBoard(m) {
  const ladder = [48, 32, 24, 20, 16].map((px, i) => `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
          <div style="height: 48px; display: flex; align-items: center;">${glyph(m, `${m.id}-l${i}`, px)}</div>
          <span style="font-size: 11px; color: ${C.faint}; font-family: ${BODY};">${px}</span>
        </div>`).join('');

  const body = `
<div style="width: 600px; height: 1060px; background: ${C.bg}; padding: 44px; display: flex;
            flex-direction: column; gap: 26px; box-sizing: border-box;">

  <div style="display: flex; flex-direction: column; gap: 10px;">
    <span class="eyebrow">Direction ${m.n}</span>
    <h1 style="margin: 0; font-family: ${FONT}; font-weight: 700; font-size: 38px;
               letter-spacing: -0.02em; line-height: 1.05; color: ${C.text};">${m.name}</h1>
    <p style="margin: 0; font-size: 15px; line-height: 1.55; color: ${C.muted};
              max-width: 46ch; text-wrap: pretty;">${m.idea}</p>
  </div>

  <div style="background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 16px;
              padding: 34px; display: flex; align-items: center; justify-content: center;
              color: {{accent}};">
    ${glyph(m, `${m.id}-hero`, 232)}
  </div>

  <div style="display: flex; flex-direction: column; gap: 14px;">
    <span class="eyebrow">Legibility ladder</span>
    <div style="background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 14px;
                padding: 20px 24px; display: flex; align-items: flex-end; justify-content: space-between;
                color: {{accent}};">${ladder}
    </div>
  </div>

  <div style="display: flex; gap: 16px;">
    <div style="flex-grow: 1; background: ${C.dark}; border-radius: 14px; padding: 20px 24px;
                display: flex; align-items: center; gap: 20px; color: ${C.darkAccent};">
      ${glyph(m, `${m.id}-d1`, 44)}${glyph(m, `${m.id}-d2`, 22)}
      <span style="font-size: 11px; color: #7f878f; font-family: ${BODY}; margin-left: auto;">Dark UI</span>
    </div>
  </div>

  <div style="display: flex; flex-direction: column; gap: 14px;">
    <span class="eyebrow">Lockup</span>
    <div style="background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 14px;
                padding: 20px 24px; display: flex; align-items: center; gap: 16px;">
      <span style="display: flex; color: {{accent}};">${glyph(m, `${m.id}-lock`, 40)}</span>
      <span style="font-family: ${FONT}; font-weight: 700; font-size: 26px; letter-spacing: -0.02em;
                   color: ${C.text};">Bring2Bring!</span>
    </div>
  </div>

  <div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px;
              border-top: 1px solid ${C.border}; padding-top: 18px;">
    <span class="eyebrow">Trade-off</span>
    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: ${C.muted};
              max-width: 50ch; text-wrap: pretty;">${m.trade}</p>
  </div>
</div>`;
  return head(m.name, 600, 1060) + body + foot(PROPS);
}

/* ---------- overview artboard ------------------------------------- */
function mainBoard() {
  const cards = MARKS.map(m => `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <div style="background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 16px;
                  height: 232px; display: flex; align-items: center; justify-content: center;
                  color: {{accent}};">${glyph(m, `ov-${m.id}`, 156)}</div>
      <div style="display: flex; flex-direction: column; gap: 6px; min-height: 92px;">
        <span style="font-family: ${FONT}; font-weight: 700; font-size: 17px; color: ${C.text};
                     letter-spacing: -0.01em;">${m.n} &nbsp;${m.name}</span>
        <span style="font-size: 13px; line-height: 1.5; color: ${C.muted}; text-wrap: pretty;">${m.trade}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 14px; padding-top: 2px; color: {{accent}};">
        ${glyph(m, `ov-${m.id}-a`, 24)}${glyph(m, `ov-${m.id}-b`, 20)}${glyph(m, `ov-${m.id}-c`, 16)}
      </div>
    </div>`).join('');

  const body = `
<div style="width: 1320px; height: 700px; background: ${C.bg}; padding: 52px 56px; display: flex;
            flex-direction: column; gap: 34px; box-sizing: border-box;">
  <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 40px;">
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <span class="eyebrow">Bring2Bring! &nbsp;·&nbsp; Logo directions</span>
      <h1 style="margin: 0; font-family: ${FONT}; font-weight: 700; font-size: 44px;
                 letter-spacing: -0.025em; line-height: 1.02; color: ${C.text};">Two B&rsquo;s, one shared 2</h1>
    </div>
    <p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${C.muted}; max-width: 44ch;
              text-wrap: pretty;">Every mark is built the same way: two bold geometric B&rsquo;s are
       overlapped into a single form, and the channel they leave between them is cut as the
       number 2. Nothing is drawn twice &mdash; the 2 only exists as the letters&rsquo; negative space.</p>
  </div>
  <div class="rule"></div>
  <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 28px;">
    ${cards}
  </div>
</div>`;
  return head('Logo directions', 1320, 700) + body
    + foot(JSON.stringify({
        accent: { editor: 'color', default: '#2e7d32',
                  options: ['#2e7d32', '#0d0f11', '#b4531f', '#1f5f6b'] },
        $preview: { width: 1320, height: 700 },
      }).replace(/'/g, '&#39;'));
}

writeFileSync('Main.dc.html', mainBoard());
for (const m of MARKS) writeFileSync(`${m.name}.dc.html`, conceptBoard(m));

const canvas = {
  artboards: [
    { file: 'Main.dc.html', x: 0, y: 0, w: 1320, h: 700 },
    ...MARKS.map((m, i) => ({ file: `${m.name}.dc.html`, x: i * 680, y: 840, w: 600, h: 1060 })),
  ],
  launch: { view: 'canvas' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', ['Main', ...MARKS.map(m => m.name)].join(', '));
