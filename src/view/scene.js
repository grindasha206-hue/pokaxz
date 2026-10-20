// Окружение первого участка: свет, небо, дом с крыльцом, забор, дерево, садовые предметы,
// контейнер, стол с блокнотом улучшений и видимая за забором следующая часть двора.

import * as THREE from '../../vendor/three.module.min.js';
import { ZONE } from '../config.js';
import { CONTAINER, SHOP, TREE, PORCH, PORCH_STEP, GARDEN_GATE, T as FENCE_T } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { grassTexture, plasterTexture, woodTexture, roofTexture, signTexture } from './textures.js';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function add(parent, geo, mat, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}

const boxAt = (parent, mat, x0, x1, y0, y1, z0, z1, opts) =>
  add(parent, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, opts);

export function buildWorld(scene) {
  const refs = {};
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

  // ── свет и небо ──────────────────────────────────────────────
  scene.background = new THREE.Color('#bcd6ee');
  scene.fog = new THREE.Fog('#eadfc8', 38, 140);
  const hemi = new THREE.HemisphereLight('#dbe8ff', '#a08259', 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe1b5', 2.6);
  sun.position.set(-9, 15, 11);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  refs.sun = sun;
  scene.add(skyDome());

  // ── земля вокруг участка ─────────────────────────────────────
  const outerGrass = grassTexture(4, 512, 60);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshLambertMaterial({ map: outerGrass, color: '#e6e8d8' }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.025;
  outer.receiveShadow = true;
  scene.add(outer);

  buildHouse(scene, MAT);
  buildFence(scene, MAT, refs);
  buildTree(scene, TREE.x, TREE.z, 1, ['#e39a2d', '#d4762a', '#eab845', '#c95f2c'], 21);
  buildYardProps(scene, MAT);
  refs.container = buildContainer(scene, MAT);
  refs.shop = buildShop(scene, MAT);
  buildSurroundings(scene, MAT);
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
function picketGeometry() {
  const s = new THREE.Shape();
  const w = 0.09, h = 1.1;
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - 0.07); s.lineTo(0, h); s.lineTo(-w / 2, h - 0.07); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
  geo.translate(0, 0, -0.0125);
  return geo;
}

function buildFence(scene, MAT, refs) {
  const segs = [];
  const { minX, maxX, minZ, maxZ } = ZONE;
  // [x0,z0,x1,z1, разрывы вдоль отрезка]
  segs.push([minX, maxZ, -0.9, maxZ], [0.9, maxZ, maxX, maxZ]);           // южный, с калиткой
  segs.push([minX, minZ, minX, maxZ]);                                       // западный
  segs.push([maxX, minZ, maxX, GARDEN_GATE.z0], [maxX, GARDEN_GATE.z1, maxX, maxZ]); // восточный, с воротами в сад
  segs.push([minX, minZ, -6.5, minZ], [6.5, minZ, maxX, minZ]);             // у дома
  const pickets = [];
  const rails = new THREE.Group();
  const addRun = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 0.15));
    for (let i = 0; i <= n; i++) {
      const t = (i + 0.5) / (n + 1);
      pickets.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, ang]);
    }
    for (const y of [0.3, 0.82]) {
      const r = add(rails, new THREE.BoxGeometry(0.05, 0.08, len), MAT.fence, (x0 + x1) / 2, y, (z0 + z1) / 2);
      r.rotation.y = ang;
    }
    const posts = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      add(rails, new THREE.BoxGeometry(0.11, 1.25, 0.11), MAT.darkWood, x0 + (x1 - x0) * t, 0.625, z0 + (z1 - z0) * t);
    }
  };
  for (const s of segs) addRun(...s);
  // калитка (закрыта) и ворота в сад
  addRun(-0.9, maxZ + 0.03, 0.9, maxZ + 0.03);
  addRun(maxX + 0.03, GARDEN_GATE.z0, maxX + 0.03, GARDEN_GATE.z1);
  const geo = picketGeometry();
  const inst = new THREE.InstancedMesh(geo, lambert('#d5a978'), pickets.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const rng = mulberry32(31);
  pickets.forEach(([x, z, a], i) => {
    e.set(0, a + Math.PI / 2, (rng() - 0.5) * 0.03);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 0.94 + rng() * 0.1, 1));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, new THREE.Color('#d5a978').offsetHSL(0, 0, (rng() - 0.5) * 0.06));
  });
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst, rails);
  // табличка на воротах в сад
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65),
    new THREE.MeshLambertMaterial({ map: signTexture(['Сад', 'откроется после', 'уборки двора'], { size: 100 }) }));
  sign.position.set(maxX - FENCE_T - 0.03, 1.05, (GARDEN_GATE.z0 + GARDEN_GATE.z1) / 2);
  sign.rotation.y = -Math.PI / 2;
  scene.add(sign);
  refs.gardenSign = sign;
}

