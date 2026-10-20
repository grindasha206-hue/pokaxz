// Поле листьев: генерация, состояния, поиск соседей, сдвиг.
// Чистый модуль без three.js.

import { ZONE, GRAB_RADIUS } from './config.js';
import { CONTAINER, TREE, isFree, onPath, resolveCircle, segmentBlocked, surfaceHeight } from './layout.js';

export const ON_GROUND = 0;
export const IN_BAG = 1;
export const SOLD = 2;

export const SHAPES = 3;        // клён, берёза, дуб
export const PALETTE_SIZE = 7;  // см. view: золотой, охра, оранжевый, ...

// Минимальный отступ листа от препятствий и забора.
export const LEAF_MARGIN = 0.14;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed) {
  const hash = (ix, iz) => {
    let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

// Первые листья — между стартом и контейнером.
export const STARTER_CLUSTER = { x: 0.9, z: 3.3, r: 1.1, count: 28 };

// Центры «наносов» — плотных скоплений, которые намёл ветер.
function drifts(rng) {
  const out = [];
  for (let k = 0; k < 7; k++) {
    out.push([ZONE.minX + 1 + rng() * (ZONE.maxX - ZONE.minX - 2), ZONE.minZ + 1.5 + rng() * (ZONE.maxZ - ZONE.minZ - 3), 0.8 + rng() * 0.9]);
  }
  return out;
}

function density(x, z, noise, drift) {
  const toFence = Math.min(x - ZONE.minX, ZONE.maxX - x, ZONE.maxZ - z, z - ZONE.minZ);
  let d = 0.06;
  d += 2.4 * Math.max(0, 1 - toFence / 1.5) ** 1.5;                 // вдоль забора и дома
  const toTree = Math.hypot(x - TREE.x, z - TREE.z);
  d += 3.2 * Math.max(0, 1 - toTree / 4.6) ** 1.2;                   // под деревом
  for (const [cx, cz, r] of drift) d += 2.6 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
  const n = noise(x * 0.38, z * 0.38);
  d *= Math.max(0, n - 0.22) * 2.6;                                  // пятна и чистые промежутки
  if (onPath(x, z)) d *= 0.22;                                       // на дорожке — редкие листья
  if (surfaceHeight(x, z) > 0.15) d *= 0.7;                          // крыльцо
  const toContainer = Math.hypot(x - CONTAINER.x, z - CONTAINER.z);
  if (toContainer < 1.2) d *= 0.4;
  return d;
}

export class LeafField {
  constructor(count) {
    this.count = count;
    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.yaw = new Float32Array(count);
    this.tiltX = new Float32Array(count);
    this.tiltZ = new Float32Array(count);
    this.lift = new Float32Array(count);   // смещение над поверхностью (слоистость, без мерцания)
    this.scale = new Float32Array(count);
    this.shape = new Uint8Array(count);
    this.bend = new Uint8Array(count);
    this.color = new Uint8Array(count);
    this.state = new Uint8Array(count);
    this.version = 0; // увеличивается при любом изменении состояния/позиции
  }

  y(i) {
    return surfaceHeight(this.x[i], this.z[i]) + this.lift[i];
  }

  countState(s) {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.state[i] === s) n++;
    return n;
  }

  /**
   * Ближайшие лежащие листья вокруг выбранного (включая его самого), не дальше GRAB_RADIUS
   * и без препятствий между ними. Возвращает не более limit индексов, выбранный — первым.
   */
  gatherAround(target, limit) {
    if (limit <= 0 || this.state[target] !== ON_GROUND) return [];
    const out = [target];
    if (limit === 1) return out;
    const tx = this.x[target], tz = this.z[target];
    const cand = [];
    for (let i = 0; i < this.count; i++) {
      if (i === target || this.state[i] !== ON_GROUND) continue;
      const d = Math.hypot(this.x[i] - tx, this.z[i] - tz);
      if (d <= GRAB_RADIUS) cand.push([d, i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const ty = this.y(target) + 0.05;
    for (const [, i] of cand) {
      if (out.length >= limit) break;
      if (segmentBlocked(tx, ty, tz, this.x[i], this.y(i) + 0.05, this.z[i])) continue;
      out.push(i);
    }
    return out;
  }

  /** Сдвигает лежащий лист; лист никогда не попадает в препятствие или за забор. */
  nudge(i, dx, dz) {
    if (this.state[i] !== ON_GROUND) return;
    const p = resolveCircle(this.x[i] + dx, this.z[i] + dz, LEAF_MARGIN);
    this.x[i] = p.x; this.z[i] = p.z;
    this.version++;
  }

  serialize() {
    const pos = new Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      pos[i * 3] = Math.round(this.x[i] * 1000);
      pos[i * 3 + 1] = Math.round(this.z[i] * 1000);
      pos[i * 3 + 2] = Math.round(this.yaw[i] * 1000);
    }
    return { state: Array.from(this.state).join(''), pos };
  }

  /** Восстанавливает состояние и позиции. Возвращает false, если данные не подходят. */
  restore(data) {
    if (!data || typeof data.state !== 'string' || data.state.length !== this.count) return false;
    if (!Array.isArray(data.pos) || data.pos.length !== this.count * 3) return false;
    for (let i = 0; i < this.count; i++) {
      const s = data.state.charCodeAt(i) - 48;
      if (s !== ON_GROUND && s !== IN_BAG && s !== SOLD) return false;
    }
    for (let i = 0; i < this.count; i++) {
      this.state[i] = data.state.charCodeAt(i) - 48;
      // даже испорченная позиция не уводит лист в недоступное место
      const p = resolveCircle(data.pos[i * 3] / 1000 || 0, data.pos[i * 3 + 1] / 1000 || 0, LEAF_MARGIN);
      this.x[i] = p.x; this.z[i] = p.z;
      this.yaw[i] = data.pos[i * 3 + 2] / 1000 || 0;
    }
    this.version++;
    return true;
  }
}

export function generateLeaves(seed, count) {
  const rng = mulberry32(seed);
  const noise = valueNoise(seed);
  const f = new LeafField(count);
  const maxD = 4.2;
  const drift = drifts(rng);
  let i = 0;
  const place = (x, z) => {
    f.x[i] = x; f.z[i] = z;
    f.yaw[i] = rng() * Math.PI * 2;
    f.tiltX[i] = (rng() - 0.5) * 0.22;
    f.tiltZ[i] = (rng() - 0.5) * 0.22;
    f.lift[i] = 0.012 + (i % 23) * 0.0016 + rng() * 0.001;
    f.scale[i] = 0.75 + rng() * 0.55;
    f.shape[i] = Math.floor(rng() * SHAPES);
    f.bend[i] = rng() < 0.5 ? 0 : 1;
    // ближе к дереву больше клёна, на дорожке — светлые
    f.color[i] = Math.floor(rng() * PALETTE_SIZE);
    f.state[i] = ON_GROUND;
    i++;
  };
  const c = STARTER_CLUSTER;
  let guard = 0;
  while (i < Math.min(c.count, count) && guard++ < 100000) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * c.r;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (isFree(x, z, LEAF_MARGIN)) place(x, z);
  }
  guard = 0;
  while (i < count && guard++ < 2000000) {
    const x = ZONE.minX + rng() * (ZONE.maxX - ZONE.minX);
    const z = ZONE.minZ + rng() * (ZONE.maxZ - ZONE.minZ);
    if (!isFree(x, z, LEAF_MARGIN)) continue;
    if (rng() * maxD > density(x, z, noise, drift)) continue;
    place(x, z);
  }
  if (i < count) throw new Error(`leaf generation: placed ${i} of ${count}`);
  return f;
}
