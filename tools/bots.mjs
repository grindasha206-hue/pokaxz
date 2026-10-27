// Боты для замера скорости уборки на коде игры: рука, грабли, воздуходувка.
// Используются в tools/rake-sim.mjs, tools/blower-sim.mjs и tools/zone-plan.mjs.
//
// Бот уборки инструментом выбирает самый дальний (по пути в обход препятствий, см. flow.mjs) лист
// и гонит его к приёмнику, пока лист не провалится. По пути он сгребает и всё, что лежит рядом.
//  • грабли: игрок встаёт со стороны приёмника и тянет лист к себе взмахами, отступая следом;
//  • воздуходувка: игрок встаёт за листом и держит кнопку, идя следом за валом.
// Если встать негде (забор, угол) или лист не продвигается — лист откладывается до следующего
// этапа. Последний этап — рука: сбор в мешок с походами к контейнеру.
// Время: ходьба PLAYER.walkSpeed, взмах RAKE_STROKE.time, такт струи BLOWER_STREAM.tick и разгон,
// подбор рукой — 0,35 с прицела + время подбора по ловкости.

import { PLAYER, UPGRADES, RAKE_STROKE, BLOWER_STREAM, RAKE, BLOWER } from '../src/config.js';
import { setLevel, level, isFree } from '../src/layout.js';
import { createGame } from '../src/game.js';
import { ON_GROUND, mulberry32 } from '../src/leaves.js';
import { rakeStats, strokeSpan, rakeStroke, activeInlets } from '../src/rake.js';
import { blowerStats, blowTick } from '../src/blower.js';
import { buildFlow } from './flow.mjs';

const AIM = 0.35, REACH_H = 2.2, DT = BLOWER_STREAM.tick;
const B = (T) => Object.fromEntries(Object.entries(T.branches).map(([k, b]) => [k, b.prices.length]));
export const RAKE_MAX = B(RAKE), BLOWER_MAX = B(BLOWER);
export const RAKE_NONE = { handle: 0, sweep: 0, sticky: 0 }, BLOWER_NONE = { width: 0, power: 0, accuracy: 0 };

/**
 * Прогон уборки зоны. phases — по порядку: 'blower', 'rake', 'hand'.
 * inlets: 'all' — все приёмники зоны, 'first' — только первый (самый дешёвый), 'none'.
 */
