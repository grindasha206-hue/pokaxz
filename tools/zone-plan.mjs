// План зон после двора: листья, покрытие земли, доход, покупки и время.
// Запуск: node tools/zone-plan.mjs
//
// Что считается точно (симуляцией на коде игры):
//   • площадь листа — по атласу (assets/leaves/leaf-atlas.json) и размерам из игры;
//   • доход — по экономике игры: $0,004 за лист, +25 % за каждый бонус зоны (на 50 % уборки);
//   • когда хватает денег на каждую покупку — по ценам из config.js при сборе по порядку зон;
//   • скорость ручного сбора — прогоном сбора на реальной раскладке листьев (как economy-sim).
// Скорость граблей — замер ботом (tools/rake-sim.mjs); воздуходувки ещё нет — её скорость пока цель.
// Обе — в ASSUME ниже; игровой тест с человеком их уточнит.

import { readFileSync } from 'node:fs';
import { PLAYER, UPGRADES, BRANCHES, LOCKED_TOOLS, RAKE, LEAF_VALUE, LEAF_BONUS, usd, formatMoney } from '../src/config.js';
import { createGame } from '../src/game.js';
import { setLevel, level, YARD } from '../src/layout.js';
import { ON_GROUND } from '../src/leaves.js';

// ── площадь одного листа ────────────────────────────────────
// клетка атласа = LEAF_BASE × leafSize × размер вида × scale; лист занимает долю area клетки
const atlas = JSON.parse(readFileSync(new URL('../assets/leaves/leaf-atlas.json', import.meta.url)));
const SPECIES_SIZE = [1.12, 1.0, 0.86, 0.98, 0.88, 1.08];    // как в src/view/leafView.js
const SPECIES_WEIGHTS = [0.22, 0.17, 0.2, 0.11, 0.19, 0.11]; // как в src/leaves.js
const LEAF_BASE = 0.17, LEAF_SIZE = YARD.leafSize, SCALE2 = 1 + 0.36 ** 2 / 12; // E[scale²], scale ∈ [0,82; 1,18]
let leafArea = 0;
atlas.leaves.forEach((l, k) => { leafArea += SPECIES_WEIGHTS[k] * l.area * (LEAF_BASE * LEAF_SIZE * SPECIES_SIZE[k]) ** 2 * SCALE2; });
// покрытие c = площадь листьев / площадь земли; доля открытой земли при случайной укладке ≈ e^(−c)
const coverage = (n, area) => (n * leafArea) / area;
const bare = (c) => Math.exp(-c);

// ── зоны ────────────────────────────────────────────────────
// area — площадь, где лежат листья (м²). В каждой зоне inDense листьев лежит плотным ковром
// с покрытием cDense (2,5 — видно ≈8 % земли, как на референсах), остальные — редко между ковром.
// Dc — средний путь до контейнера, м (походы с мешком); D — средний путь листа до приёмника, м.
const C_DENSE = 2.3;        // покрытие ковра: видно ≈10 % земли
// Зона 1 — существующий двор (площадь задана); листья в ней предлагается собрать в кучи плотнее (inDense).
// Для новых зон площадь выводится из числа листьев: carpet — доля площади под ковром.
const zoneArea = (z) => z.area ?? Math.round((z.leaves * z.inDense * leafArea) / (C_DENSE * z.carpet));
const ZONES = [
  { id: 'yard',   name: '1. Двор',              leaves: 6400,  area: 200, inDense: 0.8, Dc: 6,  D: 0, inlets: [] },
  { id: 'garden', name: '2. Сад с теплицей',     leaves: 12000, carpet: 0.45, inDense: 0.85, Dc: 8,  D: 5, inlets: [['у крыльца, справа', 0], ['у крыльца, слева', 3]] },
  { id: 'court',  name: '3. Площадка у гаража',  leaves: 16000, carpet: 0.5,  inDense: 0.85, Dc: 9,  D: 6, inlets: [['площадка у гаража', 3], ['качели за гаражом', 6]] },
  { id: 'pool',   name: '4. Терраса и бассейн',  leaves: 22000, carpet: 0.5,  inDense: 0.85, Dc: 11, D: 7, inlets: [['гриль у дома', 10], ['бассейн', 15]] },
  { id: 'park',   name: '5. Сквер с лабиринтом', leaves: 24000, carpet: 0.45, inDense: 0.85, Dc: 12, D: 8, inlets: [['лабиринт за домом', 20], ['дорожка к теплице', 25]] },
  { id: 'alley',  name: '6. Аллея',              leaves: 18000, carpet: 0.5,  inDense: 0.85, Dc: 11, D: 8, inlets: [] },
];
for (const z of ZONES) z.area = zoneArea(z);

