// Сохранение: сериализация, localStorage, экспорт и восстановление.

import { SAVE_KEY, SAVE_VERSION } from './config.js';
import { level, ZONE_ORDER } from './layout.js';

export const DEFAULT_SETTINGS = {
  sensitivity: 1,       // множитель чувствительности обзора
  invertY: false,
  collectMode: 'hold',  // 'hold' — удержание E; 'toggle' — включение одним нажатием
  volMaster: 0.8,
  volEffects: 0.9,
  volAmbient: 0.5,
  highlightLast: true,
  shadows: true,
  showFps: false,
};

export function buildSave(game) {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed: game.seed,
    progress: game.economy.progress,
    zones: { ...(game.zones ?? {}), [level.id]: game.field.serialize() },
    currentZone: game.nextZone ?? level.id,
    openZones: game.openZones,
    hints: game.hints,
    settings: game.settings,
    player: game.player ? { x: round(game.player.x), z: round(game.player.z), yaw: round(game.player.yaw) } : null,
  };
}

const round = (v) => Math.round(v * 1000) / 1000;

/** Проверяет формат сохранения. Бросает ошибку с понятным текстом. */
export function parseSave(text) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('Файл не похож на сохранение'); }
  if (!data || typeof data !== 'object') throw new Error('Файл не похож на сохранение');
  if (![1, 2, 3, SAVE_VERSION].includes(data.version)) throw new Error(`Неизвестная версия сохранения: ${data.version}`);
  if (!Number.isInteger(data.seed)) throw new Error('В сохранении нет зерна участка');
  if (!data.progress || !data.progress.upgrades) throw new Error('В сохранении нет покупок');
  if (!data.zones || typeof data.zones !== 'object' || !data.zones.yard) throw new Error('В сохранении нет состояния двора');
  if (data.currentZone !== undefined && !ZONE_ORDER.includes(data.currentZone)) throw new Error(`Неизвестная зона: ${data.currentZone}`);
  return data;
}

/**
 * Сохранение прежней экономики (версии 1–2, монеты). Монеты не пересчитываются в доллары
 * один к одному: игра предлагает экспортировать такой прогресс и начать заново.
 */
export function isLegacySave(data) {
  return !!data && (data.version === 1 || data.version === 2);
}

/** Исходный текст сохранения из хранилища (для экспорта прежнего прогресса). */
export function readLocalRaw(storage = globalThis.localStorage) {
  try { return storage.getItem(SAVE_KEY); } catch { return null; }
}

export function readLocal(storage = globalThis.localStorage) {
  try {
    const text = storage.getItem(SAVE_KEY);
    return text ? parseSave(text) : null;
  } catch (e) {
    console.warn('save: cannot read', e);
    return null;
  }
}

export function writeLocal(data, storage = globalThis.localStorage) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('save: cannot write', e);
    return false;
  }
}

export function clearLocal(storage = globalThis.localStorage) {
  try { storage.removeItem(SAVE_KEY); } catch { /* недоступно — нечего удалять */ }
}