export function simulate({ zone, phases = ['rake', 'hand'], rake = RAKE_NONE, blower = BLOWER_NONE, hand = 'max', inlets = 'all', seed = 1 }) {
  setLevel(zone);
  const g = createGame();
  const { field: f, economy: e } = g;
  const max = (b) => UPGRADES[b].prices.length;
  e.progress.upgrades = hand === 'max' ? { grab: max('grab'), speed: max('speed'), bag: max('bag') } : { grab: 0, speed: 0, bag: 0 };
  e.progress.tools.rake = { ...rake };
  e.progress.tools.blower = { ...blower };
  e.progress.inlets = inlets === 'all' ? (level.inlets ?? []).map((n) => n.id) : [];
  const ins = inlets === 'none' ? [] : inlets === 'first' ? (level.inlets ?? []).slice(0, 1) : activeInlets(e.progress);
  const flow = ins.length ? buildFlow(ins) : null;
  const rng = mulberry32(seed);
  const p = { x: level.spawn.x, z: level.spawn.z, yaw: 0 };
  const out = { count: f.count, t: 0, phases: {} };
  let t = 0, spin = 0;
  const walkTo = (x, z, stop = 0) => {
    const d = Math.max(0, Math.hypot(x - p.x, z - p.z) - stop);
    const k = d / Math.max(1e-6, Math.hypot(x - p.x, z - p.z));
    t += d / PLAYER.walkSpeed;
    p.x += (x - p.x) * k; p.z += (z - p.z) * k;
    if (d > 1) spin = 0; // перешёл на новое место — кнопка воздуходувки отпущена
  };
  const sell = (r) => { let n = 0; for (const a of r.absorbed) n += e.sellDirect(a.ids); return n; };
  // направление к приёмнику и место, где встать (dist — от листа против направления), с обходом препятствий
  const stance = (i, dist, sign) => {
    let u = flow.dirAt(f.x[i], f.z[i]);
    if (!u) {
      const n = ins.reduce((a, q) => (Math.hypot(q.x - f.x[i], q.z - f.z[i]) < Math.hypot(a.x - f.x[i], a.z - f.z[i]) ? q : a));
      const l = Math.hypot(n.x - f.x[i], n.z - f.z[i]) || 1;
      u = [(n.x - f.x[i]) / l, (n.z - f.z[i]) / l];
    }
    for (const da of [0, 0.4, -0.4, 0.8, -0.8]) {
      const c = Math.cos(da), s = Math.sin(da), ux = u[0] * c - u[1] * s, uz = u[0] * s + u[1] * c;
      const px = f.x[i] + sign * ux * dist, pz = f.z[i] + sign * uz * dist;
      if (isFree(px, pz, PLAYER.radius)) return { u: [ux, uz], px, pz };
    }
    return null;
  };

  const drives = {
    rake(st, span) {
      return (i) => {
        let last = Infinity, stuck = 0;
        for (let k = 0; k < 60 && f.state[i] === ON_GROUND; k++) {
          const D = flow.distAt(f.x[i], f.z[i]);
          // голова граблей — чуть за листом, игрок — ближе к приёмнику, лицом к листу
          const s = stance(i, span.start - 0.05, +1);
          if (!s) return false;
          walkTo(s.px, s.pz);
          p.yaw = Math.atan2(s.u[0], s.u[1]);
          const r = rakeStroke(f, p, st, span, ins, rng);
          t += RAKE_STROKE.time;
          out.cur.actions++;
          out.cur.sold += sell(r);
          if (!r.moved.length && !r.absorbed.length) return false;
          if (D > last - 0.02) { if (++stuck > 3) return false; } else { stuck = 0; last = D; }
        }
        return f.state[i] !== ON_GROUND;
      };
    },
    blower(st) {
      const back = BLOWER_STREAM.start + st.range * 0.25; // вал держится перед игроком
      return (i) => {
        let last = Infinity, stuck = 0;
        for (let k = 0; k < 600 && f.state[i] === ON_GROUND; k++) {
          const D = flow.distAt(f.x[i], f.z[i]);
          const s = stance(i, back, -1);
          if (!s) return false;
          const step = Math.hypot(s.px - p.x, s.pz - p.z);
          if (step > 1) walkTo(s.px, s.pz);
          else { t += step / PLAYER.walkSpeed * 0.2; p.x = s.px; p.z = s.pz; } // идёт, не отпуская кнопку
          p.yaw = Math.atan2(-s.u[0], -s.u[1]);
          spin = Math.min(1, spin + DT / st.startup);
          const r = blowTick(f, p, st, spin, DT, ins, rng);
          t += DT;
          out.cur.actions++;
          out.cur.sold += sell(r);
          if (D > last - 0.01) { if (++stuck > 30) return false; } else { stuck = 0; last = D; }
        }
        return f.state[i] !== ON_GROUND;
      };
    },
  };

  for (const phase of phases) {
    const t0 = t;
    out.cur = out.phases[phase] = { actions: 0, sold: 0, time: 0, trips: 0, hand: 0 };
    if (phase === 'hand') {
      while (e.remaining > 0 || e.inBag > 0) {
        if (e.free === 0 || e.remaining === 0) { walkTo(level.container.x, level.container.z, 1.4); e.deposit(); out.cur.trips++; continue; }
        let best = -1, bd = Infinity;
        for (let i = 0; i < f.count; i++) {
          if (f.state[i] !== ON_GROUND) continue;
          const d = (f.x[i] - p.x) ** 2 + (f.z[i] - p.z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        walkTo(f.x[best], f.z[best], REACH_H);
        t += AIM + e.pickTime;
        out.cur.hand += e.collect(f.gatherAround(best, Math.min(e.grab, e.free))).length;
      }
    } else if (flow) {
      const drive = phase === 'rake'
        ? drives.rake(rakeStats(rake), strokeSpan(rakeStats(rake), Infinity))
        : drives.blower(blowerStats(blower));
      const skip = new Set();
      for (let guard = 0; e.remaining > 0 && guard < 100000; guard++) {
        // самый дальний лист по пути к приёмнику, с поправкой на то, как далеко до него идти
        let best = -1, bs = -Infinity;
        for (let i = 0; i < f.count; i++) {
          if (f.state[i] !== ON_GROUND || skip.has(i)) continue;
          const d = flow.distAt(f.x[i], f.z[i]);
          if (d === Infinity) { skip.add(i); continue; }
          const sc = d - 0.35 * Math.hypot(f.x[i] - p.x, f.z[i] - p.z);
          if (sc > bs) { bs = sc; best = i; }
        }
        if (best < 0) break;
        if (!drive(best)) skip.add(best);
      }
    }
    out.cur.time = t - t0;
  }
  delete out.cur;
  out.t = t;
  out.leafValue = e.leafValue;
  return out;
}

export const fmt = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Строка отчёта: время, скорость и вклад этапов. */
export function report(name, r) {
  const ph = Object.entries(r.phases).map(([k, v]) => k === 'hand'
    ? `рукой ${v.hand} за ${fmt(v.time)} (походов ${v.trips})`
    : `${{ rake: 'граблями', blower: 'воздуходувкой' }[k]} ${v.sold} за ${fmt(v.time)}`).join(', ');
  return `${name.padEnd(44)} ${fmt(r.t).padStart(6)}  ${(r.count / r.t).toFixed(1).padStart(5)} лист/с · ${ph}`;
}
