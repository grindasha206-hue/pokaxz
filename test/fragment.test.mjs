import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER } from '../src/config.js';
import { setLevel, level, distToObstacle, isWalkable, segmentBlocked, surfaceHeight, YARD } from '../src/layout.js';
import { createGame } from '../src/game.js';
import { mulberry32, IN_BAG } from '../src/leaves.js';

test('фрагмент: плотный слой листьев без попаданий в препятствия и под землю', () => {
  setLevel('fragment');
  try {
    const { field: f, economy: e } = createGame();
    assert.equal(f.count, level.leafCount);
    const Z = level.zone;
    for (let i = 0; i < f.count; i++) {
      assert.ok(f.x[i] >= Z.minX && f.x[i] <= Z.maxX && f.z[i] >= Z.minZ && f.z[i] <= Z.maxZ);
      for (const o of level.obstacles) assert.ok(distToObstacle(f.x[i], f.z[i], o) >= level.leafMargin - 1e-6, `leaf ${i} in ${o.id}`);
      assert.ok(f.y(i) > surfaceHeight(f.x[i], f.z[i]));
    }
    // выборочно: каждый лист досягаем с доступной точки
    const rng = mulberry32(3);
    for (let k = 0; k < 300; k++) {
      const i = Math.floor(rng() * f.count);
      let ok = false;
      for (let dx = -2.4; dx <= 2.4 && !ok; dx += 0.3) {
        for (let dz = -2.4; dz <= 2.4 && !ok; dz += 0.3) {
          const px = f.x[i] + dx, pz = f.z[i] + dz;
          if (!isWalkable(px, pz, PLAYER.radius)) continue;
          const ey = PLAYER.eyeHeight;
          if (Math.hypot(dx, dz, ey - f.y(i)) > PLAYER.reach - 0.2) continue;
          if (!segmentBlocked(px, ey, pz, f.x[i], f.y(i) + 0.02, f.z[i])) ok = true;
        }
      }
      assert.ok(ok, `leaf ${i} unreachable`);
    }
    // экономика та же: мешок, сдача, покупки
    e.collect(Array.from({ length: 30 }, (_, i) => i));
    assert.equal(e.inBag, 20);
    assert.equal(f.countState(IN_BAG), 20);
    assert.equal(e.deposit(), 20);
    assert.ok(e.buy('grab'));
    assert.equal(e.coins, 10);
  } finally {
    setLevel(YARD);
  }
});
