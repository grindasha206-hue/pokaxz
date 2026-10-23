// Планировка первого участка: препятствия, поверхности, точки интереса.
// Чистый модуль: им пользуются и отрисовка, и логика, и тесты в node.

import { ZONE, usd } from './config.js';

export const SPAWN = { x: 0, z: 6.1, yaw: 0 }; // yaw 0 — взгляд на дом (−Z)

export const CONTAINER = { x: 2.3, z: 2.7, w: 1.3, d: 1.0, h: 1.05 };
export const SHOP = { x: -2.3, z: 2.9, w: 1.2, d: 0.75, h: 0.82 };

export const TREE = { x: -4.4, z: -3.4, r: 0.3 };

export const PORCH = { x0: -2.4, x1: 2.4, z0: ZONE.minZ, z1: -7.25, h: 0.22 };
export const PORCH_STEP = { x0: -1.2, x1: 1.2, z0: -7.25, z1: -6.9, h: 0.11 };

export const PATH = { x0: -0.7, x1: 0.7, z0: PORCH_STEP.z1, z1: ZONE.maxZ };

// Ворота в следующую часть двора (сад) — в восточном заборе.
export const GARDEN_GATE = { x: ZONE.maxX, z0: -2.6, z1: -1.0 };

const box = (id, x0, x1, z0, z1, y1, extra = {}) => ({ id, kind: 'box', x0, x1, z0, z1, y0: 0, y1, ...extra });
const circle = (id, x, z, r, y1, extra = {}) => ({ id, kind: 'circle', x, z, r, y0: 0, y1, ...extra });

export const T = 0.08; // полутолщина забора
// высокий дощатый забор: с уровня глаз (1,62 м) за ним не видно пустого поля
export const FENCE_H = 1.85;

export const OBSTACLES = [
  // дом закрывает северную сторону целиком
  box('house', -6.5, 6.5, ZONE.minZ - 7, ZONE.minZ, 6.5),
  // забор
  box('fence-n-w', ZONE.minX - T, -6.5, ZONE.minZ - T, ZONE.minZ + T, FENCE_H),
  box('fence-n-e', 6.5, ZONE.maxX + T, ZONE.minZ - T, ZONE.minZ + T, FENCE_H),
  box('fence-w', ZONE.minX - T, ZONE.minX + T, ZONE.minZ, ZONE.maxZ, FENCE_H),
  box('fence-e', ZONE.maxX - T, ZONE.maxX + T, ZONE.minZ, ZONE.maxZ, FENCE_H),
  box('fence-s', ZONE.minX, ZONE.maxX, ZONE.maxZ - T, ZONE.maxZ + T, FENCE_H),
  // предметы двора
  box('container', CONTAINER.x - CONTAINER.w / 2, CONTAINER.x + CONTAINER.w / 2,
    CONTAINER.z - CONTAINER.d / 2, CONTAINER.z + CONTAINER.d / 2, CONTAINER.h),
  box('shop', SHOP.x - SHOP.w / 2, SHOP.x + SHOP.w / 2,
    SHOP.z - SHOP.d / 2, SHOP.z + SHOP.d / 2, SHOP.h),
  circle('tree', TREE.x, TREE.z, TREE.r, 8),
  box('bench', 5.05, 5.65, -5.5, -3.7, 0.9),
  box('wheelbarrow', 5.0, 5.75, 0.5, 2.0, 0.75),
  box('bed', ZONE.minX + T, -6.7, -0.6, 2.8, 0.32),
  circle('barrel', -5.95, -8.35, 0.42, 0.95),
  circle('birdbath', -4.4, 4.2, 0.32, 0.85),
  circle('pumpkin-1', -3.0, -7.9, 0.27, 0.36),
  circle('pumpkin-2', -3.55, -7.35, 0.2, 0.28),
  circle('pumpkin-3', 3.05, -7.85, 0.3, 0.4),
  circle('pot-1', -2.05, -8.55, 0.2, 0.7),
  circle('pot-2', 2.05, -8.55, 0.2, 0.7),
  circle('post-1', -2.25, -7.42, 0.09, 2.6),
  circle('post-2', 2.25, -7.42, 0.09, 2.6),
];

// ── уровни ──────────────────────────────────────────────────
// Уровень описывает границы, препятствия, поверхности и раскладку листьев.
// Все функции ниже работают с текущим уровнем (setLevel).

