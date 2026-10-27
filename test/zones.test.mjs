// Зоны, грабли, приёмники и сохранение нескольких зон.
import test from 'node:test';
import assert from 'node:assert/strict';

import { RAKE, RAKE_BRANCHES, LEAF_VALUE, LEAF_BONUS, usd, SAVE_VERSION } from '../src/config.js';
import { ON_GROUND, SOLD, IN_BAG, mulberry32 } from '../src/leaves.js';
import { spentTotal, ALL_INLETS } from '../src/economy.js';
import { setLevel, level, GARDEN, YARD, isFree, distToObstacle, LEVELS, ZONE_ORDER, ARRIVALS } from '../src/layout.js';
import { createGame, zoneUnlocked, zoneSummary } from '../src/game.js';
import { buildSave, parseSave, isLegacySave } from '../src/save.js';
import { rakeStats, strokeSpan, rakeStroke, activeInlets } from '../src/rake.js';

const inGarden = (fn) => { setLevel('garden'); try { return fn(); } finally { setLevel('yard'); } };
const json = (o) => JSON.parse(JSON.stringify(o));

/** Двор, убранный честно: всё собрано и сдано, награды выданы. */
function clearedYard() {
  setLevel('yard');
  const g = createGame();
  const e = g.economy, f = g.field;
  for (let i = 0; i < f.count; i += e.free) {
    const ids = [];
    for (let k = i; k < Math.min(f.count, i + e.free); k++) ids.push(k);
    e.collect(ids); e.checkRewards(); e.deposit();
  }
  return g;
}

test('зоны: у каждой своя раскладка, листья внутри и не в препятствиях', () => {
  for (const id of ZONE_ORDER) {
    setLevel(id);
    const f = createGame().field, Z = level.zone;
    assert.equal(f.count, level.leafCount);
    for (let i = 0; i < f.count; i += 7) {
      assert.ok(f.x[i] > Z.minX && f.x[i] < Z.maxX && f.z[i] > Z.minZ && f.z[i] < Z.maxZ, `${id}: лист ${i} вне зоны`);
      for (const o of level.obstacles) assert.ok(distToObstacle(f.x[i], f.z[i], o) >= level.leafMargin - 1e-6, `${id}: лист ${i} в ${o.id}`);
    }
    assert.ok(isFree(level.spawn.x, level.spawn.z, 0.35), `${id}: точка появления свободна`);
  }
  setLevel('yard');
  for (const [k, p] of Object.entries(ARRIVALS)) {
    setLevel(k.split('>')[1]);
    assert.ok(isFree(p.x, p.z, 0.35), `${k}: точка входа свободна`);
  }
  setLevel('yard');
  // приёмники не в препятствиях
  for (const n of GARDEN.inlets) for (const o of GARDEN.obstacles) assert.ok(distToObstacle(n.x, n.z, o) > n.r, `${n.id} в ${o.id}`);
});

test('сохранение хранит позиции только сдвинутых листьев, сдвинутые лежат сверху', () => {
  const g = inGarden(() => createGame());
  const f = g.field;
  inGarden(() => {
    // сдвигаем 300 листьев в одну точку: они ложатся поверх тех, что там лежали
    const moved = [];
    for (let i = 0; i < 300; i++) { f.moveTo(i * 7, 13 + (i % 10) * 0.01, -3 + Math.floor(i / 10) * 0.01); moved.push(i * 7); }
    f.resettle(12.9, -3.1, 13.2, -2.6);
    const data = f.serialize();
    assert.equal(data.m.length, 300 * 5, 'только сдвинутые');
    assert.equal(data.pos, undefined);
    assert.ok(JSON.stringify(data).length < 30000, 'сохранение компактное');
    const h = createGame().field;
    assert.ok(h.restore(json(data)));
    for (const i of moved) {
      assert.ok(Math.abs(h.x[i] - f.x[i]) < 0.002 && Math.abs(h.z[i] - f.z[i]) < 0.002, `лист ${i} на месте`);
      assert.ok(Math.abs(h.lift[i] - f.lift[i]) < 0.001, `высота листа ${i} та же`);
    }
    // последний сдвинутый лежит выше всех соседей
    const top = moved[moved.length - 1];
    for (const j of h.neighbours(top)) if (h.state[j] === ON_GROUND) assert.ok(h.lift[top] >= h.lift[j] - 1e-6);
  });
});

