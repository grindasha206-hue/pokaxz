// Состояние игры без отрисовки: создание с нуля и из сохранения.
//
// Зоны: в сохранении хранится состояние листьев каждой посещённой зоны (zones[id]),
// активна одна — level (см. layout.setLevel). Деньги, покупки и награды общие.

import { generateLeaves, SOLD, IN_BAG } from './leaves.js';
import { Economy, newProgress, ALL_REWARDS, zoneUnlocked } from './economy.js';
import { DEFAULT_SETTINGS, isLegacySave } from './save.js';
import { level, LEVELS, ZONE_ORDER } from './layout.js';

export const DEFAULT_SEED = 20261020;

export function newHints() {
  return { picked: false, deposited: false, bought: false };
}

/** Зерно генерации листьев зоны: у двора — зерно игры (совместимо с прежними сохранениями). */
export function zoneSeed(seed, id) {
  const k = ZONE_ORDER.indexOf(id);
  return k <= 0 ? seed : (seed + 1000003 * k) >>> 0;
}

/** Сводка по сохранённой (неактивной) зоне: продано и доля убранного. */
export function zoneSummary(id, data) {
  const s = typeof data?.state === 'string' ? data.state : '';
  const n = LEVELS[id]?.leafCount ?? 0;
  if (!n || s.length !== n) return { sold: 0, ratio: 0 };
  let sold = 0;
  for (let i = 0; i < n; i++) if (s.charCodeAt(i) - 48 === SOLD) sold++;
  return { sold, ratio: sold / n };
}

export function createGame(save = null, opts = {}) {
  const seed = save ? save.seed : (opts.seed ?? DEFAULT_SEED);
  const count = opts.leafCount ?? level.leafCount;
  const field = generateLeaves(zoneSeed(seed, level.id), count);
  let progress = newProgress();
  let fixes = [];
  const zones = { ...(save?.zones ?? {}) };
  let otherSold = 0;
  const ratios = {};
  if (save) {
    if (isLegacySave(save)) throw new Error('Сохранение прежней экономики (монеты) — см. isLegacySave');
    const p = save.progress;
    progress = {
      money: p.money, earned: p.earned,
      upgrades: { ...newProgress().upgrades, ...p.upgrades },
      bonuses: Array.isArray(p.bonuses) ? [...p.bonuses] : [],
      tools: { rake: p.tools?.rake ? { ...p.tools.rake } : null },
      inlets: Array.isArray(p.inlets) ? [...p.inlets] : [],
    };
    if (zones[level.id] && !field.restore(zones[level.id])) throw new Error(`Состояние зоны «${level.name}» в сохранении повреждено`);
    if (zones[level.id] === undefined && level.id !== 'yard' && !save.zones?.yard) throw new Error('В сохранении нет двора');
    for (const [id, data] of Object.entries(zones)) {
      if (id === level.id || !LEVELS[id]) continue;
      const z = zoneSummary(id, data);
      otherSold += z.sold;
      ratios[id] = z.ratio;
    }
  }
  // мешок в неактивной зоне не бывает: переход между зонами только с пустым мешком
  const economy = new Economy(field, progress, level.rewards ?? [], {
    allRewards: ALL_REWARDS, otherSold, rewardReached: (r) => (ratios[r.zone] ?? 0) >= r.at,
  });
  if (save) fixes = economy.validate();
  const samePlace = save && (save.currentZone ?? 'yard') === level.id && save.player;
  return {
    seed,
    field,
    economy,
    fixes,
    zones,
    openZones: [...new Set([...(save?.openZones ?? []), level.id])],
    hints: { ...newHints(), ...(save?.hints ?? {}) },
    settings: { ...DEFAULT_SETTINGS, ...(save?.settings ?? {}) },
    player: samePlace ? save.player : { ...level.spawn },
  };
}

export { zoneUnlocked };

/** Есть ли в поле листья в мешке (переход между зонами только с пустым мешком). */
export const bagEmpty = (field) => field.countState(IN_BAG) === 0;
