// Сквер с лабиринтом южнее террасы и аллея южнее сквера и площадки: живая изгородь-лабиринт,
// теплица с дорожкой, скамейки, фонари, ряды лип. Планировка — в layout.js (PARK, ALLEY).

import * as THREE from '../../vendor/three.module.min.js';
import { PARK, KZ, ALLEY, AZ, ALLEY_GATE } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { canvas, toTexture, shade } from './textures.js';
import { placeModel } from './yardAssets.js';
import { add, boxAt, lambert, buildContainer, buildFenceRuns, buildLatticeGate, buildTree } from './scene.js';
import { buildInlet } from './garden.js';

export function buildPark(scene, MAT, M = {}) {
  const P = PARK;
  const center = { x: (KZ.minX + KZ.maxX) / 2, z: (KZ.minZ + KZ.maxZ) / 2 };
  // северный забор — общий с террасой; западный до z = 11,2 — общий с площадкой
  buildFenceRuns(scene, MAT, [
    [KZ.minX, 11.2, KZ.minX, KZ.maxZ],
    [KZ.maxX, KZ.minZ, KZ.maxX, KZ.maxZ],
    [KZ.minX, KZ.maxZ, ALLEY_GATE.x0, KZ.maxZ], [ALLEY_GATE.x1, KZ.maxZ, KZ.maxX, KZ.maxZ],
  ], center, { seed: 97 });
  // ворота на юг — к аллее; лицевая табличка — в сквере (север)
  const alleyGate = buildLatticeGate(scene, MAT, ALLEY_GATE.x0, KZ.maxZ + 0.02, ALLEY_GATE.x1, KZ.maxZ + 0.02, 1);

  stonePath(scene, P.path.x0, P.path.x1, P.path.z0, P.path.z1, 33);
  const hedgeMat = new THREE.MeshLambertMaterial({ map: hedgeTexture() });
  for (const [x0, x1, z0, z1] of P.hedges) {
    const m = boxAt(scene, hedgeMat, x0, x1, 0, 1.15, z0, z1);
    // текстура изгороди — по метрам, а не растянута на стену
    const uv = m.geometry.attributes.uv;
    const pos = m.geometry.attributes.position, n = m.geometry.attributes.normal;
    for (let k = 0; k < uv.count; k++) {
      if (Math.abs(n.getY(k)) > 0.5) { uv.setXY(k, pos.getX(k) * 1.2, pos.getZ(k) * 1.2); continue; } // верх
      const ax = Math.abs(n.getX(k)) > 0.5 ? pos.getZ(k) : pos.getX(k);
      uv.setXY(k, ax * 1.2 + x0, pos.getY(k) * 1.2);
    }
  }
  buildGreenhouse(scene, MAT, P.greenhouse);
  for (const b of P.benches) buildBench(scene, MAT, b);
  for (const [x, z] of P.lamps) buildLamp(scene, MAT, x, z);
  P.trees.forEach((t, k) => {
    const model = k % 2 ? M.tree1 : M.tree3;
    if (model) placeModel(scene, model, { x: t.x, z: t.z, height: 6.2 - k * 0.6, tint: k % 2 ? '#c9772f' : '#b8652c', rotY: k * 1.7 });
    else buildTree(scene, t.x, t.z, 1.05, 91 + k);
  });
  for (const [x, z, r] of P.bushes) {
    if (M.bush) placeModel(scene, M.bush, { x, z, height: r * 2.1, rotY: x * z, tint: '#6f7f3a' });
    else add(scene, new THREE.IcosahedronGeometry(r, 1), lambert('#7a8442', { flatShading: true }), x, r * 0.8, z);
  }
  const container = buildContainer(scene, MAT, P.container);
  const inlets = new Map();
  for (const n of P.inlets) inlets.set(n.id, buildInlet(scene, MAT, n));
  return { container, inlets, alleyGate };
}