test('прежний формат листьев (pos — все позиции) по-прежнему загружается', () => {
  const g = createGame(), f = g.field;
  f.moveTo(5, 1.234, 2.345);
  const pos = [];
  for (let i = 0; i < f.count; i++) pos.push(Math.round(f.x[i] * 1000), Math.round(f.z[i] * 1000), Math.round(f.yaw[i] * 1000));
  const h = createGame().field;
  assert.ok(h.restore({ state: Array.from(f.state).join(''), pos }));
  assert.ok(Math.abs(h.x[5] - 1.234) < 0.002 && Math.abs(h.z[5] - 2.345) < 0.002);
  assert.ok(Math.abs(h.x[6] - f.x[6]) < 1e-6, 'несдвинутые — точно на месте генерации');
});

test('грабли тянут листья к игроку и не протаскивают их сквозь забор', () => inGarden(() => {
  const g = createGame(), f = g.field;
  const st = rakeStats({ handle: 0, sweep: 0, sticky: 0 });
  const span = strokeSpan(st, Infinity);
  assert.equal(span.start, RAKE.branches.handle.values[0] * 0.65);
  assert.ok(Math.abs(span.start - span.end - RAKE.branches.handle.dist[0]) < 1e-9);
  // игрок у плотного ковра под деревом, смотрит на север
  const p = { x: 14.6, z: 0.2, yaw: 0 };
  const before = new Map();
  for (let i = 0; i < f.count; i++) before.set(i, [f.x[i], f.z[i]]);
  const r = rakeStroke(f, p, st, span, [], mulberry32(3));
  assert.ok(r.moved.length > 5, `сдвинуто ${r.moved.length}`);
  for (const { i, fx, fz } of r.moved) {
    assert.equal(fx, before.get(i)[0]);
    assert.ok(f.z[i] > fz - 1e-6, 'лист приблизился к игроку (на юг)');
    assert.ok(Math.abs(f.x[i] - p.x) <= st.width / 2 + 0.05, 'в полосе граблей');
    for (const o of level.obstacles) assert.ok(distToObstacle(f.x[i], f.z[i], o) >= level.leafMargin - 1e-6, `лист ${i} в ${o.id}`);
  }
  // у забора: голова за забором не тянет листья сквозь доски
  const q = { x: 12, z: 0.6, yaw: Math.PI }; // спиной к саду, лицом к южному забору
  const r2 = rakeStroke(f, q, st, strokeSpan(st, Infinity), [], mulberry32(4));
  for (const { i } of r2.moved) assert.ok(f.z[i] < 1, 'лист остался в саду');
}));

test('приёмник продаёт протащенные над ним листья сразу, без мешка', () => inGarden(() => {
  const g = createGame(), f = g.field, e = g.economy;
  const inl = GARDEN.inlets.find((n) => n.price === 0);
  // кладём 40 листьев перед приёмником и тянем их через решётку
  for (let k = 0; k < 40; k++) f.moveTo(k, inl.x + (k % 8 - 3.5) * 0.04, inl.z - 0.75 - Math.floor(k / 8) * 0.03);
  f.resettle(inl.x - 1, inl.z - 1.2, inl.x + 1, inl.z);
  const st = rakeStats({ handle: 0, sweep: 0, sticky: 4 }); // цепкость 100 %
  const p = { x: inl.x, z: inl.z - 0.75 + st.handle * 0.65 - 0.05, yaw: 0 };
  const ins = activeInlets(e.progress);
  assert.deepEqual(ins.map((n) => n.id), [inl.id], 'бесплатный приёмник работает сразу, платный — нет');
  const r = rakeStroke(f, p, st, strokeSpan(st, Infinity), ins, mulberry32(1));
  const ids = r.absorbed.flatMap((a) => a.ids);
  for (let k = 0; k < 40; k++) assert.ok(ids.includes(k), `лист ${k} попал в приёмник`);
  const money = e.money;
  const n = e.sellDirect(ids);
  assert.equal(n, ids.length);
  assert.equal(e.money - money, n * LEAF_VALUE);
  assert.equal(e.inBag, 0);
  for (const i of ids) assert.equal(f.state[i], SOLD);
  assert.equal(e.sellDirect(ids), 0, 'дважды не продаётся');
}));

