// Сквозная проверка в браузере: подбор клавишей E, сдача F, покупка в блокноте, сохранение и загрузка.
// Запуск: python3 -m http.server 8080 & node tools/smoke.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), execSync('npm root -g').toString().trim()] }));
const base = process.env.URL || 'http://localhost:8080/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// маленькое окно: программный рендер в headless медленный
const context = await browser.newContext({ viewport: { width: 400, height: 260 } });
let page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}?debug`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}?debug`);
await page.waitForFunction(() => window.__dvor);
const st = () => page.evaluate(() => { const e = window.__dvor.economy; return { bag: e.inBag, money: e.money, sold: e.sold, grab: e.grab }; });
await page.evaluate(() => window.__dvor.play());

const nextLeaf = () => page.evaluate(() => { const d = window.__dvor, f = d.field; for (let i = 0; i < f.count; i++) if (f.state[i] === 0) { d.aim(i, 1.2, 0.2); return i; } return -1; });
const center = { x: 200, y: 130 };

// клик, которым захватывают курсор (сразу при входе в игру), листья не собирает
await page.evaluate(() => window.__dvor.aim(3, 1.2, 0.2));
await page.evaluate(() => window.__dvor.play());
await page.mouse.click(center.x, center.y);
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);
assert.equal((await st()).bag, 0, 'клик захвата курсора не собирает');

// один клик — один сбор
await page.mouse.click(center.x, center.y);
await page.waitForFunction(() => window.__dvor.economy.inBag === 1, null, { timeout: 30000 });
await page.waitForTimeout(1500);
assert.equal((await st()).bag, 1, 'один клик — один лист, без повтора');

// удержание левой кнопки собирает подряд, отпускание останавливает
await page.mouse.down();
for (let k = 0; k < 4; k++) {
  const before = (await st()).bag;
  await nextLeaf();
  await page.waitForFunction((b) => window.__dvor.economy.inBag > b, before, { timeout: 30000 });
}
await page.mouse.up();
const released = (await st()).bag;
await nextLeaf();
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 30000 });
await page.waitForTimeout(2500);
assert.ok((await st()).bag <= released + 1, 'после отпускания сбор не продолжается');
assert.ok(released >= 5, `удержание собрало ${released}`);

// отпускание отменяет незавершённый повторный подбор
await page.mouse.down();
await nextLeaf();
await page.waitForFunction(() => window.__dvor.pickState() !== null, null, { timeout: 30000 });
const firstBag = (await st()).bag;
await page.waitForFunction((b) => window.__dvor.economy.inBag > b, firstBag, { timeout: 30000 }); // первый (клик) завершён
await nextLeaf();
await page.waitForFunction(() => window.__dvor.pickState()?.repeat === true, null, { timeout: 30000 });
const bagAtRelease = (await st()).bag;
await page.mouse.up();
assert.equal(await page.evaluate(() => window.__dvor.pickState()), null, 'отпускание отменило повторный подбор');
await page.waitForTimeout(2000);
assert.equal((await st()).bag, bagAtRelease, 'после отпускания листья не добавились');

// ходьба поверх листьев не сдвигает их
const before = await page.evaluate(() => Array.from(window.__dvor.field.x).concat(Array.from(window.__dvor.field.z)));
await page.evaluate(() => window.__dvor.view(-2, 1.5, 0.6, -0.3));
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyW');
const moved = await page.evaluate(() => window.__dvor.player.z);
assert.ok(moved < 1.4, `игрок прошёл вперёд (z=${moved})`);
const after = await page.evaluate(() => Array.from(window.__dvor.field.x).concat(Array.from(window.__dvor.field.z)));
assert.deepEqual(after, before, 'листья остались на месте');

// E по-прежнему работает как клик
const beforeE = (await st()).bag;
await nextLeaf();
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 30000 });
await page.keyboard.press('KeyE');
await page.waitForFunction((b) => window.__dvor.economy.inBag > b, beforeE, { timeout: 30000 });
await page.waitForTimeout(1200);
const afterHold = await st();

// центр экрана — только точка: старых надписей нет
assert.equal(await page.$('#prompt'), null);
assert.equal(await page.$('#tip'), null);
assert.ok(!(await page.isVisible('.slot[data-tool="2"]')), 'недоступные инструменты скрыты');

// сдача у контейнера
await page.evaluate(() => window.__dvor.view(2.3, 4.2, 0, -0.3));
await page.waitForTimeout(200);
await page.keyboard.press('KeyF');
await page.waitForFunction(() => window.__dvor.economy.inBag === 0, null, { timeout: 30000 });
let s = await st();
assert.equal(s.bag, 0);
assert.equal(s.money, afterHold.bag * 40, 'лист — $0,004 (40 единиц по $0,0001)');
assert.match(await page.textContent('#coins-value'), /^\$\d+,\d\d$/, 'баланс показан в долларах с двумя знаками');

// добираем до $0,10 и покупаем «Жадную хватку 1» через блокнот
await page.evaluate(() => window.__dvor.earn(60));
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
assert.ok(await page.isVisible('#shop'), 'блокнот открыт');
const moneyBefore = (await st()).money;
const bagInShop = (await st()).bag;
await page.click('#shop-rows .upg:nth-child(1) button');
await page.waitForTimeout(100);
s = await st();
assert.equal(s.grab, 2);
assert.equal(s.money, moneyBefore - 1000, 'списано ровно $0,10');
// клики по блокноту листья не собирают
await page.mouse.click(30, 30);
await page.waitForTimeout(1500);
assert.equal((await st()).bag, bagInShop, 'клик в блокноте не собирает');
await page.keyboard.press('Tab');
await page.waitForTimeout(500);

