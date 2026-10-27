// Площадка у гаража южнее сада: бетонная площадка с баскетбольным кольцом, гараж,
// качели за гаражом, дерево у забора, контейнер и два приёмника. Планировка — в layout.js (COURT).

import * as THREE from '../../vendor/three.module.min.js';
import { COURT, CZ, POOL_GATE } from '../layout.js';
import { ZONE } from '../config.js';
import { mulberry32 } from '../leaves.js';
import { canvas, toTexture, shade } from './textures.js';
import { placeModel } from './yardAssets.js';
import { add, boxAt, lambert, buildContainer, buildFenceRuns, buildLatticeGate, buildTree } from './scene.js';
import { buildInlet } from './garden.js';

export function buildCourt(scene, MAT, M = {}) {
  const C = COURT;
  const center = { x: (CZ.minX + CZ.maxX) / 2, z: (CZ.minZ + CZ.maxZ) / 2 };
  // северный забор — общий с садом, западный до z = 7 — общий с двором
  buildFenceRuns(scene, MAT, [
    [CZ.minX, ZONE.maxZ, CZ.minX, CZ.maxZ],
    [CZ.minX, CZ.maxZ, CZ.maxX, CZ.maxZ],
    [CZ.maxX, CZ.minZ, CZ.maxX, POOL_GATE.z0], [CZ.maxX, POOL_GATE.z1, CZ.maxX, CZ.maxZ],
  ], center, { seed: 73 });
  // ворота на восток — к террасе с бассейном; лицевая табличка — на площадке
  const poolGate = buildLatticeGate(scene, MAT, CZ.maxX + 0.02, POOL_GATE.z0, CZ.maxX + 0.02, POOL_GATE.z1, -1);

  buildPad(scene, C.pad);
  buildGarage(scene, MAT, C.garage);
  buildHoop(scene, MAT, C.hoop);
  buildSwings(scene, MAT, C.swings);
  if (M.tree1) placeModel(scene, M.tree1, { x: C.tree.x, z: C.tree.z, height: 6.0, tint: '#b8652c', rotY: 1.4 });
  else buildTree(scene, C.tree.x, C.tree.z, 1.1, 71);
  for (const [x, z, r] of C.bushes) {
    if (M.bush) placeModel(scene, M.bush, { x, z, height: r * 2.1, rotY: z * 2, tint: r > 0.44 ? '#6f7f3a' : '#9a8a3e' });
    else add(scene, new THREE.IcosahedronGeometry(r, 1), lambert('#7a8442', { flatShading: true }), x, r * 0.8, z);
  }
  const container = buildContainer(scene, MAT, C.container);
  const inlets = new Map();
  for (const n of C.inlets) inlets.set(n.id, buildInlet(scene, MAT, n));
  return { container, inlets, poolGate };
}