test('покупки граблей: сначала грабли, затем ступени каждой ветки по порядку; приёмник — после граблей', () => {
  const g = clearedYard(), e = g.economy;
  const m0 = e.money;
  assert.equal(e.offer('rake:handle'), null, 'улучшения без граблей не продаются');
  assert.equal(e.offer('inlet:garden-b'), null, 'платный приёмник без граблей не продаётся');
  assert.equal(e.offer('inlet:garden-a'), null, 'бесплатный приёмник не покупается — он уже работает');
  assert.ok(e.buy('rake'));
  assert.equal(e.money, m0 - RAKE.price);
  assert.equal(e.buy('rake'), null, 'вторые грабли не продаются');
  for (const b of RAKE_BRANCHES) {
    const before = e.money, res = e.buy(`rake:${b}`);
    assert.ok(res, b);
    assert.equal(before - e.money, RAKE.branches[b].prices[0]);
    assert.equal(e.rake[b], 1);
  }
  assert.ok(e.buy('inlet:garden-b'));
  assert.equal(e.buy('inlet:garden-b'), null);
  assert.equal(e.progress.inlets.join(), 'garden-b');
  assert.equal(spentTotal(e.progress), m0 - e.money);
  assert.equal(e.buy('inlet:nope'), null);
  assert.equal(e.buy('rake:nope'), null);
});

test('переход: сад открывается наградой за весь двор; прогресс и двор переносятся', () => {
  const fresh = createGame();
  assert.equal(zoneUnlocked(fresh.economy.progress, 'garden'), false);
  const g = clearedYard();
  assert.ok(zoneUnlocked(g.economy.progress, 'garden'));
  assert.ok(g.economy.progress.bonuses.includes('yard-50'));
  g.economy.buy('rake');
  // как useGate в main.js: следующая зона и точка у ворот
  g.nextZone = 'garden';
  g.player = { ...ARRIVALS['yard>garden'] };
  const save = json(buildSave(g));
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.currentZone, 'garden');
  assert.ok(save.zones.yard);
  parseSave(save);
  const h = inGarden(() => createGame(save));
  assert.deepEqual(h.fixes, []);
  assert.equal(h.field.count, GARDEN.leafCount);
  assert.equal(h.economy.money, g.economy.money);
  assert.ok(h.economy.rake);
  assert.equal(h.economy.leafValue, LEAF_VALUE + LEAF_BONUS, 'бонус двора действует в саду');
  assert.ok(Math.abs(h.player.x - ARRIVALS['yard>garden'].x) < 0.01 && Math.abs(h.player.yaw - ARRIVALS['yard>garden'].yaw) < 0.01);
  assert.equal(zoneSummary('yard', save.zones.yard).sold, YARD.leafCount);

  // в саду: собрали, продали, сохранили; двор остался в сохранении нетронутым
  inGarden(() => {
    const e = h.economy;
    const ids = []; for (let i = 0; i < 300; i++) ids.push(i);
    e.sellDirect(ids);
    h.field.moveTo(400, 12, -3);
    const s2 = json(buildSave(h));
    assert.equal(s2.currentZone, 'garden');
    assert.deepEqual(s2.zones.yard, save.zones.yard);
    const k = createGame(s2);
    assert.deepEqual(k.fixes, [], 'заработок в саду и бонусы двора проходят проверку');
    assert.equal(k.economy.money, e.money);
    assert.equal(k.economy.sold, 300);
  });
  // обратно во двор: в нём ничего не изменилось, проданные в саду учитываются
  const s3 = inGarden(() => json(buildSave(h)));
  s3.currentZone = 'yard';
  const y = createGame(s3);
  assert.deepEqual(y.fixes, []);
  assert.equal(y.economy.remaining, 0);
  assert.equal(y.economy.money, h.economy.money);
});

