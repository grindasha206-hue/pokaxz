// Двор: свет, небо, дом с крыльцом, высокий дощатый забор, дерево, садовые предметы,
// контейнер и стол с блокнотом улучшений. За забором — крыши соседей и сад.

import * as THREE from '../../vendor/three.module.min.js';
import { ZONE } from '../config.js';
import { CONTAINER, SHOP, TREE, PORCH, PORCH_STEP, GARDEN_GATE, T as FENCE_T, FENCE_H } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { grassTexture, plasterTexture, woodTexture, roofTexture, signTexture, boardTexture, barkTexture } from './textures.js';
import { placeModel, worldUV } from './yardAssets.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function add(parent, geo, mat, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  // у материалов из assets/yard текстура повторяется по метрам, а не растягивается на объект
  if (mat.userData?.tile) worldUV(geo, mat.userData.tile);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}

const boxAt = (parent, mat, x0, x1, y0, y1, z0, z1, opts) =>
  add(parent, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, opts);

export function buildWorld(scene, assets = { mats: {}, models: {} }) {
  const refs = {};
  const A = assets.mats;
  const MAT = {
    plaster: new THREE.MeshLambertMaterial({ map: plasterTexture() }),
    trim: lambert('#fbf7ee'),
    wood: new THREE.MeshLambertMaterial({ map: woodTexture('#b4865a', 5, 5) }),
    darkWood: new THREE.MeshLambertMaterial({ map: woodTexture('#7e5537', 8, 3) }),
    fence: new THREE.MeshLambertMaterial({ color: '#c79a68' }),
    roof: new THREE.MeshLambertMaterial({ map: roofTexture() }),
    glass: new THREE.MeshLambertMaterial({ color: '#5d7c91' }),
    shutter: lambert('#6f8b6a'),
    foundation: lambert('#9b9184'),
    metal: lambert('#4a4d50'),
    soil: lambert('#5b4331'),
  };
  MAT.roof.map.repeat.set(4, 3);
  // готовые PBR-материалы (если загрузились) — по одному на вид поверхности
  if (A.plaster) MAT.plaster = A.plaster;
  if (A.wood) { MAT.wood = A.wood; MAT.fence = A.wood; }
  if (A.darkWood) MAT.darkWood = A.darkWood;
  if (A.roof) MAT.roof = A.roof;
  if (A.stone) MAT.foundation = A.stone;

  // ── свет и небо ──────────────────────────────────────────────
  // солнечный осенний день: низкое тёплое солнце даёт мягкие тени, по которым читаются
  // перекрытия и изгибы листьев; заполняющий свет слабее, чтобы не «сплющивать» картинку
  scene.background = new THREE.Color('#bcd6ee');
  scene.fog = new THREE.Fog('#e8dcc4', 30, 120);
  const hemi = new THREE.HemisphereLight('#d6e4ff', '#8a6e4a', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd9a8', 3.1);
  sun.position.set(-11, 10, 8);
  sun.target.position.set(0, 0, -1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // теневая камера охватывает только двор — так у листьев чёткие тени (≈1,3 см на пиксель)
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  refs.sun = sun;
  scene.add(skyDome());

  // ── земля вокруг участка ─────────────────────────────────────
  const outerGeo = new THREE.PlaneGeometry(320, 320).rotateX(-Math.PI / 2);
  const outerMat = A.grass || new THREE.MeshLambertMaterial({ map: grassTexture(4, 512, 60), color: '#e6e8d8' });
  if (A.grass) worldUV(outerGeo, A.grass.userData.tile);
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.position.y = -0.025;
  outer.receiveShadow = true;
  scene.add(outer);

  buildHouse(scene, MAT);
  buildFence(scene, MAT, refs);
  const M = assets.models;
  // дерево во дворе: модель Quaternius, нормализованная до 5,5 м, золотистая листва
  if (M.tree1) placeModel(scene, M.tree1, { x: TREE.x, z: TREE.z, height: 5.5, tint: '#c58b32', rotY: 0.6 });
  else buildTree(scene, TREE.x, TREE.z, 1.15, 21);
  buildYardProps(scene, MAT, M);
  refs.container = buildContainer(scene, MAT);
  refs.shop = buildShop(scene, MAT);
  buildSurroundings(scene, MAT, M);
  return refs;
}

export function skyDome() {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#8fb8e2') },
      horizon: { value: new THREE.Color('#f2e6cf') },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

// ── дом и крыльцо ──────────────────────────────────────────────
function buildHouse(scene, MAT) {
  const g = new THREE.Group();
  const z1 = ZONE.minZ, z0 = z1 - 7, x0 = -6.5, x1 = 6.5, wallH = 4.3;
  boxAt(g, MAT.foundation, x0 - 0.05, x1 + 0.05, 0, 0.45, z0, z1 + 0.04);
  boxAt(g, MAT.plaster, x0, x1, 0.45, wallH, z0, z1);
  // фронтон
  const gable = new THREE.Shape();
  gable.moveTo(-3.5, 0); gable.lineTo(3.5, 0); gable.lineTo(0, 2.3); gable.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: 0.1, bevelEnabled: false });
  for (const x of [x0 + 0.05, x1 - 0.15]) {
    const m = add(g, gableGeo, MAT.plaster, x, wallH, (z0 + z1) / 2);
    m.rotation.y = Math.PI / 2;
  }
  // крыша (два ската вдоль оси X)
  const run = 3.5 + 0.55, rise = 2.3 + 0.32, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  for (const s of [-1, 1]) {
    const roof = add(g, new THREE.BoxGeometry(x1 - x0 + 0.9, 0.16, len), MAT.roof, 0, wallH - 0.32 + rise / 2, (z0 + z1) / 2 + s * run / 2);
    roof.rotation.x = s * ang;
  }
  boxAt(g, MAT.trim, x0 - 0.45, x1 + 0.45, wallH + 2.25, wallH + 2.45, (z0 + z1) / 2 - 0.12, (z0 + z1) / 2 + 0.12);
  // труба
  boxAt(g, lambert('#a5624b'), 3.2, 3.8, wallH + 0.8, wallH + 3.0, z0 + 2.2, z0 + 2.8);
  // окна
  const win = (x, y, w, h) => {
    boxAt(g, MAT.trim, x - w / 2 - 0.09, x + w / 2 + 0.09, y - h / 2 - 0.09, y + h / 2 + 0.09, z1, z1 + 0.06);
    boxAt(g, MAT.glass, x - w / 2, x + w / 2, y - h / 2, y + h / 2, z1 + 0.02, z1 + 0.07, { cast: false });
    boxAt(g, MAT.trim, x - 0.03, x + 0.03, y - h / 2, y + h / 2, z1 + 0.06, z1 + 0.1, { cast: false });
    boxAt(g, MAT.trim, x - w / 2, x + w / 2, y - 0.03, y + 0.03, z1 + 0.06, z1 + 0.1, { cast: false });
    boxAt(g, MAT.trim, x - w / 2 - 0.16, x + w / 2 + 0.16, y - h / 2 - 0.16, y - h / 2 - 0.09, z1, z1 + 0.16);
    for (const s of [-1, 1]) {
      const sx = x + s * (w / 2 + 0.33);
      boxAt(g, MAT.shutter, sx - 0.22, sx + 0.22, y - h / 2, y + h / 2, z1 + 0.02, z1 + 0.07);
    }
    // ящик с цветами
    boxAt(g, lambert('#8c5a3a'), x - w / 2, x + w / 2, y - h / 2 - 0.42, y - h / 2 - 0.18, z1 + 0.06, z1 + 0.3);
    const rng = mulberry32(Math.round(x * 100));
    for (let i = 0; i < 7; i++) {
      add(g, new THREE.IcosahedronGeometry(0.1 + rng() * 0.05, 0),
        lambert(['#c94a3a', '#e6b74a', '#b86ab3', '#f0e2c8'][i % 4]),
        x - w / 2 + 0.12 + i * (w - 0.24) / 6, y - h / 2 - 0.12, z1 + 0.18, { cast: false });
    }
  };
  win(-4.3, 2.35, 1.3, 1.25);
  win(4.3, 2.35, 1.3, 1.25);
  // дверь
  boxAt(g, MAT.trim, -0.62, 0.62, PORCH.h, 2.45, z1, z1 + 0.06);
  boxAt(g, lambert('#7a4a32'), -0.5, 0.5, PORCH.h, 2.35, z1 + 0.03, z1 + 0.1);
  boxAt(g, MAT.glass, -0.25, 0.25, 1.6, 2.1, z1 + 0.08, z1 + 0.12, { cast: false });
  add(g, new THREE.SphereGeometry(0.045, 10, 8), lambert('#d9b45c'), 0.36, 1.2, z1 + 0.14);
  // крыльцо
  boxAt(g, MAT.wood, PORCH.x0, PORCH.x1, 0, PORCH.h, PORCH.z0, PORCH.z1);
  boxAt(g, MAT.wood, PORCH_STEP.x0, PORCH_STEP.x1, 0, PORCH_STEP.h, PORCH_STEP.z0, PORCH_STEP.z1);
  boxAt(g, lambert('#a1693e'), -0.5, 0.5, PORCH.h, PORCH.h + 0.012, z1 + 0.25, z1 + 0.85, { cast: false });
  for (const s of [-1, 1]) {
    add(g, new THREE.CylinderGeometry(0.075, 0.09, 2.6, 10), MAT.trim, s * 2.25, PORCH.h + 1.3, -7.42);
  }
  const porchRoof = boxAt(g, MAT.roof, PORCH.x0 - 0.3, PORCH.x1 + 0.3, 2.75, 2.88, z1 - 0.1, -7.0);
  porchRoof.rotation.x = -0.12;
  boxAt(g, MAT.trim, PORCH.x0 - 0.3, PORCH.x1 + 0.3, 2.58, 2.76, -7.55, -7.3);
  // фонарь у двери
  boxAt(g, MAT.metal, 0.85, 1.0, 1.9, 2.15, z1 + 0.02, z1 + 0.14);
  add(g, new THREE.BoxGeometry(0.11, 0.14, 0.08), lambert('#ffe6a8', { emissive: '#ffcf70', emissiveIntensity: 0.6 }), 0.925, 2.0, z1 + 0.15, { cast: false });
  scene.add(g);
}

// ── забор ─────────────────────────────────────────────────────
// Высокий дощатый забор: вертикальные доски с текстурой волокон, столбы и прожилины.
// С уровня глаз за ним не видно пустого поля — только крыши соседей и верхушки деревьев.
function buildFence(scene, MAT, refs) {
  const { minX, maxX, minZ, maxZ } = ZONE;
  const H = FENCE_H;
  const runs = [
    [minX, maxZ, -0.9, maxZ], [0.9, maxZ, maxX, maxZ],                       // юг, с калиткой
    [minX, minZ, minX, maxZ],                                                  // запад
    [maxX, minZ, maxX, GARDEN_GATE.z0], [maxX, GARDEN_GATE.z1, maxX, maxZ],   // восток, ворота в сад
    [minX, minZ, -6.5, minZ], [6.5, minZ, maxX, minZ],                         // у дома
    [-0.9, maxZ + 0.02, 0.9, maxZ + 0.02],                                     // калитка (закрыта)
  ];
  const boards = [], rng = mulberry32(31);
  const frame = new THREE.Group();
  const addRun = (x0, z0, x1, z1, h = H) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.152));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      boards.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, ang, h + (rng() - 0.5) * 0.035]);
    }
    // прожилины с внутренней стороны двора
    const nx = Math.cos(ang) * 0.035, nz = -Math.sin(ang) * 0.035;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const inward = Math.sign(cx * nx + cz * nz) || 1;
    for (const y of [0.35, h - 0.3]) {
      const r = add(frame, new THREE.BoxGeometry(0.045, 0.09, len), MAT.darkWood, cx - nx * inward, y, cz - nz * inward);
      r.rotation.y = ang;
    }
  };
  for (const r of runs) addRun(...r);
  // ворота в сад: доски ниже, сверху решётка — сквозь неё видна следующая часть двора
  const gateLow = 1.15;
  addRun(maxX + 0.02, GARDEN_GATE.z0, maxX + 0.02, GARDEN_GATE.z1, gateLow);
  // решётка из диагональных реек, обрезанных по рамке проёма
  const gz0 = GARDEN_GATE.z0, gz1 = GARDEN_GATE.z1, glen = gz1 - gz0;
  const y0 = gateLow, y1 = H, lattice = new THREE.Group();
  for (const sgn of [-1, 1]) {
    for (let c = -2.2; c <= 2.2; c += 0.2) {
      // прямая y − y0 = sgn·(z − gz0) + c, обрезаем по прямоугольнику [gz0, gz1] × [y0, y1]
      const pts = [];
      for (const z of [gz0, gz1]) { const y = y0 + sgn * (z - gz0) + c; if (y >= y0 && y <= y1) pts.push([z, y]); }
      for (const y of [y0, y1]) { const z = gz0 + (y - y0 - c) * sgn; if (z > gz0 && z < gz1) pts.push([z, y]); }
      if (pts.length < 2) continue;
      const [[za, ya], [zb, yb]] = pts;
      const len = Math.hypot(zb - za, yb - ya);
      if (len < 0.05) continue;
      const slat = add(lattice, new THREE.BoxGeometry(0.02, 0.03, len), MAT.wood, maxX + 0.02, (ya + yb) / 2, (za + zb) / 2);
      slat.rotation.x = -Math.atan2(yb - ya, zb - za);
    }
  }
  scene.add(lattice);
  for (const z of [gz0, gz1]) add(frame, new THREE.BoxGeometry(0.1, H + 0.08, 0.1), MAT.darkWood, maxX, (H + 0.08) / 2, z);
  add(frame, new THREE.BoxGeometry(0.06, 0.07, glen), MAT.darkWood, maxX + 0.02, H, (gz0 + gz1) / 2);
  add(frame, new THREE.BoxGeometry(0.06, 0.06, glen), MAT.darkWood, maxX + 0.02, gateLow, (gz0 + gz1) / 2);
  // столбы через ~2 м
  for (const [x0, z0, x1, z1] of runs.slice(0, 7)) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      add(frame, new THREE.BoxGeometry(0.1, H + 0.08, 0.1), MAT.darkWood, x0 + (x1 - x0) * t, (H + 0.08) / 2, z0 + (z1 - z0) * t);
    }
  }
  // калитка: раскос и ручка
  const brace = add(frame, new THREE.BoxGeometry(1.9, 0.08, 0.04), MAT.darkWood, 0, H / 2, maxZ - 0.05);
  brace.rotation.z = Math.atan2(H - 0.7, 1.7);
  add(frame, new THREE.BoxGeometry(0.04, 0.16, 0.05), MAT.metal, 0.7, 1.0, maxZ - 0.06);
  scene.add(frame);

  const boardGeo = new THREE.BoxGeometry(0.14, 1, 0.024);
  // доска с готовой текстурой дуба: UV в метрах (высота доски задаётся масштабом экземпляра)
  if (MAT.fence.userData?.tile) worldUV(boardGeo, MAT.fence.userData.tile, new THREE.Vector3(1, H, 1));
  const boardMat = MAT.fence.userData?.tile ? MAT.fence : new THREE.MeshLambertMaterial({ map: boardTexture() });
  const inst = new THREE.InstancedMesh(boardGeo, boardMat, boards.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  boards.forEach(([x, z, a, h], i) => {
    e.set(0, a + Math.PI / 2, (rng() - 0.5) * 0.012);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h, 1));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, c.set('#ffffff').offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.12));
  });
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);
  // табличка на воротах в сад
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55),
    new THREE.MeshLambertMaterial({ map: signTexture(['Сад', 'откроется после', 'уборки двора'], { size: 100 }) }));
  sign.position.set(maxX - FENCE_T - 0.03, 0.85, (GARDEN_GATE.z0 + GARDEN_GATE.z1) / 2);
  sign.rotation.y = -Math.PI / 2;
  scene.add(sign);
  refs.gardenSign = sign;
}

