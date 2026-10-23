// Грабли: один взмах сдвигает листья к игроку. Чистый модуль без three.js — его же
// использует симуляция скорости уборки (tools/zone-plan.mjs) и тесты.
//
// Голова граблей ставится перед игроком (в точку взгляда, но не дальше 0,65 длины черенка)
// и протягивается к нему на dist метров (по таблице «Длина черенка»). Листья в полосе шириной
// «Ширина захвата» от точки чуть дальше головы до конца протяжки сгребаются в валик перед зубьями.
// Доля листьев, которые идут за граблями, — «Цепкость»; остальные сдвигаются меньше.
// Лист, путь которого проходит над приёмником, проваливается в него и продаётся.

import { RAKE, RAKE_STROKE } from './config.js';
import { level, segmentBlocked } from './layout.js';

/** Характеристики граблей при уровнях веток {handle, sweep, sticky}. */
export function rakeStats(lv) {
  const B = RAKE.branches;
  return {
    handle: B.handle.values[lv.handle],
    dist: B.handle.dist[lv.handle],
    width: 2 * B.sweep.values[lv.sweep], // в таблице — радиус граблей
    sticky: B.sticky.values[lv.sticky],
  };
}

/**
 * Где окажется голова граблей: расстояние от игрока до начала и конца протяжки.
 * aimDist — расстояние до точки взгляда на земле (Infinity, если взгляд выше горизонта).
 */
export function strokeSpan(stats, aimDist) {
  const max = stats.handle * RAKE_STROKE.reachK;
  const start = Math.max(RAKE_STROKE.minStart, Math.min(max, aimDist));
  return { start, end: start - stats.dist };
}

/** Расстояние от точки до отрезка в плоскости XZ. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/**
 * Взмах. p — {x, z, yaw} игрока; span — strokeSpan(); inlets — работающие приёмники.
 * Двигает листья в field (moveTo) и возвращает
 * { moved: [{i, fx, fz}], absorbed: [{inlet, ids, from: [{i, fx, fz}]}], box: [minX, minZ, maxX, maxZ] }.
 * Поглощённые листья остаются ON_GROUND — продаёт их экономика (sellDirect).
 */
export function rakeStroke(field, p, stats, span, inlets, rng = Math.random) {
  const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw); // взгляд
  const rx = -dz, rz = dx;                              // вправо
  const { start, end } = span;
  const half = stats.width / 2;
  const cx = p.x + dx * (start + end) / 2, cz = p.z + dz * (start + end) / 2;
  const R = (start - end) / 2 + RAKE_STROKE.reach + half + 0.05;
  const cand = field.leavesNear(cx, cz, R);
  const grabbed = [];
  for (const i of cand) {
    const ox = field.x[i] - p.x, oz = field.z[i] - p.z;
    const a = ox * dx + oz * dz, l = ox * rx + oz * rz;
    if (Math.abs(l) > half || a < end || a > start + RAKE_STROKE.reach) continue;
    grabbed.push([a, l, i]);
  }
  // валик тащит ограниченное число листьев: ближние к зубьям (дальние от игрока) — первыми
  grabbed.sort((u, v) => v[0] - u[0]);
  if (grabbed.length > RAKE_STROKE.carry) grabbed.length = RAKE_STROKE.carry;

  const moved = [], absorbedBy = new Map();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [a, l, i] of grabbed) {
    let na, nl;
    if (rng() < stats.sticky) {
      // в валик перед зубьями, чуть сжимаясь к середине
      na = end - 0.02 - rng() * RAKE_STROKE.back;
      nl = l * 0.85 + (rng() - 0.5) * 0.05;
    } else {
      // проскользнул между зубьями: сдвинулся, но меньше
      na = a - (a - end) * rng() * 0.6;
      nl = l + (rng() - 0.5) * 0.04;
    }
    const fx = field.x[i], fz = field.z[i];
    const tx = p.x + dx * na + rx * nl, tz = p.z + dz * na + rz * nl;
    // сквозь забор, сарай и стволы листья не протаскиваются
    if (segmentBlocked(fx, 0.04, fz, tx, 0.04, tz)) continue;
    const hit = inlets.find((n) => segDist(n.x, n.z, fx, fz, tx, tz) < n.r);
    minX = Math.min(minX, fx, tx); maxX = Math.max(maxX, fx, tx);
    minZ = Math.min(minZ, fz, tz); maxZ = Math.max(maxZ, fz, tz);
    if (hit) {
      if (!absorbedBy.has(hit)) absorbedBy.set(hit, { inlet: hit, ids: [], from: [] });
      const g = absorbedBy.get(hit);
      g.ids.push(i); g.from.push({ i, fx, fz });
      continue;
    }
    field.moveTo(i, tx, tz);
    field.yaw[i] += (rng() - 0.5) * 0.6;
    moved.push({ i, fx, fz });
  }
  if (moved.length) field.version++;
  return { moved, absorbed: [...absorbedBy.values()], box: [minX, minZ, maxX, maxZ] };
}

/** Приёмники зоны, которые работают при таком прогрессе. */
export function activeInlets(progress, lvl = level) {
  return (lvl.inlets ?? []).filter((n) => n.price === 0 || progress.inlets?.includes(n.id));
}