function yardSurface(x, z) {
  if (inRect(x, z, PORCH)) return PORCH.h;
  if (inRect(x, z, PORCH_STEP)) return PORCH_STEP.h;
  return 0;
}

// Плотность листьев во дворе: сумма мягких скоплений (у забора и дома, под деревом,
// «наносы» ветра) с плавным спадом к редким листьям. Без резких границ и ровного ковра.
function yardDensity(x, z, noise, drift) {
  const toFence = Math.min(x - ZONE.minX, ZONE.maxX - x, ZONE.maxZ - z, z - ZONE.minZ);
  let d = 0.02;
  d += 1.3 * Math.exp(-((toFence / 0.8) ** 2));                     // у забора и дома
  const toTree = Math.hypot(x - TREE.x, z - TREE.z);
  d += 2.4 * Math.exp(-((toTree / 2.2) ** 2));                       // под деревом
  for (const [cx, cz, r] of drift) d += 2.2 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
  d *= 0.45 + noise(x * 0.5, z * 0.5);                               // неровные края скоплений
  d = d ** 3.4;                                                      // скопления гуще, промежутки чище
  if (onPath(x, z)) d *= 0.3;                                        // на дорожке реже
  if (yardSurface(x, z) > 0.15) d *= 0.7;                            // крыльцо
  const toContainer = Math.hypot(x - CONTAINER.x, z - CONTAINER.z);
  if (toContainer < 1.2) d *= 0.4;
  return d;
}

export const YARD = {
  id: 'yard',
  name: 'Двор',
  leafCount: ZONE.leafCount,
  zone: ZONE,
  // награды зоны (как в Leaf it Alone): выдаются один раз и сохраняются
  rewards: [
    { id: 'yard-50', at: 0.5, leafBonus: 1, text: 'цена листа +25 %' },
    { id: 'yard-100', at: 1, leafBonus: 0, text: 'открыт сад — ворота в восточном заборе' },
  ],
  // переходы в другие зоны: точка у ворот (F) и условие открытия
  gates: [{ to: 'garden', x: ZONE.maxX - 0.45, z: (GARDEN_GATE.z0 + GARDEN_GATE.z1) / 2, requires: 'yard-100',
    locked: 'Сад откроется, когда двор будет убран полностью' }],
  inlets: [],
  inset: T,
  obstacles: OBSTACLES,
  spawn: SPAWN,
  container: CONTAINER,
  shop: SHOP,
  surface: yardSurface,
  onPath: (x, z) => inRect(x, z, PATH) || inRect(x, z, PORCH_STEP),
  density: yardDensity,
  maxDensity: 30,
  drifts: 10,
  starter: { x: 0.9, z: 3.3, r: 0.9, count: 60 },
  leafMargin: 0.08,
  leafSize: 1.12,
};

// ── фрагмент земли: проверка ковра из листьев и подбора ─────
const FZ = { id: 'fragment', name: 'Фрагмент', leafCount: 11000, minX: -3, maxX: 3, minZ: -3, maxZ: 3 };

// плиты дорожки: центр, радиус, поворот — дуга с юго-запада на северо-восток
export const FRAGMENT_STONES = (() => {
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 11; k++) {
    const t = k / 10;
    const x = -3.2 + t * 6.4, z = 2.0 - t * 4.2 + Math.sin(t * Math.PI) * 1.0;
    for (const off of [-0.32, 0.3]) {
      const nx = 0.55, nz = 0.83;
      out.push({ x: x + nx * off + (rnd() - 0.5) * 0.1, z: z + nz * off + (rnd() - 0.5) * 0.1, r: 0.2 + rnd() * 0.08, a: rnd() * 6.28, seed: k * 2 + (off > 0 ? 1 : 0) });
    }
  }
  return out;
})();

export const FRAGMENT_WALL = { x0: FZ.minX - 0.3, x1: FZ.maxX + 0.3, z0: FZ.minZ - 0.35, z1: FZ.minZ, h: 0.55 };
export const FRAGMENT_FENCE = { x0: FZ.maxX, x1: FZ.maxX + 0.1, z0: FZ.minZ, z1: FZ.maxZ, h: 1.15 };
const FRAGMENT_CONTAINER = { x: 2.15, z: 2.35, w: 1.3, d: 1.0, h: 1.05 };

