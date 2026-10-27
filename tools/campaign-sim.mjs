// Прохождение всей игры ботом на коде игры: шесть зон подряд, покупки по мере денег.
// Запуск: node tools/campaign-sim.mjs   (несколько минут)
//
// Покупки: после каждой сдачи мешка и каждой проводки кучи бот покупает самое дешёвое из доступного —
// ступени руки и мешка, грабли и воздуходувку с ветками, приёмники текущей зоны. В зоне он берёт лучший
// из имеющихся инструментов (воздуходувка → грабли), а рукой добирает то, что инструментами не загнать.
// Бот играет идеально (сразу знает, куда гнать кучу), поэтому у человека времени уйдёт больше.

import { UPGRADES, BRANCHES, TOOLS, formatMoney } from '../src/config.js';
import { LEVELS, ZONE_ORDER, level } from '../src/layout.js';
import { newProgress, spentTotal } from '../src/economy.js';
import { simulate, fmt } from './bots.mjs';

const progress = newProgress();
const log = [];
let zoneNow = 'yard';

/** Самое дешёвое из доступного; true — куплен инструмент или приёмник (меняется тактика бота). */
function shop(e) {
  let changed = false;
  for (;;) {
    const keys = [...BRANCHES];
    for (const [id, T] of Object.entries(TOOLS)) {
      keys.push(id);
      for (const b of Object.keys(T.branches)) keys.push(`${id}:${b}`);
    }
    for (const n of level.inlets ?? []) keys.push(`inlet:${n.id}`);
    const offers = keys.map((k) => [k, e.offer(k)]).filter(([, o]) => o && o.price <= e.money).sort((a, b) => a[1].price - b[1].price);
    if (!offers.length) return changed;
    const [key] = offers[0];
    e.buy(key);
    log.push({ zone: zoneNow, key, price: offers[0][1].price });
    if (!UPGRADES[key] && !key.includes(':')) changed = true; // инструмент
    if (key.startsWith('inlet:')) changed = true;
  }
}

let total = 0;
const rows = [];
for (const zone of ZONE_ORDER) {
  zoneNow = zone;
  const before = progress.earned;
  const r = simulate({ zone, phases: 'auto', progress, shop }); // меняет progress на месте
  total += r.t;
  rows.push({ zone, r, earned: progress.earned - before });
}

const name = (k) => {
  if (UPGRADES[k]) return UPGRADES[k].title;
  if (TOOLS[k]) return TOOLS[k].title;
  if (k.startsWith('inlet:')) return `приёмник ${k.slice(6)}`;
  const [t, b] = k.split(':');
  return `${TOOLS[t].title}: ${TOOLS[t].branches[b].title.toLowerCase()}`;
};
console.log('| Зона | Листьев | Время | Лист/с | Заработано | Рукой | Граблями | Воздуходувкой | Куплено в зоне |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const { zone, r, earned } of rows) {
  const ph = (k) => (r.phases[k] ? `${r.phases[k].hand || r.phases[k].sold} (${fmt(r.phases[k].time)})` : '—');
  const bought = log.filter((l) => l.zone === zone);
  const tools = bought.filter((l) => TOOLS[l.key] || l.key.startsWith('inlet:')).map((l) => name(l.key));
  const ups = bought.length - tools.length;
  console.log(`| ${LEVELS[zone].name} | ${LEVELS[zone].leafCount} | ${fmt(r.t)} | ${(r.count / r.t).toFixed(1)} | ${formatMoney(earned)} | ` +
    `${ph('hand')} | ${ph('rake')} | ${ph('blower')} | ${[...tools, ups ? `ступеней ×${ups}` : ''].filter(Boolean).join(', ') || '—'} |`);
}
console.log(`\nВся игра: ${fmt(total)}; заработано ${formatMoney(progress.earned)}, потрачено ${formatMoney(spentTotal(progress))}, ` +
  `осталось ${formatMoney(progress.money)}.`);
const all = Object.values(TOOLS).reduce((s, T) => s + T.price + Object.values(T.branches).reduce((a, b) => a + b.prices.reduce((x, y) => x + y, 0), 0), 0);
const hand = BRANCHES.reduce((s, b) => s + UPGRADES[b].prices.reduce((x, y) => x + y, 0), 0);
const owned = (id) => progress.tools[id] ? Object.entries(progress.tools[id]).map(([b, v]) => `${b} ${v}/${TOOLS[id].branches[b].prices.length}`).join(', ') : 'не куплены';
console.log(`Прокачка в конце: рука ${BRANCHES.map((b) => `${progress.upgrades[b]}/${UPGRADES[b].prices.length}`).join(' ')}; грабли — ${owned('rake')}; воздуходувка — ${owned('blower')}; приёмники: ${progress.inlets.join(', ') || '—'}.`);
console.log(`Стоимость всего по таблице: рука и мешки ${formatMoney(hand)}, инструменты ${formatMoney(all)}.`);
const last = log[log.length - 1];
if (last) console.log(`Последняя покупка: ${name(last.key)} — в зоне «${LEVELS[last.zone].name}».`);