// сохранение и восстановление после перезапуска: деньги, покупки, мешок и какие именно листья убраны
await page.evaluate(() => { const d = window.__dvor; d.play(); d.aim(d.field.count - 1, 1.2, 0.2); });
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 30000 });
await page.waitForTimeout(400);
await page.mouse.click(200, 130); // один лист в мешок, чтобы проверить и его
await page.waitForFunction((b) => window.__dvor.economy.inBag > b, s.bag, { timeout: 30000 });
await page.keyboard.press('Escape'); // пауза сохраняет
await page.waitForTimeout(300);
s = await st();
const statesBefore = await page.evaluate(() => Array.from(window.__dvor.field.state).join(''));
const ctx = context;
await page.close();
// тот же профиль браузера (browser.newPage создал бы новый, с пустым хранилищем)
const page2 = await ctx.newPage();
page2.on('pageerror', (e) => errors.push(String(e)));
await page2.goto(`${base}?debug`);
await page2.waitForFunction(() => window.__dvor);
const restored = await page2.evaluate(() => { const e = window.__dvor.economy; return { bag: e.inBag, money: e.money, sold: e.sold, grab: e.grab }; });
assert.deepEqual(restored, s, 'деньги, покупки и мешок восстановлены');
assert.equal(await page2.evaluate(() => Array.from(window.__dvor.field.state).join('')), statesBefore, 'убранные листья восстановлены');
page = page2;

// импорт: если запись в хранилище не удалась — без перезагрузки и с понятной ошибкой
const saveText = await page.evaluate(() => localStorage.getItem('leaf-yard-save-v1'));
await page.evaluate(() => {
  window.__marker = 'не перезагружалась';
  Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
});
await page.setInputFiles('#import-file', { name: 'save.json', mimeType: 'application/json', buffer: Buffer.from(saveText) });
await page.waitForFunction(() => /Не удалось записать/.test(document.getElementById('save-status').textContent), null, { timeout: 30000 });
assert.equal(await page.evaluate(() => window.__marker), 'не перезагружалась');

// пауза останавливает сбор
await page.evaluate(() => window.__dvor.play());
await page.evaluate(() => { const d = window.__dvor, f = d.field; for (let i = 0; i < f.count; i++) if (f.state[i] === 0) { d.aim(i, 1.2, 0.2); break; } });
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 30000 });
await page.waitForTimeout(400); // мимо окна, когда клики после входа в игру игнорируются
await page.mouse.down();
await page.keyboard.press('Escape');
await page.waitForTimeout(4000);
await page.mouse.up();
assert.equal((await st()).bag, restored.bag, 'на паузе листья не собираются');
assert.equal(await page.evaluate(() => window.__dvor.mouseState().held), false, 'пауза сбрасывает удержание');

// потеря фокуса останавливает удержание
await page.evaluate(() => window.__dvor.play());
await page.waitForTimeout(400);
await page.mouse.down();
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.__dvor.mouseState().held), false, 'потеря фокуса сбрасывает удержание');
await page.mouse.up();
assert.ok(await page.isVisible('#pause'));

// сохранение прежней экономики (монеты): не загружается как доллары, предлагается экспорт и новый старт.
// Записываем его со страницы без игры, чтобы игра при выгрузке не перезаписала его своим.
await page.goto(base.replace('index.html', 'assets/yard/models-manifest.json'));
await page.evaluate(() => {
  const old = { version: 2, seed: 20261020, progress: { coins: 420, upgrades: { grab: 2, speed: 0, bag: 1 } },
    zones: { yard: { state: '0'.repeat(2500), pos: new Array(7500).fill(0) } } };
  localStorage.setItem('leaf-yard-save-v1', JSON.stringify(old));
});
await page.goto(`${base}?debug`);
await page.waitForFunction(() => window.__dvor);
assert.ok(await page.isVisible('#legacy'), 'показан выбор для прежнего сохранения');
assert.ok(await page.isDisabled('#start-btn'), 'до выбора игра не начинается');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('leaf-yard-save-v1')).version), 2, 'прежнее не перезаписано');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#legacy-export')]);
assert.match(download.suggestedFilename(), /old-coins-save\.json$/);
await page.click('#legacy-new');
await page.click('#legacy-yes');
assert.ok(!(await page.isDisabled('#start-btn')));
const legacyAfter = await page.evaluate(() => ({ v: JSON.parse(localStorage.getItem('leaf-yard-save-v1')).version,
  money: JSON.parse(localStorage.getItem('leaf-yard-save-v1')).progress.money,
  backup: JSON.parse(localStorage.getItem('leaf-yard-save-legacy-backup')).progress.coins }));
assert.deepEqual(legacyAfter, { v: 3, money: 0, backup: 420 }, 'новая игра с $0,00, копия прежнего сохранения осталась');

assert.deepEqual(errors, []);
console.log('smoke ok', restored);
await page.evaluate(() => localStorage.clear());
await browser.close();
