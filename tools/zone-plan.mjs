// Замер зон на коде игры: листья, площадь, плотность ковра, доход.
// Запуск: node tools/zone-plan.mjs        Время прохождения — node tools/campaign-sim.mjs.
//
// Площадь листа — по атласу (assets/leaves/leaf-atlas.json) и размерам из игры. Покрытие c — площадь
// листьев на площадь земли; доля открытой земли при случайной укладке ≈ e^(−c): c ≥ 2,3 — видно ≤ 10 %
// земли (плотный ковёр, как на референсах), c ≥ 1,5 — видно ≤ 22 %.

import { readFileSync } from 'node:fs';
import { LEAF_VALUE, LEAF_BONUS, formatMoney } from '../src/config.js';
import { createGame } from '../src/game.js';
import { setLevel, level, isFree, LEVELS, ZONE_ORDER } from '../src/layout.js';

const atlas = JSON.parse(readFileSync(new URL('../assets/leaves/leaf-atlas.json', import.meta.url)));
const SPECIES_SIZE = [1.12, 1.0, 0.86, 0.98, 0.88, 1.08];    // как в src/view/leafView.js
const SPECIES_WEIGHTS = [0.22, 0.17, 0.2, 0.11, 0.19, 0.11]; // как в src/leaves.js
const LEAF_BASE = 0.17, SCALE2 = 1 + 0.36 ** 2 / 12;         // E[scale²], scale ∈ [0,82; 1,18]
const leafArea = (size) => atlas.leaves.reduce((s, l, k) => s + SPECIES_WEIGHTS[k] * l.area * (LEAF_BASE * size * SPECIES_SIZE[k]) ** 2 * SCALE2, 0);

const CELL = 0.5;
let total = 0, bonuses = 0, earnedAll = 0;
console.log('| Зона | Листьев | Площадь под листья | Листьев/м² | Ковёр c ≥ 2,3 | Густо c ≥ 1,5 | Доход зоны | Доход всего |');
console.log('|---|---|---|---|---|---|---|---|');
for (const id of ZONE_ORDER) {
  setLevel(id);
  const L = level, Z = L.zone, A = leafArea(L.leafSize);
  // площадь, где могут лежать листья (без построек, бассейна, изгородей)
  let free = 0;
  for (let x = Z.minX + 0.05; x < Z.maxX; x += 0.1) for (let z = Z.minZ + 0.05; z < Z.maxZ; z += 0.1) if (isFree(x, z, L.leafMargin)) free += 0.01;
  const f = createGame().field, cells = new Map();
  for (let i = 0; i < f.count; i++) {
    const k = Math.floor(f.x[i] / CELL) + ':' + Math.floor(f.z[i] / CELL);
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  const share = (cMin) => {
    let area = 0, n = 0;
    for (const v of cells.values()) if ((v * A) / (CELL * CELL) >= cMin) { area += CELL * CELL; n += v; }
    return `${Math.round(area)} м², ${Math.round((100 * n) / f.count)} % листьев`;
  };
  // доход: первая половина зоны — по текущей цене, вторая — с бонусом этой зоны
  const half = Math.floor(L.leafCount / 2);
  const earned = half * (LEAF_VALUE + LEAF_BONUS * bonuses) + (L.leafCount - half) * (LEAF_VALUE + LEAF_BONUS * (bonuses + 1));
  bonuses++;
  earnedAll += earned; total += L.leafCount;
  console.log(`| ${L.name} | ${L.leafCount.toLocaleString('ru')} | ${Math.round(free)} м² | ${Math.round(L.leafCount / free)} | ${share(2.3)} | ${share(1.5)} | ${formatMoney(earned)} | ${formatMoney(earnedAll)} |`);
}
console.log(`\nВсего листьев: ${total.toLocaleString('ru')}; доход за всю игру ${formatMoney(earnedAll)} (если бонус зоны получен ровно на половине уборки).`);
console.log(`Площадь листа: ${(leafArea(LEVELS.yard.leafSize) * 1e4).toFixed(0)} см² (двор и дальше, размер ×${LEVELS.yard.leafSize}).`);
