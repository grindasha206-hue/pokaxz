// Точка входа: сцена, управление, цикл игры, сохранение.

import * as THREE from '../vendor/three.module.min.js';
import { PLAYER, UPGRADES, REMAINING_HIGHLIGHT, ZONE, plural } from './config.js';
import { level, setLevel, distToObstacle, resolveCircle, segmentBlocked, surfaceHeight } from './layout.js';
import { ON_GROUND } from './leaves.js';
import { createGame } from './game.js';
import { buildSave, parseSave, readLocal, writeLocal, clearLocal } from './save.js';
import { buildWorld } from './view/scene.js';
import { Ground } from './view/ground.js';
import { LeafView, loadLeafTextures } from './view/leafView.js';
import { buildFragment } from './view/fragment.js';
import { loadYardAssets } from './view/yardAssets.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const LEAF_OVERRIDE = params.has('leaves') ? Math.max(1, parseInt(params.get('leaves'), 10) || 600) : null;
// ?fragment — небольшой участок для проверки ковра из листьев и подбора
const FRAGMENT_MODE = params.has('fragment');
if (FRAGMENT_MODE) setLevel('fragment');
// режим замера, фрагмент и чистый старт не трогают настоящее сохранение
const NO_SAVE = params.has('fresh') || LEAF_OVERRIDE !== null || FRAGMENT_MODE;
const FORCE_FPS = params.has('fps') || LEAF_OVERRIDE !== null;

const ui = new UI();
document.getElementById('zone-name').textContent = level.name;
const sound = new Sound();

// ── загрузка ─────────────────────────────────────────────────
let game, startNote = '';
{
  const saved = NO_SAVE ? null : readLocal();
  try {
    game = createGame(saved, { leafCount: LEAF_OVERRIDE ?? undefined });
    if (saved) startNote = game.migrated
      ? 'Двор обновился: листья разложены заново, заработанные монеты и покупки сохранены.'
      : 'Продолжаем с сохранения.';
    if (game.fixes.length) console.warn('save fixes', game.fixes);
  } catch (e) {
    console.warn(e);
    game = createGame(null);
    startNote = 'Сохранение не удалось прочитать — начата новая игра.';
  }
  if (NO_SAVE) {
    startNote = FRAGMENT_MODE ? `Фрагмент для оценки листьев: ${game.field.count} листьев, прогресс не сохраняется.`
      : LEAF_OVERRIDE ? `Замер: ${LEAF_OVERRIDE} листьев, прогресс не сохраняется.` : 'Чистый старт, прогресс не сохраняется.';
  }
}
const { field, economy, settings } = game;

// шрифт для табличек в сцене
try {
  await Promise.race([document.fonts.load('700 40px Caveat'), new Promise((r) => setTimeout(r, 1500))]);
} catch { /* без шрифта таблички нарисуются запасным */ }
const leafTextures = await loadLeafTextures();

// ── рендер ───────────────────────────────────────────────────
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400); // ближняя плоскость 0,1 м — точнее глубина, листья не мерцают
camera.rotation.order = 'YXZ';
let world, ground, yardAssets = null;
if (FRAGMENT_MODE) {
  world = buildFragment(scene);
  ground = world;
} else {
  // готовые материалы и модели двора; при ошибке загрузки сцена строится с запасными
  yardAssets = await loadYardAssets(renderer);
  world = buildWorld(scene, yardAssets);
  ground = new Ground(field, yardAssets.mats.grass);
  scene.add(ground.mesh);
}
const leaves = new LeafView(scene, field, leafTextures, { size: level.leafSize });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── игрок и ввод ─────────────────────────────────────────────
const player = {
  x: game.player.x, z: game.player.z, yaw: game.player.yaw ?? 0, pitch: -0.12,
  vx: 0, vz: 0, eye: surfaceHeight(game.player.x, game.player.z) + PLAYER.eyeHeight,
};
{
  const p = resolveCircle(player.x, player.z, PLAYER.radius);
  player.x = p.x; player.z = p.z;
}
game.player = player;