// ── дерево ────────────────────────────────────────────────────
// Голое осеннее дерево: ветвящийся ствол из сужающихся цилиндров (один instanced-меш).
// Листва для деревьев и кустов — по готовым моделям, см. README.
export function buildTree(scene, x, z, size, seed) {
  const rng = mulberry32(seed);
  const segs = [];
  const up = new THREE.Vector3(0, 1, 0);
  const grow = (from, dir, len, r, depth) => {
    const to = from.clone().addScaledVector(dir, len);
    segs.push([from, to, r]);
    if (depth === 0) return;
    const kids = depth > 3 ? 2 : 2 + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const axis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
      const nd = dir.clone().applyAxisAngle(axis, 0.35 + rng() * 0.5);
      nd.lerp(up, 0.18).normalize();
      grow(to, nd, len * (0.68 + rng() * 0.12), r * 0.64, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3((rng() - 0.5) * 0.08, 1, (rng() - 0.5) * 0.08).normalize(), 2.2 * size, 0.24 * size, 5);
  const geo = new THREE.CylinderGeometry(0.66, 1, 1, 9, 1);
  geo.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: barkTexture() }), segs.length + 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), d = new THREE.Vector3();
  segs.forEach(([a, b, r], i) => {
    d.subVectors(b, a);
    const len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    m.compose(a, q, new THREE.Vector3(r, len * 1.04, r));
    inst.setMatrixAt(i, m);
  });
  // расширение у корней
  m.compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.42 * size, 0.35, 0.42 * size));
  inst.setMatrixAt(segs.length, m);
  inst.castShadow = inst.receiveShadow = true;
  inst.position.set(x, 0, z);
  scene.add(inst);
  return inst;
}


