// Интерфейс поверх сцены: HUD, подсказки, магазин-блокнот, пауза и настройки.

import { UPGRADES, BRANCHES, LOCKED_TOOLS, formatMoney, formatGain, plural } from './config.js';
import { level } from './layout.js';
import { nextLevel } from './economy.js';

const $ = (id) => document.getElementById(id);
const RING_LEN = 40.84; // длина окружности кольца у точки (r = 6.5)

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), coins: $('coins'), coinsValue: $('coins-value'), coinsDelta: $('coins-delta'),
      zoneBar: $('zone-bar'), zoneValue: $('zone-value'), zoneLeft: $('zone-left'),
      crosshair: $('crosshair'), ring: $('ring'), toast: $('toast'),
      bagNote: $('bag-note'), bagNoteText: document.querySelector('#bag-note .text'),
      bagNoteArrow: document.querySelector('#bag-note .arrow'),
      bag: $('bag'), bagValue: $('bag-value'), bagBar: $('bag-bar'), fps: $('fps'),
      start: $('start'), resume: $('resume'), pause: $('pause'), shop: $('shop'),
      shopRows: $('shop-rows'), shopCoins: $('shop-coins'), shopProgress: $('shop-progress'),
    };
    this.cache = {};
    this.toastTimer = 0;
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  /** Баланс в единицах $0,0001; delta — доход или покупка, для короткой анимации. */
  money(units, delta = 0) {
    this.set('money', formatMoney(units), (v) => { this.el.coinsValue.textContent = v; });
    if (delta) {
      const d = this.el.coinsDelta;
      d.textContent = delta > 0 ? formatGain(delta) : '−' + formatMoney(-delta);
      d.classList.toggle('minus', delta < 0);
      d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
      const c = this.el.coins;
      c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse');
    }
  }

  bag(n, cap, pulse = false) {
    this.set('bag', `${n}/${cap}`, () => {
      this.el.bagValue.textContent = `${n} / ${cap}`;
      this.el.bagBar.style.width = `${(100 * n) / cap}%`;
      this.el.bag.classList.toggle('full', n >= cap);
    });
    if (pulse) { const b = this.el.bag; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
  }

  zone(ratio, remaining) {
    const pct = Math.floor(ratio * 100);
    this.set('zone', `${pct}|${remaining}`, () => {
      this.el.zoneBar.style.width = `${ratio * 100}%`;
      this.el.zoneValue.textContent = remaining === 0 ? '100 %' : `${Math.min(pct, 99)} %`;
      this.el.zoneLeft.textContent = remaining === 0 ? 'двор чист!'
        : remaining <= 30 ? `осталось ${remaining} ${plural(remaining, 'лист', 'листа', 'листьев')}` : '';
    });
  }

  crosshair(hover, progress) {
    this.set('hover', hover, (v) => this.el.crosshair.classList.toggle('hover', v));
    const active = progress !== null;
    this.set('active', active, (v) => this.el.crosshair.classList.toggle('active', v));
    const off = active ? RING_LEN * (1 - progress) : RING_LEN;
    this.el.ring.style.strokeDashoffset = off.toFixed(1);
  }

  toast(html, ms = 2600) {
    const t = this.el.toast;
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /**
   * Короткая строка над счётчиком мешка: «мешок полон» со стрелкой к контейнеру
   * (angle — угол относительно взгляда, рад) или действие у предмета. null — скрыть.
   */
  bagNote(html, { full = false, angle = null } = {}) {
    this.set('bagNote', `${html}|${full}`, () => {
      this.el.bagNote.hidden = !html;
      if (html) this.el.bagNoteText.innerHTML = html;
      this.el.bagNote.classList.toggle('full', full);
    });
    const showArrow = angle !== null;
    this.set('bagArrow', showArrow, (v) => { this.el.bagNoteArrow.hidden = !v; });
    if (showArrow) this.el.bagNoteArrow.style.transform = `rotate(${(angle - Math.PI / 2).toFixed(3)}rad)`;
  }

  fps(text) {
    this.set('fps', text, (v) => {
      this.el.fps.hidden = v === null;
      if (v !== null) this.el.fps.textContent = v;
    });
  }

  show(name, on = true) { this.el[name].hidden = !on; }

  renderShop(economy, onBuy) {
    const p = economy.progress;
    this.el.shopCoins.textContent = formatMoney(p.money);
    const rows = this.el.shopRows;
    rows.textContent = '';
    for (const b of BRANCHES) {
      const u = UPGRADES[b], next = nextLevel(p, b), lvl = p.upgrades[b];
      const row = document.createElement('div');
      row.className = 'upg' + (next && p.money >= next.price ? ' can' : '');
      const name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = `${u.title}<span class="levels">${'●'.repeat(lvl + 1)}${'○'.repeat(u.prices.length - lvl)}</span>`;
      name.title = u.hint;
      const vals = document.createElement('div');
      vals.className = 'vals';
      if (next) vals.innerHTML = `<span class="now">${u.unit(next.current)}</span><span class="arrow">→</span><span class="next">${u.unit(next.value)}</span>`;
      else vals.innerHTML = `<span class="next">${u.unit(u.values[lvl])}</span> — лучше уже некуда`;
      const buy = document.createElement('div');
      buy.className = 'buy';
      const btn = document.createElement('button');
      if (!next) { btn.textContent = 'максимум'; btn.disabled = true; }
      else {
        btn.textContent = `купить · ${formatMoney(next.price)}`;
        btn.disabled = p.money < next.price;
        btn.addEventListener('click', () => onBuy(b, btn));
      }
      buy.append(btn);
      if (next && p.money < next.price) {
        const lack = document.createElement('div');
        lack.className = 'lack';
        // «не хватает» округляем вверх до цента, чтобы сумма действительно покрывала цену
        lack.textContent = `не хватает ${formatMoney(Math.ceil((next.price - p.money) / 100) * 100)}`;
        buy.append(lack);
      }
      row.append(name, buy, vals);
      rows.append(row);
    }
    // инструменты из таблицы, которых ещё нет: цены видны, купить нельзя
    const locked = document.getElementById('locked-tools');
    locked.innerHTML = LOCKED_TOOLS.map((t) =>
      `<div class="dim"><b>${t.title}</b> · ${formatMoney(t.price)} — ${t.info} <span class="tag">ещё нет в игре</span>` +
      `<div class="sub">${t.upgrades.map((u) => `${u.title}: ${u.prices.map(formatMoney).join(' → ')} (${u.info})`).join('<br>')}</div></div>`).join('');
    const rewards = (economy.rewards || []).map((r) =>
      `<div class="${p.bonuses.includes(r.id) ? '' : 'dim'}">${Math.round(r.at * 100)} % — ${r.text} ${p.bonuses.includes(r.id) ? '✓' : ''}</div>`).join('');
    this.el.shopProgress.innerHTML =
      `<div>${level.name}: убрано ${economy.cleaned} из ${economy.field.count} (${Math.floor(economy.cleanedRatio * 100)} %)</div>` +
      `<div>Цена листа: ${formatMoney(economy.leafValue * 1000)} за 1000 · сдано ${economy.sold}, в мешке ${economy.inBag}</div>` +
      rewards;
  }
}
