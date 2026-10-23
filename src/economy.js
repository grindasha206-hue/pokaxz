// Экономика: мешок, сдача за доллары, бонусы зоны, покупки. Чистый модуль без three.js.
//
// Мешок — это листья в состоянии IN_BAG, проданные — SOLD, поэтому лист невозможно
// собрать или продать дважды. Деньги — целые единицы по $0,0001 (см. config.js):
// лист стоит LEAF_VALUE единиц плюс LEAF_BONUS за каждый полученный бонус зоны.
// Доход начисляется при сдаче. Баланс проверяем так: money = earned − потрачено,
// а earned лежит между «все листья по базовой цене» и «все по цене с бонусами».

import { UPGRADES, BRANCHES, LEAF_VALUE, LEAF_BONUS, RAKE, RAKE_BRANCHES } from './config.js';
import { ON_GROUND, IN_BAG, SOLD } from './leaves.js';
import { LEVELS, ZONE_ORDER } from './layout.js';

export function newProgress() {
  return { money: 0, earned: 0, upgrades: { grab: 0, speed: 0, bag: 0 }, bonuses: [], tools: { rake: null }, inlets: [] };
}

/** Все приёмники игры (для цен и проверки сохранения). */
export const ALL_INLETS = ZONE_ORDER.flatMap((z) => LEVELS[z].inlets ?? []);
/** Все награды всех зон, с id зоны. */
export const ALL_REWARDS = ZONE_ORDER.flatMap((z) => (LEVELS[z].rewards ?? []).map((r) => ({ ...r, zone: z })));

export function stat(progress, branch) {
  return UPGRADES[branch].values[progress.upgrades[branch]];
}

export function nextLevel(progress, branch) {
  const u = UPGRADES[branch], lvl = progress.upgrades[branch];
  if (lvl >= u.prices.length) return null;
  return { price: u.prices[lvl], value: u.values[lvl + 1], current: u.values[lvl], level: lvl + 1 };
}

export function spentOn(upgrades) {
  let total = 0;
  for (const b of BRANCHES) {
    for (let l = 0; l < upgrades[b]; l++) total += UPGRADES[b].prices[l];
  }
  return total;
}

/** Всё потраченное: улучшения руки и мешка, грабли с улучшениями, приёмники. */
export function spentTotal(progress) {
  let total = spentOn(progress.upgrades);
  const rake = progress.tools?.rake;
  if (rake) {
    total += RAKE.price;
    for (const b of RAKE_BRANCHES) for (let l = 0; l < rake[b]; l++) total += RAKE.branches[b].prices[l];
  }
  for (const id of progress.inlets ?? []) total += ALL_INLETS.find((n) => n.id === id)?.price ?? 0;
  return total;
}

export class Economy {
  /**
   * rewards — награды зоны: [{ id, at: доля убранного, leafBonus: 1 | 0, text }].
   * Награда выдаётся один раз и хранится в progress.bonuses.
   */
  /**
   * ctx — другие зоны: allRewards (награды всех зон, по умолчанию — только этой),
   * otherSold (продано листьев в других зонах), rewardReached(r) — достигнут ли порог
   * награды другой зоны (для проверки сохранения).
   */
  constructor(field, progress = newProgress(), rewards = [], ctx = {}) {
    this.field = field;
    this.progress = progress;
    this.rewards = rewards;
    this.allRewards = ctx.allRewards ?? rewards;
    this.otherSold = ctx.otherSold ?? 0;
    this.rewardReached = ctx.rewardReached ?? (() => false);
    progress.tools ??= { rake: null };
    progress.inlets ??= [];
    this.lastGain = 0;
    this.recount();
  }

  recount() {
    this.inBag = this.field.countState(IN_BAG);
    this.sold = this.field.countState(SOLD);
  }

  get capacity() { return stat(this.progress, 'bag'); }
  get grab() { return stat(this.progress, 'grab'); }
  get pickTime() { return stat(this.progress, 'speed'); }
  get free() { return Math.max(0, this.capacity - this.inBag); }
  get money() { return this.progress.money; }
  get cleaned() { return this.inBag + this.sold; }
  get remaining() { return this.field.count - this.cleaned; }
  get cleanedRatio() { return this.cleaned / this.field.count; }