// ── предметы двора ─────────────────────────────────────────────
function buildYardProps(scene, MAT, M = {}) {
  // скамейка вдоль оси Z, сиденьем на запад
  const bench = new THREE.Group();
  for (const dz of [-0.75, 0.75]) {
    boxAt(bench, MAT.metal, -0.24, -0.18, 0, 0.45, dz - 0.03, dz + 0.03);
    boxAt(bench, MAT.metal, 0.18, 0.24, 0, 0.88, dz - 0.03, dz + 0.03);
  }
  for (let i = 0; i < 4; i++) boxAt(bench, MAT.wood, -0.27 + i * 0.12, -0.17 + i * 0.12, 0.43, 0.48, -0.9, 0.9);
  for (let i = 0; i < 3; i++) {
    const s = boxAt(bench, MAT.wood, 0.2, 0.24, 0.55 + i * 0.12, 0.64 + i * 0.12, -0.9, 0.9);
    s.rotation.z = 0.12;
  }
  bench.position.set(5.35, 0, -4.6);
  scene.add(bench);

  // тачка
  const wb = new THREE.Group();
  const tray = add(wb, new THREE.CylinderGeometry(0.42, 0.3, 0.32, 4, 1, true), lambert('#4f7d8c', { side: THREE.DoubleSide }), 0, 0.55, 0);
  tray.rotation.y = Math.PI / 4; tray.scale.set(1, 1, 1.7);
  add(wb, new THREE.BoxGeometry(0.4, 0.04, 0.85), lambert('#3f6674'), 0, 0.4, 0);
  const wheel = add(wb, new THREE.TorusGeometry(0.17, 0.06, 8, 16), lambert('#2f2f2f'), 0, 0.2, -0.62);
  wheel.rotation.y = Math.PI / 2;
  for (const s of [-1, 1]) {
    const h = add(wb, new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), MAT.darkWood, s * 0.22, 0.48, 0.15);
    h.rotation.x = Math.PI / 2 - 0.25;
    add(wb, new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), MAT.metal, s * 0.2, 0.2, 0.35);
  }
  wb.position.set(5.38, 0, 1.25);
  wb.rotation.y = 0.1;
  scene.add(wb);

  // грядка у западного забора
  const bed = new THREE.Group();
  const x0 = ZONE.minX + 0.1, x1 = -6.7, z0 = -0.6, z1 = 2.8;
  boxAt(bed, MAT.darkWood, x0, x1, 0, 0.32, z0, z0 + 0.06);
  boxAt(bed, MAT.darkWood, x0, x1, 0, 0.32, z1 - 0.06, z1);
  boxAt(bed, MAT.darkWood, x1 - 0.06, x1, 0, 0.32, z0, z1);
  boxAt(bed, MAT.soil, x0, x1 - 0.06, 0, 0.27, z0 + 0.06, z1 - 0.06);
  scene.add(bed);
  if (M.bush) {
    // кусты в грядке: место уже занято препятствием, листья и проходы не меняются
    placeModel(scene, M.bush, { x: (x0 + x1) / 2, z: 0.35, height: 0.85, rotY: 0.4, tint: '#6f7f3a' });
    placeModel(scene, M.bush, { x: (x0 + x1) / 2, z: 1.85, height: 0.7, rotY: 2.1, tint: '#9a8a3e' });
  } else {
    const rng = mulberry32(3);
    for (let i = 0; i < 5; i++) {
      const cab = add(bed, new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshLambertMaterial({ color: i % 2 ? '#7f9a63' : '#8a6a8f', flatShading: true }),
        (x0 + x1) / 2 + (rng() - 0.5) * 0.2, 0.38, z0 + 0.45 + i * 0.62);
      cab.scale.set(1, 0.75, 1);
    }
  }

  // бочка для воды
  const barrel = add(scene, new THREE.CylinderGeometry(0.4, 0.36, 0.95, 16), MAT.darkWood, -5.95, 0.475, -8.35);
  for (const y of [0.2, 0.75]) add(scene, new THREE.CylinderGeometry(0.41, 0.41, 0.05, 16), MAT.metal, -5.95, y, -8.35, { cast: false });
  add(scene, new THREE.CylinderGeometry(0.36, 0.36, 0.02, 16), lambert('#4f6b78'), -5.95, 0.9, -8.35, { cast: false });
  void barrel;

  // поилка для птиц
  add(scene, new THREE.CylinderGeometry(0.08, 0.14, 0.72, 10), lambert('#cfc6b4'), -4.4, 0.36, 4.2);
  add(scene, new THREE.CylinderGeometry(0.32, 0.16, 0.12, 16), lambert('#d8cfbd'), -4.4, 0.78, 4.2);
  add(scene, new THREE.CylinderGeometry(0.27, 0.27, 0.02, 16), lambert('#7ea2b6'), -4.4, 0.83, 4.2, { cast: false });

  // тыквы и горшки с хризантемами у крыльца
  for (const [x, z, r] of [[-3.0, -7.9, 0.27], [-3.55, -7.35, 0.2], [3.05, -7.85, 0.3]]) pumpkin(scene, x, z, r);
  for (const [x, z, c] of [[-2.05, -8.55, '#e2b13c'], [2.05, -8.55, '#b05b9a']]) {
    add(scene, new THREE.CylinderGeometry(0.2, 0.15, 0.36, 14), lambert('#c0673f'), x, PORCH.h + 0.18, z);
    const rng2 = mulberry32(Math.round(x * 10));
    for (let i = 0; i < 9; i++) {
      add(scene, new THREE.IcosahedronGeometry(0.09, 0), lambert(i % 3 ? c : '#5f7d47'),
        x + (rng2() - 0.5) * 0.3, PORCH.h + 0.45 + rng2() * 0.15, z + (rng2() - 0.5) * 0.3, { cast: false });
    }
  }
  // скворечник на заборе
  const bh = new THREE.Group();
  boxAt(bh, lambert('#cf8d5c'), -0.12, 0.12, 0, 0.3, -0.1, 0.1);
  const r1 = boxAt(bh, lambert('#7c4a33'), -0.16, 0.16, 0.3, 0.34, -0.13, 0.13);
  r1.rotation.x = 0.0;
  add(bh, new THREE.CircleGeometry(0.04, 12), lambert('#2a1d14'), 0.121, 0.18, 0, { cast: false }).rotation.y = Math.PI / 2;
  bh.position.set(ZONE.minX + 0.12, 1.25, -5);
  scene.add(bh);
}

