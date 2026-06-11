#!/usr/bin/env node
// Fork the OpenFreeMap dark style and desaturate it into the BlindSpot
// "intelligence basemap": muted land, near-black water, low-contrast roads,
// restrained labels (BRIEF §12). Tiles/glyphs/sprites stay on OpenFreeMap
// (keyless, commercial-OK, attribution required — kept in the style).
import { writeFileSync, mkdirSync } from 'node:fs';

const SRC = 'https://tiles.openfreemap.org/styles/dark';
const OUT = new URL('../public/basemap/blindspot-dark.json', import.meta.url);

const style = await (await fetch(SRC)).json();

// --- color utilities ------------------------------------------------------
function parseColor(s) {
  if (typeof s !== 'string') return null;
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1, fmt: 'hex' };
  }
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1, fmt: 'hex' };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4], fmt: 'rgb' };
  m = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const { r, g, b } = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    return { r, g, b, a: m[4] === undefined ? 1 : +m[4], fmt: 'hsl' };
  }
  return null;
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

// Desaturate; do NOT darken what is already dark (land must stay readable
// against the near-black water), and clamp highlights so labels stay calm.
function transmute(color) {
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
  const s2 = s * 0.4;
  // dark surfaces keep (or gain a hair of) lightness; mids ease down; brights cap
  const l2 = l < 0.18 ? l + 0.02 : l < 0.5 ? l * 0.95 : Math.min(l, 0.78);
  const { r, g, b } = hslToRgb(h, s2, l2);
  const hex = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return color.a === 1
    ? `#${hex(r)}${hex(g)}${hex(b)}`
    : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${color.a})`;
}

function walk(node) {
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === 'object')
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
  const c = parseColor(node);
  return c ? transmute(c) : node;
}

// Transform only layer paint/layout (not sources/glyphs/sprite URLs).
style.name = 'BlindSpot Dark';
style.layers = style.layers.map((layer) => ({
  ...layer,
  paint: layer.paint ? walk(layer.paint) : layer.paint,
  layout: layer.layout ? walk(layer.layout) : layer.layout,
}));

// Targeted overrides. At low zoom the background IS the land plane, so it must
// sit visibly above near-black water (BRIEF §12: muted land, near-black water).
for (const layer of style.layers) {
  if (layer.type === 'background') layer.paint = { ...layer.paint, 'background-color': '#131820' };
  if (layer.id?.includes('water') && layer.type === 'fill')
    layer.paint = { ...layer.paint, 'fill-color': '#05080a' };
}

mkdirSync(new URL('../public/basemap/', import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify(style));
console.log(`wrote public/basemap/blindspot-dark.json (${style.layers.length} layers)`);
