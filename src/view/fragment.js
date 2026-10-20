// Небольшой участок для проверки ковра из листьев: газон с травинками, каменные плиты,
// каменная стенка, дощатый забор и контейнер. Освещение — как в игре.

import * as THREE from '../../vendor/three.module.min.js';
import { FRAGMENT, FRAGMENT_STONES, FRAGMENT_WALL, FRAGMENT_FENCE, STONE_TOP } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { canvas, toTexture, shade } from './textures.js';
import { skyDome, softBlob, buildContainer } from './scene.js';

const Z = FRAGMENT.zone;

export function buildFragment(scene) {
  scene.background = new THREE.Color('#c4d9ec');
  scene.fog = new THREE.Fog('#e6dcc6', 14, 60);
  scene.add(new THREE.HemisphereLight('#dfe9ff', '#8a7350', 1.25));
  const sun = new THREE.DirectionalLight('#ffe0b0', 2.7);
  sun.position.set(-6, 9, 5);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  scene.add(skyDome());

  // газон участка — подробная текстура; вокруг — тот же газон повтором
  const lawnPx = 2048, span = 7.4;
  const lawn = canvas(lawnPx);
  paintLawn(lawn.getContext('2d'), lawnPx, span, 5);
  const lawnTex = toTexture(lawn);
  lawnTex.wrapS = lawnTex.wrapT = THREE.ClampToEdgeWrapping;
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: lawnTex }));
  patch.receiveShadow = true;
  scene.add(patch);
  const tile = canvas(1024);
  paintLawn(tile.getContext('2d'), 1024, 3.7, 11);
  const tileTex = toTexture(tile, { repeat: 160 / 3.7 });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tileTex }));
  outer.position.y = -0.004;
  outer.receiveShadow = true;
  scene.add(outer);

  buildStones(scene);
  buildWall(scene);
  buildFence(scene);
  buildGrass(scene);
  buildBushes(scene);
  const container = buildContainer(scene, undefined, FRAGMENT.container);
  return { container, update() {} };
}

