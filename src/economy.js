// Экономика: мешок, сдача, покупки. Чистый модуль без three.js.
//
// Источник правды — состояние листьев. Мешок — это листья в состоянии IN_BAG,
// заработок — листья SOLD. Поэтому лист невозможно собрать или продать дважды,
// а баланс всегда можно проверить: coins = sold * COINS_PER_LEAF − потрачено.

import { UPGRADES, BRANCHES, COINS_PER_LEAF } from './config.js';
import { ON_GROUND, IN_BAG, SOLD } from './leaves.js';

export function newProgress() {
  return { coins: 0, upgrades: { grab: 0, speed: 0, bag: 0 }, carry: 0 };
}

export function stat(progress, branch) {
  return UPGRADES[branch].values[progress.upgrades[branch]];
}

export function nextLevel(progress, branch) {
  const u = UPGRADES[branch], lvl = progress.upgrades[branch];
  if (lvl >= u.prices.length) return null;
  return { price: u.prices[lvl], value: u.values[lvl + 1], current: u.values[lvl] };
}

export function spentOn(upgrades) {
  let total = 0;
  for (const b of BRANCHES) {
    for (let l = 0; l < upgrades[b]; l++) total += UPGRADES[b].prices[l];
  }
  return total;
}

export class Economy {
  constructor(field, progress = newProgress()) {
    this.field = field;
    this.progress = progress;
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
  get coins() { return this.progress.coins; }
  get cleaned() { return this.inBag + this.sold; }
  get remaining() { return this.field.count - this.cleaned; }
  get cleanedRatio() { return this.cleaned / this.field.count; }

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

  /** Сдаёт всё содержимое мешка (в том числе неполный мешок). Возвращает число листьев. */
  deposit() {
    const f = this.field;
    let n = 0;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] === IN_BAG) { f.state[i] = SOLD; n++; }
    }
    this.inBag -= n;
    this.sold += n;
    this.progress.coins += n * COINS_PER_LEAF;
    if (n) f.version++;
    return n;
  }

  canBuy(branch) {
    const next = nextLevel(this.progress, branch);
    return !!next && this.progress.coins >= next.price;
  }

  /** Покупает следующий уровень ветки. Списывает точную цену, уровень растёт ровно на 1. */
  buy(branch) {
    if (!UPGRADES[branch]) return null;
    const next = nextLevel(this.progress, branch);
    if (!next || this.progress.coins < next.price) return null;
    this.progress.coins -= next.price;
    this.progress.upgrades[branch]++;
    return next;
  }

  /**
   * Проверяет и при необходимости исправляет прогресс после загрузки.
   * Возвращает список исправлений (пустой — всё сошлось).
   */
  validate() {
    const fixes = [];
    const up = this.progress.upgrades;
    for (const b of BRANCHES) {
      const max = UPGRADES[b].prices.length;
      const v = Number.isInteger(up[b]) ? up[b] : 0;
      if (v !== up[b] || v < 0 || v > max) fixes.push(`upgrade ${b}`);
      up[b] = Math.min(Math.max(v, 0), max);
    }
    this.recount();
    // carry — заработок, перенесённый из сохранения прежней раскладки двора
    const carry = Number.isFinite(this.progress.carry) && this.progress.carry > 0 ? Math.floor(this.progress.carry) : 0;
    this.progress.carry = carry;
    const expected = carry + this.sold * COINS_PER_LEAF - spentOn(up);
    if (expected < 0) {
      // покупок больше, чем заработано, — сохранение повреждено; откатываем покупки
      for (const b of BRANCHES) up[b] = 0;
      fixes.push('upgrades exceed earnings');
    }
    const coins = carry + this.sold * COINS_PER_LEAF - spentOn(up);
    if (this.progress.coins !== coins) fixes.push(`coins ${this.progress.coins} -> ${coins}`);
    this.progress.coins = coins;
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
