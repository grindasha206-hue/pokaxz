// Проверка экономики участка: симулирует уборку двора при разных порядках покупок.
// Запуск: node tools/economy-sim.mjs
//
// Модель времени грубая, но одинаковая для всех стратегий:
// подход к листу пешком, прицеливание 0,35 с, подбор по таблице скорости,
// поход к контейнеру и обратно.

import { PLAYER, UPGRADES, BRANCHES, formatMoney } from '../src/config.js';
import { createGame } from '../src/game.js';
import { CONTAINER, YARD } from '../src/layout.js';
import { ON_GROUND, mulberry32 } from '../src/leaves.js';
import { spentOn } from '../src/economy.js';

const AIM = 0.35;
const REACH_H = 2.2; // горизонтальная дальность подбора с учётом роста

function simulate(strategy, seed = 1) {
  const g = createGame();
  const { economy: e, field: f } = g;
  let px = g.player.x, pz = g.player.z, t = 0;
  const log = { firstDeposit: null, firstBuy: null, buys: [], trips: 0 };
  const rng = mulberry32(seed);

  const walkTo = (x, z, stop) => {
    const d = Math.max(0, Math.hypot(x - px, z - pz) - stop);
    t += d / PLAYER.walkSpeed;
    const k = d / Math.max(1e-6, Math.hypot(x - px, z - pz));
    px += (x - px) * k; pz += (z - pz) * k;
  };

  while (e.remaining > 0 || e.inBag > 0) {
    if (e.free === 0 || e.remaining === 0) {
      walkTo(CONTAINER.x, CONTAINER.z, 1.4);
      const n = e.deposit();
      log.trips++;
      if (log.firstDeposit === null) log.firstDeposit = { t, money: e.money, leaves: n };
      for (;;) {
        const b = strategy(e, rng);
        if (!b || !e.buy(b)) break;
        log.buys.push(`${b}${e.progress.upgrades[b]}@${Math.round(t)}s`);
        if (log.firstBuy === null) log.firstBuy = { t, branch: b };
      }
      continue;
    }
    // ближайший лежащий лист
    let best = -1, bd = Infinity;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      const d = Math.hypot(f.x[i] - px, f.z[i] - pz);
      if (d < bd) { bd = d; best = i; }
    }
    walkTo(f.x[best], f.z[best], REACH_H);
    t += AIM + e.pickTime;
    e.collect(f.gatherAround(best, Math.min(e.grab, e.free)));
    e.checkRewards();
  }
  const spent = spentOn(e.progress.upgrades);
  return { t, money: e.money, earned: e.progress.earned, spent, upgrades: { ...e.progress.upgrades }, ...log };
}

const cheapest = (e) => BRANCHES.filter((b) => e.canBuy(b))
  .sort((a, b) => UPGRADES[a].prices[e.progress.upgrades[a]] - UPGRADES[b].prices[e.progress.upgrades[b]])[0];
const only = (branch) => (e) => (e.canBuy(branch) ? branch : null);
// покупает первую доступную ветку в порядке приоритета
const priority = (...order) => (e) => order.find((b) => e.canBuy(b)) ?? null;
const random = (e, rng) => {
  const ok = BRANCHES.filter((b) => e.canBuy(b));
  return ok.length && rng() < 0.8 ? ok[Math.floor(rng() * ok.length)] : null;
};
const none = () => null;

const strategies = {
  'без покупок': none,
  'самое дешёвое': cheapest,
  'только захват': only('grab'),
  'только мешок': only('bag'),
  'только скорость': only('speed'),
  'захват → мешок → скорость': priority('grab', 'bag', 'speed'),
  'мешок → захват → скорость': priority('bag', 'grab', 'speed'),
};

const fmt = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const total = BRANCHES.reduce((sum, b) => sum + UPGRADES[b].prices.reduce((x, y) => x + y, 0), 0);
console.log(`Листьев во дворе: ${YARD.leafCount}. Лист — $0,004, после бонуса за 50 % уборки — $0,005.`);
console.log(`Вся доступная прокачка (хватка, ловкость, мешки): ${formatMoney(total)}.\n`);
console.log('стратегия'.padEnd(28), 'время', ' 1-я сдача', ' 1-я покупка', ' ходок', ' заработано', ' потрачено', ' уровни х/л/м');
let minEarned = Infinity;
for (const [name, st] of Object.entries(strategies)) {
  const r = simulate(st);
  minEarned = Math.min(minEarned, r.earned);
  console.log(
    name.padEnd(28), fmt(r.t).padStart(5),
    formatMoney(r.firstDeposit.money).padStart(10),
    (r.firstBuy ? `${fmt(r.firstBuy.t)} ${r.firstBuy.branch}` : '—').padStart(12),
    String(r.trips).padStart(6), formatMoney(r.earned).padStart(11), formatMoney(r.spent).padStart(10),
    `  ${r.upgrades.grab}/${r.upgrades.speed}/${r.upgrades.bag}`,
  );
}
const times = [];
for (let k = 0; k < 60; k++) { const r = simulate(random, k + 1); times.push(r.t); minEarned = Math.min(minEarned, r.earned); }
times.sort((a, b) => a - b);
console.log(`\nслучайные порядки покупок (60 прогонов): время уборки ${fmt(times[0])} … ${fmt(times[times.length - 1])}, медиана ${fmt(times[30])}`);
console.log(`минимальный заработок за двор: ${formatMoney(minEarned)} — ${minEarned >= total ? 'хватает' : 'НЕ хватает'} на всю прокачку (${formatMoney(total)}), запас ${formatMoney(minEarned - total)}`);