const FRAGMENT_OBSTACLES = [
  box('wall', FRAGMENT_WALL.x0, FRAGMENT_WALL.x1, FRAGMENT_WALL.z0, FRAGMENT_WALL.z1, FRAGMENT_WALL.h),
  box('fence-e', FRAGMENT_FENCE.x0, FRAGMENT_FENCE.x1, FRAGMENT_FENCE.z0, FRAGMENT_FENCE.z1, FRAGMENT_FENCE.h),
  box('container', FRAGMENT_CONTAINER.x - 0.65, FRAGMENT_CONTAINER.x + 0.65, FRAGMENT_CONTAINER.z - 0.5, FRAGMENT_CONTAINER.z + 0.5, 1.05),
];

export const STONE_TOP = 0.014; // плиты чуть выше газона

function onStone(x, z) {
  for (const s of FRAGMENT_STONES) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return true;
  return false;
}

function fragmentDensity(x, z, noise, drift) {
  let d = 1.6;
  const toWall = z - FZ.minZ, toFence = FZ.maxX - x;
  d += 2.2 * Math.max(0, 1 - toWall / 1.4) ** 1.4;                   // нанос у каменной стенки
  d += 1.6 * Math.max(0, 1 - toFence / 1.1) ** 1.4;                  // и у забора
  for (const [cx, cz, r] of drift) d += 1.4 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
  const n = noise(x * 0.55, z * 0.55);
  d *= 0.25 + 1.5 * Math.max(0, n - 0.12);                           // проплешины травы
  if (onStone(x, z)) d *= 0.35;                                      // на плитах реже
  if (Math.hypot(x - FRAGMENT_CONTAINER.x, z - FRAGMENT_CONTAINER.z) < 1.0) d *= 0.5;
  return d;
}

export const FRAGMENT = {
  id: FZ.id,
  name: FZ.name,
  leafCount: FZ.leafCount,
  zone: FZ,
  rewards: [{ id: 'fragment-50', at: 0.5, leafBonus: 1, text: 'цена листа +25 %' }],
  gates: [],
  inlets: [],
  inset: 0,
  obstacles: FRAGMENT_OBSTACLES,
  spawn: { x: -2.2, z: 2.4, yaw: -0.7 },
  container: FRAGMENT_CONTAINER,
  shop: null,
  surface: (x, z) => (onStone(x, z) ? STONE_TOP : 0),
  onPath: onStone,
  density: fragmentDensity,
  maxDensity: 4.4,
  drifts: 5,
  starter: null,
  leafMargin: 0.06,
  leafSize: 1,
};

