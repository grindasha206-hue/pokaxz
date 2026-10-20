import test from 'node:test';
import assert from 'node:assert/strict';

import { ZONE, PLAYER, UPGRADES, BRANCHES, usd, formatMoney, formatGain } from '../src/config.js';
import { generateLeaves, ON_GROUND, IN_BAG, SOLD, LEAF_EXTENT, mulberry32 } from '../src/leaves.js';
import { Economy, spentOn, stat } from '../src/economy.js';
import { OBSTACLES, YARD, distToObstacle, isWalkable, segmentBlocked, surfaceHeight, resolveCircle } from '../src/layout.js';

const LEAF_MARGIN = YARD.leafMargin;
import { createGame } from '../src/game.js';
import { buildSave, parseSave, isLegacySave } from '../src/save.js';

const fresh = () => createGame();

test('генерация детерминирована и даёт заданное число листьев', () => {
  const a = generateLeaves(7, YARD.leafCount), b = generateLeaves(7, YARD.leafCount);
  assert.equal(a.count, YARD.leafCount);
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
});

test('листья не лежат в препятствиях, за забором и под землёй', () => {
  const f = fresh().field;
  for (let i = 0; i < f.count; i++) {
    assert.ok(f.x[i] > ZONE.minX && f.x[i] < ZONE.maxX && f.z[i] > ZONE.minZ && f.z[i] < ZONE.maxZ, `leaf ${i} out of zone`);
    for (const o of OBSTACLES) assert.ok(distToObstacle(f.x[i], f.z[i], o) >= LEAF_MARGIN - 1e-6, `leaf ${i} in ${o.id}`);
    assert.ok(f.y(i) > surfaceHeight(f.x[i], f.z[i]), `leaf ${i} below surface`);
  }
});

test('каждый лист можно подобрать: есть точка, откуда он в досягаемости и виден', () => {
  const f = fresh().field;
  for (let i = 0; i < f.count; i++) {
    let ok = false;
    for (let dx = -2.6; dx <= 2.6 && !ok; dx += 0.2) {
      for (let dz = -2.6; dz <= 2.6 && !ok; dz += 0.2) {
        const px = f.x[i] + dx, pz = f.z[i] + dz;
        if (!isWalkable(px, pz, PLAYER.radius)) continue;
        const ey = surfaceHeight(px, pz) + PLAYER.eyeHeight;
        const d = Math.hypot(dx, dz, ey - f.y(i));
        if (d > PLAYER.reach - 0.2) continue;
        if (!segmentBlocked(px, ey, pz, f.x[i], f.y(i) + 0.02, f.z[i])) ok = true;
      }
    }
    assert.ok(ok, `leaf ${i} at ${f.x[i].toFixed(2)},${f.z[i].toFixed(2)} unreachable`);
  }
});

test('стартовая позиция свободна, рядом с ней есть листья', () => {
  const g = fresh();
  assert.ok(isWalkable(g.player.x, g.player.z, PLAYER.radius));
  let near = 0;
  for (let i = 0; i < g.field.count; i++) if (Math.hypot(g.field.x[i] - g.player.x, g.field.z[i] - g.player.z) < 4) near++;
  assert.ok(near >= 20, `near=${near}`);
});

const ids = (n, from = 0) => Array.from({ length: n }, (_, i) => from + i);

test('мешок не переполняется, лист нельзя собрать дважды', () => {
  const { economy: e, field: f } = fresh();
  assert.equal(e.capacity, 50, 'мешок на старте — 50 листьев');
  const got = e.collect([...ids(60), 0, 1, 2]);
  assert.equal(got.length, 50);
  assert.equal(e.inBag, 50);
  assert.equal(e.collect([55]).length, 0);
  assert.deepEqual(e.collect(got), []);
  assert.equal(f.countState(IN_BAG), 50);
});

test('стартовые характеристики и баланс', () => {
  const { economy: e } = fresh();
  assert.equal(e.money, 0);
  assert.equal(formatMoney(e.money), '$0,00');
  assert.equal(e.grab, 1);
  assert.equal(e.pickTime, 0.5);
  assert.equal(e.capacity, 50);
  assert.equal(e.leafValue, 40, 'лист — $0,004');
});