const keys = new Set();
let state = 'start';            // start | playing | paused | shop | resume
let pickRequested = false;      // короткое нажатие: клик или E
let mouseHeld = false;          // левая кнопка удерживается — сбор повторяется
let autoCollect = false;        // E в режиме «включает и выключает сбор»
let ignoreClicksUntil = 0;      // клик, которым захватили курсор, не собирает листья
let pick = null;                // { target, elapsed, duration }
let hoverId = -1, hoverGroup = [];
let fullHintUntil = 0, lastDenied = 0;
let now = 0;
let dirty = false, lastSave = 0;
let lastStep = 0;

const GAME_KEYS = new Set(['Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    if (e.code !== 'Tab' && e.code !== 'Escape') return;
  }
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat && (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Tab')) return;
  switch (e.code) {
    case 'Tab':
      if (state === 'playing') openShop();
      else if (state === 'shop') closeShop(false);
      return;
    case 'Escape':
      if (state === 'shop') closeShop(true);
      else if (state === 'paused') resume();
      else if (state === 'playing') pause();
      return;
  }
  if (state !== 'playing') return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyE':
      if (settings.collectMode === 'toggle') {
        autoCollect = !autoCollect;
        ui.toast(autoCollect ? 'Сбор включён — <kbd>E</kbd> ещё раз, чтобы остановить' : 'Сбор выключен', 1600);
      } else pickRequested = true;
      break;
    case 'KeyF': interact(); break;
    case 'Digit1': selectTool(1); break;
    case 'Digit2': selectTool(2); break;
    case 'Digit3': selectTool(3); break;
  }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyE' && settings.collectMode === 'hold' && !mouseHeld) releaseHold();
});

// Сбор — левой кнопкой (клик трекпада) по листу под точкой. Принимаем нажатие только
// во время игры при захваченном курсоре: клики по блокноту, меню и клик захвата курсора
// листья не собирают.
const lookFallback = () => !canvas.requestPointerLock || DEBUG;
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state !== 'playing') return;
  if (document.pointerLockElement !== canvas && !lookFallback()) return;
  if (performance.now() < ignoreClicksUntil) return;
  pickRequested = true;
  mouseHeld = true;
});
// Отпускание: повторение прекращается, незавершённый повторный подбор отменяется.
// Подбор, начатый самим нажатием (клик), доводится до конца — иначе короткий клик
// никогда не успевал бы собрать лист при времени подбора 0,6 с.
function releaseHold() {
  if (pick?.repeat) pick = null;
}
document.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  mouseHeld = false;
  if (!(settings.collectMode === 'hold' && keys.has('KeyE'))) releaseHold();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('mousemove', (e) => {
  if (state !== 'playing') return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !(lookFallback() && e.buttons & 1)) return;
  let dx = e.movementX || 0, dy = e.movementY || 0;
  // Safari иногда присылает рывок при захвате курсора
  if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
  const k = 0.0022 * settings.sensitivity;
  player.yaw -= dx * k;
  player.pitch -= dy * k * (settings.invertY ? -1 : 1);
  player.pitch = Math.max(-1.45, Math.min(1.35, player.pitch));
});

// ── состояния: старт, пауза, магазин ─────────────────────────
function requestLock() {
  try {
    const r = canvas.requestPointerLock?.();
    if (r && r.catch) r.catch(() => showResume());
  } catch { showResume(); }
  // если захват не случился (например, Safari не принял жест), просим клик
  setTimeout(() => { if (state !== 'playing' && document.pointerLockElement !== canvas && wantPlay) showResume(); }, 400);
}
let wantPlay = false;

function showResume() {
  if (state === 'playing' || !wantPlay) return;
  state = 'resume';
  ui.show('pause', false); ui.show('shop', false); ui.show('start', false);
  ui.show('resume', true);
}

function enterPlaying() {
  state = 'playing';
  ignoreClicksUntil = performance.now() + 300;
  mouseHeld = false;
  pickRequested = false;
  wantPlay = false;
  ui.show('start', false); ui.show('pause', false); ui.show('shop', false); ui.show('resume', false);
  ui.show('hud', true);
  sound.setPaused(false);
}

