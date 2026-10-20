// Состояние игры без отрисовки: создание с нуля и из сохранения.

import { generateLeaves } from './leaves.js';
import { Economy, newProgress } from './economy.js';
import { DEFAULT_SETTINGS, isLegacySave } from './save.js';
import { level } from './layout.js';

export const DEFAULT_SEED = 20261020;

export function newHints() {
  return { picked: false, deposited: false, bought: false };
}

export function createGame(save = null, opts = {}) {
  const seed = save ? save.seed : (opts.seed ?? DEFAULT_SEED);
  const count = opts.leafCount ?? level.leafCount;
  const field = generateLeaves(seed, count);
  let progress = newProgress();
  let fixes = [];
  if (save) {
    if (isLegacySave(save)) throw new Error('Сохранение прежней экономики (монеты) — см. isLegacySave');
    const p = save.progress;
    progress = {
      money: p.money, earned: p.earned,
      upgrades: { ...newProgress().upgrades, ...p.upgrades },
      bonuses: Array.isArray(p.bonuses) ? [...p.bonuses] : [],
    };
    if (!field.restore(save.zones[level.id])) throw new Error('Состояние двора в сохранении повреждено');
  }
  const economy = new Economy(field, progress, level.rewards ?? []);
  if (save) fixes = economy.validate();
  return {
    seed,
    field,
    economy,
    fixes,
    openZones: save?.openZones ?? [level.id],
    hints: { ...newHints(), ...(save?.hints ?? {}) },
    settings: { ...DEFAULT_SETTINGS, ...(save?.settings ?? {}) },
    player: save?.player ?? { ...level.spawn },
  };
}
