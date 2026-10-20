// Процедурные текстуры на canvas: трава, дорожка, штукатурка, дерево.

import * as THREE from '../../vendor/three.module.min.js';
import { mulberry32 } from '../leaves.js';

export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(c, { repeat = 1, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/**
 * Спокойный газон: крупные мягкие переходы оттенков и едва заметные штрихи травинок.
 * Без контрастного шума, который на расстоянии рябит и повторяется.
 */
export function paintGrass(ctx, x, y, w, h, seed, scale = 1) {
  const rng = mulberry32(seed);
  ctx.fillStyle = '#7a8d4f';
  ctx.fillRect(x, y, w, h);
  const blobs = Math.floor((w * h) / (2600 * scale));
  for (let i = 0; i < blobs; i++) {
    const px = x + rng() * w, py = y + rng() * h, r = (20 + rng() * 60) * scale;
    const tone = rng();
    const c = tone < 0.4 ? [108, 128, 70] : tone < 0.75 ? [134, 146, 84] : [118, 120, 72];
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(${c},0.22)`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
  const strokes = Math.floor((w * h) / (40 * scale));
  ctx.lineWidth = Math.max(1, scale);
  for (const [col, part] of [['rgba(150,166,96,0.16)', 0.5], ['rgba(94,112,60,0.16)', 0.5]]) {
    ctx.strokeStyle = col;
    ctx.beginPath();
    for (let i = 0; i < strokes * part; i++) {
      const px = x + rng() * w, py = y + rng() * h, l = (2 + rng() * 3) * scale;
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.2;
      ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    }
    ctx.stroke();
  }
}

/** Доска забора: продольные волокна и пара сучков. */
export function boardTexture() {
  const c = canvas(128, 1024), ctx = c.getContext('2d'), rng = mulberry32(31);
  ctx.fillStyle = '#a77b52'; ctx.fillRect(0, 0, 128, 1024);
  for (let i = 0; i < 90; i++) {
    const x = rng() * 128;
    ctx.strokeStyle = `rgba(${rng() < 0.5 ? '90,58,34' : '196,154,108'},${0.12 + rng() * 0.2})`;
    ctx.lineWidth = 0.6 + rng() * 2.2;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 64) ctx.lineTo(x + Math.sin(y * 0.01 + i) * 3, y);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = 20 + rng() * 88, y = 100 + rng() * 820;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
    g.addColorStop(0, 'rgba(70,40,20,0.7)'); g.addColorStop(1, 'rgba(70,40,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 10, y - 14, 20, 28);
  }
  // тёмные кромки доски
  ctx.fillStyle = 'rgba(60,36,20,0.35)';
  ctx.fillRect(0, 0, 4, 1024); ctx.fillRect(124, 0, 4, 1024);
  return toTexture(c);
}

/** Кора: вертикальные трещины и пятна. */
export function barkTexture() {
  const c = canvas(256), ctx = c.getContext('2d'), rng = mulberry32(13);
  ctx.fillStyle = '#6a5444'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = rng() * 256;
    ctx.strokeStyle = `rgba(${rng() < 0.6 ? '40,30,24' : '140,120,100'},${0.25 + rng() * 0.3})`;
    ctx.lineWidth = 1 + rng() * 3;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 32) ctx.lineTo(x + (rng() - 0.5) * 8, y);
    ctx.stroke();
  }
  const t = toTexture(c);
  t.repeat.set(2, 1);
  return t;
}

export function grassTexture(seed = 3, size = 512, repeat = 1) {
  const c = canvas(size);
  paintGrass(c.getContext('2d'), 0, 0, size, size, seed);
  return toTexture(c, { repeat });
}

export function plasterTexture() {
  const c = canvas(256), ctx = c.getContext('2d'), rng = mulberry32(11);
  ctx.fillStyle = '#efe6d6'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const g = 200 + rng() * 40;
    ctx.fillStyle = `rgba(${g},${g - 8},${g - 22},0.18)`;
    ctx.fillRect(rng() * 256, rng() * 256, 1 + rng() * 3, 1 + rng() * 3);
  }
  return toTexture(c);
}

export function woodTexture(base = '#a8794b', seed = 5, planks = 4) {
  const c = canvas(256), ctx = c.getContext('2d'), rng = mulberry32(seed);
  const bh = 256 / planks;
  for (let p = 0; p < planks; p++) {
    const tint = (rng() - 0.5) * 18;
    ctx.fillStyle = shade(base, tint);
    ctx.fillRect(0, p * bh, 256, bh);
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = `rgba(70,40,20,${0.06 + rng() * 0.08})`;
      ctx.lineWidth = 1;
      const y = p * bh + rng() * bh;
      ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(85, y + (rng() - 0.5) * 6, 170, y + (rng() - 0.5) * 6, 256, y + (rng() - 0.5) * 4);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60,35,18,0.35)';
    ctx.fillRect(0, p * bh, 256, 2);
  }
  return toTexture(c);
}

export function roofTexture() {
  const c = canvas(256), ctx = c.getContext('2d'), rng = mulberry32(17);
  ctx.fillStyle = '#8c4a3a'; ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 9; col++) {
      const x = col * 32 - (row % 2) * 16, y = row * 32;
      ctx.fillStyle = shade('#9a5443', (rng() - 0.5) * 24);
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, 30, 30, [0, 0, 10, 10]);
      ctx.fill();
      ctx.fillStyle = 'rgba(40,15,10,0.25)';
      ctx.fillRect(x + 1, y + 28, 30, 3);
    }
  }
  return toTexture(c);
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 255) + amt), b = clamp((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Мягкое круглое свечение (для подсветки оставшихся листьев). */
export function glowTexture() {
  const c = canvas(64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,248,220,1)');
  g.addColorStop(0.35, 'rgba(255,226,150,0.55)');
  g.addColorStop(1, 'rgba(255,210,120,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/** Табличка с надписью. */
export function signTexture(lines, { w = 512, h = 256, bg = '#f4ead2', fg = '#5a3b22', font = 'Caveat', size = 96 } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sizes = lines.map((_, i) => (i === 0 ? size : size * 0.6));
  const total = sizes.reduce((a, b) => a + b * 1.08, 0);
  let y = h / 2 - total / 2;
  lines.forEach((line, i) => {
    const s = sizes[i];
    ctx.font = `700 ${s}px ${font}, "Marker Felt", "Comic Sans MS", sans-serif`;
    // уменьшаем строку, если не помещается по ширине
    const wpx = ctx.measureText(line).width;
    if (wpx > w * 0.92) ctx.font = `700 ${s * (w * 0.92) / wpx}px ${font}, "Marker Felt", sans-serif`;
    ctx.fillText(line, w / 2, y + s * 0.54);
    y += s * 1.08;
  });
  return toTexture(c);
}