function startGame() {
  sound.unlock();
  applySettings();
  wantPlay = true;
  if (!canvas.requestPointerLock) { enterPlaying(); return; } // без захвата — обзор перетаскиванием
  requestLock();
}

function stopWork() {
  keys.clear();
  pick = null;
  pickRequested = false;
  mouseHeld = false;
  autoCollect = false;
  player.vx = player.vz = 0;
}

function pause() {
  stopWork();
  state = 'paused';
  wantPlay = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.show('pause', true);
  ui.show('resume', false);
  syncSettingsForm();
  saveNow();
}

function resume() {
  ui.show('pause', false);
  wantPlay = true;
  if (!canvas.requestPointerLock) { enterPlaying(); return; }
  requestLock();
}

function openShop() {
  stopWork();
  state = 'shop';
  if (document.pointerLockElement) document.exitPointerLock();
  renderShop();
  ui.show('shop', true);
}

function closeShop(toPause) {
  ui.show('shop', false);
  if (toPause) { pause(); return; }
  resume();
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) enterPlaying();
  else if (state === 'playing') pause();
});
document.addEventListener('pointerlockerror', () => showResume());
window.addEventListener('blur', () => { if (state === 'playing') pause(); else stopWork(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state === 'playing') pause();
    saveNow();
    sound.setPaused(true);
  } else sound.setPaused(false);
});
window.addEventListener('pagehide', () => saveNow());

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', resume);
document.getElementById('resume').addEventListener('click', () => { sound.unlock(); wantPlay = true; requestLock(); });
canvas.addEventListener('click', () => { if (state === 'resume') { wantPlay = true; requestLock(); } });
document.getElementById('start-note').textContent = startNote;

// ── действия ─────────────────────────────────────────────────
function selectTool(n) {
  // пока есть только рука; грабли и воздуходувка появятся в слотах 2 и 3
  void n;
}