  /** Сколько бонусов к цене листа получено во всех зонах (каждый +25 % базовой цены). */
  get leafBonuses() {
    return this.allRewards.filter((r) => r.leafBonus && this.progress.bonuses.includes(r.id)).length;
  }

  get rake() { return this.progress.tools.rake; }

  /** Цена одного листа сейчас, в единицах $0,0001. */
  get leafValue() { return LEAF_VALUE + LEAF_BONUS * this.leafBonuses; }

  /** Кладёт в мешок лежащие листья из списка, сколько поместится. Возвращает собранные индексы. */
  collect(ids) {
    const f = this.field, taken = [], limit = this.free;
    for (const i of ids) {
      if (taken.length >= limit) break;
      if (i < 0 || i >= f.count || f.state[i] !== ON_GROUND) continue;
      f.state[i] = IN_BAG;
      this.inBag++;
      taken.push(i);
    }
    if (taken.length) f.version++;
    return taken;
  }

  /**
   * Выдаёт награды зоны, порог которых достигнут (по доле убранных листьев, включая мешок).
   * Каждая награда — один раз. Возвращает только что полученные.
   */
  checkRewards() {
    const got = [];
    for (const r of this.rewards) {
      if (this.cleanedRatio >= r.at && !this.progress.bonuses.includes(r.id)) {
        this.progress.bonuses.push(r.id);
        got.push(r);
      }
    }
    return got;
  }