// ── цели скорости инструментов (до игрового теста) ───────────
// Ориентир — рука на максимуме с походами к контейнеру. Грабли и воздуходувка сдают листья
// в приёмники, без мешка. Это требования к будущей настройке инструментов, не замер.
const ASSUME = {
  // грабли — замер ботом на коде игры (tools/rake-sim.mjs, сад, оба приёмника): 16,1 и 34,7 лист/с
  // против 17,0 лист/с у руки на максимуме в том же саду
  rake: [0.95, 2.0],   // ×руки: без улучшений / все улучшения граблей
  blower: [2.0, 4.0],  // ×руки: без улучшений / все улучшения воздуходувки
  handBeforeMax: 0.45, // рука до полной прокачки в новых зонах — грубо (в зоне 1 — точный прогон)
};

// ── покрытие зоны 1: меряем на реальной раскладке ────────────
function measureYardCoverage() {
  setLevel(YARD);
  const f = createGame().field, cell = 1, cells = new Map();
  for (let i = 0; i < f.count; i++) {
    const k = Math.floor(f.x[i] / cell) + ':' + Math.floor(f.z[i] / cell);
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  let denseArea = 0, denseLeaves = 0, maxC = 0;
  for (const n of cells.values()) {
    const c = coverage(n, cell * cell);
    maxC = Math.max(maxC, c);
    if (c >= 1.5) { denseArea += cell * cell; denseLeaves += n; }
  }
  return { denseArea, denseShare: denseLeaves / f.count, maxC };
}

// ── ручной сбор: меряем на коде игры ─────────────────────────
// maxed: все улучшения руки и мешка сразу; иначе — покупки по мере денег (дешёвые сначала), как в economy-sim
function handRun(levelId, maxed, limit = Infinity) {
  setLevel(levelId);
  const g = createGame();
  const { economy: e, field: f } = g;
  if (maxed) for (const b of BRANCHES) e.progress.upgrades[b] = UPGRADES[b].prices.length;
  let px = g.player.x, pz = g.player.z, t = 0, n = 0, walk = 0;
  const C = level.container;
  const walkTo = (x, z, stop) => {
    const d = Math.max(0, Math.hypot(x - px, z - pz) - stop);
    t += d / PLAYER.walkSpeed; walk += d;
    const k = d / Math.max(1e-6, Math.hypot(x - px, z - pz));
    px += (x - px) * k; pz += (z - pz) * k;
  };
  const cheapest = () => BRANCHES.filter((b) => e.canBuy(b))
    .sort((a, b) => UPGRADES[a].prices[e.progress.upgrades[a]] - UPGRADES[b].prices[e.progress.upgrades[b]])[0];
  limit = Math.min(limit, f.count);
  while (n < limit || e.inBag > 0) {
    if (e.free === 0 || n >= limit) {
      walkTo(C.x, C.z, 1.4); e.deposit();
      for (let b = cheapest(); !maxed && b; b = cheapest()) e.buy(b);
      continue;
    }
    let best = -1, bd = Infinity;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      const d = Math.hypot(f.x[i] - px, f.z[i] - pz);
      if (d < bd) { bd = d; best = i; }
    }
    walkTo(f.x[best], f.z[best], 2.2);
    t += 0.35 + e.pickTime;
    n += e.collect(f.gatherAround(best, Math.min(e.grab, e.free))).length;
    e.checkRewards();
  }
  const Z = level.zone;
  const density = f.count / ((Z.maxX - Z.minX) * (Z.maxZ - Z.minZ));
  setLevel(YARD);
  return { t, n, rate: n / t, density, earned: e.progress.earned };
}

