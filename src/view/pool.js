// Терраса с бассейном восточнее сада и площадки: деревянный настил с грилем и столом под зонтом,
// бассейн с каменным бортиком, шезлонги, дерево, кусты, контейнер и два приёмника.
// Планировка — в layout.js (POOL).

import * as THREE from '../../vendor/three.module.min.js';
import { POOL, PZ, PARK_GATE } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { placeModel } from './yardAssets.js';
import { add, boxAt, lambert, buildContainer, buildFenceRuns, buildLatticeGate, buildTree } from './scene.js';
import { buildInlet } from './garden.js';

export function buildPool(scene, MAT, M = {}) {
  const P = POOL;
  const center = { x: (PZ.minX + PZ.maxX) / 2, z: (PZ.minZ + PZ.maxZ) / 2 };
  // западный забор — общий с садом и площадкой
  buildFenceRuns(scene, MAT, [
    [PZ.minX, PZ.minZ, PZ.maxX, PZ.minZ],
    [PZ.maxX, PZ.minZ, PZ.maxX, PZ.maxZ],
    [PZ.minX, PZ.maxZ, PARK_GATE.x0, PZ.maxZ], [PARK_GATE.x1, PZ.maxZ, PZ.maxX, PZ.maxZ],
  ], center, { seed: 89 });
  // ворота на юг — к скверу; лицевая табличка — на террасе (север)
  const parkGate = buildLatticeGate(scene, MAT, PARK_GATE.x0, PZ.maxZ + 0.02, PARK_GATE.x1, PZ.maxZ + 0.02, 1);

  buildDeck(scene, MAT, P.deck);
  buildPoolBasin(scene, MAT, P.pool);
  buildGrill(scene, MAT, P.grill);
  buildTable(scene, MAT, P.table);
  for (const l of P.loungers) buildLounger(scene, MAT, l);
  if (M.tree3) placeModel(scene, M.tree3, { x: P.tree.x, z: P.tree.z, height: 6.4, tint: '#c58b32', rotY: 0.4 });
  else buildTree(scene, P.tree.x, P.tree.z, 1.15, 83);
  for (const [x, z, r] of P.bushes) {
    if (M.bush) placeModel(scene, M.bush, { x, z, height: r * 2.1, rotY: x + z, tint: r > 0.47 ? '#6f7f3a' : '#9a8a3e' });
    else add(scene, new THREE.IcosahedronGeometry(r, 1), lambert('#7a8442', { flatShading: true }), x, r * 0.8, z);
  }
  // кадки с туями по углам настила
  for (const [x, z] of [[P.deck.x1 - 0.3, P.deck.z0 + 0.3], [P.deck.x1 - 0.3, P.deck.z1 - 0.3]]) {
    add(scene, new THREE.CylinderGeometry(0.2, 0.16, 0.4, 12), lambert('#a8603c'), x, P.deck.h + 0.2, z);
    add(scene, new THREE.ConeGeometry(0.22, 0.9, 10), lambert('#4f6a3a'), x, P.deck.h + 0.85, z);
  }
  const container = buildContainer(scene, MAT, P.container);
  const inlets = new Map();
  for (const n of P.inlets) inlets.set(n.id, buildInlet(scene, MAT, n, n.id === 'pool-a' ? P.deck.h : 0));
  return { container, inlets, parkGate };
}

/** Настил из досок поперёк террасы, с торцевой доской по краю. */
function buildDeck(scene, MAT, D) {
  const g = new THREE.Group();
  boxAt(g, MAT.darkWood, D.x0, D.x1, 0, D.h - 0.03, D.z0, D.z1);
  for (let z = D.z0; z < D.z1 - 0.01; z += 0.145) boxAt(g, MAT.wood, D.x0, D.x1, D.h - 0.03, D.h, z + 0.004, Math.min(D.z1, z + 0.141));
  boxAt(g, MAT.darkWood, D.x1 - 0.04, D.x1 + 0.02, 0, D.h + 0.005, D.z0, D.z1);
  boxAt(g, MAT.darkWood, D.x0, D.x1 + 0.02, 0, D.h + 0.005, D.z1 - 0.02, D.z1 + 0.04);
  scene.add(g);
}

/** Бассейн: вода почти вровень с бортиком (участок плоский), бортик из камня, лесенка. */
function buildPoolBasin(scene, MAT, B) {
  const r = B.rim, g = new THREE.Group();
  boxAt(g, MAT.foundation, B.x0 - r, B.x1 + r, 0, 0.06, B.z0 - r, B.z0);
  boxAt(g, MAT.foundation, B.x0 - r, B.x1 + r, 0, 0.06, B.z1, B.z1 + r);
  boxAt(g, MAT.foundation, B.x0 - r, B.x0, 0, 0.06, B.z0, B.z1);
  boxAt(g, MAT.foundation, B.x1, B.x1 + r, 0, 0.06, B.z0, B.z1);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(B.x1 - B.x0, B.z1 - B.z0).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#3d8fae', roughness: 0.08, metalness: 0.1, emissive: '#0b3443', emissiveIntensity: 0.35 }));
  water.position.set((B.x0 + B.x1) / 2, 0.035, (B.z0 + B.z1) / 2);
  water.receiveShadow = true;
  g.add(water);
  // несколько листьев плавают у бортика — только для вида
  const leafMat = lambert('#c46a2a', { side: THREE.DoubleSide });
  const rng = mulberry32(29);
  for (let k = 0; k < 14; k++) {
    const m = add(g, new THREE.CircleGeometry(0.05 + rng() * 0.03, 5), leafMat,
      B.x0 + 0.2 + rng() * (B.x1 - B.x0 - 0.4), 0.037, (rng() < 0.5 ? B.z0 + 0.15 : B.z1 - 0.15) + (rng() - 0.5) * 0.2, { cast: false });
    m.rotation.set(-Math.PI / 2, 0, rng() * 6);
  }
  // лесенка у восточного края
  for (const dz of [-0.25, 0.25]) {
    const rail = add(g, new THREE.TorusGeometry(0.22, 0.02, 6, 12, Math.PI), MAT.metal, B.x1 - 0.12, 0.06, (B.z0 + B.z1) / 2 + dz);
    rail.rotation.y = Math.PI / 2;
  }
  scene.add(g);
}

