// Состояние игры без отрисовки: создание с нуля и из сохранения.

import { generateLeaves } from './leaves.js';
import { Economy, newProgress } from './economy.js';
import { DEFAULT_SETTINGS } from './save.js';
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
  let migrated = false;
  if (save) {
    progress = {
      coins: Number(save.progress.coins) || 0,
      upgrades: { ...newProgress().upgrades, ...save.progress.upgrades },
      carry: Number(save.progress.carry) || 0,
    };
    const zone = save.zones[level.id];
    if (save.version === 1 || zone?.state?.length !== count) {
      // Сохранение прежней раскладки двора (другое число листьев): листья раскладываются
      // заново, а заработанное (сданные листья и листья в мешке) и покупки сохраняются.
      const st = typeof zone?.state === 'string' ? zone.state : '';
      let earned = 0;
      for (const ch of st) if (ch === '1' || ch === '2') earned++;
      progress.carry += earned;
      migrated = true;
    } else if (!field.restore(zone)) {
      throw new Error('Состояние двора в сохранении повреждено');
    }
  }
  const economy = new Economy(field, progress);
  if (save) fixes = economy.validate();
  return {
    seed,
    field,
    economy,
    fixes,
    migrated,
    openZones: save?.openZones ?? [level.id],
    hints: { ...newHints(), ...(save?.hints ?? {}) },
    settings: { ...DEFAULT_SETTINGS, ...(save?.settings ?? {}) },
    player: save?.player ?? { ...level.spawn },
  };
}