const yardFull = handRun('yard', false);             // зона 1 целиком, с покупками по мере денег
const handSparse = handRun('yard', true, 3000);      // рука на максимуме, редкие листья
const handDense = handRun('fragment', true, 3000);   // рука на максимуме, плотный слой
// рука на максимуме в зоне: сбор в плотном ковре + походы к контейнеру на расстояние Dc (мешок 500)
function handMaxRate(z) {
  const pickRate = handDense.rate;                   // в ковре листья всегда в досягаемости
  const perBag = 500 / pickRate + (2 * z.Dc) / PLAYER.walkSpeed;
  const sparseShare = 1 - z.inDense;                 // редкие листья собираются медленнее
  const slow = handSparse.rate / handDense.rate;
  return 500 / (perBag * (1 - sparseShare + sparseShare / slow));
}

// ── покупки по порядку ──────────────────────────────────────
const plan = [];
for (const b of ['grab', 'speed', 'bag']) UPGRADES[b].prices.forEach((p, k) => plan.push({ tool: 'hand', what: `${UPGRADES[b].title} ${k + 1}`, price: p }));
const [BLOWER] = LOCKED_TOOLS;
const rakePlan = [{ tool: 'rake', what: 'Грабли', price: RAKE.price }];
const blowPlan = [{ tool: 'blower', what: 'Воздуходувка', price: BLOWER.price }];
for (const u of Object.values(RAKE.branches)) u.prices.forEach((p, k) => rakePlan.push({ tool: 'rake', what: `${u.title} ${k + 1}`, price: p }));
for (const u of BLOWER.upgrades) u.prices.forEach((p, k) => blowPlan.push({ tool: 'blower', what: `${u.title} ${k + 1}`, price: p }));
const sum = (a) => a.reduce((s, x) => s + x.price, 0);
const inletTotal = ZONES.reduce((s, z) => s + z.inlets.reduce((x, [, p]) => x + usd(p), 0), 0);

// проходим зоны лист за листом (пачками по 50), покупая по очереди: рука → грабли → воздуходувка;
// приёмники зоны покупаются, как только хватает денег, после первой покупки граблей
let money = 0, bonuses = 0, earnedTotal = 0;
const queue = [...plan, ...rakePlan, ...blowPlan];
const bought = [];
const rows = [];
let rakeLvl = 0, blowLvl = 0, haveRake = false, haveBlower = false, handMaxed = false;
for (const z of ZONES) {
  let earned = 0, sold = 0, time = 0, leavesAfterMax = 0;
  const startQueue = queue.length;
  const inletsLeft = z.inlets.map(([n, p]) => ({ name: n, price: usd(p) }));
  const firstBuys = [];
  while (sold < z.leaves) {
    const batch = Math.min(50, z.leaves - sold);
    const value = LEAF_VALUE + LEAF_BONUS * bonuses;
    // время пачки — самым быстрым доступным инструментом (зона 1 — точный прогон ниже)
    const hand = handMaxRate(z) * (handMaxed ? 1 : ASSUME.handBeforeMax);
    const rRate = haveRake && z.D ? hand * (rakeLvl === rakePlan.length - 1 ? ASSUME.rake[1] : ASSUME.rake[0]) : 0;
    const bRate = haveBlower && z.D ? hand * (blowLvl === blowPlan.length - 1 ? ASSUME.blower[1] : ASSUME.blower[0]) : 0;
    const handNow = handMaxed ? handMaxRate(z) : hand;
    time += batch / Math.max(handNow, rRate, bRate);
    sold += batch;
    money += batch * value; earned += batch * value;
    if (sold >= z.leaves / 2 && !z.bonusGiven) { z.bonusGiven = true; bonuses++; }
    if (!queue.length) leavesAfterMax += batch;
    for (;;) {
      if (queue.length && queue[0].price <= money) {
        const it = queue.shift();
        money -= it.price;
        bought.push({ ...it, zone: z.id });
        if (firstBuys.length < 3 || it.what === 'Грабли' || it.what === 'Воздуходувка') firstBuys.push(it.what);
        if (it.tool === 'rake') { haveRake = true; rakeLvl = rakePlan.indexOf(it); }
        if (it.tool === 'blower') { haveBlower = true; blowLvl = blowPlan.indexOf(it); }
        if (!queue.some((q) => q.tool === 'hand')) handMaxed = true;
        continue;
      }
      if (haveRake && inletsLeft.length && inletsLeft[0].price <= money) { money -= inletsLeft.shift().price; continue; }
      break;
    }
  }
  earnedTotal += earned;
  if (z.id === 'yard') time = yardFull.t; // зона 1 — прогон сбора с покупками на коде игры
  const denseArea = (z.leaves * z.inDense * leafArea) / C_DENSE;
  const cScatter = coverage(z.leaves * (1 - z.inDense), z.area - denseArea);
  const boughtHere = bought.filter((b) => b.zone === z.id);
  const groups = {};
  for (const b of boughtHere) groups[b.tool] = (groups[b.tool] || 0) + 1;
  rows.push({
    name: z.name, leaves: z.leaves, area: z.area, density: Math.round(z.leaves / z.area),
    denseArea, cScatter, earned, earnedTotal, time,
    buys: Object.entries(groups).map(([t, n]) => `${{ hand: 'рука/мешок', rake: 'грабли', blower: 'воздуходувка' }[t]} ×${n}`).join(', ') || '—',
    key: firstBuys.filter((w) => w === 'Грабли' || w === 'Воздуходувка').join(', '),
    left: queue.length, afterMax: leavesAfterMax, spentHere: sum(boughtHere),
  });
  void startQueue;
}

