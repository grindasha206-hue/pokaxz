// Карта путей к приёмникам для ботов-замеров: расстояние от каждой клетки 0,2 м до ближайшего
// приёмника в обход препятствий (Дейкстра по 8 соседям) и направление, куда гнать лист.
import { level, isFree } from '../src/layout.js';

export function buildFlow(inlets, cell = 0.2) {
  const Z = level.zone, margin = level.leafMargin;
  const nx = Math.ceil((Z.maxX - Z.minX) / cell), nz = Math.ceil((Z.maxZ - Z.minZ) / cell);
  const cx = (i) => Z.minX + (i + 0.5) * cell, cz = (k) => Z.minZ + (k + 0.5) * cell;
  const free = new Uint8Array(nx * nz), dist = new Float64Array(nx * nz).fill(Infinity);
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) free[i * nz + k] = isFree(cx(i), cz(k), margin) ? 1 : 0;
  // простая очередь с приоритетом (двоичная куча)
  const heap = [];
  const push = (d, id) => {
    heap.push([d, id]);
    for (let j = heap.length - 1; j > 0;) { const p = (j - 1) >> 1; if (heap[p][0] <= heap[j][0]) break; [heap[p], heap[j]] = [heap[j], heap[p]]; j = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let j = 0; ;) {
        const l = 2 * j + 1, r = l + 1; let m = j;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === j) break;
        [heap[m], heap[j]] = [heap[j], heap[m]]; j = m;
      }
    }
    return top;
  };
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    for (const n of inlets) if (Math.hypot(cx(i) - n.x, cz(k) - n.z) < n.r * 0.8) { dist[i * nz + k] = 0; push(0, i * nz + k); }
  }
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [d, id] = pop();
    if (d > dist[id]) continue;
    const i = Math.floor(id / nz), k = id % nz;
    for (const [di, dk] of steps) {
      const a = i + di, b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz || !free[a * nz + b]) continue;
      // по диагонали — только если оба соседа свободны (не срезаем углы препятствий)
      if (di && dk && (!free[a * nz + k] || !free[i * nz + b])) continue;
      const nd = d + cell * Math.hypot(di, dk);
      if (nd < dist[a * nz + b]) { dist[a * nz + b] = nd; push(nd, a * nz + b); }
    }
  }
  const cellOf = (x, z) => [Math.min(nx - 1, Math.max(0, Math.floor((x - Z.minX) / cell))), Math.min(nz - 1, Math.max(0, Math.floor((z - Z.minZ) / cell)))];
  /** Расстояние до приёмника по карте (Infinity — не добраться). */
  const distAt = (x, z) => {
    const [i, k] = cellOf(x, z);
    let best = dist[i * nz + k];
    if (best === Infinity) for (const [di, dk] of steps) {
      const a = i + di, b = k + dk;
      if (a >= 0 && b >= 0 && a < nx && b < nz) best = Math.min(best, dist[a * nz + b] + cell);
    }
    return best;
  };
  /** Куда гнать лист: единичный вектор к соседней клетке с наименьшим расстоянием (сглаженный). */
  const dirAt = (x, z) => {
    let gx = 0, gz = 0;
    const d0 = distAt(x, z);
    for (const [di, dk] of steps) {
      const d = distAt(x + di * cell * 1.5, z + dk * cell * 1.5);
      if (d < d0) { const w = (d0 - d) / Math.hypot(di, dk); gx += di * w; gz += dk * w; }
    }
    const l = Math.hypot(gx, gz);
    return l > 1e-6 ? [gx / l, gz / l] : null;
  };
  return { distAt, dirAt };
}
