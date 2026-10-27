// Замер скорости граблей на коде игры: бот убирает сад и площадку у гаража (см. tools/bots.mjs).
// Запуск: node tools/rake-sim.mjs [garden|court|pool]
// Остаток, который граблями к приёмнику не подтянуть, собирается рукой на максимуме (мешок 500).

import { LEVELS } from '../src/layout.js';
import { simulate, report, RAKE_MAX, RAKE_NONE } from './bots.mjs';

const runs = [
  ['рука на максимуме, без граблей', { phases: ['hand'] }],
  ['грабли без улучшений, 1 приёмник', { rake: RAKE_NONE, inlets: 'first' }],
  ['грабли без улучшений, 2 приёмника', { rake: RAKE_NONE }],
  ['грабли 2/2/2, 2 приёмника', { rake: { handle: 2, sweep: 2, sticky: 2 } }], // примерно к концу сада
  ['грабли на максимуме, 2 приёмника', { rake: RAKE_MAX }],
];
for (const zone of process.argv[2] ? [process.argv[2]] : ['garden', 'court']) {
  console.log(`\n${LEVELS[zone].name}: ${LEVELS[zone].leafCount} листьев.`);
  for (const [name, o] of runs) console.log(report(name, simulate({ zone, phases: ['rake', 'hand'], ...o })));
}
