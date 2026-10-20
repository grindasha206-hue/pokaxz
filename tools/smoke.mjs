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
const page = await browser.newPage({ viewport: { width: 400, height: 260 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}?debug`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}?debug`);
await page.waitForFunction(() => window.__dvor);
const st = () => page.evaluate(() => { const e = window.__dvor.economy; return { bag: e.inBag, coins: e.coins, sold: e.sold, grab: e.grab }; });
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
assert.equal(s.coins, afterHold.bag);

// добираем до 10 монет и покупаем захват через блокнот
await page.evaluate(() => window.__dvor.earn(12));
await page.keyboard.press('Tab');
await page.waitForTimeout(200);
assert.ok(await page.isVisible('#shop'), 'блокнот открыт');
const coinsBefore = (await st()).coins;
const bagInShop = (await st()).bag;
await page.click('#shop-rows .upg:nth-child(1) button');
await page.waitForTimeout(100);
s = await st();
assert.equal(s.grab, 2);
assert.equal(s.coins, coinsBefore - 10);
// клики по блокноту листья не собирают
await page.mouse.click(30, 30);
await page.waitForTimeout(1500);
assert.equal((await st()).bag, bagInShop, 'клик в блокноте не собирает');
await page.keyboard.press('Tab');
await page.waitForTimeout(500);

// сохранение и восстановление после перезагрузки
await page.reload();
await page.waitForFunction(() => window.__dvor);
const restored = await st();
assert.deepEqual(restored, s, 'прогресс восстановлен');

// пауза останавливает сбор
await page.evaluate(() => window.__dvor.play());
await page.evaluate(() => window.__dvor.aim(40, 1.2, 0.2));
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

assert.deepEqual(errors, []);
console.log('smoke ok', restored);
await page.evaluate(() => localStorage.clear());
await browser.close();
