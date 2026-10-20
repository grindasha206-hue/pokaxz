// Отдельный режим для проверки листьев (?fragment): газон, каменные плиты, каменная стенка,
// дощатый забор и контейнер. Освещение — как во дворе.

import * as THREE from '../../vendor/three.module.min.js';
import { FRAGMENT, FRAGMENT_STONES, FRAGMENT_WALL, FRAGMENT_FENCE, STONE_TOP } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { canvas, toTexture, shade, boardTexture, paintGrass } from './textures.js';
import { skyDome, buildContainer } from './scene.js';

const Z = FRAGMENT.zone;

export function buildFragment(scene) {
  scene.background = new THREE.Color('#c4d9ec');
  scene.fog = new THREE.Fog('#e6dcc6', 14, 60);
  scene.add(new THREE.HemisphereLight('#d6e4ff', '#8a6e4a', 0.95));
  const sun = new THREE.DirectionalLight('#ffd9a8', 3.1);
  sun.position.set(-7.5, 7, 5.5);
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
  paintGrass(lawn.getContext('2d'), 0, 0, lawnPx, lawnPx, 5, 2);
  const lawnTex = toTexture(lawn);
  lawnTex.wrapS = lawnTex.wrapT = THREE.ClampToEdgeWrapping;
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: lawnTex }));
  patch.receiveShadow = true;
  scene.add(patch);
  const tile = canvas(1024);
  paintGrass(tile.getContext('2d'), 0, 0, 1024, 1024, 11, 1);
  const tileTex = toTexture(tile, { repeat: 160 / 3.7 });
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tileTex }));
  outer.position.y = -0.004;
  outer.receiveShadow = true;
  scene.add(outer);

  buildStones(scene);
  buildWall(scene);
  buildFence(scene);
  const container = buildContainer(scene, undefined, FRAGMENT.container);
  return { container, update() {} };
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

function buildFence(scene) {
  const F = FRAGMENT_FENCE, rng = mulberry32(4);
  const tex = boardTexture();
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
