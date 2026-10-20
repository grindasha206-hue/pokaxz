// Состояние игры без отрисовки: создание с нуля и из сохранения.

import { ZONE } from './config.js';
import { generateLeaves } from './leaves.js';
import { Economy, newProgress } from './economy.js';
import { DEFAULT_SETTINGS } from './save.js';
import { SPAWN } from './layout.js';

export const DEFAULT_SEED = 20261020;

export function newHints() {
  return { picked: false, deposited: false, bought: false };
}

export function createGame(save = null, opts = {}) {
  const seed = save ? save.seed : (opts.seed ?? DEFAULT_SEED);
  const count = opts.leafCount ?? ZONE.leafCount;
  const field = generateLeaves(seed, count);
  let progress = newProgress();
  let fixes = [];
  if (save) {
    if (!field.restore(save.zones[ZONE.id])) throw new Error('Состояние двора в сохранении повреждено');
    progress = {
      coins: Number(save.progress.coins) || 0,
      upgrades: { ...newProgress().upgrades, ...save.progress.upgrades },
    };
  }
  const economy = new Economy(field, progress);
  if (save) fixes = economy.validate();
  return {
    seed,
    field,
    economy,
    fixes,
    openZones: save?.openZones ?? [ZONE.id],
    hints: { ...newHints(), ...(save?.hints ?? {}) },
    settings: { ...DEFAULT_SETTINGS, ...(save?.settings ?? {}) },
    player: save?.player ?? { ...SPAWN },
  };
}