// ── дерево ────────────────────────────────────────────────────
export function buildTree(scene, x, z, size, colors, seed) {
  const g = new THREE.Group();
  const rng = mulberry32(seed);
  const bark = lambert('#6e5240');
  const trunkH = 3.1 * size;
  add(g, new THREE.CylinderGeometry(0.17 * size, 0.3 * size, trunkH, 12), bark, 0, trunkH / 2, 0);
  add(g, new THREE.CylinderGeometry(0.34 * size, 0.42 * size, 0.18, 12), bark, 0, 0.06, 0, { cast: false });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    const br = add(g, new THREE.CylinderGeometry(0.05 * size, 0.1 * size, 1.5 * size, 8), bark,
      Math.cos(a) * 0.45 * size, trunkH - 0.1, Math.sin(a) * 0.45 * size);
    br.rotation.set(Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8);
  }
  const blobs = 9;
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2, r = (i === 0 ? 0 : 0.8 + rng() * 1.1) * size;
    const geo = softBlob((1.15 + rng() * 0.55) * size, rng);
    const mat = new THREE.MeshLambertMaterial({ color: colors[i % colors.length] });
    const b = add(g, geo, mat, Math.cos(a) * r, trunkH + 0.9 * size + (rng() - 0.3) * 0.9 * size, Math.sin(a) * r);
    b.scale.set(1, 0.82, 1);
    b.rotation.set(rng(), rng(), rng());
  }
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}