test('продажа: 50 / 200 / 500 листьев = $0,20 / $0,80 / $2,00, доход только при сдаче', () => {
  for (const [n, text] of [[50, '$0,20'], [200, '$0,80'], [500, '$2,00']]) {
    const { economy: e } = fresh();
    e.progress.upgrades.bag = 2; // мешок на 500
    e.collect(ids(n));
    assert.equal(e.money, 0, 'при подборе денег нет');
    e.deposit();
    assert.equal(formatMoney(e.money), text);
    assert.equal(e.money, n * 40);
    assert.equal(e.deposit(), 0, 'повторная сдача пустого мешка ничего не даёт');
    assert.equal(e.money, n * 40);
  }
});

test('после бонуса +25 %: 50 / 200 / 500 листьев = $0,25 / $1,00 / $2,50', () => {
  for (const [n, text] of [[50, '$0,25'], [200, '$1,00'], [500, '$2,50']]) {
    const { economy: e } = fresh();
    e.progress.upgrades.bag = 2;
    e.progress.bonuses.push('yard-50');
    assert.equal(e.leafValue, 50);
    e.collect(ids(n));
    e.deposit();
    assert.equal(formatMoney(e.money), text);
  }
});

test('дробный остаток не теряется: пять сдач по листу = одна сдача пяти', () => {
  const a = fresh().economy, b = fresh().economy;
  for (let i = 0; i < 5; i++) { a.collect([i]); a.deposit(); }
  b.collect(ids(5)); b.deposit();
  assert.equal(a.money, b.money);
  assert.equal(a.money, 200); // $0,02
  // по одному листу баланс растёт на 40 единиц, не округляясь до цента
  const c = fresh().economy;
  c.collect([0]); c.deposit();
  assert.equal(c.money, 40);
  assert.equal(formatMoney(c.money), '$0,00');
  assert.equal(formatGain(c.lastGain), '+<$0,01');
});

test('бонус зоны выдаётся один раз при 50 % и сохраняется', () => {
  const g = fresh(), e = g.economy, f = g.field;
  let given = 0;
  for (let k = 0; k * 50 < f.count; k++) {
    e.collect(ids(Math.min(50, f.count - k * 50), k * 50));
    given += e.checkRewards().filter((r) => r.leafBonus).length;
    e.deposit();
    if (e.cleanedRatio >= 0.5) assert.equal(e.leafValue, 50);
  }
  assert.equal(given, 1, 'бонус цены — ровно один раз');
  assert.deepEqual(e.checkRewards(), [], 'повторно не выдаётся');
  assert.deepEqual(e.progress.bonuses.sort(), ['yard-100', 'yard-50']);
  const g2 = createGame(parseSave(JSON.stringify(buildSave(g))));
  assert.equal(g2.economy.leafValue, 50, 'бонус восстановлен после загрузки');
  assert.equal(g2.economy.money, e.money);
});

test('цены по таблице: каждая ступень списывается точно и по порядку', () => {
  const { economy: e } = fresh();
  const table = {
    grab: ['0,10', '0,50', '1,75', '3,50', '5,75'],
    speed: ['0,25', '0,75', '1,50', '2,75', '4,50'],
    bag: ['0,75', '3,49'],
  };
  const values = { grab: [1, 2, 3, 5, 7, 10], speed: [0.5, 0.43, 0.37, 0.31, 0.25, 0.2], bag: [50, 200, 500] };
  e.progress.money = e.progress.earned = usd(100);
  for (const b of BRANCHES) {
    table[b].forEach((price, k) => {
      const before = e.money;
      const res = e.buy(b);
      assert.ok(res, `${b} ${k + 1}`);
      assert.equal(formatMoney(before - e.money), '$' + price);
      assert.equal(before - e.money, UPGRADES[b].prices[k]);
      assert.equal(stat(e.progress, b), values[b][k + 1], 'характеристика изменилась');
    });
    assert.equal(e.buy(b), null, 'выше таблицы не покупается');
  }
  assert.equal(e.money, usd(100) - usd(25.59), 'вся доступная прокачка — $25,59');
});