/** Бетонная площадка: светлые плиты со швами, пятна и трещинки; тонкий слой над газоном. */
function buildPad(scene, P) {
  const w = P.x1 - P.x0, d = P.z1 - P.z0, ppm = 110;
  const c = canvas(Math.round(w * ppm), Math.round(d * ppm)), ctx = c.getContext('2d');
  const rng = mulberry32(17);
  ctx.fillStyle = '#a8a49a'; ctx.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 2600; k++) {
    ctx.fillStyle = `rgba(${rng() < 0.5 ? '120,116,108' : '226,222,212'},${0.06 + rng() * 0.1})`;
    ctx.beginPath(); ctx.arc(rng() * c.width, rng() * c.height, 0.6 + rng() * 2.6, 0, Math.PI * 2); ctx.fill();
  }
  for (let k = 0; k < 7; k++) {
    ctx.fillStyle = `rgba(90,84,74,${0.05 + rng() * 0.06})`;
    ctx.beginPath(); ctx.ellipse(rng() * c.width, rng() * c.height, 20 + rng() * 60, 14 + rng() * 40, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // швы между плитами
  ctx.strokeStyle = 'rgba(70,66,60,0.55)'; ctx.lineWidth = 2;
  for (let x = 1.4; x < w; x += 1.4) { ctx.beginPath(); ctx.moveTo(x * ppm, 0); ctx.lineTo(x * ppm, c.height); ctx.stroke(); }
  for (let z = 1.15; z < d; z += 1.15) { ctx.beginPath(); ctx.moveTo(0, z * ppm); ctx.lineTo(c.width, z * ppm); ctx.stroke(); }
  // волосяные трещины
  ctx.strokeStyle = 'rgba(80,76,68,0.4)'; ctx.lineWidth = 1;
  for (let k = 0; k < 5; k++) {
    let x = rng() * c.width, y = rng() * c.height;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (rng() - 0.5) * 40; y += (rng() - 0.3) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // кромка: чуть темнее
  ctx.strokeStyle = shade('#9d998f', -10); ctx.lineWidth = 5; ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mesh.position.set((P.x0 + P.x1) / 2, 0.001, (P.z0 + P.z1) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** Гараж: стены на цоколе, двускатная крыша, секционные ворота на запад (к площадке), окно на юг. */
function buildGarage(scene, MAT, G) {
  const g = new THREE.Group();
  const w = G.x1 - G.x0, d = G.z1 - G.z0, h = 2.55;
  boxAt(g, MAT.foundation, -w / 2 - 0.04, w / 2 + 0.04, 0, 0.14, -d / 2 - 0.04, d / 2 + 0.04);
  boxAt(g, MAT.plaster, -w / 2, w / 2, 0.14, h, -d / 2, d / 2);
  // крыша: скаты на север и юг, фронтоны на западе и востоке
  const rise = 0.65, run = d / 2 + 0.3, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const s of [-1, 1]) {
    const r = add(g, new THREE.BoxGeometry(w + 0.5, 0.1, len), MAT.roof, 0, h + rise / 2 - 0.02, s * run / 2);
    r.rotation.x = s * ang;
  }
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0); gable.lineTo(d / 2, 0); gable.lineTo(0, rise); gable.closePath();
  const gg = new THREE.ExtrudeGeometry(gable, { depth: 0.06, bevelEnabled: false });
  for (const x of [-w / 2, w / 2 - 0.06]) { const m = add(g, gg, MAT.plaster, x, h, 0); m.rotation.y = Math.PI / 2; }
  // секционные ворота: светлое полотно с горизонтальными панелями
  const doorW = 2.4, doorH = 2.15, door = lambert('#e9e4d8');
  boxAt(g, MAT.trim, -w / 2 - 0.05, -w / 2, 0.14, doorH + 0.24, -doorW / 2 - 0.1, doorW / 2 + 0.1);
  boxAt(g, door, -w / 2 - 0.07, -w / 2 - 0.03, 0.14, doorH + 0.14, -doorW / 2, doorW / 2);
  for (let k = 1; k < 4; k++) {
    const y = 0.14 + (doorH * k) / 4;
    boxAt(g, lambert('#bdb7aa'), -w / 2 - 0.085, -w / 2 - 0.07, y - 0.012, y + 0.012, -doorW / 2, doorW / 2, { cast: false });
  }
  boxAt(g, MAT.metal, -w / 2 - 0.1, -w / 2 - 0.07, 0.75, 0.8, -0.2, 0.2, { cast: false });
  // окно на южной стене
  boxAt(g, MAT.trim, -0.45, 0.45, 1.25, 1.95, d / 2, d / 2 + 0.05);
  boxAt(g, MAT.glass, -0.38, 0.38, 1.32, 1.88, d / 2 + 0.02, d / 2 + 0.07, { cast: false });
  // фонарь над воротами
  boxAt(g, MAT.metal, -w / 2 - 0.16, -w / 2, 2.32, 2.46, -0.07, 0.07);
  g.position.set((G.x0 + G.x1) / 2, 0, (G.z0 + G.z1) / 2);
  scene.add(g);
}

/** Баскетбольное кольцо: столб, вынос, щит с квадратом и кольцо с сеткой из тонких стоек. */
function buildHoop(scene, MAT, H) {
  const g = new THREE.Group();
  const paint = lambert('#3e4f5c');
  add(g, new THREE.CylinderGeometry(0.06, 0.07, 3.3, 10), paint, 0, 1.65, 0);
  boxAt(g, paint, 0, 0.45, 3.05, 3.12, -0.05, 0.05);
  boxAt(g, lambert('#f4f2ec'), 0.43, 0.47, 2.75, 3.55, -0.6, 0.6);
  boxAt(g, lambert('#c8442f'), 0.475, 0.48, 3.0, 3.3, -0.2, 0.2, { cast: false });
  const rim = add(g, new THREE.TorusGeometry(0.23, 0.012, 6, 24), lambert('#d2541e'), 0.72, 3.05, 0);
  rim.rotation.x = Math.PI / 2;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const s = add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.36, 3), lambert('#f1efe8'), 0.72 + Math.cos(a) * 0.19, 2.88, Math.sin(a) * 0.19, { cast: false });
    s.rotation.z = Math.cos(a) * 0.12; s.rotation.x = -Math.sin(a) * 0.12;
  }
  g.position.set(H.x, 0, H.z);
  scene.add(g);
}

/** Качели: две А-образные стойки, перекладина, два сиденья на цепях. */
function buildSwings(scene, MAT, S) {
  const g = new THREE.Group();
  const frame = lambert('#5c7d5a'), zc = (S.z0 + S.z1) / 2, half = (S.z1 - S.z0) / 2;
  const leg = (x, z) => {
    const len = Math.hypot(S.h, half);
    const m = add(g, new THREE.CylinderGeometry(0.035, 0.035, len, 8), frame, x, S.h / 2, (z + zc) / 2);
    m.rotation.x = Math.sign(zc - z) * Math.atan2(half, S.h);
  };
  for (const x of [S.x0 + 0.05, S.x1 - 0.05]) { leg(x, S.z0); leg(x, S.z1); }
  const bar = add(g, new THREE.CylinderGeometry(0.04, 0.04, S.x1 - S.x0, 8), frame, (S.x0 + S.x1) / 2, S.h, zc);
  bar.rotation.z = Math.PI / 2;
  const rng = mulberry32(5);
  for (const x of [S.x0 + 0.85, S.x1 - 0.85]) {
    const sway = (rng() - 0.5) * 0.1;
    for (const dx of [-0.2, 0.2]) {
      const c = add(g, new THREE.CylinderGeometry(0.008, 0.008, S.h - 0.5, 4), MAT.metal, x + dx, (S.h + 0.5) / 2, zc, { cast: false });
      c.rotation.x = sway;
    }
    boxAt(g, lambert('#7b4b2f'), x - 0.24, x + 0.24, 0.47, 0.51, zc - 0.09 + sway * 0.85, zc + 0.09 + sway * 0.85);
  }
  scene.add(g);
}
