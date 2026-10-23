// Сад за восточным забором двора: забор с воротами, сарай, дерево, грядка, кусты,
// контейнер и приёмники листьев. Планировка — в layout.js (GARDEN).

import * as THREE from '../../vendor/three.module.min.js';
import { GARDEN, GZ, GARDEN_GATE } from '../layout.js';
import { formatMoney } from '../config.js';
import { mulberry32 } from '../leaves.js';
import { signTexture } from './textures.js';
import { placeModel } from './yardAssets.js';
import { add, boxAt, lambert, pumpkin, buildContainer, buildFenceRuns, buildLatticeGate, buildTree } from './scene.js';

export function buildGarden(scene, MAT, M = {}) {
  const G = GARDEN;
  const center = { x: (GZ.minX + GZ.maxX) / 2, z: (GZ.minZ + GZ.maxZ) / 2 };
  const court = G.gates.find((g) => g.to === null);
  const c0 = court.x - 0.75, c1 = court.x + 0.75;
  // западный забор — общий с двором (строится вместе с двором)
  buildFenceRuns(scene, MAT, [
    [GZ.minX, GZ.minZ, GZ.maxX, GZ.minZ],
    [GZ.maxX, GZ.minZ, GZ.maxX, GZ.maxZ],
    [GZ.minX, GZ.maxZ, c0, GZ.maxZ], [c1, GZ.maxZ, GZ.maxX, GZ.maxZ],
  ], center, { seed: 57 });
  // ворота к площадке у гаража (следующая зона) — со стороны сада табличка
  const courtGate = buildLatticeGate(scene, MAT, c0, GZ.maxZ + 0.02, c1, GZ.maxZ + 0.02, -1);
  courtGate.setSign(['Площадка', 'у гаража', '— скоро']);
  // табличка ворот во двор со стороны сада: на тех же воротах, что строит двор, — отдельная доска
  const backSign = new THREE.MeshLambertMaterial({ map: signTexture(['Двор', 'F — пройти'], { size: 100 }) });
  const bs = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), backSign);
  bs.position.set(GZ.minX + 0.13, 0.8, (GARDEN_GATE.z0 + GARDEN_GATE.z1) / 2);
  bs.rotation.y = Math.PI / 2;
  scene.add(bs);

  buildShed(scene, MAT, G.shed);
  if (M.tree3) placeModel(scene, M.tree3, { x: G.tree.x, z: G.tree.z, height: 6.2, tint: '#c9772f', rotY: 2.2 });
  else buildTree(scene, G.tree.x, G.tree.z, 1.1, 63);

  // грядка с тыквами
  const b = G.bed;
  boxAt(scene, MAT.darkWood, b.x0, b.x1, 0, b.h, b.z0, b.z0 + 0.06);
  boxAt(scene, MAT.darkWood, b.x0, b.x1, 0, b.h, b.z1 - 0.06, b.z1);
  boxAt(scene, MAT.darkWood, b.x0, b.x0 + 0.06, 0, b.h, b.z0, b.z1);
  boxAt(scene, MAT.darkWood, b.x1 - 0.06, b.x1, 0, b.h, b.z0, b.z1);
  boxAt(scene, MAT.soil, b.x0 + 0.06, b.x1 - 0.06, 0, b.h - 0.05, b.z0 + 0.06, b.z1 - 0.06);
  const rng = mulberry32(91);
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    g.position.y = b.h - 0.05;
    scene.add(g);
    pumpkin(g, b.x0 + 0.35 + k * 0.56 + (rng() - 0.5) * 0.1, (b.z0 + b.z1) / 2 + (rng() - 0.5) * 0.3, 0.16 + rng() * 0.08);
  }
  for (const [x, z, r] of G.bushes) {
    if (M.bush) placeModel(scene, M.bush, { x, z, height: r * 2.1, rotY: x * 3, tint: r > 0.45 ? '#6f7f3a' : '#9a8a3e' });
    else add(scene, new THREE.IcosahedronGeometry(r, 1), lambert('#7a8442', { flatShading: true }), x, r * 0.8, z);
  }
  const container = buildContainer(scene, MAT, G.container);
  const inlets = new Map();
  for (const n of G.inlets) inlets.set(n.id, buildInlet(scene, MAT, n));
  return { container, inlets, courtGate };
}

