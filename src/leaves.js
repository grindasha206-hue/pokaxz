// Поле листьев: генерация, состояния, поиск соседей, сдвиг.
// Чистый модуль без three.js.

import { GRAB_RADIUS } from './config.js';
import { level, isFree, resolveCircle, segmentBlocked, surfaceHeight } from './layout.js';

export const ON_GROUND = 0;
export const IN_BAG = 1;
export const SOLD = 2;

export const SHAPES = 6;        // виды листьев — клетки атласа текстур
export const PALETTE_SIZE = 4;  // лёгкие сдвиги оттенка

// доли видов: больше жёлтых и охристых, меньше бурых и медных
const SPECIES_WEIGHTS = [0.22, 0.17, 0.2, 0.11, 0.19, 0.11];
function pickSpecies(r) {
  for (let k = 0; k < SPECIES_WEIGHTS.length; k++) { r -= SPECIES_WEIGHTS[k]; if (r <= 0) return k; }
  return SPECIES_WEIGHTS.length - 1;
}

// Размер листа на земле при scale = 1 (м) и радиус, в котором листья считаются лежащими друг на друге.
export const LEAF_EXTENT = 0.16;
const STACK_R = 0.075;

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

// Центры «наносов» — плотных скоплений, которые намёл ветер.
function drifts(rng, n) {
  const Z = level.zone, out = [];
  for (let k = 0; k < n; k++) {
    out.push([Z.minX + 1 + rng() * (Z.maxX - Z.minX - 2), Z.minZ + 1 + rng() * (Z.maxZ - Z.minZ - 2), 0.8 + rng() * 0.9]);
  }
  return out;
}

export class LeafField {
  constructor(count) {
    this.count = count;
    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.yaw = new Float32Array(count);
    this.tiltX = new Float32Array(count);
    this.tiltZ = new Float32Array(count);
    this.lift = new Float32Array(count);   // высота над поверхностью: на земле или на листьях под ним
    this.flat = new Float32Array(count).fill(1); // множитель наклона: без опоры лист ложится плашмя
    this.scale = new Float32Array(count);
    this.shape = new Uint8Array(count);
    this.bend = new Uint8Array(count);
    this.color = new Uint8Array(count);
    this.state = new Uint8Array(count);
    this.version = 0; // увеличивается при любом изменении состояния/позиции
    this.grid = null; // пространственная сетка для поиска лежащих друг на друге листьев
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

  /** Сдвигает лежащий лист (для будущих граблей и воздуходувки); лист не попадает в препятствие. */
  nudge(i, dx, dz) {
    if (this.state[i] !== ON_GROUND) return;
    const p = resolveCircle(this.x[i] + dx, this.z[i] + dz, level.leafMargin);
    this.x[i] = p.x; this.z[i] = p.z;
    this.grid = null;
    this.version++;
  }

  // ── укладка: лист лежит на земле или на листьях, которые под ним ──────────
  // Высота слоя не хранится в сохранении: она всегда выводится из того,
  // какие листья лежат ниже. Поэтому после сбора нижних верхние опускаются.

  buildGrid() {
    const cell = STACK_R;
    const g = new Map();
    for (let i = 0; i < this.count; i++) {
      const key = Math.floor(this.x[i] / cell) * 65536 + Math.floor(this.z[i] / cell);
      let arr = g.get(key);
      if (!arr) g.set(key, (arr = []));
      arr.push(i);
    }
    this.grid = g;
  }

  /** Листья, перекрывающиеся с листом i (по центрам, в радиусе STACK_R). */
  neighbours(i, out = []) {
    if (!this.grid) this.buildGrid();
    out.length = 0;
    const cx = Math.floor(this.x[i] / STACK_R), cz = Math.floor(this.z[i] / STACK_R);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.grid.get((cx + dx) * 65536 + (cz + dz));
        if (!arr) continue;
        for (const j of arr) {
          if (j === i) continue;
          const ddx = this.x[j] - this.x[i], ddz = this.z[j] - this.z[i];
          if (ddx * ddx + ddz * ddz < STACK_R * STACK_R) out.push(j);
        }
      }
    }
    return out;
  }

  /**
   * Пересчитывает высоту листа i: на 4,5 мм выше самого высокого лежащего под ним
   * (с меньшим индексом) листа, но не ниже, чем нужно, чтобы наклонённый край не ушёл в землю.
   */
  settle(i, tmp = []) {
    let below = -1;
    for (const j of this.neighbours(i, tmp)) {
      if (j < i && this.state[j] === ON_GROUND && this.lift[j] > below) below = this.lift[j];
    }
    // без опоры лист ложится почти плашмя (до 3°), на других листьях — с исходным наклоном
    const tilt0 = Math.max(Math.abs(this.tiltX[i]), Math.abs(this.tiltZ[i]));
    this.flat[i] = below < 0 && tilt0 > 0.05 ? 0.05 / tilt0 : 1;
    const tilt = tilt0 * this.flat[i];
    const edge = 0.5 * LEAF_EXTENT * this.scale[i] * Math.sin(tilt);
    const base = below < 0 ? 0.0025 : below + 0.0045;
    this.lift[i] = Math.min(0.08, Math.max(base, edge + 0.0015));
  }

  settleAll() {
    const tmp = [];
    for (let i = 0; i < this.count; i++) this.settle(i, tmp);
    this.version++;
  }

  /** После сбора: опускает листья, лежавшие на собранных. Возвращает изменённые индексы. */
  settleAfter(removed) {
    const changed = new Set(), tmp = [], queue = [...removed];
    while (queue.length) {
      const r = queue.pop();
      for (const j of [...this.neighbours(r, tmp)]) {
        if (j <= r || this.state[j] !== ON_GROUND) continue;
        const before = this.lift[j];
        this.settle(j);
        if (Math.abs(this.lift[j] - before) > 1e-5) {
          changed.add(j);
          queue.push(j); // лежащие на нём тоже опускаются
        }
      }
    }
    if (changed.size) this.version++;
    return [...changed];
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
      const sx = data.pos[i * 3] / 1000 || 0, sz = data.pos[i * 3 + 1] / 1000 || 0, syaw = data.pos[i * 3 + 2] / 1000 || 0;
      // позиция не менялась (сохранение округляет до мм) — оставляем точную, чтобы укладка совпала
      if (Math.abs(sx - this.x[i]) < 0.0015 && Math.abs(sz - this.z[i]) < 0.0015 && Math.abs(syaw - this.yaw[i]) < 0.0015) continue;
      // даже испорченная позиция не уводит лист в недоступное место
      const p = resolveCircle(sx, sz, level.leafMargin);
      this.x[i] = p.x; this.z[i] = p.z;
      this.yaw[i] = syaw;
    }
    this.grid = null;
    this.settleAll();
    return true;
  }
}

