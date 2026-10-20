// Интерфейс поверх сцены: HUD, подсказки, магазин-блокнот, пауза и настройки.

import { UPGRADES, BRANCHES, ZONE, plural } from './config.js';
import { nextLevel } from './economy.js';

const $ = (id) => document.getElementById(id);
const RING_LEN = 106.8;

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'), coins: $('coins'), coinsValue: $('coins-value'), coinsDelta: $('coins-delta'),
      zoneBar: $('zone-bar'), zoneValue: $('zone-value'), zoneLeft: $('zone-left'),
      crosshair: $('crosshair'), ring: $('ring'), prompt: $('prompt'), tip: $('tip'), toast: $('toast'),
      pointer: $('pointer'), pointerArrow: document.querySelector('#pointer .arrow'),
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

  coins(n, delta = 0) {
    this.set('coins', n, (v) => { this.el.coinsValue.textContent = v; });
    if (delta) {
      const d = this.el.coinsDelta;
      d.textContent = delta > 0 ? `+${delta}` : `−${-delta}`;
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

  prompt(html) {
    this.set('prompt', html, (v) => {
      if (v) this.el.prompt.innerHTML = v;
      this.el.prompt.classList.toggle('show', !!v);
    });
  }

  tip(text) {
    this.set('tip', text, (v) => {
      if (v) this.el.tip.textContent = v;
      this.el.tip.classList.toggle('show', !!v);
    });
  }

  toast(html, ms = 2600) {
    const t = this.el.toast;
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /** Указатель на контейнер: angle — угол относительно взгляда (рад), null — скрыть. */
  pointer(angle) {
    const show = angle !== null;
    this.set('pointer', show, (v) => { this.el.pointer.hidden = !v; });
    if (show) this.el.pointerArrow.style.transform = `rotate(${(angle - Math.PI / 2).toFixed(3)}rad)`;
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
    this.el.shopCoins.textContent = p.coins;
    const rows = this.el.shopRows;
    rows.textContent = '';
    for (const b of BRANCHES) {
      const u = UPGRADES[b], next = nextLevel(p, b), lvl = p.upgrades[b];
      const row = document.createElement('div');
      row.className = 'upg' + (next && p.coins >= next.price ? ' can' : '');
      const name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = `${u.title}<span class="levels">${'●'.repeat(lvl + 1)}${'○'.repeat(u.prices.length - lvl)}</span>`;
      const vals = document.createElement('div');
      vals.className = 'vals';
      if (next) vals.innerHTML = `<span class="now">${u.unit(next.current)}</span><span class="arrow">→</span><span class="next">${u.unit(next.value)}</span>`;
      else vals.innerHTML = `<span class="next">${u.unit(u.values[lvl])}</span> — лучше уже некуда`;
      const buy = document.createElement('div');
      buy.className = 'buy';
      const btn = document.createElement('button');
      if (!next) { btn.textContent = 'максимум'; btn.disabled = true; }
      else {
        btn.textContent = `купить · ${next.price}`;
        btn.disabled = p.coins < next.price;
        btn.addEventListener('click', () => onBuy(b, btn));
      }
      buy.append(btn);
      if (next && p.coins < next.price) {
        const lack = document.createElement('div');
        lack.className = 'lack';
        lack.textContent = `не хватает ${next.price - p.coins}`;
        buy.append(lack);
      }
      row.append(name, buy, vals);
      rows.append(row);
    }
    const left = economy.remaining;
    this.el.shopProgress.innerHTML =
      `<div>${ZONE.name}: убрано ${economy.cleaned} из ${economy.field.count} (${Math.floor(economy.cleanedRatio * 100)} %)</div>` +
      `<div>Сдано листьев: ${economy.sold}, в мешке: ${economy.inBag}</div>` +
      `<div class="dim">Сад — ${left === 0 && economy.inBag === 0 ? 'скоро откроется' : 'откроется после уборки двора'}</div>`;
  }
}
