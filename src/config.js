// Игровые константы и таблицы прокачки.
// Модуль чистый (без three.js), чтобы его можно было проверять в node.

// ── деньги ───────────────────────────────────────────────────
// Доллары храним целыми единицами по $0,0001, чтобы цены списывались точно,
// а дробный остаток от продажи листьев не терялся.
export const UNITS_PER_DOLLAR = 10000;
export const usd = (d) => Math.round(d * UNITS_PER_DOLLAR);

// Цена листа: $0,004 (настройка баланса нашей версии). Каждый бонус зоны: +25 % базовой цены.
export const LEAF_VALUE = 40;  // $0,004
export const LEAF_BONUS = 10;  // +$0,001 за бонус

// Таблицы улучшений — по таблице Leaf it Alone. values[0] — начальная характеристика,
// prices[i] — цена перехода на уровень i + 1; каждая ступень покупается отдельно и по порядку.
// Удержание кнопки для сбора бесплатно с начала (Fluid Picker не продаётся).
export const UPGRADES = {
  grab: {
    title: 'Жадная хватка',
    hint: 'листьев за один подбор',
    unit: (v) => `${v} ${plural(v, 'лист', 'листа', 'листьев')}`,
    values: [1, 2, 3, 5, 7, 10],
    prices: [0.10, 0.50, 1.75, 3.50, 5.75].map(usd),
  },
  speed: {
    title: 'Ловкость',
    hint: 'время подбора',
    unit: (v) => `${v.toFixed(2).replace('.', ',')} с`,
    values: [0.5, 0.43, 0.37, 0.31, 0.25, 0.2],
    prices: [0.25, 0.75, 1.50, 2.75, 4.50].map(usd),
  },
  bag: {
    title: 'Мешок',
    hint: 'вместимость',
    unit: (v) => `${v} ${plural(v, 'лист', 'листа', 'листьев')}`,
    values: [50, 200, 500],
    levelNames: ['обычный', 'средний', 'большой'],
    prices: [0.75, 3.49].map(usd),
  },
};

export const BRANCHES = Object.keys(UPGRADES);

// ── инструменты ──────────────────────────────────────────────
// Грабли — по таблице Leaf it Alone: покупка и три ветки улучшений; values[0] — без улучшений.
// Длина черенка задаёт, как далеко ставятся грабли, и путь листьев за один взмах.
export const RAKE = {
  title: 'Грабли', price: usd(7.49), info: 'сгребают листья в кучи и в приёмники',
  branches: {
    handle: {
      title: 'Длина черенка', hint: 'дальность и путь за взмах',
      values: [2.0, 2.05, 2.1, 2.15, 2.2], dist: [0.62, 0.64, 0.66, 0.68, 0.7],
      unit: (v, k) => `${v.toFixed(2).replace('.', ',')} м, ${RAKE.branches.handle.dist[k].toFixed(2).replace('.', ',')} м за взмах`,
      prices: [3.50, 6.00, 8.50, 11.00].map(usd),
    },
    sweep: {
      title: 'Ширина захвата', hint: 'радиус граблей',
      values: [0.45, 0.48, 0.51, 0.54, 0.57, 0.6],
      unit: (v) => `${v.toFixed(2).replace('.', ',')} м`,
      prices: [4.00, 6.75, 9.50, 12.25, 14.00].map(usd),
    },
    sticky: {
      title: 'Цепкость листьев', hint: 'какая доля листьев идёт за граблями',
      values: [0.8, 0.85, 0.9, 0.95, 1],
      unit: (v) => `${Math.round(v * 100)} %`,
      prices: [5.00, 6.50, 8.00, 9.50].map(usd),
    },
  },
};
export const RAKE_BRANCHES = Object.keys(RAKE.branches);
// Взмах граблями: голова ставится в точку взгляда (не дальше 0,65 длины черенка) и тянется
// к игроку на dist метров. time — длительность взмаха, reach — сколько захватывают зубья за головой,
// back — глубина валика перед зубьями, carry — сколько листьев валик может тащить за раз.
export const RAKE_STROKE = { time: 0.42, reachK: 0.65, minStart: 1.05, reach: 0.14, back: 0.12, carry: 400 };

// Воздуходувки в игре ещё нет: показывается в блокноте, но не продаётся.
export const LOCKED_TOOLS = [
  {
    title: 'Воздуходувка', price: usd(49.99), info: 'гнать листья по двору и в приёмники',
    upgrades: [
      { title: 'Ширина потока', prices: [28, 35, 40, 46, 50].map(usd), info: '0,55 → 0,75 м' },
      { title: 'Мощность', prices: [15, 20, 24, 27].map(usd), info: 'до 2400 Вт, запуск 0,2 с' },
      { title: 'Точность', prices: [10, 16, 21, 25].map(usd), info: 'разброс 0,48 → 0,12' },
    ],
  },
];

/** $1234,5678 → «$1234,56»: всегда два знака, дробь отбрасывается (не завышаем баланс). */
export function formatMoney(units) {
  const u = Math.max(0, Math.floor(units));
  const cents = Math.floor(u / 100);
  return `$${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

/** Доход для сообщения: «+$0,20»; меньше цента — «+<$0,01» (сам остаток сохраняется). */
export function formatGain(units) {
  if (units > 0 && units < 100) return '+<$0,01';
  return '+' + formatMoney(units);
}


// Участок прототипа
export const ZONE = {
  id: 'yard',
  name: 'Двор',
  leafCount: 6400, // см. README «Экономика»: хватает на всю доступную прокачку ($25,59) с запасом
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
export const SAVE_VERSION = 4;
// v4 — несколько зон, инструменты и приёмники; v3 (доллары, одна зона) загружается без потерь.
// v1, v2 — прежняя экономика в монетах. Такие сохранения не пересчитываются в доллары:
// игра предлагает экспортировать их и начать заново (см. isLegacySave, main.js).
export const LEGACY_BACKUP_KEY = 'leaf-yard-save-legacy-backup';

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