function buildShed(scene, MAT, S) {
  const g = new THREE.Group();
  const w = S.x1 - S.x0, d = S.z1 - S.z0, h = S.h - 0.45;
  boxAt(g, MAT.foundation, -w / 2 - 0.04, w / 2 + 0.04, 0, 0.12, -d / 2 - 0.04, d / 2 + 0.04);
  boxAt(g, MAT.darkWood, -w / 2, w / 2, 0.12, h, -d / 2, d / 2);
  // двускатная крыша вдоль X, фронтон к саду (+Z)
  const rise = 0.75, run = d / 2 + 0.25, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const s of [-1, 1]) {
    const r = add(g, new THREE.BoxGeometry(w + 0.4, 0.08, len), MAT.roof, 0, h + rise / 2 - 0.02, s * run / 2);
    r.rotation.x = s * ang;
  }
  const gable = new THREE.Shape();
  gable.moveTo(-d / 2, 0); gable.lineTo(d / 2, 0); gable.lineTo(0, rise); gable.closePath();
  const gg = new THREE.ExtrudeGeometry(gable, { depth: 0.06, bevelEnabled: false });
  for (const x of [-w / 2, w / 2 - 0.06]) { const m = add(g, gg, MAT.darkWood, x, h, 0); m.rotation.y = Math.PI / 2; }
  // дверь и окошко на южной стене
  boxAt(g, MAT.wood, -0.5, 0.45, 0.12, 2.0, d / 2, d / 2 + 0.05);
  boxAt(g, lambert('#3d2a1c'), -0.05, 0.0, 0.12, 2.0, d / 2 + 0.05, d / 2 + 0.06, { cast: false });
  add(g, new THREE.SphereGeometry(0.04, 8, 6), MAT.metal, 0.33, 1.05, d / 2 + 0.08);
  boxAt(g, MAT.trim, 0.75, 1.3, 1.15, 1.6, d / 2, d / 2 + 0.04);
  boxAt(g, MAT.glass, 0.8, 1.25, 1.2, 1.55, d / 2 + 0.02, d / 2 + 0.06, { cast: false });
  // грабли и метла у стены
  for (const [x, c] of [[-0.85, '#8d6a45'], [-1.0, '#a07a50']]) {
    const t = add(g, new THREE.CylinderGeometry(0.018, 0.018, 1.6, 6), lambert(c), x, 0.85, d / 2 + 0.12);
    t.rotation.x = -0.12;
  }
  g.position.set((S.x0 + S.x1) / 2, 0, (S.z0 + S.z1) / 2);
  scene.add(g);
}

/**
 * Приёмник: решётка в земле. Не купленный закрыт деревянной крышкой с колышком-табличкой
 * (цена — в блокноте). setOwned(true) открывает решётку.
 */
function buildInlet(scene, MAT, n) {
  const g = new THREE.Group();
  g.position.set(n.x, 0, n.z);
  const ring = add(g, new THREE.TorusGeometry(n.r, 0.035, 8, 32), MAT.metal, 0, 0.012, 0, { cast: false });
  ring.rotation.x = Math.PI / 2;
  add(g, new THREE.CircleGeometry(n.r, 32).rotateX(-Math.PI / 2), lambert('#17130f'), 0, 0.004, 0, { cast: false });
  const bars = new THREE.Group();
  for (let k = -3; k <= 3; k++) {
    const len = 2 * Math.sqrt(Math.max(0, n.r * n.r - (k * n.r / 3.6) ** 2));
    add(bars, new THREE.BoxGeometry(0.03, 0.02, len), MAT.metal, k * n.r / 3.6, 0.012, 0, { cast: false });
  }
  g.add(bars);
  const cover = new THREE.Group();
  add(cover, new THREE.CylinderGeometry(n.r + 0.04, n.r + 0.04, 0.035, 24), MAT.wood, 0, 0.02, 0, { cast: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25),
    new THREE.MeshLambertMaterial({ map: signTexture(['Приёмник', formatMoney(n.price)], { size: 100 }) }));
  sign.position.set(0, 0.55, n.r + 0.12);
  cover.add(sign);
  add(cover, new THREE.BoxGeometry(0.035, 0.5, 0.035), MAT.darkWood, 0, 0.27, n.r + 0.1);
  g.add(cover);
  scene.add(g);
  return {
    group: g,
    setOwned(v) { cover.visible = !v; bars.visible = v; },
  };
}