function nearest() {
  // ближайший объект для F, к которому игрок стоит лицом
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  let best = null, bestD = Infinity;
  for (const id of ['container', 'shop']) {
    const o = level.obstacles.find((ob) => ob.id === id);
    if (!o) continue;
    const d = distToObstacle(player.x, player.z, o);
    if (d > PLAYER.interactReach - PLAYER.radius) continue;
    const c = id === 'container' ? level.container : level.shop;
    const dx = c.x - player.x, dz = c.z - player.z, len = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / len < 0.2 && d > 0.6) continue;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function interact() {
  const target = nearest();
  if (target === 'container') deposit();
  else if (target === 'shop') openShop();
}

const tmpV = new THREE.Vector3(), tmpFrom = new THREE.Vector3();

function deposit() {
  if (economy.inBag === 0) {
    ui.toast('Мешок пуст — сначала соберите листья', 1600);
    return;
  }
  const n = economy.deposit();
  sound.deposit(n);
  ui.coins(economy.coins, n);
  ui.bag(economy.inBag, economy.capacity, true);
  const C = level.container;
  camera.localToWorld(tmpFrom.set(0.12, -0.3, -0.45));
  leaves.depositBurst(tmpFrom, tmpV.set(C.x, C.h + 0.1, C.z), n, now);
  lidOpenUntil = now + 0.9;
  if (!game.hints.deposited) game.hints.deposited = true;
  ui.toast(`Сдано ${n} ${plural(n, 'лист', 'листа', 'листьев')}: <b>+${n}</b> ${plural(n, 'монета', 'монеты', 'монет')}`, 2000);
  if (economy.remaining === 0) {
    setTimeout(() => ui.toast('Двор чист! Сад откроется в следующей версии игры.', 5000), 2100);
  }
  saveNow();
}

const buyLock = new Map();
function buy(branch, btn) {
  const t = performance.now();
  if (t - (buyLock.get(branch) ?? 0) < 250) return; // защита от двойного клика
  buyLock.set(branch, t);
  const before = economy.coins;
  const res = economy.buy(branch);
  if (!res) { sound.denied(); btn?.classList.add('flash'); return; }
  sound.purchase();
  ui.coins(economy.coins, economy.coins - before);
  ui.bag(economy.inBag, economy.capacity);
  game.hints.bought = true;
  const u = UPGRADES[branch];
  const text = branch === 'grab' ? `теперь ${u.unit(res.value)} за раз`
    : branch === 'speed' ? `подбор за ${u.unit(res.value)}`
      : `в мешок помещается ${u.unit(res.value)}`;
  ui.toast(`${u.title} улучшен: <b>${text}</b>`, 2600);
  renderShop();
  saveNow();
}

function renderShop() { ui.renderShop(economy, buy); }

// ── сбор ─────────────────────────────────────────────────────
const camDir = new THREE.Vector3();

function findHover() {
  // Выбираем самый верхний видимый лист: точку, где луч взгляда пересекает плоскость листа,
  // сравниваем с его радиусом. В плотном ковре так берётся тот лист, что лежит сверху.
  camera.getWorldDirection(camDir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  if (camDir.y > -0.05) return -1;
  const reach2 = PLAYER.reach * PLAYER.reach;
  const cand = [];
  for (let i = 0; i < field.count; i++) {
    if (field.state[i] !== ON_GROUND) continue;
    const ly = field.y(i);
    const t = (ly - oy) / camDir.y;
    if (t <= 0 || t * t > reach2) continue;
    const hx = ox + camDir.x * t - field.x[i], hz = oz + camDir.z * t - field.z[i];
    const R = leaves.pickRadius(i) + 0.012 + t * 0.006;
    const d2 = hx * hx + hz * hz;
    if (d2 > R * R) continue;
    // выше лежащий лист важнее; среди близких по высоте — тот, что ближе к центру прицела
    cand.push([-ly * 40 + Math.sqrt(d2) / R, i]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < Math.min(cand.length, 6); k++) {
    const i = cand[k][1];
    if (!segmentBlocked(ox, oy, oz, field.x[i], field.y(i) + 0.03, field.z[i])) return i;
  }
  return -1;
}

// группа захвата пересчитывается только при смене цели, листьев или улучшений
let groupKey = '', groupCache = [];
function groupFor(target) {
  if (target < 0) return [];
  const n = Math.max(1, Math.min(economy.grab, economy.free || economy.grab));
  const key = `${target}|${n}|${field.version}`;
  if (key !== groupKey) { groupKey = key; groupCache = field.gatherAround(target, n); }
  return groupCache;
}

function stillReachable(i) {
  if (field.state[i] !== ON_GROUND) return false;
  const p = camera.position;
  const d = Math.hypot(field.x[i] - p.x, field.y(i) - p.y, field.z[i] - p.z);
  if (d > PLAYER.reach + 0.6) return false;
  return !segmentBlocked(p.x, p.y, p.z, field.x[i], field.y(i) + 0.03, field.z[i]);
}

function updatePicking(dt) {
  const held = mouseHeld || (settings.collectMode === 'hold' && keys.has('KeyE'));
  const want = pickRequested || autoCollect || held;
  if (!pick) {
    hoverId = findHover();
    hoverGroup = groupFor(hoverId);
    if (want && hoverId >= 0) {
      if (economy.free === 0) {
        fullHintUntil = now + 3;
        if (now - lastDenied > 0.8) { sound.denied(); lastDenied = now; }
      } else {
        // repeat — подбор начат удержанием (а не новым нажатием): отпускание его отменяет
        pick = { target: hoverId, elapsed: 0, duration: economy.pickTime, repeat: !pickRequested && !autoCollect };
      }
      pickRequested = false;
    } else if (want && hoverId < 0 && !held) {
      // короткое нажатие мимо листа не «запоминается» навсегда
      pickRequested = false;
    }
  }
  if (pick) {
    if (!stillReachable(pick.target)) { pick = null; return; }
    pick.elapsed += dt;
    if (pick.elapsed >= pick.duration) {
      const ids = field.gatherAround(pick.target, Math.min(economy.grab, economy.free));
      const got = economy.collect(ids);
      if (got.length) {
        leaves.flyToCamera(got, now);
        leaves.settle(field.settleAfter(got), got); // лежавшие сверху опускаются, а не висят
        sound.rustle(got.length);
        ui.bag(economy.inBag, economy.capacity, true);
        game.hints.picked = true;
        game.hints.pickCount = (game.hints.pickCount ?? 0) + 1;
        dirty = true;
        if (economy.free === 0) fullHintUntil = now + 4;
        if (economy.remaining === 0) ui.toast('Все листья собраны — осталось сдать мешок', 3000);
        else if (economy.remaining === REMAINING_HIGHLIGHT && settings.highlightLast) ui.toast('Последние листья подсвечены', 2400);
      }
      pick = null;
    }
  }
}

// ── движение ─────────────────────────────────────────────────
function updateMovement(dt) {
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  const len = Math.hypot(ix, iz);
  let tx = 0, tz = 0;
  if (len > 0) {
    ix /= len; iz /= len;
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    tx = (ix * c + iz * s) * PLAYER.walkSpeed;
    tz = (-ix * s + iz * c) * PLAYER.walkSpeed;
  }
  const a = Math.min(1, dt * 11);
  player.vx += (tx - player.vx) * a;
  player.vz += (tz - player.vz) * a;
  const ox = player.x, oz = player.z;
  const p = resolveCircle(player.x + player.vx * dt, player.z + player.vz * dt, PLAYER.radius);
  player.x = p.x; player.z = p.z;
  const realVx = (player.x - ox) / Math.max(dt, 1e-4), realVz = (player.z - oz) / Math.max(dt, 1e-4);
  // идём поверх листьев: шорох и лёгкое покачивание, листья остаются на месте
  if (leaves.stepOver(player.x, player.z, Math.hypot(realVx, realVz)) && now - lastStep > 0.32) {
    sound.step(); lastStep = now;
  }
  const eye = surfaceHeight(player.x, player.z) + PLAYER.eyeHeight;
  player.eye += (eye - player.eye) * Math.min(1, dt * 12);
  return Math.hypot(realVx, realVz);
}

// ── строка у счётчика мешка ──────────────────────────────────
// В центре экрана только точка; действие у предмета и «мешок полон» — над счётчиком мешка.
function updateHints() {
  const C = level.container;
  const full = economy.free === 0;
  const near = nearest();
  world.container.arrow.visible = full;
  if (full && near !== 'container') {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const dx = C.x - player.x, dz = C.z - player.z;
    const show = now < fullHintUntil || Math.hypot(dx, dz) > 2.4;
    ui.bagNote(show ? 'Мешок полон — к контейнеру' : '', { full: true, angle: Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) });
  } else if (near === 'container' && economy.inBag > 0) {
    ui.bagNote(`<kbd>F</kbd> сдать ${economy.inBag}`, { full });
  } else if (near === 'shop') {
    ui.bagNote('<kbd>F</kbd> блокнот улучшений');
  } else ui.bagNote('');
}

// ── сохранение ───────────────────────────────────────────────
let skipSave = false;
function saveNow() {
  if (NO_SAVE || skipSave) return;
  const ok = writeLocal(buildSave(game));
  dirty = false;
  lastSave = now;
  document.getElementById('save-status').textContent = ok
    ? `Сохранено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — после сдачи, покупки и каждые 10 секунд уборки. ` +
      `Сохранение хранится в этом браузере для адреса ${location.origin}: открывайте игру по нему же.`
    : 'Не удалось сохранить: хранилище браузера недоступно. Используйте экспорт в файл.';
}

document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(buildSave(game), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `osenniy-dvor-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const importInput = document.getElementById('import-file');
document.getElementById('import-btn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file) return;
  const status = document.getElementById('save-status');
  if (NO_SAVE) {
    status.textContent = 'В этом режиме сохранение отключено — откройте основной двор (без ?fragment и ?fresh).';
    importInput.value = '';
    return;
  }
  try {
    const data = parseSave(await file.text());
    createGame(data); // проверка, что сохранение загружается
    // пишем и сразу читаем обратно: перезагружаемся, только если запись действительно удалась
    const written = writeLocal(data);
    const back = written ? readLocal() : null;
    const ok = !!back && back.seed === data.seed && back.savedAt === data.savedAt;
    if (!ok) {
      status.textContent = 'Не удалось записать сохранение в хранилище браузера (оно переполнено или запрещено). ' +
        'Текущая игра не изменена. Проверьте настройки Safari: «Конфиденциальность» → разрешить данные сайтов.';
      importInput.value = '';
      return;
    }
    skipSave = true; // не перезаписывать восстановленное текущей игрой при перезагрузке
    location.reload();
  } catch (e) {
    document.getElementById('save-status').textContent = `Не удалось восстановить: ${e.message}`;
  }
  importInput.value = '';
});
const resetConfirm = document.getElementById('reset-confirm');
document.getElementById('reset-btn').addEventListener('click', () => { resetConfirm.hidden = false; });
document.getElementById('reset-no').addEventListener('click', () => { resetConfirm.hidden = true; });
document.getElementById('reset-yes').addEventListener('click', () => {
  skipSave = true;
  clearLocal();
  location.reload();
});

// ── настройки ────────────────────────────────────────────────
const form = {
  sens: document.getElementById('set-sens'), sensOut: document.getElementById('out-sens'),
  invert: document.getElementById('set-invert'), mode: document.getElementById('set-mode'),
  master: document.getElementById('set-vol-master'), effects: document.getElementById('set-vol-effects'),
  ambient: document.getElementById('set-vol-ambient'), highlight: document.getElementById('set-highlight'),
  shadows: document.getElementById('set-shadows'), fps: document.getElementById('set-fps'),
};
function syncSettingsForm() {
  form.sens.value = settings.sensitivity; form.sensOut.textContent = `${Number(settings.sensitivity).toFixed(2)}×`;
  form.invert.checked = settings.invertY; form.mode.value = settings.collectMode;
  form.master.value = settings.volMaster; form.effects.value = settings.volEffects; form.ambient.value = settings.volAmbient;
  form.highlight.checked = settings.highlightLast; form.shadows.checked = settings.shadows; form.fps.checked = settings.showFps;
}
function applySettings() {
  sound.setVolumes({ master: settings.volMaster, effects: settings.volEffects, ambient: settings.volAmbient });
  if (renderer.shadowMap.enabled !== settings.shadows) {
    renderer.shadowMap.enabled = settings.shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
}
function onForm() {
  settings.sensitivity = Number(form.sens.value);
  settings.invertY = form.invert.checked;
  settings.collectMode = form.mode.value;
  settings.volMaster = Number(form.master.value);
  settings.volEffects = Number(form.effects.value);
  settings.volAmbient = Number(form.ambient.value);
  settings.highlightLast = form.highlight.checked;
  settings.shadows = form.shadows.checked;
  settings.showFps = form.fps.checked;
  form.sensOut.textContent = `${settings.sensitivity.toFixed(2)}×`;
  applySettings();
  saveNow();
}
for (const el of Object.values(form)) if (el.tagName !== 'OUTPUT') el.addEventListener('input', onForm);
syncSettingsForm();

// ── цикл ─────────────────────────────────────────────────────
let lidOpenUntil = 0, lidAngle = 0;
let remainingIds = null, remainingVersion = -1;
let fpsFrames = 0, fpsTime = 0;
let last = performance.now();
let timeScale = 1; // только для отладочной съёмки

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  now += dt * timeScale;
  if (state === 'playing') updateMovement(dt);
  camera.position.set(player.x, player.eye, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
  if (state === 'playing') {
    updatePicking(dt);
    if (dirty && now - lastSave > 10) saveNow();
  } else {
    hoverId = -1; hoverGroup = [];
  }
  leaves.setWobble(pick ? pick.target : -1, pick ? Math.min(1, pick.elapsed / pick.duration) : 0, now);
  leaves.setHighlight(pick ? pick.target : hoverId, pick ? groupFor(pick.target) : hoverGroup);
  updateHints();
  ui.crosshair(hoverId >= 0 || !!pick, pick ? Math.min(1, pick.elapsed / pick.duration) : null);
  ui.coins(economy.coins);
  ui.bag(economy.inBag, economy.capacity);
  ui.zone(economy.cleanedRatio, economy.remaining);

  if (field.version !== remainingVersion) {
    remainingVersion = field.version;
    remainingIds = null;
    if (economy.remaining > 0 && economy.remaining <= REMAINING_HIGHLIGHT) {
      remainingIds = [];
      for (let i = 0; i < field.count; i++) if (field.state[i] === ON_GROUND) remainingIds.push(i);
    }
  }

  leaves.update(now, dt, camera, settings.highlightLast ? remainingIds : null);
  ground.update(now);

  // крышка контейнера и указатель
  const lidTarget = now < lidOpenUntil ? 1.05 : 0;
  lidAngle += (lidTarget - lidAngle) * Math.min(1, dt * 10);
  world.container.lid.rotation.x = -lidAngle;
  world.container.arrow.position.y = level.container.h + 0.75 + Math.sin(now * 3) * 0.08;
  world.container.arrow.rotation.y = now * 1.5;

  renderer.clear();
  renderer.render(scene, camera);

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    ui.fps(settings.showFps || FORCE_FPS ? `${Math.round(fpsFrames / fpsTime)} к/с · ${field.count} листьев · ${renderer.getPixelRatio()}×` : null);
    fpsFrames = 0; fpsTime = 0;
  }
}
requestAnimationFrame(frame);

// ── отладка и съёмка кадров ──────────────────────────────────
if (DEBUG) {
  window.__dvor = {
    game, economy, field, player, camera, renderer, ui,
    play() { enterPlaying(); },
    view(x, z, yaw, pitch) { Object.assign(player, { x, z, yaw, pitch, eye: surfaceHeight(x, z) + PLAYER.eyeHeight }); },
    clearAll() { // убрать весь двор честным путём: собрать и сдать всё
      const ids = [];
      for (let i = 0; i < field.count; i++) if (field.state[i] === ON_GROUND) ids.push(i);
      while (ids.length) { economy.collect(ids.splice(0, Math.max(1, economy.free))); economy.deposit(); }
      leaves.refreshAll();
    },
    aim(i, dist = 1.6, side = 0) { // встать рядом с листом i и посмотреть на него
      const a = side, x = field.x[i] + Math.sin(a) * dist, z = field.z[i] + Math.cos(a) * dist;
      const p = resolveCircle(x, z, PLAYER.radius);
      const eye = surfaceHeight(p.x, p.z) + PLAYER.eyeHeight;
      const dx = field.x[i] - p.x, dz = field.z[i] - p.z, dy = field.y(i) - eye;
      Object.assign(player, { x: p.x, z: p.z, eye, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    },
    earn(n) { // собрать и сдать n ближайших к старту листьев честным путём
      const ids = [];
      for (let i = 0; i < field.count && ids.length < n; i++) if (field.state[i] === ON_GROUND) ids.push(i);
      while (ids.length) { economy.collect(ids.splice(0, economy.free)); economy.deposit(); }
      leaves.refreshAll();
    },
    openShop() { openShop(); },
    hover() { return hoverId; },
    pickState() { return pick && { ...pick }; },
    assetErrors() { return yardAssets ? yardAssets.errors : []; },
    renderInfo() { const r = renderer.info.render; return { calls: r.calls, triangles: r.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }; },
    leafY(i) { return { lift: field.lift[i], shown: leaves.shown[i] }; },
    startPick() { if (hoverId >= 0) pick = { target: hoverId, elapsed: 0, duration: economy.pickTime }; },
    setPickProgress(p) { if (pick) pick.elapsed = p * pick.duration; },
    hideHud(v) { ui.show('hud', !v); },
    slowmo(k) { timeScale = k; },
    advance(sec) { now += sec; }, // при slowmo(0): шаг времени для съёмки анимаций по кадрам
    mouseState() { return { held: mouseHeld, requested: pickRequested }; },
  };
}
ui.show('hud', true);
