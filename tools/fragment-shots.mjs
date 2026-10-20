// Кадры фрагмента с листьями: издалека, средний план, вблизи, полёт листа к камере.
// Запуск: python3 -m http.server 8080 & node tools/fragment-shots.mjs [out-dir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), execSync('npm root -g').toString().trim()] }));
const out = process.argv[2] || 'docs/screenshots';
const base = process.env.URL || 'http://localhost:8080/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = +(process.env.W || 1440), H = Math.round(W / 1.6);
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}?fragment&debug`);
await page.waitForFunction(() => window.__dvor, null, { timeout: 120000 });
await page.evaluate(() => window.__dvor.play());
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };

await page.evaluate(() => window.__dvor.view(-2.4, 2.6, -0.72, -0.42));
await shot('f1-far');
await page.evaluate(() => window.__dvor.view(-0.6, 1.4, -0.5, -0.75));
await shot('f2-mid');
await page.evaluate(() => window.__dvor.view(0.4, 0.4, 0.3, -1.25));
await shot('f3-close');
// подбор: лист под прицелом дрожит и приподнимается, затем летит к камере
await page.waitForFunction(() => window.__dvor.hover() >= 0, null, { timeout: 60000 });
await page.evaluate(() => { window.__dvor.startPick(); });
await page.waitForTimeout(200);
await page.evaluate(() => window.__dvor.setPickProgress(0.85));
await shot('f4-pick', 300);
await page.evaluate(() => { window.__dvor.slowmo(0.6); window.__dvor.setPickProgress(1); });
await page.waitForFunction(() => window.__dvor.economy.inBag > 0, null, { timeout: 60000 });
await shot('f5-flight', 2000);
await shot('f6-flight-late', 3000);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
