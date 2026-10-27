// Воздуходувка: струя воздуха гонит листья от игрока. Чистый модуль без three.js — его же
// использует замер скорости (tools/blower-sim.mjs) и тесты.
//
// Струя начинается чуть перед игроком и тянется на «дальность» (растёт с мощностью); у сопла
// она шириной «Ширина потока» и расширяется к концу. Лист в струе едет от игрока со скоростью,
// которая падает к концу струи, — так листья собираются валом на её краю, и вал можно гнать дальше.
// «Точность» — разброс направления: чем меньше, тем ровнее вал. Мощность задаёт и разгон: после
// нажатия струя набирает силу за 0,6–0,2 с. Лист, прижатый струёй к забору или стене, скользит вдоль
// него. Лист, путь которого проходит над приёмником, продаётся.

import { BLOWER, BLOWER_STREAM as S } from './config.js';
import { segmentBlocked } from './layout.js';

/** Характеристики воздуходувки при уровнях веток {width, power, accuracy}. */
export function blowerStats(lv) {
  const B = BLOWER.branches;
  const power = B.power.values[lv.power];
  return {
    width: B.width.values[lv.width],
    power,
    startup: B.power.startup[lv.power],
    spread: B.accuracy.values[lv.accuracy],
    range: S.range0 + S.rangeK * (power - 1500) / 900,
    speed: S.speed * power / 1500,
  };
}

/** Расстояние от точки до отрезка в плоскости XZ. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/**
 * Один такт струи (dt с). p — {x, z, yaw}; spin — разгон 0…1; inlets — работающие приёмники.
 * Двигает листья в field и возвращает { moved: [{i, fx, fz}], absorbed: [{inlet, ids, from}], box }.
 * Поглощённые листья остаются ON_GROUND — продаёт их экономика (sellDirect).
 */
export function blowTick(field, p, st, spin, dt, inlets, rng = Math.random) {
  const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
  const rx = -dz, rz = dx;
  const a0 = S.start, a1 = S.start + st.range;
  const halfAt = (a) => st.width / 2 + (a - a0) * S.spreadK;
  const mid = (a0 + a1) / 2;
  const cand = field.leavesNear(p.x + dx * mid, p.z + dz * mid, st.range / 2 + halfAt(a1) + 0.05);
  const hit = [];
  for (const i of cand) {
    const ox = field.x[i] - p.x, oz = field.z[i] - p.z;
    const a = ox * dx + oz * dz, l = ox * rx + oz * rz;
    if (a < a0 || a > a1) continue;
    const h = halfAt(a);
    if (Math.abs(l) > h) continue;
    hit.push([a, l, h, i]);
  }
  // ближние к соплу — первыми; за такт двигается не больше cap листьев
  hit.sort((u, v) => u[0] - v[0]);
  if (hit.length > S.cap) hit.length = S.cap;
  const moved = [], absorbedBy = new Map();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [a, l, h, i] of hit) {
    const u = (a - a0) / st.range;                      // 0 у сопла … 1 на краю струи
    const side = 1 - 0.5 * (l / h) ** 2;                 // по краям струи слабее
    const v = st.speed * spin * Math.pow(1 - u, 0.8) * side * (0.75 + rng() * 0.5);
    if (v < 0.02) continue;
    // направление: от игрока, с разбросом и лёгким расхождением к краям струи
    const ang = (rng() - 0.5) * st.spread + (l / h) * st.spread * 0.35;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const mx = (dx * ca + rx * sa) * v * dt, mz = (dz * ca + rz * sa) * v * dt;
    const fx = field.x[i], fz = field.z[i];
    let tx = fx + mx, tz = fz + mz;
    if (segmentBlocked(fx, 0.04, fz, tx, 0.04, tz)) {
      // упёрся в забор, стену, бортик — скользит вдоль него (препятствия выровнены по осям)
      const along = Math.abs(mx) > Math.abs(mz) ? [[fx + mx, fz], [fx, fz + mz]] : [[fx, fz + mz], [fx + mx, fz]];
      const ok = along.find(([x, z]) => !segmentBlocked(fx, 0.04, fz, x, 0.04, z));
      if (!ok) continue;
      [tx, tz] = ok;
    }
    minX = Math.min(minX, fx, tx); maxX = Math.max(maxX, fx, tx);
    minZ = Math.min(minZ, fz, tz); maxZ = Math.max(maxZ, fz, tz);
    const n = inlets.find((q) => segDist(q.x, q.z, fx, fz, tx, tz) < q.r);
    if (n) {
      if (!absorbedBy.has(n)) absorbedBy.set(n, { inlet: n, ids: [], from: [] });
      const g = absorbedBy.get(n);
      g.ids.push(i); g.from.push({ i, fx, fz });
      continue;
    }
    field.moveTo(i, tx, tz);
    field.yaw[i] += (rng() - 0.5) * v * dt * 6;          // лист поворачивается на лету
    moved.push({ i, fx, fz });
  }
  if (moved.length) field.version++;
  return { moved, absorbed: [...absorbedBy.values()], box: [minX, minZ, maxX, maxZ] };
}
