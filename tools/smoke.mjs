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

// подбор: короткое нажатие E на лист
await page.evaluate(() => window.__dvor.aim(3, 1.2, 0.2));
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 30000 }); // лист под прицелом
await page.keyboard.press('KeyE');
await page.waitForFunction(() => window.__dvor.economy.inBag === 1, null, { timeout: 30000 });
await page.waitForTimeout(500);
assert.equal((await st()).bag, 1, 'один лист в мешке, повтора без удержания нет');

// удержание E собирает подряд
await page.keyboard.down('KeyE');
for (let k = 0; k < 4; k++) {
  const before = (await st()).bag;
  await page.evaluate(() => { const d = window.__dvor, f = d.field; for (let i = 0; i < f.count; i++) if (f.state[i] === 0) { d.aim(i, 1.2, 0.2); break; } });
  await page.waitForFunction((b) => window.__dvor.economy.inBag > b, before, { timeout: 30000 });
}
await page.keyboard.up('KeyE');
const afterHold = await st();
assert.ok(afterHold.bag >= 4, `удержание собрало ${afterHold.bag}`);

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
await page.click('#shop-rows .upg:nth-child(1) button');
await page.waitForTimeout(100);
s = await st();
assert.equal(s.grab, 2);
assert.equal(s.coins, coinsBefore - 10);
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
await page.keyboard.down('KeyE');
await page.keyboard.press('Escape');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyE');
assert.equal((await st()).bag, restored.bag, 'на паузе листья не собираются');
assert.ok(await page.isVisible('#pause'));

assert.deepEqual(errors, []);
console.log('smoke ok', restored);
await page.evaluate(() => localStorage.clear());
await browser.close();