function pumpkin(scene, x, z, r) {
  const geo = new THREE.SphereGeometry(r, 20, 12);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 - 0.07 * Math.abs(Math.sin(a * 4));
    p.setXYZ(i, v.x * k, v.y * 0.72, v.z * k);
  }
  geo.computeVertexNormals();
  add(scene, geo, lambert('#dd7a26'), x, r * 0.68, z);
  add(scene, new THREE.CylinderGeometry(0.025, 0.035, 0.1, 6), lambert('#5e6a35'), x, r * 1.4, z);
}

// ── контейнер для листьев ─────────────────────────────────────
export function buildContainer(scene, MAT = { metal: lambert('#4a4d50') }, C = CONTAINER) {
  const g = new THREE.Group();
  const { w, d, h } = C;
  const green = lambert('#4f7b4c');
  const body = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.88, 1, 4, 1);
  body.rotateY(Math.PI / 4);
  const bm = add(g, body, green, 0, (h - 0.08) / 2 + 0.05, 0);
  bm.scale.set(w, h - 0.08, d);
  boxAt(g, lambert('#3d6340'), -w / 2 - 0.03, w / 2 + 0.03, h - 0.1, h - 0.03, -d / 2 - 0.03, d / 2 + 0.03);
  // крышка на шарнире у задней (северной) кромки
  const lid = new THREE.Group();
  lid.position.set(0, h - 0.03, -d / 2 - 0.03);
  boxAt(lid, lambert('#3f6a42'), -w / 2 - 0.04, w / 2 + 0.04, 0, 0.06, 0, d + 0.06);
  boxAt(lid, MAT.metal, -0.2, 0.2, 0.06, 0.09, d - 0.02, d + 0.04);
  g.add(lid);
  // табличка спереди (к игроку, +Z)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4),
    new THREE.MeshLambertMaterial({ map: signTexture(['Листья', 'сдать — F'], { bg: '#f1e7cf', size: 110 }) }));
  // корпус расширяется кверху — табличку наклоняем вместе со стенкой
  sign.position.set(0, h * 0.55, d / 2 * 0.97 + 0.02);
  sign.rotation.x = Math.atan2(0.06 * d, h);
  g.add(sign);
  for (const s of [-1, 1]) {
    const wh = add(g, new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), lambert('#2b2b2b'), s * (w / 2 - 0.12), 0.09, -d / 2 + 0.05);
    wh.rotation.z = Math.PI / 2;
  }
  g.position.set(C.x, 0, C.z);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  // указатель над контейнером (показывается, когда мешок полон)
  const arrow = new THREE.Group();
  const cone = add(arrow, new THREE.ConeGeometry(0.16, 0.3, 4), lambert('#ffd36b', { emissive: '#ffb02e', emissiveIntensity: 0.5 }), 0, 0, 0, { cast: false });
  cone.rotation.x = Math.PI;
  arrow.position.set(C.x, h + 0.75, C.z);
  arrow.visible = false;
  scene.add(arrow);
  return { group: g, lid, arrow };
}