// ── газон ─────────────────────────────────────────────────────
function paintLawn(ctx, px, meters, seed) {
  const rng = mulberry32(seed);
  const m = px / meters;
  ctx.fillStyle = '#6f8446';
  ctx.fillRect(0, 0, px, px);
  // крупные пятна оттенков: сочные, жёлтые, подсохшие
  const tones = ['rgba(98,124,58,0.35)', 'rgba(132,146,70,0.3)', 'rgba(150,136,78,0.22)', 'rgba(84,108,52,0.35)'];
  for (let i = 0; i < 900; i++) {
    const x = rng() * px, y = rng() * px, r = (0.08 + rng() * 0.45) * m;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = tones[Math.floor(rng() * tones.length)];
    g.addColorStop(0, c); g.addColorStop(1, c.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // проплешины земли
  for (let i = 0; i < 40; i++) {
    const x = rng() * px, y = rng() * px, r = (0.03 + rng() * 0.1) * m;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(110,88,58,0.45)'); g.addColorStop(1, 'rgba(110,88,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // травинки: группами по цвету, одним путём на группу (быстро)
  const blade = ['#566b34', '#7d9447', '#9aab5a', '#647a3a', '#b0b56a'];
  const count = Math.floor(meters * meters * 9000);
  for (let g = 0; g < blade.length; g++) {
    ctx.strokeStyle = blade[g];
    ctx.globalAlpha = g === 4 ? 0.5 : 0.75;
    ctx.lineWidth = Math.max(1, m * 0.0025);
    ctx.beginPath();
    for (let i = 0; i < count / blade.length; i++) {
      const x = rng() * px, y = rng() * px;
      const l = (0.008 + rng() * 0.018) * m, a = rng() * Math.PI * 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // клевер
  ctx.fillStyle = 'rgba(90,128,58,0.8)';
  for (let i = 0; i < meters * meters * 25; i++) {
    const x = rng() * px, y = rng() * px, r = m * 0.006;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng();
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ── каменные плиты ────────────────────────────────────────────
function stoneTextures() {
  const S = 512, rng = mulberry32(21);
  const col = canvas(S), bump = canvas(S);
  const c = col.getContext('2d'), b = bump.getContext('2d');
  c.fillStyle = '#b3a993'; c.fillRect(0, 0, S, S);
  b.fillStyle = '#808080'; b.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rng() * S, y = rng() * S, r = 1 + rng() * 14;
    const t = rng();
    c.fillStyle = t < 0.4 ? 'rgba(150,140,120,0.25)' : t < 0.75 ? 'rgba(200,192,172,0.22)' : 'rgba(120,112,98,0.22)';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    const v = Math.floor(100 + rng() * 60);
    b.fillStyle = `rgba(${v},${v},${v},0.35)`;
    b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill();
  }
  // лишайник
  for (let i = 0; i < 40; i++) {
    const x = rng() * S, y = rng() * S, r = 3 + rng() * 10;
    c.fillStyle = rng() < 0.5 ? 'rgba(170,170,110,0.4)' : 'rgba(205,200,160,0.35)';
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  const map = toTexture(col), bumpMap = toTexture(bump, { srgb: false });
  return { map, bumpMap };
}

function stoneShape(r, seed) {
  const rng = mulberry32(seed + 1);
  const s = new THREE.Shape();
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (0.82 + rng() * 0.3);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (0.8 + rng() * 0.2);
    if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function buildStones(scene) {
  const { map, bumpMap } = stoneTextures();
  map.repeat.set(1.6, 1.6); bumpMap.repeat.set(1.6, 1.6);
  for (const st of FRAGMENT_STONES) {
    const geo = new THREE.ExtrudeGeometry(stoneShape(st.r, st.seed), {
      depth: STONE_TOP + 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -0.02 - 0.008, 0);
    const mat = new THREE.MeshLambertMaterial({ map, bumpMap, bumpScale: 1.5, color: new THREE.Color(shade('#ffffff', -10 + (st.seed % 5) * 6)) });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(st.x, 0, st.z);
    m.rotation.y = st.a;
    m.receiveShadow = true;
    scene.add(m);
  }
}

// ── каменная стенка с севера ──────────────────────────────────
function roundedBox(r = 0.18) {
  const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const p = geo.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3();
  const lim = 0.5 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(Math.max(-lim, Math.min(lim, v.x)), Math.max(-lim, Math.min(lim, v.y)), Math.max(-lim, Math.min(lim, v.z)));
    v.sub(inner).normalize().multiplyScalar(r).add(inner);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildWall(scene) {
  const W = FRAGMENT_WALL, rng = mulberry32(8);
  const { map, bumpMap } = stoneTextures();
  const stones = [];
  const courses = 3, ch = W.h / courses;
  for (let c = 0; c < courses; c++) {
    let x = W.x0 + (c % 2) * 0.15;
    while (x < W.x1) {
      const w = 0.28 + rng() * 0.3;
      stones.push([x + w / 2, ch * (c + 0.5), (W.z0 + W.z1) / 2 + (rng() - 0.5) * 0.04, w - 0.02, ch - 0.02, W.z1 - W.z0]);
      x += w;
    }
  }
  const inst = new THREE.InstancedMesh(roundedBox(), new THREE.MeshLambertMaterial({ map, bumpMap, bumpScale: 2 }), stones.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  stones.forEach(([x, y, z, w, h, d], i) => {
    q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.04));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.set(['#d6cbb6', '#c2b49c', '#b8b0a2', '#cfc0a2'][Math.floor(rng() * 4)]));
  });
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);
  // раствор позади камней
  const mortar = new THREE.Mesh(new THREE.BoxGeometry(W.x1 - W.x0, W.h - 0.02, (W.z1 - W.z0) * 0.7), new THREE.MeshLambertMaterial({ color: '#8f877a' }));
  mortar.position.set((W.x0 + W.x1) / 2, W.h / 2, (W.z0 + W.z1) / 2);
  scene.add(mortar);
}

// ── дощатый забор с востока ───────────────────────────────────
function woodBoardTexture() {
  const c = canvas(128, 1024), ctx = c.getContext('2d'), rng = mulberry32(31);
  ctx.fillStyle = '#a77b52'; ctx.fillRect(0, 0, 128, 1024);
  for (let i = 0; i < 90; i++) {
    const x = rng() * 128;
    ctx.strokeStyle = `rgba(${rng() < 0.5 ? '90,58,34' : '196,154,108'},${0.15 + rng() * 0.25})`;
    ctx.lineWidth = 0.6 + rng() * 2.2;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 64) ctx.lineTo(x + Math.sin(y * 0.01 + i) * 3, y);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const x = 20 + rng() * 88, y = 100 + rng() * 820;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
    g.addColorStop(0, 'rgba(70,40,20,0.8)'); g.addColorStop(1, 'rgba(70,40,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 10, y - 14, 20, 28);
  }
  return toTexture(c);
}

function buildFence(scene) {
  const F = FRAGMENT_FENCE, rng = mulberry32(4);
  const tex = woodBoardTexture();
  const boardGeo = new THREE.BoxGeometry(0.03, 1, 0.14);
  const n = Math.ceil((F.z1 - F.z0 + 1) / 0.15);
  const inst = new THREE.InstancedMesh(boardGeo, new THREE.MeshLambertMaterial({ map: tex }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const z = F.z0 - 0.5 + i * 0.15 + 0.075, h = F.h + (rng() - 0.5) * 0.04;
    q.setFromEuler(new THREE.Euler(0, 0, (rng() - 0.5) * 0.015));
    m.compose(new THREE.Vector3(F.x0 + 0.05, h / 2, z), q, new THREE.Vector3(1, h, 1));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.set('#ffffff').offsetHSL(0, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.1));
  }
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);
  const dark = new THREE.MeshLambertMaterial({ color: '#7d5a3c' });
  for (const y of [0.25, 0.9]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, F.z1 - F.z0 + 1), dark);
    rail.position.set(F.x0 + 0.1, y, (F.z0 + F.z1) / 2);
    rail.castShadow = true;
    scene.add(rail);
  }
}

// ── травинки и кусты ──────────────────────────────────────────
function tuftGeometry(rng) {
  const pos = [], colr = [], nor = [];
  const blades = 9;
  const base = new THREE.Color('#5f7239'), tip = new THREE.Color('#a3b465');
  for (let b = 0; b < blades; b++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.035;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.022 + rng() * 0.03, w = 0.0028 + rng() * 0.002;
    const lean = (rng() - 0.5) * 0.02, la = rng() * Math.PI * 2;
    const tx = x + Math.cos(la) * lean, tz = z + Math.sin(la) * lean;
    const px = Math.cos(a + Math.PI / 2) * w, pz = Math.sin(a + Math.PI / 2) * w;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, h, tz);
    const t = tip.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.1);
    colr.push(base.r, base.g, base.b, base.r, base.g, base.b, t.r, t.g, t.b);
    for (let k = 0; k < 3; k++) nor.push(0, 1, 0); // травинки освещаются как газон
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

function buildGrass(scene) {
  const rng = mulberry32(17);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const pts = [];
  // на участке травинки пробиваются сквозь листья, вокруг — сплошной газон
  for (let i = 0; i < 2500; i++) {
    const x = Z.minX + rng() * (Z.maxX - Z.minX), z = Z.minZ + rng() * (Z.maxZ - Z.minZ);
    if (FRAGMENT.onPath(x, z)) continue;
    pts.push([x, z, 0.7 + rng() * 0.6]);
  }
  for (let i = 0; i < 12000; i++) {
    const a = rng() * Math.PI * 2, r = 3.2 + Math.sqrt(rng()) * 7;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < Z.minZ - 0.3 || x > Z.maxX + 0.05) continue; // за стенкой и забором — кусты
    pts.push([x, z, 0.9 + rng() * 0.7]);
  }
  const variants = [tuftGeometry(rng), tuftGeometry(rng), tuftGeometry(rng)];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  variants.forEach((geo, v) => {
    const mine = pts.filter((_, i) => i % 3 === v);
    const inst = new THREE.InstancedMesh(geo, mat, mine.length);
    mine.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + rng() * 0.5), s));
      inst.setMatrixAt(i, m);
    });
    inst.receiveShadow = true;
    scene.add(inst);
  });
}

function buildBushes(scene) {
  const rng = mulberry32(23);
  const items = [];
  for (let x = -6; x <= 6; x += 0.7) items.push([x, Z.minZ - 1.0 - rng() * 0.4, 0.75 + rng() * 0.35]);
  for (let z = -3.5; z <= 6; z += 0.7) items.push([Z.maxX + 0.9 + rng() * 0.4, z, 0.85 + rng() * 0.4]);
  const inst = new THREE.InstancedMesh(softBlob(1, rng), new THREE.MeshLambertMaterial(), items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  items.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    m.compose(new THREE.Vector3(x, s * 0.8, z), q, new THREE.Vector3(s * 0.8, s, s * 0.8));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, c.set(['#5f7a3f', '#6f8a46', '#7d8c3e', '#a8862f'][Math.floor(rng() * 4)]));
  });
  inst.castShadow = inst.receiveShadow = true;
  scene.add(inst);
}