/** Мягкий, слегка бугристый шар для крон. */
export function softBlob(r, rng) {
  const geo = new THREE.SphereGeometry(r, 28, 18);
  const p = geo.attributes.position, v = new THREE.Vector3();
  const a = rng() * 10, b = rng() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const k = 1 + 0.07 * Math.sin(v.x * 5 + a) * Math.sin(v.y * 4 + b) + 0.05 * Math.sin(v.z * 7 + a + b);
    p.setXYZ(i, v.x * r * k, v.y * r * k, v.z * r * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// ── предметы двора ─────────────────────────────────────────────
function buildYardProps(scene, MAT) {
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
  const rng = mulberry32(3);
  for (let i = 0; i < 5; i++) {
    const cz = z0 + 0.45 + i * 0.62;
    const cab = add(bed, new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshLambertMaterial({ color: i % 2 ? '#7f9a63' : '#8a6a8f', flatShading: true }),
      (x0 + x1) / 2 + (rng() - 0.5) * 0.2, 0.38, cz);
    cab.scale.set(1, 0.75, 1);
  }
  scene.add(bed);

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
function buildSurroundings(scene, MAT) {
  // Сад на востоке — следующая зона
  buildTree(scene, 12.5, -5.5, 0.85, ['#d9572e', '#e8a33a', '#b8452a'], 41);
  buildTree(scene, 14.5, 2.5, 0.9, ['#eab845', '#d98c2d', '#c96a28'], 43);
  buildTree(scene, 17.5, -2, 0.75, ['#e29a35', '#cf5d2b'], 47);
  // сарай
  const shed = new THREE.Group();
  boxAt(shed, MAT.darkWood, -1.4, 1.4, 0, 2.2, -1.1, 1.1);
  const rf = boxAt(shed, MAT.roof, -1.7, 1.7, 2.2, 2.35, -1.45, 1.45);
  rf.rotation.z = 0.15;
  boxAt(shed, lambert('#5b3a28'), -1.42, -1.38, 0, 1.8, -0.4, 0.4);
  shed.position.set(18.5, 0, -8);
  scene.add(shed);
  // теплица
  const gh = new THREE.Group();
  const glass = new THREE.MeshLambertMaterial({ color: '#d9ecf0', transparent: true, opacity: 0.35, depthWrite: false });
  boxAt(gh, glass, -1.2, 1.2, 0, 1.8, -2, 2, { cast: false, receive: false });
  for (const x of [-1.2, 1.2]) for (const z of [-2, 0, 2]) boxAt(gh, lambert('#f0f0ea'), x - 0.03, x + 0.03, 0, 1.8, z - 0.03, z + 0.03);
  gh.position.set(13, 0, 6.5);
  scene.add(gh);
  // грядки сада
  for (const [x, z] of [[11, -1.5], [11, 1.5], [16, 5]]) {
    boxAt(scene, MAT.darkWood, x - 1.2, x + 1.2, 0, 0.25, z - 0.5, z + 0.5);
    boxAt(scene, MAT.soil, x - 1.1, x + 1.1, 0, 0.27, z - 0.42, z + 0.42, { cast: false });
  }
  for (let i = 0; i < 4; i++) pumpkin(scene, 15.2 + i * 0.7, 4.8 + (i % 2) * 0.5, 0.22 + (i % 3) * 0.06);
  // дальний забор сада
  boxAt(scene, MAT.fence, 21.5, 21.6, 0, 1.15, -10, 10);

  // соседская живая изгородь на западе и у улицы
  const bushes = [];
  for (let z = -14; z <= 12; z += 0.85) bushes.push([-10.9, z, 0.95]);
  for (let x = -10; x <= 21.5; x += 0.8) bushes.push([x, 13.2, 0.6]);
  const bushMesh = new THREE.InstancedMesh(softBlob(1, mulberry32(9)), lambert('#ffffff'), bushes.length);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), r = mulberry32(12);
    bushes.forEach(([x, z, h], i) => {
      const k = 0.85 + r() * 0.3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6);
      m.compose(new THREE.Vector3(x, h * 0.9, z), q, new THREE.Vector3(0.75 * k, h * k, 0.75 * k));
      bushMesh.setMatrixAt(i, m);
      bushMesh.setColorAt(i, c.set(r() < 0.25 ? '#8a8a45' : '#6e8a4c').offsetHSL(0, 0, (r() - 0.5) * 0.06));
    });
    bushMesh.castShadow = true; bushMesh.receiveShadow = true;
  }
  scene.add(bushMesh);
  // улица на юге
  const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(120, 2.2), lambert('#c9c2b4'));
  sidewalk.rotation.x = -Math.PI / 2; sidewalk.position.set(0, -0.012, 9.1); sidewalk.receiveShadow = true;
  scene.add(sidewalk);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(120, 6), lambert('#7c7a76'));
  road.rotation.x = -Math.PI / 2; road.position.set(0, -0.015, 16.6); road.receiveShadow = true;
  scene.add(road);

  // кольцо дальних деревьев
  const rng = mulberry32(101);
  const crowns = ['#d9822f', '#e6b245', '#c4532c', '#9e7a3a', '#d06a2c', '#7b8d4a'];
  const n = 70;
  const crownGeo = softBlob(1, mulberry32(5));
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1, 6);
  const crownMesh = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial(), n * 2);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, lambert('#6a503e'), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.08, r = 32 + rng() * 22;
    const x = Math.cos(a) * r, z = Math.sin(a) * r - 4, s = 1.6 + rng() * 1.6;
    m.compose(new THREE.Vector3(x, s * 1.1, z), q, new THREE.Vector3(1, s * 2.2, 1));
    trunkMesh.setMatrixAt(i, m);
    for (let k = 0; k < 2; k++) {
      m.compose(new THREE.Vector3(x + (rng() - 0.5) * s, s * 2.6 + k * s * 0.9, z + (rng() - 0.5) * s), q,
        new THREE.Vector3(s * 1.5, s * 1.25, s * 1.5));
      crownMesh.setMatrixAt(i * 2 + k, m);
      crownMesh.setColorAt(i * 2 + k, c.set(crowns[Math.floor(rng() * crowns.length)]));
    }
  }
  scene.add(crownMesh, trunkMesh);
  // соседский дом за изгородью
  const nh = new THREE.Group();
  boxAt(nh, lambert('#e3d3bd'), -4, 4, 0, 4, -3, 3);
  const r1 = boxAt(nh, lambert('#6d5a4e'), -4.4, 4.4, 4, 4.2, -3.4, 3.4);
  r1.rotation.x = 0.0;
  const roofGeo = new THREE.ConeGeometry(5.6, 2.4, 4, 1);
  const roofM = add(nh, roofGeo, lambert('#7a4a3c'), 0, 5.3, 0);
  roofM.rotation.y = Math.PI / 4; roofM.scale.set(1.05, 1, 0.8);
  for (const z of [-1.6, 1.6]) {
    boxAt(nh, lambert('#fbf7ee'), 3.98, 4.06, 1.4, 2.8, z - 0.65, z + 0.65, { cast: false });
    boxAt(nh, lambert('#5d7c91'), 4.0, 4.1, 1.5, 2.7, z - 0.55, z + 0.55, { cast: false });
  }
  nh.position.set(-19, 0, -4);
  scene.add(nh);
}
