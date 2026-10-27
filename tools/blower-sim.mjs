// Замер скорости воздуходувки на коде игры: бот убирает террасу с бассейном (см. tools/bots.mjs).
// Запуск: node tools/blower-sim.mjs [pool|court|garden]
// Как играл бы человек: воздуходувка гонит основную массу в приёмники, грабли (на максимуме)
// отводят листья от заборов и углов, остаток — рукой на максимуме (мешок 500).

import { LEVELS } from '../src/layout.js';
import { simulate, report, RAKE_MAX, BLOWER_MAX, BLOWER_NONE } from './bots.mjs';

const zone = process.argv[2] || 'pool';
const runs = [
  ['рука на максимуме', { phases: ['hand'] }],
  ['грабли на максимуме + рука', { phases: ['rake', 'hand'] }],
  ['воздуходувка без улучшений, 1 приёмник', { blower: BLOWER_NONE, inlets: 'first' }],
  ['воздуходувка без улучшений, 2 приёмника', { blower: BLOWER_NONE }],
  ['воздуходувка 2/2/2, 2 приёмника', { blower: { width: 2, power: 2, accuracy: 2 } }],
  ['воздуходувка на максимуме, 2 приёмника', { blower: BLOWER_MAX }],
];
console.log(`${LEVELS[zone].name}: ${LEVELS[zone].leafCount} листьев.`);
for (const [name, o] of runs) console.log(report(name, simulate({ zone, phases: ['blower', 'rake', 'hand'], rake: RAKE_MAX, ...o })));
