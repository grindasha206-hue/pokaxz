// Игровые константы и таблицы прокачки.
// Модуль чистый (без three.js), чтобы его можно было проверять в node.

export const UPGRADES = {
  grab: {
    title: 'Захват',
    unit: (v) => `${v} ${plural(v, 'лист', 'листа', 'листьев')}`,
    values: [1, 2, 3, 5, 7, 10],
    prices: [10, 40, 120, 280, 550],
  },
  speed: {
    title: 'Скорость',
    unit: (v) => `${v.toFixed(1).replace('.', ',')} с`,
    values: [0.6, 0.5, 0.4, 0.3, 0.2],
    prices: [15, 60, 180, 450],
  },
  bag: {
    title: 'Мешок',
    unit: (v) => `${v} ${plural(v, 'лист', 'листа', 'листьев')}`,
    values: [20, 50, 100, 200, 500],
    prices: [20, 80, 220, 600],
  },
};

export const BRANCHES = Object.keys(UPGRADES);

export const COINS_PER_LEAF = 1;

// Участок прототипа
export const ZONE = {
  id: 'yard',
  name: 'Двор',
  leafCount: 2500,
  // границы участка (метры, мир XZ): с севера дом, с остальных сторон забор
  minX: -8, maxX: 8, minZ: -9, maxZ: 7,
};

export const PLAYER = {
  radius: 0.35,
  eyeHeight: 1.62,
  walkSpeed: 3.6,
  reach: 3.2,          // дальность подбора от глаз
  interactReach: 2.6,  // контейнер / магазин
};

// радиус, в котором захват ищет соседей вокруг выбранного листа
export const GRAB_RADIUS = 2.4;

// сколько оставшихся листьев подсвечивать в конце уборки
export const REMAINING_HIGHLIGHT = 12;

export const SAVE_KEY = 'leaf-yard-save-v1';
export const SAVE_VERSION = 2;
// v1 — двор из 600 листьев; при загрузке переносятся деньги и покупки (см. game.js)

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
