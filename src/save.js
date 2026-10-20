// Сохранение: сериализация, localStorage, экспорт и восстановление.

import { SAVE_KEY, SAVE_VERSION } from './config.js';
import { level } from './layout.js';

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
    zones: { [level.id]: game.field.serialize() },
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
  if (data.version !== SAVE_VERSION && data.version !== 1) throw new Error(`Неизвестная версия сохранения: ${data.version}`);
  if (!Number.isInteger(data.seed)) throw new Error('В сохранении нет зерна участка');
  if (!data.progress || !data.progress.upgrades) throw new Error('В сохранении нет покупок');
  if (!data.zones || !data.zones[level.id]) throw new Error('В сохранении нет состояния двора');
  return data;
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