test('проверка сохранения: бонус чужой зоны без уборки, лишние деньги и поддельные приёмники снимаются', () => {
  const g = clearedYard();
  g.economy.buy('rake');
  g.nextZone = 'garden';
  const save = json(buildSave(g));
  save.progress.bonuses.push('garden-50');      // сад не убран
  save.progress.inlets = ['garden-b', 'garden-b', 'fake'];
  save.progress.money += usd(100);
  save.progress.earned += usd(100);
  const h = inGarden(() => createGame(save));
  assert.ok(!h.economy.progress.bonuses.includes('garden-50'));
  assert.ok(h.fixes.length > 0);
  assert.deepEqual(h.economy.progress.inlets, ['garden-b'], 'повторы и неизвестные убраны; купленный — оплачен из заработка');
  assert.equal(h.economy.money, h.economy.progress.earned - spentTotal(h.economy.progress));
  assert.ok(h.economy.progress.earned <= YARD.leafCount * (LEAF_VALUE + LEAF_BONUS));
  // грабли «в долг» откатываются
  const s2 = json(buildSave(createGame()));
  s2.progress.tools = { rake: { handle: 4, sweep: 5, sticky: 4 } };
  const k = createGame(s2);
  assert.equal(k.economy.rake, null);
  assert.equal(k.economy.money, 0);
});

test('версии: v3 (доллары, одна зона) загружается, v1–v2 (монеты) — прежняя экономика', () => {
  const g = createGame();
  g.economy.collect([0, 1, 2]); g.economy.deposit();
  const v3 = json(buildSave(g));
  v3.version = 3;
  delete v3.currentZone;
  const f = g.field;
  v3.zones.yard = { state: Array.from(f.state).join(''), pos: Array.from({ length: f.count * 3 }, (_, k) => Math.round([f.x, f.z, f.yaw][k % 3][Math.floor(k / 3)] * 1000)) };
  assert.equal(isLegacySave(v3), false);
  parseSave(v3);
  const h = createGame(v3);
  assert.deepEqual(h.fixes, []);
  assert.equal(h.economy.money, 3 * LEAF_VALUE);
  assert.equal(level.id, 'yard');
  for (const v of [1, 2]) assert.equal(isLegacySave({ ...v3, version: v }), true);
  assert.throws(() => parseSave({ ...v3, version: 4, currentZone: 'moon' }), /зона/);
});

test('сохранение всех зон помещается в хранилище Safari с запасом', () => {
  // худший случай для размера: сдвинуты все листья сада
  const g = clearedYard();
  g.nextZone = 'garden';
  const save = json(buildSave(g));
  const h = inGarden(() => createGame(save));
  inGarden(() => {
    for (let i = 0; i < h.field.count; i++) h.field.moveTo(i, h.field.x[i] + 0.01, h.field.z[i]);
  });
  const text = JSON.stringify(buildSave(h));
  assert.ok(text.length < 500 * 1024, `${(text.length / 1024).toFixed(0)} КБ`);
});

test('все приёмники: цены по таблице и уникальные id', () => {
  const ids = new Set(ALL_INLETS.map((n) => n.id));
  assert.equal(ids.size, ALL_INLETS.length);
  assert.deepEqual(GARDEN.inlets.map((n) => n.price), [usd(0), usd(3)]);
  for (const id of ZONE_ORDER) assert.ok(LEVELS[id].rewards.length >= 2);
});

