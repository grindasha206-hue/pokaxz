// Сквозная проверка зон и граблей в браузере: двор убран → ворота в сад → покупка граблей →
// взмахи над приёмником → сохранение и загрузка в саду → обратно во двор.
// Запуск: python3 -m http.server 8080 & node tools/smoke-zones.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), execSync('npm root -g').toString().trim()] }));
const base = process.env.URL || 'http://localhost:8080/index.html';
const shots = process.env.SHOTS; // папка для двух кадров сада (необязательно)
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: shots ? { width: 960, height: 600 } : { width: 400, height: 260 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ready = async () => { await page.waitForFunction(() => window.__dvor, null, { timeout: 120000 }); await page.evaluate(() => window.__dvor.play()); };
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${base}?debug`);
await ev(() => localStorage.clear());
await page.goto(`${base}?debug`);
await ready();
assert.equal(await ev(() => window.__dvor.level()), 'yard');

// ворота закрыты, пока двор не убран
await ev(() => window.__dvor.view(7.2, -1.8, -Math.PI / 2, 0));
assert.match(await ev(() => window.__dvor.gate(0)), /Сад откроется/);

// убираем двор честно (сбор и сдача), награды выдаются
await ev(() => { const d = window.__dvor; d.clearAll(); d.economy.checkRewards(); });
const yardMoney = await ev(() => window.__dvor.economy.money);
assert.ok(yardMoney >= 256000, `за двор заработано ${yardMoney}`);
assert.equal(await ev(() => window.__dvor.gate(0)), 'ok');
await page.waitForFunction(() => !window.__dvor || window.__dvor.level() === 'garden', null, { timeout: 60000 }).catch(() => {});
await page.waitForLoadState('load');
await ready();
assert.equal(await ev(() => window.__dvor.level()), 'garden', 'после ворот — сад');
assert.equal(await ev(() => window.__dvor.economy.money), yardMoney, 'деньги перенеслись');
assert.equal(await ev(() => window.__dvor.field.count), 12000);

// грабли: покупка, выбор, взмахи над бесплатным приёмником у дорожки
await ev(() => window.__dvor.buy('rake'));
assert.ok(await ev(() => !!window.__dvor.economy.rake), 'грабли куплены');
assert.equal(await ev(() => window.__dvor.selectTool('rake')), 'rake');
const sold0 = await ev(() => window.__dvor.economy.sold);
let movedTotal = 0;
for (let k = 0; k < 6; k++) {
  // встаём южнее приёмника и тянем листья с севера к себе — через решётку
  await ev((k) => window.__dvor.view(11.6 + k * 0.25, 0.25, 0, -0.75), k);
  await page.waitForTimeout(50);
  await ev(() => window.__dvor.rakeOnce());
  movedTotal = await ev(() => window.__dvor.field.moved.reduce((a, b) => a + b, 0));
}
const sold1 = await ev(() => window.__dvor.economy.sold);
console.log(`взмахов 6: сдвинуто листьев ${movedTotal}, продано через приёмник ${sold1 - sold0}`);
assert.ok(movedTotal > 0, 'грабли сдвигают листья');
// протащим кучу дальше: несколько шагов от дерева к приёмнику
for (let k = 0; k < 8; k++) {
  await ev((k) => window.__dvor.view(12.2, -2.4 + k * 0.62 + 1.3, 0, -0.75), k);
  await ev(() => window.__dvor.rakeOnce());
}
// настоящее удержание кнопки: взмахи идут подряд, отпускание их останавливает
await ev(() => window.__dvor.view(14.6, 0.2, 0, -0.75)); // у ковра под деревом
const vp = page.viewportSize();
const moved0 = await ev(() => window.__dvor.field.moved.reduce((a, b) => a + b, 0));
await page.mouse.move(vp.width / 2, vp.height / 2);
await page.mouse.down();
await page.waitForFunction((m) => window.__dvor.field.moved.reduce((a, b) => a + b, 0) > m + 20, moved0, { timeout: 60000 });
await page.mouse.up();
await page.waitForTimeout(1500);
const movedA = await ev(() => window.__dvor.field.moved.reduce((a, b) => a + b, 0));
await page.waitForTimeout(2000);
assert.equal(await ev(() => window.__dvor.field.moved.reduce((a, b) => a + b, 0)), movedA, 'после отпускания грабли не работают');
console.log(`удержание кнопки с граблями: сдвинуто ${movedA - moved0} листьев`);
const sold2 = await ev(() => window.__dvor.economy.sold);
console.log(`проводка кучи к приёмнику: продано всего ${sold2 - sold0}`);
assert.ok(sold2 > sold0, 'приёмник продаёт листья');
assert.equal(await ev(() => window.__dvor.economy.inBag), 0, 'приёмник продаёт без мешка');

if (shots) {
  await ev(() => { const d = window.__dvor; d.hideHud(true); d.view(12.2, 0.2, 0, -0.55); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/garden-rake.png` });
  await ev(() => { const d = window.__dvor; d.selectTool('hand'); d.view(9.0, -1.8, -Math.PI / 2 + 0.35, -0.22); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/garden-view.png` });
  await ev(() => window.__dvor.selectTool('rake'));
}

// сохранение: зона, грабли и сдвинутые листья переживают перезагрузку
await ev(() => window.__dvor.hideHud(false));
await page.keyboard.press('Escape'); // пауза сохраняет
await page.waitForTimeout(300);
const saved = await ev(() => JSON.parse(localStorage.getItem('leaf-yard-save-v1')));
assert.equal(saved.version, 4);
assert.equal(saved.currentZone, 'garden');
assert.ok(saved.zones.yard && saved.zones.garden, 'обе зоны в сохранении');
assert.ok(saved.zones.garden.m.length > 0, 'сдвинутые листья сохранены');
console.log(`размер сохранения: ${(JSON.stringify(saved).length / 1024).toFixed(1)} КБ`);
const before = await ev(() => { const d = window.__dvor, f = d.field; const i = f.moved.findIndex((m, k) => m && f.state[k] === 0); return { i, x: f.x[i], z: f.z[i], sold: d.economy.sold, money: d.economy.money }; });
await page.reload();
await ready();
assert.equal(await ev(() => window.__dvor.level()), 'garden', 'после перезагрузки — снова сад');
const after = await ev((i) => { const d = window.__dvor, f = d.field; return { x: f.x[i], z: f.z[i], sold: d.economy.sold, money: d.economy.money, rake: !!d.economy.rake, fixes: d.game.fixes }; }, before.i);
assert.deepEqual(after.fixes, [], 'сохранение без исправлений');
assert.ok(Math.abs(after.x - before.x) < 0.002 && Math.abs(after.z - before.z) < 0.002, 'лист остался там, куда его сдвинули');
assert.equal(after.sold, before.sold);
assert.equal(after.money, before.money);
assert.ok(after.rake, 'грабли сохранились');

// обратно во двор: двор по-прежнему убран
await ev(() => window.__dvor.view(8.9, -1.8, Math.PI / 2, 0));
assert.equal(await ev(() => window.__dvor.gate(0)), 'ok');
await page.waitForTimeout(500);
await page.waitForLoadState('load');
await ready();
assert.equal(await ev(() => window.__dvor.level()), 'yard');
assert.equal(await ev(() => window.__dvor.economy.remaining), 0, 'двор остался убранным');

assert.deepEqual(errors, [], 'без ошибок в консоли');
console.log('smoke-zones: ok');
await browser.close();