export function buildAlley(scene, MAT, M = {}) {
  const A = ALLEY;
  const center = { x: (AZ.minX + AZ.maxX) / 2, z: (AZ.minZ + AZ.maxZ) / 2 };
  // северный забор от x = 18 — общий со сквером
  buildFenceRuns(scene, MAT, [
    [AZ.minX, AZ.minZ, KZ.minX, AZ.minZ],
    [AZ.minX, AZ.minZ, AZ.minX, AZ.maxZ],
    [AZ.maxX, AZ.minZ, AZ.maxX, AZ.maxZ],
    [AZ.minX, AZ.maxZ, AZ.maxX, AZ.maxZ],
  ], center, { seed: 101 });
  stonePath(scene, A.path.x0, A.path.x1, A.path.z0, A.path.z1, 41, true);
  A.trees.forEach((t, k) => {
    const model = k % 3 === 1 ? M.tree3 : M.tree1;
    const tint = ['#c58b32', '#c9772f', '#d09a3a'][k % 3];
    if (model) placeModel(scene, model, { x: t.x, z: t.z, height: 6.6 + (k % 4) * 0.25, tint, rotY: k * 2.3 });
    else buildTree(scene, t.x, t.z, 1.1, 120 + k);
  });
  for (const b of A.benches) buildBench(scene, MAT, b);
  for (const [x, z] of A.lamps) buildLamp(scene, MAT, x, z);
  const container = buildContainer(scene, MAT, A.container);
  const inlets = new Map();
  for (const n of A.inlets) inlets.set(n.id, buildInlet(scene, MAT, n));
  return { container, inlets };
}