test('площадка у гаража: открывается наградой за весь сад, её приёмники продаются только после этого', () => {
  const g = clearedYard();
  const e = g.economy;
  e.buy('rake');
  assert.equal(zoneUnlocked(e.progress, 'court'), false);
  assert.equal(e.offer('inlet:court-a'), null, 'приёмник закрытой зоны не продаётся');
  // сад: всё продано через приёмник — награды сада выданы
  g.nextZone = 'garden';
  const s1 = json(buildSave(g));
  const h = inGarden(() => {
    const k = createGame(s1);
    const ids = []; for (let i = 0; i < k.field.count; i++) ids.push(i);
    k.economy.sellDirect(ids);
    k.economy.checkRewards();
    return k;
  });
  assert.ok(zoneUnlocked(h.economy.progress, 'court'));
  assert.ok(h.economy.offer('inlet:court-a'), 'теперь продаётся');
  assert.equal(h.economy.leafValue, LEAF_VALUE + 2 * LEAF_BONUS, 'бонусы двора и сада');
  h.nextZone = 'court';
  h.player = { ...ARRIVALS['garden>court'] };
  const s2 = inGarden(() => json(buildSave(h)));
  setLevel('court');
  try {
    const c = createGame(s2);
    assert.deepEqual(c.fixes, []);
    assert.equal(c.field.count, LEVELS.court.leafCount);
    assert.equal(c.economy.money, h.economy.money);
    assert.ok(c.economy.buy('inlet:court-a'));
    const s3 = json(buildSave(c));
    assert.deepEqual(createGame(s3).fixes, []);
    // поддельный приёмник площадки при неубранном саде снимается
    const fake = json(s1);
    fake.progress.inlets = ['court-b'];
    setLevel('garden');
    const f = createGame(fake);
    assert.deepEqual(f.economy.progress.inlets, []);
  } finally { setLevel('yard'); }
});

test('воздуходувка гонит листья от игрока, не сквозь забор; без разгона не дует', async () => {
  const { blowerStats, blowTick } = await import('../src/blower.js');
  const { BLOWER, BLOWER_STREAM } = await import('../src/config.js');
  setLevel('pool');
  try {
    const f = createGame().field;
    const st = blowerStats({ width: 0, power: 0, accuracy: 0 });
    assert.equal(st.width, BLOWER.branches.width.values[0]);
    assert.equal(st.startup, 0.6);
    const top = blowerStats({ width: 5, power: 4, accuracy: 4 });
    assert.ok(top.range > st.range && top.speed > st.speed && top.spread < st.spread && top.startup === 0.2);
    // у ковра у восточного забора, лицом на восток (к забору)
    const p = { x: 28.0, z: -7.0, yaw: -Math.PI / 2 };
    assert.equal(blowTick(f, p, st, 0, BLOWER_STREAM.tick, [], mulberry32(1)).moved.length, 0, 'без разгона струи нет');
    let moved = 0;
    for (let k = 0; k < 40; k++) {
      const r = blowTick(f, p, st, 1, BLOWER_STREAM.tick, [], mulberry32(k));
      for (const { i, fx } of r.moved) {
        moved++;
        assert.ok(f.x[i] < 30 - level.leafMargin + 1e-6, 'лист остался по эту сторону забора');
        if (Math.abs(f.z[i] - p.z) < 0.2) assert.ok(f.x[i] >= fx - 0.02, 'лист летит от игрока');
      }
    }
    assert.ok(moved > 50, `сдвинуто ${moved}`);
  } finally { setLevel('yard'); }
});

test('воздуходувка загоняет листья в приёмник', async () => {
  const { blowerStats, blowTick } = await import('../src/blower.js');
  const { BLOWER_STREAM } = await import('../src/config.js');
  setLevel('pool');
  try {
    const g = createGame(), f = g.field;
    const n = level.inlets[1]; // скиммер
    for (let k = 0; k < 30; k++) f.moveTo(k, n.x - 1.2 - (k % 5) * 0.03, n.z + (Math.floor(k / 5) - 2.5) * 0.04);
    const st = blowerStats({ width: 0, power: 0, accuracy: 4 });
    const p = { x: n.x - 1.75, z: n.z, yaw: -Math.PI / 2 }; // смотрит на восток, на скиммер; листья — у сопла
    const sold = new Set();
    for (let k = 0; k < 120; k++) {
      const r = blowTick(f, p, st, 1, BLOWER_STREAM.tick, [n], mulberry32(k));
      for (const a of r.absorbed) { g.economy.sellDirect(a.ids); a.ids.forEach((i) => sold.add(i)); }
    }
    let ours = 0;
    for (let k = 0; k < 30; k++) if (sold.has(k)) ours++;
    assert.ok(ours >= 24, `в скиммер попало ${ours} из 30`);
    assert.equal(g.economy.sold, sold.size);
  } finally { setLevel('yard'); }
});