// ── стол с блокнотом улучшений ────────────────────────────────
function buildShop(scene, MAT) {
  const g = new THREE.Group();
  const { w, d, h } = SHOP;
  boxAt(g, MAT.wood, -w / 2, w / 2, h - 0.05, h, -d / 2, d / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    boxAt(g, MAT.darkWood, sx * (w / 2 - 0.08) - 0.03, sx * (w / 2 - 0.08) + 0.03, 0, h - 0.05, sz * (d / 2 - 0.08) - 0.03, sz * (d / 2 - 0.08) + 0.03);
  }
  // открытый блокнот
  const page = new THREE.MeshLambertMaterial({ map: notebookPage() });
  for (const s of [-1, 1]) {
    const p = add(g, new THREE.BoxGeometry(0.26, 0.012, 0.34), page, s * 0.135, h + 0.008, 0.05, { cast: false });
    p.rotation.z = -s * 0.04;
  }
  boxAt(g, lambert('#7d5a3c'), -0.29, 0.29, h, h + 0.006, -0.135, 0.235, { cast: false });
  const pencil = add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.19, 6), lambert('#e3b23c'), 0.34, h + 0.01, 0.08);
  pencil.rotation.set(Math.PI / 2, 0, 0.5);
  // лейка
  add(g, new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12), lambert('#6c9aa6'), -0.43, h + 0.1, -0.12);
  const spout = add(g, new THREE.CylinderGeometry(0.015, 0.025, 0.25, 6), lambert('#6c9aa6'), -0.31, h + 0.17, -0.12);
  spout.rotation.z = -0.9;
  // меловая табличка «Улучшения»
  const board = new THREE.Group();
  const boardTex = signTexture(['Улучшения', 'блокнот — F или Tab'], { bg: '#33402f', fg: '#f3ecd8', size: 108 });
  const bmesh = add(board, new THREE.PlaneGeometry(0.85, 0.48), new THREE.MeshLambertMaterial({ map: boardTex }), 0, 0, 0.022, { cast: false });
  void bmesh;
  boxAt(board, MAT.darkWood, -0.47, 0.47, -0.28, 0.28, -0.02, 0.02);
  for (const s of [-1, 1]) boxAt(board, MAT.darkWood, s * 0.4 - 0.025, s * 0.4 + 0.025, -1.25, -0.2, -0.015, 0.015);
  board.position.set(0, 1.55, -d / 2 + 0.06);
  board.rotation.x = -0.08;
  g.add(board);
  g.position.set(SHOP.x, 0, SHOP.z);
  g.rotation.y = 0;
  scene.add(g);
  return { group: g };
}