export function generateLeaves(seed, count) {
  const L = level, Z = L.zone, M = L.leafMargin;
  const rng = mulberry32(seed);
  const noise = valueNoise(seed);
  const f = new LeafField(count);
  const drift = drifts(rng, L.drifts);
  let i = 0;
  const place = (x, z) => {
    f.x[i] = x; f.z[i] = z;
    f.yaw[i] = rng() * Math.PI * 2;
    // наклон: у лежащих на земле почти нет, у лежащих на других — больше (см. ниже)
    f.tiltX[i] = (rng() - 0.5) * 2;
    f.tiltZ[i] = (rng() - 0.5) * 2;
    f.scale[i] = 0.82 + rng() * 0.36; // ±18 % по размеру
    f.shape[i] = pickSpecies(rng());
    f.bend[i] = Math.floor(rng() * 256);
    f.color[i] = Math.floor(rng() * PALETTE_SIZE);
    f.state[i] = ON_GROUND;
    i++;
  };
  const c = L.starter;
  let guard = 0;
  while (c && i < Math.min(c.count, count) && guard++ < 100000) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * c.r;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (isFree(x, z, M)) place(x, z);
  }
  guard = 0;
  while (i < count && guard++ < 5000000) {
    const x = Z.minX + rng() * (Z.maxX - Z.minX);
    const z = Z.minZ + rng() * (Z.maxZ - Z.minZ);
    if (!isFree(x, z, M)) continue;
    const d = L.density(x, z, noise, drift);
    if (rng() * L.maxDensity > d) continue;
    place(x, z);
  }
  if (i < count) throw new Error(`leaf generation: placed ${i} of ${count}`);
  // наклон зависит от того, на чём лист лежит: на земле — до 3°, на других листьях — до 12°
  const tmp = [];
  for (let k = 0; k < count; k++) {
    let under = 0;
    for (const j of f.neighbours(k, tmp)) if (j < k) under++;
    const amp = 0.05 + 0.16 * Math.min(1, under / 3);
    f.tiltX[k] *= amp; f.tiltZ[k] *= amp;
  }
  f.settleAll();
  return f;
}
