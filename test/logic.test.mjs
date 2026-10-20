import test from 'node:test';
import assert from 'node:assert/strict';

import { ZONE, PLAYER, UPGRADES, BRANCHES } from '../src/config.js';
import { generateLeaves, ON_GROUND, IN_BAG, SOLD, LEAF_MARGIN, mulberry32 } from '../src/leaves.js';
import { Economy, spentOn } from '../src/economy.js';
import { OBSTACLES, distToObstacle, isWalkable, segmentBlocked, surfaceHeight, resolveCircle } from '../src/layout.js';
import { createGame } from '../src/game.js';
import { buildSave, parseSave } from '../src/save.js';

const fresh = () => createGame();

test('генерация детерминирована и даёт 600 листьев', () => {
  const a = generateLeaves(7, ZONE.leafCount), b = generateLeaves(7, ZONE.leafCount);
  assert.equal(a.count, 600);
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

test('мешок не переполняется, лист нельзя собрать дважды', () => {
  const { economy: e, field: f } = fresh();
  const ids = Array.from({ length: 30 }, (_, i) => i);
  const got = e.collect([...ids, 0, 1, 2]);
  assert.equal(got.length, 20);
  assert.equal(e.inBag, 20);
  assert.equal(e.collect([25]).length, 0);
  assert.deepEqual(e.collect(got), []);
  assert.equal(f.countState(IN_BAG), 20);
});

test('сдача неполного мешка, лист не продаётся дважды', () => {
  const { economy: e } = fresh();
  e.collect([1, 2, 3]);
  assert.equal(e.deposit(), 3);
  assert.equal(e.coins, 3);
  assert.equal(e.deposit(), 0);
  assert.deepEqual(e.collect([1, 2, 3]), []);
  assert.equal(e.coins, 3);
});

test('покупка списывает точную цену один раз и сразу меняет характеристику', () => {
  const { economy: e } = fresh();
  e.collect(Array.from({ length: 20 }, (_, i) => i));
  e.deposit();
  assert.equal(e.coins, 20);
  assert.equal(e.grab, 1);
  assert.ok(e.buy('grab'));
  assert.equal(e.coins, 10);
  assert.equal(e.grab, 2);
  assert.ok(e.buy('grab') === null, 'на второй уровень не хватает');
  assert.equal(e.coins, 10);
  assert.equal(e.buy('nope'), null);
  assert.ok(!e.buy('bag'));
  assert.ok(e.buy('speed') === null);
});

test('баланс не уходит в минус и прокачка не выходит за таблицу', () => {
  const g = createGame(null, { leafCount: 600 });
  const e = g.economy;
  // много денег: продаём всё, затем покупаем всё, что можно
  e.progress.upgrades.bag = 4; // ёмкость 500
  for (let k = 0; k < 2; k++) { e.collect(Array.from({ length: 600 }, (_, i) => i)); e.deposit(); }
  e.progress.upgrades.bag = 0;
  e.progress.coins = 100000;
  for (let n = 0; n < 50; n++) for (const b of BRANCHES) e.buy(b);
  for (const b of BRANCHES) assert.equal(e.progress.upgrades[b], UPGRADES[b].prices.length);
  assert.equal(e.progress.coins, 100000 - spentOn(e.progress.upgrades));
  for (const b of BRANCHES) assert.equal(e.buy(b), null);
});

test('случайные последовательности действий сохраняют инварианты', () => {
  const rng = mulberry32(42);
  for (let run = 0; run < 30; run++) {
    const { economy: e, field: f } = createGame(null, { seed: 1000 + run });
    for (let step = 0; step < 3000; step++) {
      const r = rng();
      if (r < 0.7) {
        const t = Math.floor(rng() * f.count);
        e.collect(f.gatherAround(t, e.grab).slice(0, Math.min(e.grab, e.free)));
      } else if (r < 0.85) e.deposit();
      else e.buy(BRANCHES[Math.floor(rng() * 3)]);
      assert.ok(e.inBag <= e.capacity);
      assert.ok(e.coins >= 0);
    }
    assert.equal(e.inBag, f.countState(IN_BAG));
    assert.equal(e.sold, f.countState(SOLD));
    assert.equal(e.coins, e.sold - spentOn(e.progress.upgrades));
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
  e.collect(Array.from({ length: 20 }, (_, i) => i));
  e.deposit();
  e.buy('grab');
  e.collect([40, 41, 42]);
  g.field.nudge(100, 0.5, 0.5);
  const text = JSON.stringify(buildSave(g));
  const g2 = createGame(parseSave(text));
  assert.deepEqual(g2.fixes, []);
  assert.equal(g2.economy.coins, 10);
  assert.equal(g2.economy.progress.upgrades.grab, 1);
  assert.equal(g2.economy.inBag, 3);
  assert.equal(g2.economy.sold, 20);
  assert.ok(Math.abs(g2.field.x[100] - g.field.x[100]) < 0.002);
  assert.deepEqual(Array.from(g2.field.state), Array.from(g.field.state));
});

test('подделанные деньги в сохранении исправляются', () => {
  const g = fresh();
  g.economy.collect([1, 2, 3]);
  g.economy.deposit();
  const data = buildSave(g);
  data.progress.coins = 99999;
  const g2 = createGame(parseSave(JSON.stringify(data)));
  assert.equal(g2.economy.coins, 3);
  assert.ok(g2.fixes.length > 0);
});

test('испорченное сохранение отклоняется с понятной ошибкой', () => {
  assert.throws(() => parseSave('{oops'), /не похож/);
  assert.throws(() => parseSave('{"version":999}'), /версия/);
});
