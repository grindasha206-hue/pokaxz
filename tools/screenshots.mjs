// Снимает контрольные кадры сцены в headless Chromium.
// Запуск: python3 -m http.server 8080 & node tools/screenshots.mjs [out-dir]
// Нужен playwright (локально или глобально).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const pwPath = require.resolve('playwright', { paths: [process.cwd(), execSync('npm root -g').toString().trim()] });
const { chromium } = require(pwPath);

const out = process.argv[2] || 'docs/screenshots';
const base = process.env.URL || 'http://localhost:8080/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });

async function load(q = '') {
  await page.goto(`${base}?fresh&debug${q}`);
  await page.waitForFunction(() => window.__dvor, null, { timeout: 60000 });
  await page.evaluate(() => { window.__dvor.play(); });
  await page.waitForTimeout(1500);
}
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };

await load();
await shot('1-start');

// крупный план: встаём рядом с листом из первой кучки и начинаем подбор
await page.evaluate(() => { const d = window.__dvor; d.aim(3, 1.25, 0.25); });
await page.waitForTimeout(400);
await page.evaluate(() => window.__dvor.startPick());
await page.waitForTimeout(100);
await page.evaluate(() => window.__dvor.setPickProgress(0.6));
await shot('2-closeup-pick');

// до и после — один ракурс на дерево и забор
await page.evaluate(() => window.__dvor.view(-0.8, 2.2, 0.55, -0.32));
await shot('3-before');
await page.evaluate(() => window.__dvor.clearAll());
await page.waitForTimeout(600);
await shot('4-after');

// магазин: немного заработать честным путём
await load();
await page.evaluate(() => { const d = window.__dvor; d.earn(57); d.view(-1.2, 4.6, -0.2, -0.25); d.openShop(); });
await shot('5-shop');

console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
