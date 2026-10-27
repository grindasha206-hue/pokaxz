// Точка входа: сцена, управление, цикл игры, сохранение.

import * as THREE from '../vendor/three.module.min.js';
import { PLAYER, UPGRADES, RAKE, RAKE_STROKE, BLOWER_STREAM, TOOLS, REMAINING_HIGHLIGHT, LEGACY_BACKUP_KEY, formatGain, formatMoney, plural } from './config.js';
import { level, setLevel, distToObstacle, resolveCircle, segmentBlocked, surfaceHeight, ZONE_ORDER, LEVELS, ARRIVALS } from './layout.js';
import { ON_GROUND } from './leaves.js';
import { createGame, zoneUnlocked } from './game.js';
import { ALL_INLETS } from './economy.js';
import { rakeStats, strokeSpan, rakeStroke, activeInlets } from './rake.js';
import { RakeView } from './view/rakeView.js';
import { blowerStats, blowTick } from './blower.js';
import { BlowerView } from './view/blowerView.js';
import { buildSave, parseSave, readLocal, readLocalRaw, writeLocal, clearLocal, isLegacySave } from './save.js';
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
// режим замера, фрагмент и чистый старт не трогают настоящее сохранение
const NO_SAVE = params.has('fresh') || LEAF_OVERRIDE !== null || FRAGMENT_MODE;
const FORCE_FPS = params.has('fps') || LEAF_OVERRIDE !== null;

const ui = new UI();
const sound = new Sound();

// ── загрузка ─────────────────────────────────────────────────
let game, startNote = '';
// Сохранение прежней экономики (монеты): до выбора игрока ничего не перезаписываем.
let legacyText = null, legacyPending = false;
{
  let saved = NO_SAVE ? null : readLocal();
  if (saved && isLegacySave(saved)) {
    legacyText = readLocalRaw();
    legacyPending = true;
    saved = null;
  }
  // активная зона: из сохранения; ?zone=garden — только для проверки без сохранения
  const want = NO_SAVE ? params.get('zone') : saved?.currentZone;
  if (FRAGMENT_MODE) setLevel('fragment');
  else if (ZONE_ORDER.includes(want)) setLevel(want);
  try {
    game = createGame(saved, { leafCount: LEAF_OVERRIDE ?? undefined });
    if (saved) startNote = 'Продолжаем с сохранения.';
    if (game.fixes.length) console.warn('save fixes', game.fixes);
  } catch (e) {
    console.warn(e);
    // повреждена не двор, а другая зона — сначала пробуем вернуться во двор с тем же прогрессом
    let ok = false;
    if (saved && level.id !== 'yard') {
      try { setLevel('yard'); game = createGame(saved); ok = true; startNote = `Зона «${LEVELS[want]?.name}» в сохранении повреждена — вы во дворе.`; } catch { /* дальше — новая игра */ }
    }
    if (!ok) {
      setLevel('yard');
      game = createGame(null);
      startNote = 'Сохранение не удалось прочитать — начата новая игра.';
    }
  }
  if (NO_SAVE) {
    startNote = FRAGMENT_MODE ? `Фрагмент для оценки листьев: ${game.field.count} листьев, прогресс не сохраняется.`
      : LEAF_OVERRIDE ? `Замер: ${LEAF_OVERRIDE} листьев, прогресс не сохраняется.` : 'Чистый старт, прогресс не сохраняется.';
  }
}
const { field, economy, settings } = game;
document.getElementById('zone-name').textContent = level.name;

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
  // во дворе — своя земля с дорожкой; в саду — общий газон вокруг участков
  if (level.id === 'yard') {
    ground = new Ground(field, yardAssets.mats.grass);
    scene.add(ground.mesh);
  } else ground = { update() {} };
}
// в зонах больше 20 тыс. листьев лист — сетка 3 × 3 вместо 4 × 4: почти вдвое меньше треугольников
const leaves = new LeafView(scene, field, leafTextures, { size: level.leafSize, segments: field.count > 20000 ? 3 : 4 });
const rakeView = new RakeView(scene);
const blowerView = new BlowerView(scene);
// приёмники сада видны и из двора: открыта решётка или крышка
for (const [id, v] of world.inlets ?? []) v.setOwned(ALL_INLETS.some((n) => n.id === id && (n.price === 0 || economy.progress.inlets.includes(id))));
ui.tools('hand', economy.progress.tools);

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
let tool = 'hand';              // hand | rake | blower
let stroke = null;              // взмах граблей: { t, span, done }
let spin = 0, blowAcc = 0;      // воздуходувка: разгон 0…1 и накопленное время до следующего такта струи
let now = 0;
let dirty = false, lastSave = 0;
let lastStep = 0;

