#!/usr/bin/env node
/**
 * Builds tools/PokerMaster.icns from nothing but a hand-written PDF.
 *
 * The icon is authored as vectors so every size in the .icns is rendered
 * sharp rather than resampled from one bitmap. PDF is the only vector format
 * `sips` reads, and its cross-reference table needs real byte offsets — which
 * is why this is a script and not a heredoc.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(TOOLS, 'build');

const SIZE = 1024;
/** macOS Big Sur geometry: an 824pt rounded square centred on a 1024pt canvas. */
const INSET = 100;
const RADIUS = 185.4;
const K = 0.5523;                       // circle-to-bezier constant

/** Straight from the table felt and the rail in public/css/style.css. */
const FELT = [[0.118, 0.447, 0.314], [0.082, 0.353, 0.239], [0.043, 0.212, 0.141]];
const GOLD = [0.847, 0.702, 0.369];
const INK = [0.933, 0.945, 0.965];

const n = (v) => (Math.round(v * 1000) / 1000).toString();
const rgb = (c) => c.map(n).join(' ');

/* ----------------------------- shapes ------------------------------ */

/** A rounded square as four arcs, drawn clockwise from the top-left corner. */
function roundedSquare(inset, radius) {
  const lo = inset;
  const hi = SIZE - inset;
  const r = radius;
  const c = r * K;
  return [
    `${n(lo)} ${n(hi - r)} m`,
    `${n(lo)} ${n(hi - r + c)} ${n(lo + r - c)} ${n(hi)} ${n(lo + r)} ${n(hi)} c`,
    `${n(hi - r)} ${n(hi)} l`,
    `${n(hi - r + c)} ${n(hi)} ${n(hi)} ${n(hi - r + c)} ${n(hi)} ${n(hi - r)} c`,
    `${n(hi)} ${n(lo + r)} l`,
    `${n(hi)} ${n(lo + r - c)} ${n(hi - r + c)} ${n(lo)} ${n(hi - r)} ${n(lo)} c`,
    `${n(lo + r)} ${n(lo)} l`,
    `${n(lo + r - c)} ${n(lo)} ${n(lo)} ${n(lo + r - c)} ${n(lo)} ${n(lo + r)} c`,
    'h',
  ].join('\n');
}

/**
 * The spade, authored in a 100x100 box with y pointing down — the way every
 * drawing program states it — and flipped on the way into PDF space.
 */
const SPADE_SCALE = 4.6;
const SPADE_X = SIZE / 2 - 50 * SPADE_SCALE;
const SPADE_Y = SIZE / 2 + 52 * SPADE_SCALE;   // the glyph's ink spans y 8..96

const px = (x) => n(SPADE_X + x * SPADE_SCALE);
const py = (y) => n(SPADE_Y - y * SPADE_SCALE);
const m = (x, y) => `${px(x)} ${py(y)} m`;
const l = (x, y) => `${px(x)} ${py(y)} l`;
const c = (...p) => `${px(p[0])} ${py(p[1])} ${px(p[2])} ${py(p[3])} ${px(p[4])} ${py(p[5])} c`;

/** An upended heart: the two lobes meet in a notch the stem grows out of. */
const SPADE_BODY = [
  m(50, 6),
  c(27, 28, 8, 46, 8, 60),
  c(8, 74, 19, 82, 31, 82),
  c(39, 82, 46, 77, 50, 68),
  c(54, 77, 61, 82, 69, 82),
  c(81, 82, 92, 74, 92, 60),
  c(92, 46, 73, 28, 50, 6),
  'h',
].join('\n');

/** Wide enough at the foot that the glyph reads as a spade, not a flipped heart. */
const SPADE_STEM = [
  m(50, 58),
  c(53, 76, 58, 90, 71, 97),
  l(29, 97),
  c(42, 90, 47, 76, 50, 58),
  'h',
].join('\n');

/* ------------------------------ the pdf ---------------------------- */

const content = `q
${roundedSquare(INSET, RADIUS)}
W n
/Sh0 sh
Q
q
${rgb(GOLD)} RG
9 w
${roundedSquare(INSET + 30, RADIUS - 26)}
S
Q
${rgb(INK)} rg
${SPADE_BODY}
f
${SPADE_STEM}
f
`;

/**
 * Three felt stops, brightest just above centre — the same light the table
 * gets from `radial-gradient(ellipse at 50% 34%, ...)`.
 */
const shading = `<< /ShadingType 3 /ColorSpace /DeviceRGB
     /Coords [${SIZE / 2} ${SIZE * 0.66} 0 ${SIZE / 2} ${SIZE * 0.66} ${SIZE * 0.62}]
     /Extend [true true]
     /Function << /FunctionType 3 /Domain [0 1] /Bounds [0.46] /Encode [0 1 0 1]
       /Functions [
         << /FunctionType 2 /Domain [0 1] /C0 [${rgb(FELT[0])}] /C1 [${rgb(FELT[1])}] /N 1 >>
         << /FunctionType 2 /Domain [0 1] /C0 [${rgb(FELT[1])}] /C1 [${rgb(FELT[2])}] /N 1 >>
       ] >> >>`;

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SIZE} ${SIZE}] /Contents 4 0 R
     /Resources << /Shading << /Sh0 ${shading} >> >> >>`,
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
];

function buildPdf() {
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return pdf;
}

/* ------------------------------- build ----------------------------- */

rmSync(BUILD, { recursive: true, force: true });
const iconset = path.join(BUILD, 'PokerMaster.iconset');
mkdirSync(iconset, { recursive: true });

const pdf = path.join(BUILD, 'icon.pdf');
writeFileSync(pdf, buildPdf(), 'latin1');

// The set Apple asks for: every size at 1x and 2x.
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  for (const [name, scale] of [[`${size}x${size}`, 1], [`${size / 2}x${size / 2}@2x`, 2]]) {
    if (scale === 2 && size === 16) continue;             // 8x8@2x is not a thing
    if (scale === 1 && size === 64) continue;             // nor is a plain 64
    execFileSync('sips', [
      '-s', 'format', 'png', pdf,
      '--resampleHeightWidth', String(size), String(size),
      '--out', path.join(iconset, `icon_${name}.png`),
    ], { stdio: 'ignore' });
  }
}

const icns = path.join(TOOLS, 'PokerMaster.icns');
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
console.log(`Icon written: ${icns}`);
