// Экономика: мешок, сдача за доллары, бонусы зоны, покупки. Чистый модуль без three.js.
//
// Мешок — это листья в состоянии IN_BAG, проданные — SOLD, поэтому лист невозможно
// собрать или продать дважды. Деньги — целые единицы по $0,0001 (см. config.js):
// лист стоит LEAF_VALUE единиц плюс LEAF_BONUS за каждый полученный бонус зоны.
// Доход начисляется при сдаче. Баланс проверяем так: money = earned − потрачено,
// а earned лежит между «все листья по базовой цене» и «все по цене с бонусами».

import { UPGRADES, BRANCHES, LEAF_VALUE, LEAF_BONUS } from './config.js';
import { ON_GROUND, IN_BAG, SOLD } from './leaves.js';

export function newProgress() {
  return { money: 0, earned: 0, upgrades: { grab: 0, speed: 0, bag: 0 }, bonuses: [] };
}

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

export class Economy {
  /**
   * rewards — награды зоны: [{ id, at: доля убранного, leafBonus: 1 | 0, text }].
   * Награда выдаётся один раз и хранится в progress.bonuses.
   */
  constructor(field, progress = newProgress(), rewards = []) {
    this.field = field;
    this.progress = progress;
    this.rewards = rewards;
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

  /** Сколько бонусов к цене листа получено (каждый +25 % базовой цены). */
  get leafBonuses() {
    return this.rewards.filter((r) => r.leafBonus && this.progress.bonuses.includes(r.id)).length;
  }

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

  canBuy(branch) {
    const next = nextLevel(this.progress, branch);
    return !!next && this.progress.money >= next.price;
  }

  /** Покупает следующую ступень ветки: списывает точную цену, уровень растёт ровно на 1. */
  buy(branch) {
    if (!UPGRADES[branch]) return null;
    const next = nextLevel(this.progress, branch);
    if (!next || this.progress.money < next.price) return null;
    this.progress.money -= next.price;
    this.progress.upgrades[branch]++;
    return next;
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
    this.recount();
    // бонусы: только известные, без повторов и только если порог действительно достигнут
    const valid = Array.isArray(p.bonuses) ? p.bonuses : [];
    const ok = [...new Set(valid)].filter((id) => {
      const r = this.rewards.find((x) => x.id === id);
      return r && this.cleanedRatio >= r.at;
    });
    if (ok.length !== valid.length) fixes.push('bonuses');
    p.bonuses = ok;
    // заработок — целое число в пределах, возможных при таком числе проданных листьев
    const lo = this.sold * LEAF_VALUE, hi = this.sold * (LEAF_VALUE + LEAF_BONUS * this.leafBonuses);
    const earned = Number.isInteger(p.earned) ? Math.min(Math.max(p.earned, lo), hi) : lo;
    if (earned !== p.earned) fixes.push(`earned ${p.earned} -> ${earned}`);
    p.earned = earned;
    if (earned - spentOn(up) < 0) {
      // покупок больше, чем заработано, — сохранение повреждено; откатываем покупки
      for (const b of BRANCHES) up[b] = 0;
      fixes.push('upgrades exceed earnings');
    }
    const money = earned - spentOn(up);
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