const GAME_KEYS = new Set(['Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyQ', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

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
    case 'Digit1': selectTool('hand'); break;
    case 'Digit2': selectTool('rake'); break;
    case 'Digit3': selectTool('blower'); break;
    case 'KeyQ': { // по кругу среди того, что есть
      const own = ['hand', ...Object.keys(TOOLS).filter((t) => economy.progress.tools[t])];
      selectTool(own[(own.indexOf(tool) + 1) % own.length]);
      break;
    }
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
  spin = 0;
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

// ── прежнее сохранение: экспорт или новый старт с подтверждением ─────────────
function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
if (legacyPending) {
  const startBtn = document.getElementById('start-btn');
  document.getElementById('legacy').hidden = false;
  startBtn.disabled = true;
  document.getElementById('legacy-export').addEventListener('click', () => downloadText(legacyText, 'osenniy-dvor-old-coins-save.json'));
  const confirmRow = document.getElementById('legacy-confirm');
  document.getElementById('legacy-new').addEventListener('click', () => { confirmRow.hidden = false; });
  document.getElementById('legacy-no').addEventListener('click', () => { confirmRow.hidden = true; });
  document.getElementById('legacy-yes').addEventListener('click', () => {
    try { localStorage.setItem(LEGACY_BACKUP_KEY, legacyText); } catch { /* копия не обязательна: файл можно экспортировать */ }
    legacyPending = false;
    saveNow(); // новое сохранение заменяет прежнее
    document.getElementById('legacy').hidden = true;
    startBtn.disabled = false;
    document.getElementById('start-note').textContent = 'Новая игра: $0,00. Копия прежнего сохранения осталась в браузере.';
  });
}

// ── действия ─────────────────────────────────────────────────
function selectTool(name) {
  if (TOOLS[name] && !economy.progress.tools[name]) {
    ui.toast(`${TOOLS[name].title} — в блокноте (<kbd>Tab</kbd>) за ${formatMoney(TOOLS[name].price)}`, 2200);
    return;
  }
  if (name === tool) return;
  tool = name;
  pick = null; stroke = null; spin = 0;
  ui.tools(tool, economy.progress.tools);
  if (tool === 'rake' && !game.hints.raked) {
    ui.toast('Грабли: наведите на листья и удерживайте кнопку — листья тянутся к вам. ' +
      'Протащите кучу над приёмником, и она продастся сразу. <kbd>1</kbd> — рука', 6000);
  }
  if (tool === 'blower' && !game.hints.blown) {
    ui.toast('Воздуходувка: удерживайте кнопку — струя гонит листья от вас, они собираются валом. ' +
      'Гоните вал к приёмнику; у заборов листья удобнее отвести граблями. <kbd>1</kbd> — рука', 7000);
  }
}

function nearest() {
  // ближайший объект для F, к которому игрок стоит лицом
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  let best = null, bestD = Infinity;
  (level.gates ?? []).forEach((g, k) => {
    const dx = g.x - player.x, dz = g.z - player.z, d = Math.hypot(dx, dz);
    if (d > 1.7 || (dx * fx + dz * fz) / (d || 1) < 0.3) return;
    if (d < bestD) { bestD = d; best = `gate:${k}`; }
  });
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
  else if (target?.startsWith('gate:')) useGate(level.gates[+target.slice(5)]);
}

/** Почему нельзя пройти в ворота (или null — можно). */
function gateBlock(g) {
  if (!g.to) return g.locked;
  if (!zoneUnlocked(economy.progress, g.to)) return g.locked;
  if (economy.inBag > 0) return 'Сначала сдайте мешок в контейнер';
  if (NO_SAVE) return 'В режиме без сохранения переход между зонами отключён';
  return null;
}

function useGate(g) {
  const why = gateBlock(g);
  if (why) { ui.toast(why, 2600); sound.denied(); return; }
  // переход: сохраняем, что игрок уже в новой зоне у ворот, и загружаем её
  stopWork();
  game.nextZone = g.to;
  game.player = { ...ARRIVALS[`${level.id}>${g.to}`] };
  saveNow();
  skipSave = true;
  ui.toast(`Переходим: ${LEVELS[g.to].name}…`, 4000);
  setTimeout(() => location.reload(), 250);
}

const tmpV = new THREE.Vector3(), tmpFrom = new THREE.Vector3();

function deposit() {
  if (economy.inBag === 0) {
    ui.toast('Мешок пуст — сначала соберите листья', 1600);
    return;
  }
  const n = economy.deposit();
  sound.deposit(n);
  ui.money(economy.money, economy.lastGain);
  ui.bag(economy.inBag, economy.capacity, true);
  const C = level.container;
  camera.localToWorld(tmpFrom.set(0.12, -0.3, -0.45));
  leaves.depositBurst(tmpFrom, tmpV.set(C.x, C.h + 0.1, C.z), n, now);
  lidOpenUntil = now + 0.9;
  if (!game.hints.deposited) game.hints.deposited = true;
  ui.toast(`Сдано ${n} ${plural(n, 'лист', 'листа', 'листьев')}: <b>${formatGain(economy.lastGain)}</b>`, 2000);
  if (economy.remaining === 0) setTimeout(() => ui.toast(zoneDoneText(), 5000), 2100);
  saveNow();
}

function zoneDoneText() {
  const g = (level.gates ?? []).find((x) => x.requires === `${level.id}-100`);
  return g?.to && LEVELS[g.to] ? `${level.name}: чисто! Открыта зона «${LEVELS[g.to].name}» — <kbd>F</kbd> у ворот.`
    : `${level.name}: чисто! Следующая зона появится в новой версии игры.`;
}

// таблички на воротах: куда ведут и открыты ли (зон, которых ещё нет, — «скоро»)
const SOON = {};
function updateGateSigns() {
  for (const [key, set] of Object.entries(world.gateSigns ?? {})) {
    const [from, to] = key.split('>'), L = LEVELS[to];
    if (!L) { set(SOON[to] ?? ['— скоро']); continue; }
    // открывается уборкой той зоны, из которой в неё ведут ворота с условием
    const by = ZONE_ORDER.find((z) => (LEVELS[z].gates ?? []).some((g) => g.to === to && g.requires)) ?? from;
    set(zoneUnlocked(economy.progress, to) ? [L.signName, 'F — пройти'] : [L.signName, 'откроется после', `уборки ${LEVELS[by].genitive}`]);
  }
}

const buyLock = new Map();
function buy(key, btn) {
  const t = performance.now();
  if (t - (buyLock.get(key) ?? 0) < 250) return; // защита от двойного клика
  buyLock.set(key, t);
  const before = economy.money;
  const res = economy.buy(key);
  if (!res) { sound.denied(); btn?.classList.add('flash'); return; }
  sound.purchase();
  ui.money(economy.money, economy.money - before);
  ui.bag(economy.inBag, economy.capacity);
  game.hints.bought = true;
  let text;
  if (UPGRADES[key]) {
    const u = UPGRADES[key];
    text = `${u.title} улучшен: <b>${key === 'grab' ? `теперь ${u.unit(res.value)} за раз`
      : key === 'speed' ? `подбор за ${u.unit(res.value)}` : `в мешок помещается ${u.unit(res.value)}`}</b>`;
  } else if (TOOLS[key]) {
    text = key === 'rake' ? 'Куплены <b>грабли</b>: клавиша <kbd>2</kbd> или <kbd>Q</kbd>'
      : 'Куплена <b>воздуходувка</b>: клавиша <kbd>3</kbd> или <kbd>Q</kbd>';
    ui.tools(tool, economy.progress.tools);
  } else if (TOOLS[key.split(':')[0]]) {
    const [t, br] = key.split(':'), b = TOOLS[t].branches[br];
    text = `${b.title}: <b>${b.unit(res.value, res.level)}</b>`;
  } else {
    text = `${res.inlet.name} открыт`;
    world.inlets?.get(res.inlet.id)?.setOwned(true);
  }
  ui.toast(text, 2600);
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
        // награды зоны: выдаются один раз и сразу сохраняются
        for (const r of economy.checkRewards()) {
          setTimeout(() => ui.toast(`${level.name} убран на ${Math.round(r.at * 100)} %: <b>${r.text}</b>`, 3600), 400);
          saveNow();
        }
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

// ── грабли ───────────────────────────────────────────────────
// Взмах начинается нажатием (удержание — взмахи подряд). Листья сдвигаются сразу в логике,
// а на экране едут вместе с головой граблей. Над приёмником куча проваливается и продаётся.
const PULL = 0.7; // доля взмаха на протяжку, остальное — возврат головы

function rakeSpanNow() {
  const st = rakeStats(economy.rake);
  camera.getWorldDirection(camDir);
  let aim = Infinity;
  if (camDir.y < -0.02) aim = (player.eye - surfaceHeight(player.x, player.z)) / -camDir.y * Math.hypot(camDir.x, camDir.z);
  let span = strokeSpan(st, aim);
  // голова не заходит за забор и стены: укорачиваем взмах, пока путь свободен
  const dx = -Math.sin(player.yaw), dz = -Math.cos(player.yaw);
  while (span.start > RAKE_STROKE.minStart) {
    const far = span.start + RAKE_STROKE.reach;
    if (!segmentBlocked(player.x, 0.1, player.z, player.x + dx * far, 0.1, player.z + dz * far)) break;
    span = { start: span.start - 0.1, end: span.end - 0.1 };
  }
  return { st, span };
}

let rakeSpan = null;
function updateRake(dt) {
  const held = mouseHeld || (settings.collectMode === 'hold' && keys.has('KeyE'));
  const want = pickRequested || autoCollect || held;
  pickRequested = false;
  hoverId = -1; hoverGroup = [];
  const { st, span } = rakeSpanNow();
  rakeSpan = span;
  rakeView.setWidth(st.width);
  if (stroke) {
    stroke.t += dt;
    if (stroke.t >= RAKE_STROKE.time) stroke = null;
  }
  if (stroke || !want) return;
  stroke = { t: 0, span };
  const p = { x: player.x, z: player.z, yaw: player.yaw };
  const r = rakeStroke(field, p, st, span, activeInlets(economy.progress));
  sound.rake();
  if (!r.moved.length && !r.absorbed.length) return;
  const n = applyMoves(r, RAKE_STROKE.time * PULL);
  sound.rustle(Math.min(10, Math.ceil(r.moved.length / 8) + n));
  game.hints.raked = true;
}

/**
 * Общее для граблей и воздуходувки: сдвинутые листья едут на экране dur секунд, куча
 * перестраивается, листья над приёмниками проваливаются и продаются. Возвращает число проданных.
 */
let sale = { n: 0, gain: 0, at: 0 };
function applyMoves(r, dur) {
  if (r.moved.length) leaves.slide(r.moved, field.resettle(...r.box), now, dur);
  let n = 0, gain = 0;
  for (const a of r.absorbed) {
    n += economy.sellDirect(a.ids); gain += economy.lastGain;
    leaves.sink(a.from, a.inlet, now, dur + 0.2);
  }
  dirty = true;
  if (!n) return 0;
  ui.money(economy.money, gain);
  sound.deposit(Math.min(n, 30));
  // продажи подряд (воздуходувка — каждый такт) складываются в одно сообщение
  if (now - sale.at > 1.5) sale = { n: 0, gain: 0, at: now };
  sale.n += n; sale.gain += gain; sale.at = now;
  ui.toast(`В приёмник: ${sale.n} ${plural(sale.n, 'лист', 'листа', 'листьев')} · <b>${formatGain(sale.gain)}</b>`, 1400);
  for (const rw of economy.checkRewards()) {
    setTimeout(() => ui.toast(`${level.name} убран на ${Math.round(rw.at * 100)} %: <b>${rw.text}</b>`, 3600), 400);
    saveNow();
  }
  if (economy.remaining === 0 && economy.inBag === 0) setTimeout(() => ui.toast(zoneDoneText(), 5000), 1600);
  return n;
}

// ── воздуходувка ─────────────────────────────────────────────
// Пока кнопка удерживается, струя набирает силу (разгон по мощности) и каждые 0,05 с сдвигает
// листья; отпустили — мотор стихает. Логика тактами, чтобы скорость не зависела от частоты кадров.
function updateBlower(dt) {
  const held = mouseHeld || pickRequested || autoCollect || (settings.collectMode === 'hold' && keys.has('KeyE'));
  pickRequested = false;
  hoverId = -1; hoverGroup = [];
  const st = blowerStats(economy.blower);
  spin = held ? Math.min(1, spin + dt / st.startup) : Math.max(0, spin - dt * 2.5);
  if (!held) { blowAcc = 0; return; }
  blowAcc = Math.min(blowAcc + dt, BLOWER_STREAM.tick * 4);
  const ins = activeInlets(economy.progress);
  const p = { x: player.x, z: player.z, yaw: player.yaw };
  let moved = 0;
  while (blowAcc >= BLOWER_STREAM.tick) {
    blowAcc -= BLOWER_STREAM.tick;
    const r = blowTick(field, p, st, spin, BLOWER_STREAM.tick, ins);
    moved += r.moved.length;
    if (r.moved.length || r.absorbed.length) applyMoves(r, BLOWER_STREAM.tick);
    for (const { i } of r.moved) leaves.flutter(i, spin);
  }
  if (moved && now - lastStep > 0.2) { sound.rustle(Math.min(6, Math.ceil(moved / 30))); lastStep = now; }
  if (moved) game.hints.blown = true;
}

/** Где голова граблей сейчас: расстояние от игрока и подъём (возврат после протяжки). */
function rakeHead() {
  const span = rakeSpan ?? { start: RAKE_STROKE.minStart, end: 0.5 };
  if (!stroke) return { d: span.start, lift: 0.015 };
  const u = stroke.t / RAKE_STROKE.time, s = stroke.span;
  const ease = (x) => x * x * (3 - 2 * x);
  if (u < PULL) return { d: s.start - (s.start - s.end) * ease(u / PULL), lift: 0 };
  const v = (u - PULL) / (1 - PULL);
  return { d: s.end + (span.start - s.end) * ease(v), lift: Math.sin(v * Math.PI) * 0.12 };
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
  if (near?.startsWith('gate:')) {
    const g = level.gates[+near.slice(5)], why = gateBlock(g);
    ui.bagNote(why ?? `<kbd>F</kbd> ${LEVELS[g.to].name}`, { full: !!why && full });
    return;
  }
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
  if (NO_SAVE || skipSave || legacyPending) return;
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
    if (isLegacySave(data)) {
      status.textContent = 'Это сохранение прежней версии (монеты). В новую экономику оно не загружается — храните файл как архив.';
      importInput.value = '';
      return;
    }
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
    if (tool === 'rake') updateRake(dt);
    else if (tool === 'blower') updateBlower(dt);
    else updatePicking(dt);
    if (dirty && now - lastSave > 10) saveNow();
  } else {
    hoverId = -1; hoverGroup = [];
  }
  leaves.setWobble(pick ? pick.target : -1, pick ? Math.min(1, pick.elapsed / pick.duration) : 0, now);
  leaves.setHighlight(pick ? pick.target : hoverId, pick ? groupFor(pick.target) : hoverGroup);
  updateHints();
  if (tool === 'hand') ui.crosshair(hoverId >= 0 || !!pick, pick ? Math.min(1, pick.elapsed / pick.duration) : null);
  ui.money(economy.money);
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
  if (tool === 'rake') {
    const h = rakeHead();
    rakeView.update(true, player, camera, h.d, h.lift, rakeSpan ?? { start: h.d, end: h.d - 0.6 });
    ui.crosshair(false, stroke ? Math.min(1, stroke.t / RAKE_STROKE.time) : null);
  } else rakeView.update(false);
  if (tool === 'blower') {
    if (state !== 'playing') spin = 0;
    blowerView.update(true, player, camera, blowerStats(economy.blower), spin, now);
    ui.crosshair(false, spin > 0 ? spin : null);
  } else blowerView.update(false);
  sound.blower(tool === 'blower' && state === 'playing' ? spin : 0);
  updateGateSigns();
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
    selectTool(t) { selectTool(t); return tool; },
    buy(key) { buy(key); return economy.progress; },
    rakeOnce() { if (tool !== 'rake') return null; stroke = null; pickRequested = true; updateRake(0); return economy.sold; },
    blowFor(sec) { // удерживать кнопку воздуходувки sec секунд игрового времени (такты без кадров)
      if (tool !== 'blower') return null;
      for (let t = 0; t < sec; t += BLOWER_STREAM.tick) { mouseHeld = true; updateBlower(BLOWER_STREAM.tick); }
      mouseHeld = false;
      return economy.sold;
    },
    gate(k) { const g = level.gates[k]; return gateBlock(g) ?? (useGate(g), 'ok'); },
    level() { return level.id; },
    rakeSpan() { return rakeSpan; },
  };
}
ui.show('hud', true);