// ── зона 2: сад за восточным забором ───────────────────────
// Здесь покупаются и долго используются грабли: листья лежат плотным ковром (≈45 % площади),
// их сгребают в приёмники. Двор к этому моменту убран полностью.
export const GZ = { id: 'garden', name: 'Сад', leafCount: 12000, minX: ZONE.maxX, maxX: 18, minZ: ZONE.minZ, maxZ: 1 };
export const GARDEN = (() => {
  const gate = (GARDEN_GATE.z0 + GARDEN_GATE.z1) / 2;
  const container = { x: GZ.minX + 0.62, z: -4.6, w: 1.3, d: 1.0, h: 1.05, rotY: Math.PI / 2 }; // табличкой на восток
  const shed = { x0: 15.2, x1: GZ.maxX - T, z0: GZ.minZ + T, z1: -6.6, h: 2.45 };
  const tree = { x: 14.6, z: -2.2, r: 0.3 };
  const bed = { x0: 11.6, x1: 14.0, z0: -6.6, z1: -5.6, h: 0.3 };
  const bushes = [[9.15, -8.2, 0.48], [10.45, -8.35, 0.42]];
  // приёмники: решётка в земле; листья, попавшие в круг, продаются по текущей цене (цены — из таблицы)
  const inlets = [
    { id: 'garden-a', name: 'Приёмник у дорожки', x: 12.2, z: -0.9, r: 0.42, price: usd(0) },
    { id: 'garden-b', name: 'Приёмник у сарая', x: 16.6, z: -4.3, r: 0.42, price: usd(3) },
  ];
  const obstacles = [
    box('fence-w', GZ.minX - T, GZ.minX + T, GZ.minZ, GZ.maxZ, FENCE_H),
    box('fence-n', GZ.minX, GZ.maxX + T, GZ.minZ - T, GZ.minZ + T, FENCE_H),
    box('fence-e', GZ.maxX - T, GZ.maxX + T, GZ.minZ, GZ.maxZ, FENCE_H),
    box('fence-s', GZ.minX, GZ.maxX + T, GZ.maxZ - T, GZ.maxZ + T, FENCE_H),
    box('container', container.x - container.d / 2, container.x + container.d / 2, container.z - container.w / 2, container.z + container.w / 2, container.h),
    box('shed', shed.x0, shed.x1, shed.z0, shed.z1, shed.h),
    circle('tree', tree.x, tree.z, tree.r, 8),
    box('bed', bed.x0, bed.x1, bed.z0, bed.z1, bed.h),
    ...bushes.map(([x, z, r], k) => circle(`bush-${k}`, x, z, r, 1.0)),
  ];
  // плотные ковры: у заборов, под деревом и несколько «наносов»; приёмники и подход к контейнеру — чище
  const density = (x, z, noise, drift) => {
    const toFence = Math.min(x - GZ.minX, GZ.maxX - x, GZ.maxZ - z, z - GZ.minZ);
    let d = 0.03;
    d += 1.6 * Math.exp(-((toFence / 1.1) ** 2));
    d += 2.6 * Math.exp(-((Math.hypot(x - tree.x, z - tree.z) / 2.4) ** 2));
    for (const [cx, cz, r] of drift) d += 2.4 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r * 1.6));
    d *= 0.5 + noise(x * 0.6, z * 0.6);
    d = d ** 2;
    for (const i of inlets) if (Math.hypot(x - i.x, z - i.z) < i.r + 0.5) d *= 0.05;
    if (Math.hypot(x - container.x, z - container.z) < 1.4) d *= 0.3;
    if (Math.hypot(x - GZ.minX, z - gate) < 1.2) d *= 0.3;
    return d;
  };
  return {
    id: GZ.id, name: GZ.name, leafCount: GZ.leafCount, zone: GZ,
    rewards: [
      { id: 'garden-50', at: 0.5, leafBonus: 1, text: 'цена листа +25 %' },
      { id: 'garden-100', at: 1, leafBonus: 0, text: 'площадка у гаража откроется в следующей версии' },
    ],
    gates: [
      { to: 'yard', x: GZ.minX + 0.45, z: gate, requires: null },
      { to: null, x: 13.3, z: GZ.maxZ - 0.45, requires: 'garden-100', locked: 'Площадка у гаража — в следующей версии' },
    ],
    inset: 0,
    obstacles,
    spawn: { x: GZ.minX + 0.9, z: gate, yaw: -Math.PI / 2 },
    container, shop: null, shed, tree, bed, bushes, inlets,
    surface: () => 0,
    onPath: () => false,
    density,
    maxDensity: 14,
    drifts: 7,
    starter: null,
    leafMargin: 0.08,
    leafSize: 1.12,
  };
})();
// где появляется игрок, входя в зону из другой (у ворот)
export const ARRIVALS = {
  'yard>garden': GARDEN.spawn,
  'garden>yard': { x: ZONE.maxX - 0.9, z: (GARDEN_GATE.z0 + GARDEN_GATE.z1) / 2, yaw: Math.PI / 2 },
};

export const LEVELS = { yard: YARD, garden: GARDEN, fragment: FRAGMENT };
/** Зоны игры по порядку (фрагмент — отдельный режим проверки, не зона). */
export const ZONE_ORDER = ['yard', 'garden'];

export let level = YARD;
export function setLevel(l) { level = typeof l === 'string' ? LEVELS[l] : l; }

/** Высота поверхности (земля, крыльцо, ступенька) в точке. */
export function surfaceHeight(x, z) {
  return level.surface(x, z);
}

export function onPath(x, z) {
  return level.onPath(x, z);
}

function inRect(x, z, r) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Расстояние от точки до препятствия в плоскости XZ (0 — внутри). */
export function distToObstacle(x, z, o) {
  if (o.kind === 'circle') return Math.max(0, Math.hypot(x - o.x, z - o.z) - o.r);
  const dx = Math.max(o.x0 - x, 0, x - o.x1);
  const dz = Math.max(o.z0 - z, 0, z - o.z1);
  return Math.hypot(dx, dz);
}