test('нельзя купить без денег и в долг; неизвестные покупки отклоняются', () => {
  const { economy: e } = fresh();
  e.collect(ids(2)); e.deposit(); // $0,008
  assert.equal(e.buy('grab'), null, '$0,10 не хватает');
  assert.equal(e.money, 80);
  e.collect(ids(48, 2)); e.deposit(); // всего 50 листьев = $0,20
  assert.ok(e.buy('grab'));
  assert.equal(e.money, usd(0.10));
  assert.equal(e.buy('speed'), null, '$0,25 > $0,10');
  assert.equal(e.buy('rake'), null);
  assert.equal(e.buy('nope'), null);
  assert.ok(e.money >= 0);
});

test('случайные последовательности действий сохраняют инварианты', () => {
  const rng = mulberry32(42);
  for (let run = 0; run < 12; run++) {
    const { economy: e, field: f } = createGame(null, { seed: 1000 + run });
    for (let step = 0; step < 3000; step++) {
      const r = rng();
      if (r < 0.7) {
        const t = Math.floor(rng() * f.count);
        e.collect(f.gatherAround(t, e.grab).slice(0, Math.min(e.grab, e.free)));
        e.checkRewards();
      } else if (r < 0.85) e.deposit();
      else e.buy(BRANCHES[Math.floor(rng() * 3)]);
      assert.ok(e.inBag <= e.capacity);
      assert.ok(e.money >= 0);
      assert.ok(Number.isInteger(e.money));
    }
    assert.equal(e.inBag, f.countState(IN_BAG));
    assert.equal(e.sold, f.countState(SOLD));
    assert.equal(e.money, e.progress.earned - spentOn(e.progress.upgrades));
    assert.ok(e.progress.earned >= e.sold * 40 && e.progress.earned <= e.sold * 50);
    assert.equal(e.cleaned + f.countState(ON_GROUND), f.count);
  }
});

test('захват собирает выбранный лист и ближайших соседей без препятствий', () => {
  const { field: f } = fresh();
  const ids = f.gatherAround(0, 5);
  assert.equal(ids[0], 0);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of ids) {
    assert.equal(f.state[i], ON_GROUND);
    assert.ok(!segmentBlocked(f.x[0], f.y(0) + 0.05, f.z[0], f.x[i], f.y(i) + 0.05, f.z[i]));
  }
});

test('захват не берёт листья через стену', () => {
  // лист у забора участка: соседи по ту сторону забора (вне участка) не существуют,
  // поэтому проверяем препятствие внутри: ящик-контейнер
  assert.ok(segmentBlocked(1.4, 0.05, 2.7, 3.2, 0.05, 2.7));
  assert.ok(!segmentBlocked(1.4, 0.05, 1.9, 3.2, 0.05, 1.9));
});

test('сдвиг листа не уводит его в препятствие или за забор', () => {
  const { field: f } = fresh();
  const rng = mulberry32(5);
  for (let k = 0; k < 20000; k++) {
    const i = Math.floor(rng() * f.count);
    f.nudge(i, (rng() - 0.5) * 3, (rng() - 0.5) * 3);
  }
  for (let i = 0; i < f.count; i++) {
    for (const o of OBSTACLES) assert.ok(distToObstacle(f.x[i], f.z[i], o) >= LEAF_MARGIN - 1e-4, `leaf ${i} in ${o.id}`);
    assert.ok(f.x[i] >= ZONE.minX + LEAF_MARGIN - 1e-4 && f.x[i] <= ZONE.maxX - LEAF_MARGIN + 1e-4);
    assert.ok(f.z[i] >= ZONE.minZ + LEAF_MARGIN - 1e-4 && f.z[i] <= ZONE.maxZ - LEAF_MARGIN + 1e-4);
  }
});

test('игрок выталкивается из препятствий', () => {
  const p = resolveCircle(2.3, 2.7, PLAYER.radius);
  assert.ok(isWalkable(p.x, p.z, PLAYER.radius - 1e-6));
});

test('сохранение и загрузка восстанавливают деньги, покупки, мешок и листья', () => {
  const g = fresh();
  const e = g.economy;
  e.collect(ids(50)); e.deposit();      // $0,20
  e.buy('grab');                        // −$0,10
  e.collect([55]); e.deposit();         // +$0,004 → дробный остаток
  e.collect([60, 61, 62]);
  const text = JSON.stringify(buildSave(g));
  const g2 = createGame(parseSave(text));
  assert.deepEqual(g2.fixes, []);
  assert.equal(g2.economy.money, usd(0.10) + 40, 'баланс до $0,0001');
  assert.equal(g2.economy.progress.upgrades.grab, 1);
  assert.equal(g2.economy.inBag, 3);
  assert.equal(g2.economy.sold, 51);
  assert.deepEqual(Array.from(g2.field.state), Array.from(g.field.state));
});