/** Живая изгородь: плотная мелкая листва, светлые и тёмные пятна. */
function hedgeTexture() {
  const c = canvas(256), ctx = c.getContext('2d'), rng = mulberry32(61);
  ctx.fillStyle = '#3f5a2f'; ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2600; k++) {
    ctx.fillStyle = shade(['#4f6e38', '#5d7d40', '#35502a', '#6b8a46', '#7a7a3a'][Math.floor(rng() * 5)], (rng() - 0.5) * 16);
    ctx.beginPath(); ctx.ellipse(rng() * 256, rng() * 256, 2 + rng() * 4, 1.5 + rng() * 2.5, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // несколько осенних листьев в изгороди
  for (let k = 0; k < 40; k++) {
    ctx.fillStyle = ['#c46a2a', '#d99a3a', '#a8442a'][k % 3];
    ctx.beginPath(); ctx.ellipse(rng() * 256, rng() * 256, 3, 2, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Дорожка из камня: плитки (сквер) или брусчатка (аллея) тонким слоем над газоном. */
function stonePath(scene, x0, x1, z0, z1, seed, cobble = false) {
  const w = x1 - x0, d = z1 - z0, ppm = cobble ? 64 : 90;
  const c = canvas(Math.round(w * ppm), Math.round(d * ppm)), ctx = c.getContext('2d'), rng = mulberry32(seed);
  ctx.fillStyle = '#8d8676'; ctx.fillRect(0, 0, c.width, c.height);
  const tile = (cobble ? 0.16 : 0.45) * ppm;
  let row = 0;
  for (let y = 0; y < c.height; y += tile, row++) {
    const off = (row % 2) * tile * 0.5;
    for (let x = -off; x < c.width; x += tile * (cobble ? 1 : 1.3)) {
      ctx.fillStyle = shade(cobble ? '#a59a86' : '#c3baa5', (rng() - 0.5) * 26);
      ctx.beginPath(); ctx.roundRect(x + 2, y + 2, tile * (cobble ? 1 : 1.3) - 4, tile - 4, cobble ? 4 : 6); ctx.fill();
    }
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mesh.position.set((x0 + x1) / 2, 0.001, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** Теплица: белый каркас, стеклянные стены и двускатная стеклянная крыша, дверь на север. */
function buildGreenhouse(scene, MAT, G) {
  const g = new THREE.Group(), w = G.x1 - G.x0, d = G.z1 - G.z0, h = 1.9;
  const glass = new THREE.MeshStandardMaterial({ color: '#d5ece6', transparent: true, opacity: 0.32, roughness: 0.05, depthWrite: false });
  const frame = lambert('#f2f0ea');
  boxAt(g, MAT.foundation, -w / 2, w / 2, 0, 0.3, -d / 2, d / 2);
  for (const [x0, x1, z0, z1] of [[-w / 2, w / 2, -d / 2, -d / 2 + 0.02], [-w / 2, w / 2, d / 2 - 0.02, d / 2], [-w / 2, -w / 2 + 0.02, -d / 2, d / 2], [w / 2 - 0.02, w / 2, -d / 2, d / 2]]) {
    boxAt(g, glass, x0, x1, 0.3, h, z0, z1, { cast: false });
  }
  // стойки каркаса
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += w / 4) for (const z of [-d / 2, d / 2]) boxAt(g, frame, x - 0.03, x + 0.03, 0.3, h, z - 0.03, z + 0.03);
  for (let z = -d / 2; z <= d / 2 + 1e-6; z += d / 3) for (const x of [-w / 2, w / 2]) boxAt(g, frame, x - 0.03, x + 0.03, 0.3, h, z - 0.03, z + 0.03);
  // крыша: два ската вдоль X
  const rise = 0.75, run = d / 2, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const s of [-1, 1]) {
    const r = add(g, new THREE.BoxGeometry(w, 0.02, len), glass, 0, h + rise / 2, s * run / 2, { cast: false });
    r.rotation.x = s * ang;
    add(g, new THREE.BoxGeometry(w + 0.04, 0.05, 0.05), frame, 0, h, s * d / 2);
  }
  boxAt(g, frame, -w / 2 - 0.02, w / 2 + 0.02, h + rise - 0.03, h + rise + 0.03, -0.03, 0.03);
  // дверь к дорожке
  const dx = (PARK.path.x0 + PARK.path.x1) / 2 - (G.x0 + G.x1) / 2;
  boxAt(g, frame, dx - 0.45, dx + 0.45, 0.3, 2.05, -d / 2 - 0.03, -d / 2 + 0.01);
  boxAt(g, glass, dx - 0.4, dx + 0.4, 0.3, 2.0, -d / 2 - 0.04, -d / 2 - 0.02, { cast: false });
  // внутри — стеллажи с горшками (видны сквозь стекло)
  const rng = mulberry32(7);
  for (const z of [-d / 4, d / 4]) {
    boxAt(g, MAT.wood, -w / 2 + 0.3, w / 2 - 0.3, 0.75, 0.8, z - 0.3, z + 0.3);
    for (let k = 0; k < 7; k++) {
      const x = -w / 2 + 0.55 + k * (w - 1.1) / 6;
      add(g, new THREE.CylinderGeometry(0.09, 0.07, 0.16, 8), lambert('#b5643a'), x, 0.88, z);
      add(g, new THREE.IcosahedronGeometry(0.13, 0), lambert(rng() < 0.5 ? '#5f8a3e' : '#7a9a48', { flatShading: true }), x, 1.05, z, { cast: false });
    }
  }
  g.position.set((G.x0 + G.x1) / 2, 0, (G.z0 + G.z1) / 2);
  scene.add(g);
}

/** Скамейка вдоль оси Z (как во дворе): чугунные боковины, деревянные сиденье и спинка. */
function buildBench(scene, MAT, b) {
  const g = new THREE.Group(), len = Math.max(b.x1 - b.x0, b.z1 - b.z0), along = b.z1 - b.z0 > b.x1 - b.x0;
  for (const dz of [-len / 2 + 0.15, len / 2 - 0.15]) {
    boxAt(g, MAT.metal, -0.24, -0.18, 0, 0.45, dz - 0.03, dz + 0.03);
    boxAt(g, MAT.metal, 0.18, 0.24, 0, 0.88, dz - 0.03, dz + 0.03);
  }
  for (let i = 0; i < 4; i++) boxAt(g, MAT.wood, -0.27 + i * 0.12, -0.17 + i * 0.12, 0.43, 0.48, -len / 2, len / 2);
  for (let i = 0; i < 3; i++) {
    const s = boxAt(g, MAT.wood, 0.2, 0.24, 0.55 + i * 0.12, 0.64 + i * 0.12, -len / 2, len / 2);
    s.rotation.z = 0.12;
  }
  g.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  if (!along) g.rotation.y = Math.PI / 2;
  scene.add(g);
}

/** Садовый фонарь: тёмный столб и тёплый плафон. */
function buildLamp(scene, MAT, x, z) {
  const dark = lambert('#2d3033');
  add(scene, new THREE.CylinderGeometry(0.05, 0.07, 2.4, 8), dark, x, 1.2, z);
  add(scene, new THREE.BoxGeometry(0.22, 0.3, 0.22), lambert('#fff1c4', { emissive: '#ffcf70', emissiveIntensity: 0.5 }), x, 2.55, z, { cast: false });
  add(scene, new THREE.ConeGeometry(0.2, 0.14, 4), dark, x, 2.77, z).rotation.y = Math.PI / 4;
}