  /**
   * Сдаёт всё содержимое мешка (в том числе неполный мешок) по текущей цене листа.
   * Возвращает число листьев; доход в единицах — в lastGain. Остаток меньше цента сохраняется.
   */
  deposit() {
    const f = this.field;
    let n = 0;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] === IN_BAG) { f.state[i] = SOLD; n++; }
    }
    const gain = n * this.leafValue;
    this.inBag -= n;
    this.sold += n;
    this.progress.money += gain;
    this.progress.earned += gain;
    this.lastGain = gain;
    if (n) f.version++;
    return n;
  }

  /**
   * Продаёт лежащие листья сразу, минуя мешок (приёмник). Возвращает число проданных;
   * доход — в lastGain.
   */
  sellDirect(ids) {
    const f = this.field;
    let n = 0;
    for (const i of ids) {
      if (i < 0 || i >= f.count || f.state[i] !== ON_GROUND) continue;
      f.state[i] = SOLD;
      n++;
    }
    const gain = n * this.leafValue;
    this.sold += n;
    this.progress.money += gain;
    this.progress.earned += gain;
    this.lastGain = gain;
    if (n) f.version++;
    return n;
  }

  /**
   * Что можно купить по ключу: 'grab' | 'speed' | 'bag' — ступени руки и мешка,
   * 'rake' — грабли, 'rake:handle' и т. п. — ступени граблей, 'inlet:<id>' — приёмник.
   * Возвращает { price, value, current, level } или null (нельзя купить вовсе).
   */
  offer(key) {
    const p = this.progress;
    if (UPGRADES[key]) return nextLevel(p, key);
    if (key === 'rake') return p.tools.rake ? null : { price: RAKE.price };
    if (key.startsWith('rake:')) {
      const b = RAKE.branches[key.slice(5)], lv = p.tools.rake?.[key.slice(5)];
      if (!b || lv === undefined || lv >= b.prices.length) return null;
      return { price: b.prices[lv], value: b.values[lv + 1], current: b.values[lv], level: lv + 1 };
    }
    if (key.startsWith('inlet:')) {
      const n = ALL_INLETS.find((x) => x.id === key.slice(6));
      if (!n || n.price === 0 || p.inlets.includes(n.id) || !p.tools.rake) return null;
      return { price: n.price, inlet: n };
    }
    return null;
  }

  canBuy(key) {
    const o = this.offer(key);
    return !!o && this.progress.money >= o.price;
  }

  /** Покупает по ключу (см. offer): списывает точную цену, ступень растёт ровно на 1. */
  buy(key) {
    const o = this.offer(key);
    if (!o || this.progress.money < o.price) return null;
    const p = this.progress;
    p.money -= o.price;
    if (UPGRADES[key]) p.upgrades[key]++;
    else if (key === 'rake') p.tools.rake = { handle: 0, sweep: 0, sticky: 0 };
    else if (key.startsWith('rake:')) p.tools.rake[key.slice(5)]++;
    else p.inlets.push(o.inlet.id);
    return o;
  }

  /**
   * Проверяет и при необходимости исправляет прогресс после загрузки.
   * Возвращает список исправлений (пустой — всё сошлось).
   */
  validate() {
    const fixes = [];
    const p = this.progress;
    const up = p.upgrades;
    for (const b of BRANCHES) {
      const max = UPGRADES[b].prices.length;
      const v = Number.isInteger(up[b]) ? up[b] : 0;
      if (v !== up[b] || v < 0 || v > max) fixes.push(`upgrade ${b}`);
      up[b] = Math.min(Math.max(v, 0), max);
    }
    // грабли: либо нет, либо уровни веток в пределах таблицы
    const rk = p.tools?.rake;
    if (rk && typeof rk === 'object') {
      for (const b of RAKE_BRANCHES) {
        const max = RAKE.branches[b].prices.length, v = Number.isInteger(rk[b]) ? rk[b] : 0;
        if (v !== rk[b] || v < 0 || v > max) fixes.push(`rake ${b}`);
        rk[b] = Math.min(Math.max(v, 0), max);
      }
    } else if (rk != null) fixes.push('rake');
    p.tools = { rake: rk && typeof rk === 'object' ? rk : null };
    // приёмники: известные, платные, без повторов и только при граблях
    const inl = Array.isArray(p.inlets) ? p.inlets : [];
    const inOk = p.tools.rake ? [...new Set(inl)].filter((id) => ALL_INLETS.some((n) => n.id === id && n.price > 0)) : [];
    if (inOk.length !== inl.length) fixes.push('inlets');
    p.inlets = inOk;
    this.recount();
    // бонусы: только известные, без повторов и только если порог действительно достигнут
    const valid = Array.isArray(p.bonuses) ? p.bonuses : [];
    const ok = [...new Set(valid)].filter((id) => {
      const own = this.rewards.find((x) => x.id === id);
      if (own) return this.cleanedRatio >= own.at;
      const r = this.allRewards.find((x) => x.id === id);
      return r && this.rewardReached(r);
    });
    if (ok.length !== valid.length) fixes.push('bonuses');
    p.bonuses = ok;
    // заработок — целое число в пределах, возможных при таком числе проданных листьев
    const sold = this.sold + this.otherSold;
    const lo = sold * LEAF_VALUE, hi = sold * (LEAF_VALUE + LEAF_BONUS * this.leafBonuses);
    const earned = Number.isInteger(p.earned) ? Math.min(Math.max(p.earned, lo), hi) : lo;
    if (earned !== p.earned) fixes.push(`earned ${p.earned} -> ${earned}`);
    p.earned = earned;
    if (earned - spentTotal(p) < 0) {
      // покупок больше, чем заработано, — сохранение повреждено; откатываем покупки
      for (const b of BRANCHES) up[b] = 0;
      p.tools.rake = null;
      p.inlets = [];
      fixes.push('upgrades exceed earnings');
    }
    const money = earned - spentTotal(p);
    if (p.money !== money) fixes.push(`money ${p.money} -> ${money}`);
    p.money = money;
    if (this.inBag > this.capacity) {
      // лишние листья возвращаются на землю, а не исчезают
      let extra = this.inBag - this.capacity;
      for (let i = this.field.count - 1; i >= 0 && extra > 0; i--) {
        if (this.field.state[i] === IN_BAG) { this.field.state[i] = ON_GROUND; extra--; }
      }
      fixes.push('bag over capacity');
      this.recount();
    }
    return fixes;
  }
}