test('подделанные деньги в сохранении исправляются', () => {
  const g = fresh();
  g.economy.collect([1, 2, 3]);
  g.economy.deposit();
  const data = buildSave(g);
  data.progress.money = 999999;
  data.progress.earned = 999999; // больше, чем возможно за 3 листа
  data.progress.bonuses = ['yard-50', 'чужой'];
  const g2 = createGame(parseSave(JSON.stringify(data)));
  assert.equal(g2.economy.money, 120);
  assert.deepEqual(g2.economy.progress.bonuses, [], 'бонус без 50 % уборки не принимается');
  assert.ok(g2.fixes.length > 0);
});

test('испорченное сохранение отклоняется с понятной ошибкой', () => {
  assert.throws(() => parseSave('{oops'), /не похож/);
  assert.throws(() => parseSave('{"version":999}'), /версия/);
});

test('листья лежат на земле или на других листьях: не висят и не уходят в землю', () => {
  const { field: f } = fresh();
  const tmp = [];
  for (let i = 0; i < f.count; i++) {
    const tilt = Math.max(Math.abs(f.tiltX[i]), Math.abs(f.tiltZ[i])) * f.flat[i];
    // наклонённый край не ниже земли
    assert.ok(f.lift[i] >= 0.5 * LEAF_EXTENT * f.scale[i] * Math.sin(tilt), `leaf ${i} sinks`);
    // лист выше 1 см лежит на каком-то листе под ним
    if (f.lift[i] > 0.01) {
      const under = f.neighbours(i, tmp).filter((j) => j < i && f.state[j] === ON_GROUND);
      assert.ok(under.length > 0, `leaf ${i} floats at ${f.lift[i]}`);
    }
  }
});

test('после сбора нижних листьев верхние опускаются', () => {
  const { field: f, economy: e } = fresh();
  // находим лист, лежащий на другом
  let top = -1;
  for (let i = 0; i < f.count && top < 0; i++) if (f.lift[i] > 0.012) top = i;
  assert.ok(top >= 0, 'есть листья в несколько слоёв');
  const before = f.lift[top];
  const under = f.neighbours(top, []).filter((j) => j < top);
  e.progress.upgrades.bag = 2;
  e.collect(under);
  f.settleAfter(under);
  assert.ok(f.lift[top] < before, `${f.lift[top]} < ${before}`);
  assert.ok(f.lift[top] <= 0.01, 'лёг на землю');
});

test('ходьба не сдвигает листья: позиции меняются только явным nudge', () => {
  const { field: f } = fresh();
  const x = Float32Array.from(f.x);
  f.settleAll();
  assert.deepEqual(Array.from(f.x), Array.from(x));
});

test('после загрузки высота слоёв та же, что при генерации', () => {
  const g = fresh();
  g.economy.collect([5, 6, 7]);
  g.field.settleAfter([5, 6, 7]);
  const g2 = createGame(parseSave(JSON.stringify(buildSave(g))));
  for (let i = 0; i < g.field.count; i++) assert.ok(Math.abs(g2.field.lift[i] - g.field.lift[i]) < 1e-6, `leaf ${i}`);
});

test('сохранение прежней экономики (монеты) распознаётся и не загружается как доллары', () => {
  const v2 = { version: 2, seed: 20261020, progress: { coins: 420, upgrades: { grab: 2, speed: 0, bag: 1 } },
    zones: { yard: { state: '0'.repeat(2500), pos: new Array(7500).fill(0) } } };
  const data = parseSave(JSON.stringify(v2));
  assert.ok(isLegacySave(data));
  assert.throws(() => createGame(data), /прежней экономики/);
  assert.ok(!isLegacySave(buildSave(fresh())));
});

test('формат денег: два знака, дробь не завышается', () => {
  assert.equal(formatMoney(0), '$0,00');
  assert.equal(formatMoney(2000), '$0,20');
  assert.equal(formatMoney(99999), '$9,99');
  assert.equal(formatMoney(usd(49.99)), '$49,99');
  assert.equal(formatGain(2500), '+$0,25');
});