const fmt = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const yc = measureYardCoverage();
console.log(`Площадь листа в среднем ${(leafArea * 1e4).toFixed(0)} см². Плотный слой (видно ≤10 % земли): покрытие ≥ 2,3 — от ${Math.round(2.3 / leafArea)} листьев/м²; в плане — ${C_DENSE} (≈${Math.round(bare(C_DENSE) * 100)} % земли видно).`);
console.log(`Зона 1 сейчас (замер раскладки): участков с покрытием ≥ 1,5 — ${yc.denseArea} м², в них ${Math.round(yc.denseShare * 100)} % листьев; максимум покрытия на 1 м² — ${yc.maxC.toFixed(1)}.`);
console.log(`Рука на максимуме (прогон на коде игры): ${handSparse.rate.toFixed(1)} лист/с в редких листьях, ${handDense.rate.toFixed(1)} лист/с в ковре (без учёта походов).`);
console.log(`Зона 1 целиком с покупками по мере денег: ${fmt(yardFull.t)}, заработок ${formatMoney(yardFull.earned)}.`);
console.log(`Покупки: рука и мешки ${formatMoney(sum(plan))}, грабли с улучшениями ${formatMoney(sum(rakePlan))}, воздуходувка с улучшениями ${formatMoney(sum(blowPlan))}, приёмники ${formatMoney(inletTotal)}.\n`);
console.log('| Зона | Листьев | Площадь | Плотный ковёр | Доход зоны | Доход всего | Покупки в зоне | Время |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.leaves.toLocaleString('ru')} | ${r.area} м² | ${Math.round(r.denseArea)} м² (${Math.round(r.denseArea / r.area * 100)} %), между ним ${r.cScatter.toFixed(2)} | ${formatMoney(r.earned)} | ${formatMoney(r.earnedTotal)} | ${r.buys}${r.key ? ` — ${r.key}` : ''} | ${fmt(r.time)} |`);
}
const total = ZONES.reduce((s, z) => s + z.leaves, 0);
const afterMax = rows.reduce((s, r) => s + r.afterMax, 0);
console.log(`\nВсего листьев: ${total.toLocaleString('ru')}; заработок ${formatMoney(earnedTotal)}; после полной прокачки инструментов остаётся ${afterMax.toLocaleString('ru')} (${Math.round((afterMax / total) * 100)} %).`);
console.log(`Время всей игры (оценка): ${fmt(rows.reduce((s, r) => s + r.time, 0))}.`);
const where = (w) => { const b = bought.find((x) => x.what === w); return b ? `${b.zone}` : 'не куплено'; };
console.log(`Грабли покупаются в зоне: ${where('Грабли')}; воздуходувка: ${where('Воздуходувка')}; последняя покупка: ${bought.at(-1)?.what} (${bought.at(-1)?.zone}).`);