test('покупка воздуходувки и её веток; приёмник можно купить и без граблей', () => {
  const g = clearedYard(), e = g.economy;
  // денег за двор на воздуходувку не хватает
  assert.equal(e.canBuy('blower'), false);
  assert.equal(e.offer('blower:power'), null, 'улучшения без воздуходувки не продаются');
  // честно зарабатываем на неё: продаём листья сада
  g.nextZone = 'garden';
  const s0 = json(buildSave(g));
  const h = inGarden(() => {
    const k = createGame(s0);
    const ids = []; for (let i = 0; i < k.field.count; i++) ids.push(i);
    k.economy.sellDirect(ids); k.economy.checkRewards();
    return k;
  });
  const m = h.economy;
  assert.ok(m.buy('blower'));
  assert.ok(m.blower && !m.rake);
  assert.ok(m.offer('inlet:garden-b'), 'приёмник продаётся при одной воздуходувке');
  const before = m.money;
  assert.ok(m.buy('blower:accuracy'));
  assert.equal(before - m.money, 100000);
  assert.equal(m.blower.accuracy, 1);
  assert.equal(spentTotal(m.progress), m.progress.earned - m.money);
  const s = inGarden(() => json(buildSave(h)));
  const k = inGarden(() => createGame(s));
  assert.deepEqual(k.fixes, []);
  assert.equal(k.economy.blower.accuracy, 1);
});

test('терраса с бассейном открывается наградой за площадку у гаража', () => {
  assert.equal(zoneUnlocked({ bonuses: ['yard-100', 'garden-100'] }, 'pool'), false);
  assert.equal(zoneUnlocked({ bonuses: ['court-100'] }, 'pool'), true);
  const g = LEVELS.court.gates.find((x) => x.to === 'pool');
  assert.equal(g.requires, 'court-100');
  assert.ok(ARRIVALS['court>pool'] && ARRIVALS['pool>court']);
  // в бассейн листья не попадают при генерации
  setLevel('pool');
  try {
    const f = createGame().field, P = level.pool;
    for (let i = 0; i < f.count; i++) assert.ok(!(f.x[i] > P.x0 && f.x[i] < P.x1 && f.z[i] > P.z0 && f.z[i] < P.z1), `лист ${i} в воде`);
  } finally { setLevel('yard'); }
});

test('все шесть зон: цепочка ворот, 98 400 листьев, у каждой зоны свой контейнер и приёмники', () => {
  assert.deepEqual(ZONE_ORDER, ['yard', 'garden', 'court', 'pool', 'park', 'alley']);
  assert.equal(ZONE_ORDER.reduce((s, z) => s + LEVELS[z].leafCount, 0), 98400);
  for (let k = 1; k < ZONE_ORDER.length; k++) {
    const prev = ZONE_ORDER[k - 1], id = ZONE_ORDER[k];
    const fwd = LEVELS[prev].gates.find((g) => g.to === id), back = LEVELS[id].gates.find((g) => g.to === prev);
    assert.equal(fwd?.requires, `${prev}-100`, `${prev} → ${id} открывается уборкой ${prev}`);
    assert.ok(back && !back.requires, `${id} → ${prev} — свободно`);
    assert.ok(ARRIVALS[`${prev}>${id}`] && ARRIVALS[`${id}>${prev}`]);
    assert.equal(zoneUnlocked({ bonuses: [`${prev}-100`] }, id), true);
    assert.equal(zoneUnlocked({ bonuses: [] }, id), false);
  }
  // цены приёмников — по таблице; стоки аллеи — бесплатные (в таблице для неё приёмников нет)
  const prices = Object.fromEntries(ALL_INLETS.map((n) => [n.id, n.price / 10000]));
  assert.deepEqual(prices, { 'garden-a': 0, 'garden-b': 3, 'court-a': 3, 'court-b': 6, 'pool-a': 10, 'pool-b': 15, 'park-a': 20, 'park-b': 25, 'alley-a': 0, 'alley-b': 0 });
  for (const id of ZONE_ORDER) assert.ok(LEVELS[id].container, `${id}: контейнер`);
});
