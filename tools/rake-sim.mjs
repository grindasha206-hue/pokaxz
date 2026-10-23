// Замер скорости граблей на коде игры: прогон уборки сада ботом.
// Запуск: node tools/rake-sim.mjs
//
// Бот повторяет то, что делает игрок: выбирает ближайший лежащий лист, встаёт так, чтобы приёмник
// оказался между листом и ним, и тянет кучу к себе взмахами, отступая после каждого на длину взмаха,
// пока куча не пройдёт над приёмником. Листья, к которым так не подойти (у заборов и в углах,
// откуда нельзя тянуть к приёмнику), сначала подтягиваются от препятствия; что осталось —
// собирается рукой в мешок с походами к контейнеру.
// Время: ходьба PLAYER.walkSpeed, взмах RAKE_STROKE.time, подбор рукой — по таблице ловкости + 0,35 с прицела.

import { PLAYER, RAKE, RAKE_STROKE, UPGRADES } from '../src/config.js';
import { setLevel, level, isFree } from '../src/layout.js';
import { createGame } from '../src/game.js';
import { ON_GROUND, mulberry32 } from '../src/leaves.js';
import { rakeStats, strokeSpan, rakeStroke, activeInlets } from '../src/rake.js';

const AIM = 0.35, REACH_H = 2.2;

export function simulateRake({ zone = 'garden', rake = { handle: 0, sweep: 0, sticky: 0 }, inlets = 'all', hand = 'max', seed = 1 } = {}) {
  setLevel(zone);
  const g = createGame();
  const { field: f, economy: e } = g;
  const max = (b) => UPGRADES[b].prices.length;
  e.progress.upgrades = hand === 'max' ? { grab: max('grab'), speed: max('speed'), bag: max('bag') } : { grab: 0, speed: 0, bag: 0 };
  e.progress.tools.rake = { ...rake };
  e.progress.inlets = inlets === 'all' ? (level.inlets ?? []).map((n) => n.id) : [];
  const ins = inlets === 'none' ? [] : activeInlets(e.progress);
  const st = rakeStats(rake), span = strokeSpan(st, Infinity);
  const rng = mulberry32(seed);
  const p = { x: level.spawn.x, z: level.spawn.z, yaw: 0 };
  let t = 0, strokes = 0, handLeaves = 0, rakeSold = 0, trips = 0;
  const walkTo = (x, z, stop = 0) => {
    const d = Math.max(0, Math.hypot(x - p.x, z - p.z) - stop);
    const k = d / Math.max(1e-6, Math.hypot(x - p.x, z - p.z));
    t += d / PLAYER.walkSpeed;
    p.x += (x - p.x) * k; p.z += (z - p.z) * k;
  };
  const nearestLeaf = (x, z, skip) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND || skip.has(i)) continue;
      const d = (f.x[i] - x) ** 2 + (f.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const skip = new Set(); // листья, которые граблями к приёмнику не подтянуть
  // одна «проводка» кучи от листа i к приёмнику
  const drive = (i) => {
    let tries = 0;
    while (f.state[i] === ON_GROUND && tries++ < 40) {
      const lx = f.x[i], lz = f.z[i];
      const inl = ins.reduce((a, n) => (Math.hypot(n.x - lx, n.z - lz) < Math.hypot(a.x - lx, a.z - lz) ? n : a));
      const D = Math.hypot(inl.x - lx, inl.z - lz);
      const ux = (inl.x - lx) / D, uz = (inl.z - lz) / D;
      // голова граблей — чуть за листом; игрок — на span.start ближе к приёмнику
      const hx = lx - ux * 0.05, hz = lz - uz * 0.05;
      const px = hx + ux * span.start, pz = hz + uz * span.start;
      if (!isFree(px, pz, PLAYER.radius)) return false;
      walkTo(px, pz);
      p.yaw = Math.atan2(ux, uz);
      const r = rakeStroke(f, p, st, span, ins, rng);
      t += RAKE_STROKE.time;
      strokes++;
      for (const a of r.absorbed) rakeSold += e.sellDirect(a.ids);
      if (!r.moved.length && !r.absorbed.length) return false;
    }
    return f.state[i] !== ON_GROUND;
  };
  // сначала самые дальние от приёмников листья: их проводка заодно сгребает всё по пути
  const farLeaf = () => {
    let best = -1, bs = -Infinity;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND || skip.has(i)) continue;
      let d = Infinity;
      for (const n of ins) d = Math.min(d, Math.hypot(n.x - f.x[i], n.z - f.z[i]));
      const s = d - 0.35 * Math.hypot(f.x[i] - p.x, f.z[i] - p.z);
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  };
  let guard = 0;
  while (e.remaining > 0 && guard++ < 200000) {
    const i = ins.length ? farLeaf() : nearestLeaf(p.x, p.z, skip);
    if (i < 0) break;
    if (!ins.length || !drive(i)) skip.add(i);
  }
  // остаток — рукой
  const handStart = t;
  while (e.remaining > 0 || e.inBag > 0) {
    if (e.free === 0 || e.remaining === 0) {
      walkTo(level.container.x, level.container.z, 1.4);
      e.deposit(); trips++;
      continue;
    }
    const i = nearestLeaf(p.x, p.z, new Set());
    walkTo(f.x[i], f.z[i], REACH_H);
    t += AIM + e.pickTime;
    const got = e.collect(f.gatherAround(i, Math.min(e.grab, e.free)));
    handLeaves += got.length;
  }
  return { t, strokes, rakeSold, handLeaves, handTime: t - handStart, trips, count: f.count, leafValue: e.leafValue };
}

// только при запуске напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const B = RAKE.branches, top = { handle: B.handle.prices.length, sweep: B.sweep.prices.length, sticky: B.sticky.prices.length };
  const runs = [
    ['рука на максимуме, без граблей', { inlets: 'none' }],
    ['грабли без улучшений, 1 приёмник', { inlets: 'free' }],
    ['грабли без улучшений, 2 приёмника', {}],
    ['грабли на максимуме, 2 приёмника', { rake: top }],
  ];
  console.log(`Сад: 12 000 листьев. Время уборки всей зоны (рука — с прокачкой на максимуме, мешок 500).\n`);
  for (const [name, o] of runs) {
    const r = simulateRake(o);
    console.log(`${name.padEnd(36)} ${fmt(r.t).padStart(6)}  ${(r.count / r.t).toFixed(1).padStart(5)} лист/с · ` +
      `взмахов ${r.strokes}, в приёмники ${r.rakeSold}, рукой ${r.handLeaves} (${fmt(r.handTime)}, походов ${r.trips})`);
  }
}