function notebookPage() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 168;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbf6e8'; ctx.fillRect(0, 0, 128, 168);
  ctx.strokeStyle = '#a9c3dc'; ctx.lineWidth = 1.5;
  for (let y = 22; y < 168; y += 12) { ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(122, y); ctx.stroke(); }
  ctx.strokeStyle = '#d98a8a';
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(20, 168); ctx.stroke();
  ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
  for (let y = 31; y < 120; y += 24) { ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(28 + 40 + (y % 30), y); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── за забором: сад, соседи, улица ────────────────────────────
// За забором: крыши соседних домов, сарай в саду и голые деревья. Пустого поля не видно.
function buildSurroundings(scene, MAT, M = {}) {
  const house = (x, z, w, d, h, rot, wall, roof) => {
    const g = new THREE.Group();
    boxAt(g, MAT.plaster.userData?.tile ? MAT.plaster : lambert(wall), -w / 2, w / 2, 0, h, -d / 2, d / 2);
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2 - 0.4, 0); shape.lineTo(d / 2 + 0.4, 0); shape.lineTo(0, d * 0.42); shape.closePath();
    const rg = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false });
    rg.translate(0, 0, -(w + 0.6) / 2);
    rg.rotateY(Math.PI / 2);
    add(g, rg, MAT.roof.userData?.tile ? MAT.roof : new THREE.MeshLambertMaterial({ map: roofTexture(), color: roof }), 0, h, 0);
    for (let k = -1; k <= 1; k += 2) {
      boxAt(g, lambert('#fbf7ee'), k * w / 4 - 0.5, k * w / 4 + 0.5, h - 1.6, h - 0.6, d / 2, d / 2 + 0.05, { cast: false });
      boxAt(g, lambert('#5d7c91'), k * w / 4 - 0.42, k * w / 4 + 0.42, h - 1.52, h - 0.68, d / 2 + 0.02, d / 2 + 0.07, { cast: false });
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(g);
  };
  house(-15.5, -3, 8, 7, 5.2, Math.PI / 2, '#e7dcc8', '#9a6a55');   // соседи на западе
  house(-4, 17.5, 9, 7, 5.6, Math.PI, '#d9cbb3', '#7f5a4a');        // через улицу
  house(9, 18.5, 7, 6, 4.8, Math.PI, '#ece3d2', '#8c4a3a');
  house(4, -24, 9, 7, 6.2, 0, '#e2d6c0', '#6d5a4e');               // за домом
  // сарай в саду (восток) — виден через решётку ворот и над забором
  const shed = new THREE.Group();
  boxAt(shed, MAT.darkWood, -1.4, 1.4, 0, 2.3, -1.1, 1.1);
  const rf = boxAt(shed, MAT.roof, -1.7, 1.7, 2.3, 2.45, -1.45, 1.45);
  rf.rotation.z = 0.18;
  shed.position.set(12.5, 0, -4.5);
  scene.add(shed);
  if (M.tree1 && M.tree3) {
    // за забором — ещё три дерева: закрывают горизонт, но это не лес
    placeModel(scene, M.tree3, { x: 12, z: 1.5, height: 5.8, tint: '#bc6c2f', rotY: 1.2 });
    placeModel(scene, M.tree1, { x: -12, z: 4, height: 5.2, tint: '#bc6c2f', rotY: 2.5 });
    placeModel(scene, M.tree3, { x: 9.5, z: -13.5, height: 6, tint: '#c58b32', rotY: 4.0 });
  } else {
    buildTree(scene, 12, 1.5, 1.05, 41);
    buildTree(scene, -12, 5, 1.0, 47);
  }
  if (M.bush) {
    // кусты в саду: видны сквозь решётку ворот
    placeModel(scene, M.bush, { x: 9.3, z: -2.6, height: 0.95, rotY: 0.3, tint: '#6f7f3a' });
    placeModel(scene, M.bush, { x: 10.2, z: -1.2, height: 0.8, rotY: 1.7, tint: '#9a8a3e' });
    placeModel(scene, M.bush, { x: 11.0, z: -3.8, height: 1.05, rotY: 3.1, tint: '#6f7f3a' });
  }
}