/** Свободна ли точка с отступом margin от всех препятствий и границ участка. */
export function isFree(x, z, margin) {
  const Z = level.zone, t = level.inset;
  if (x < Z.minX + t + margin || x > Z.maxX - t - margin) return false;
  if (z < Z.minZ + t + margin || z > Z.maxZ - t - margin) return false;
  for (const o of level.obstacles) if (distToObstacle(x, z, o) < margin) return false;
  return true;
}

/**
 * Выталкивает круг радиуса r из препятствий и удерживает внутри участка.
 * Возвращает новую позицию {x, z}.
 */
export function resolveCircle(x, z, r) {
  const Z = level.zone, t = level.inset;
  for (let iter = 0; iter < 3; iter++) {
    for (const o of level.obstacles) {
      if (o.kind === 'circle') {
        const dx = x - o.x, dz = z - o.z;
        const d = Math.hypot(dx, dz), min = o.r + r;
        if (d < min) {
          const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
          x = o.x + nx * min; z = o.z + nz * min;
        }
      } else {
        const cx = Math.min(Math.max(x, o.x0), o.x1);
        const cz = Math.min(Math.max(z, o.z0), o.z1);
        const dx = x - cx, dz = z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-6) {
            x = cx + (dx / d) * r; z = cz + (dz / d) * r;
          } else {
            // центр внутри прямоугольника — выталкиваем по кратчайшей оси
            const pushes = [
              [o.x0 - r - x, 0], [o.x1 + r - x, 0], [0, o.z0 - r - z], [0, o.z1 + r - z],
            ].sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
            x += pushes[0][0]; z += pushes[0][1];
          }
        }
      }
    }
    // границы с учётом толщины забора, чтобы зажим не возвращал круг в забор
    x = Math.min(Math.max(x, Z.minX + t + r), Z.maxX - t - r);
    z = Math.min(Math.max(z, Z.minZ + t + r), Z.maxZ - t - r);
  }
  if (isFree(x, z, r - 1e-6)) return { x, z };
  // зажато между препятствиями — ищем ближайшее свободное место по спирали
  return findFree(x, z, r);
}

export function findFree(x, z, r) {
  for (let ring = 1; ring < 200; ring++) {
    const rad = ring * 0.05, steps = 8 + ring * 2;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
      if (isFree(px, pz, r)) return { x: px, z: pz };
    }
  }
  return { x: 0, z: 0 };
}

/** Пересекает ли отрезок a→b (3D) какое-либо препятствие. */
export function segmentBlocked(ax, ay, az, bx, by, bz, ignore = null) {
  for (const o of level.obstacles) {
    if (o === ignore) continue;
    if (o.kind === 'box') {
      if (segBox(ax, ay, az, bx, by, bz, o)) return true;
    } else if (segCylinder(ax, ay, az, bx, by, bz, o)) return true;
  }
  return false;
}

function segBox(ax, ay, az, bx, by, bz, o) {
  let t0 = 0, t1 = 1;
  const a = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
  const lo = [o.x0, o.y0, o.z0], hi = [o.x1, o.y1, o.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (a[i] < lo[i] || a[i] > hi[i]) return false;
    } else {
      let ta = (lo[i] - a[i]) / d[i], tb = (hi[i] - a[i]) / d[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function segCylinder(ax, ay, az, bx, by, bz, o) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - o.x, fz = az - o.z;
  const A = dx * dx + dz * dz;
  const B = 2 * (fx * dx + fz * dz);
  const C = fx * fx + fz * fz - o.r * o.r;
  let t0, t1;
  if (A < 1e-9) {
    if (C > 0) return false;
    t0 = 0; t1 = 1;
  } else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return false;
    const s = Math.sqrt(disc);
    t0 = Math.max(0, (-B - s) / (2 * A));
    t1 = Math.min(1, (-B + s) / (2 * A));
    if (t0 > t1) return false;
  }
  const y0 = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1;
  return Math.max(y0, y1) >= o.y0 && Math.min(y0, y1) <= o.y1;
}

/** Может ли игрок встать в точке (центр капсулы). */
export function isWalkable(x, z, radius) {
  return isFree(x, z, radius);
}