/** Гриль на тележке: корпус, крышка-полуцилиндр, боковые полки, ножки. */
function buildGrill(scene, MAT, G) {
  const g = new THREE.Group(), black = lambert('#2a2a2c'), y0 = POOL.deck.h;
  const w = G.x1 - G.x0, d = G.z1 - G.z0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxAt(g, black, sx * (w / 2 - 0.05) - 0.02, sx * (w / 2 - 0.05) + 0.02, y0, y0 + 0.62, sz * (d / 2 - 0.05) - 0.02, sz * (d / 2 - 0.05) + 0.02);
  boxAt(g, black, -w / 2 + 0.05, w / 2 - 0.05, y0 + 0.62, y0 + 0.82, -d / 2 + 0.04, d / 2 - 0.04);
  const lid = add(g, new THREE.CylinderGeometry(d / 2 - 0.04, d / 2 - 0.04, w - 0.1, 16, 1, false, 0, Math.PI), black, 0, y0 + 0.82, 0);
  lid.rotation.z = Math.PI / 2;
  boxAt(g, MAT.wood, -w / 2 - 0.25, -w / 2 + 0.05, y0 + 0.72, y0 + 0.75, -d / 2 + 0.06, d / 2 - 0.06);
  boxAt(g, MAT.metal, -0.15, 0.15, y0 + 0.98, y0 + 1.0, d / 2 - 0.12, d / 2 - 0.08);
  g.position.set((G.x0 + G.x1) / 2, 0, (G.z0 + G.z1) / 2);
  scene.add(g);
}

/** Круглый стол, четыре стула и полосатый зонт. */
function buildTable(scene, MAT, T) {
  const g = new THREE.Group(), y0 = POOL.deck.h, white = lambert('#f1ede4');
  add(g, new THREE.CylinderGeometry(0.5, 0.5, 0.04, 20), MAT.wood, 0, y0 + 0.74, 0);
  add(g, new THREE.CylinderGeometry(0.04, 0.06, 0.72, 8), MAT.metal, 0, y0 + 0.37, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4, cx = Math.cos(a) * 0.7, cz = Math.sin(a) * 0.55;
    const ch = new THREE.Group();
    boxAt(ch, white, -0.2, 0.2, 0.42, 0.46, -0.2, 0.2);
    boxAt(ch, white, -0.2, 0.2, 0.46, 0.85, 0.17, 0.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxAt(ch, white, sx * 0.17 - 0.015, sx * 0.17 + 0.015, 0, 0.42, sz * 0.17 - 0.015, sz * 0.17 + 0.015);
    ch.position.set(cx, y0, cz);
    ch.rotation.y = Math.atan2(cx, cz);
    g.add(ch);
  }
  add(g, new THREE.CylinderGeometry(0.025, 0.025, 2.3, 8), white, 0, y0 + 1.15, 0);
  // купол зонта: восемь клиньев в две краски
  for (let k = 0; k < 8; k++) {
    add(g, new THREE.ConeGeometry(1.15, 0.38, 8, 1, true, (k / 8) * Math.PI * 2, Math.PI / 4),
      lambert(k % 2 ? '#c8553d' : '#f3ead6', { side: THREE.DoubleSide }), 0, y0 + 2.2, 0);
  }
  g.position.set((T.x0 + T.x1) / 2, 0, (T.z0 + T.z1) / 2);
  scene.add(g);
}

/** Шезлонг: рама, лежак и приподнятая спинка (к северу, к бассейну). */
function buildLounger(scene, MAT, L) {
  const g = new THREE.Group(), w = L.x1 - L.x0, d = L.z1 - L.z0, cush = lambert('#e8dcc0');
  boxAt(g, MAT.wood, -w / 2, w / 2 - 0.5, 0.25, 0.32, -d / 2, d / 2);
  boxAt(g, cush, -w / 2 + 0.02, w / 2 - 0.52, 0.32, 0.38, -d / 2 + 0.04, d / 2 - 0.04);
  const back = boxAt(g, MAT.wood, -0.3, 0.3, -0.035, 0.035, -d / 2, d / 2);
  back.position.set(w / 2 - 0.3, 0.5, 0);
  back.rotation.z = 0.7;
  for (const x of [-w / 2 + 0.08, w / 2 - 0.6]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) boxAt(g, MAT.darkWood, x - 0.025, x + 0.025, 0, 0.25, z - 0.025, z + 0.025);
  g.position.set((L.x0 + L.x1) / 2, 0, (L.z0 + L.z1) / 2);
  scene.add(g);
}
