// Отрисовка листьев: один instanced-меш с текстурой из атласа (4 вида × 4 окраски),
// загнутые края и кончик — в вершинном шейдере. Подсветка, дрожание при подборе,
// полёт к камере, реакция на шаги, подсветка последних листьев.

import * as THREE from '../../vendor/three.module.min.js';
import { REMAINING_HIGHLIGHT } from '../config.js';
import { ON_GROUND, mulberry32 } from '../leaves.js';
import { surfaceHeight } from '../layout.js';
import { glowTexture } from './textures.js';
// Атлас готовых текстур (см. tools/build-leaf-atlas.py): 4×2 клетки, заняты 6.
// Цвет и маска прозрачности — отдельные файлы, чтобы на краях не было цветной каймы.
const ATLAS_COLS = 4, ATLAS_ROWS = 2;
const TILES = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]];
// относительный размер вида: клёны крупнее, бук и берёза мельче
const SPECIES_SIZE = [1.12, 1.0, 0.86, 0.98, 0.88, 1.08];

export const LEAF_BASE = 0.17; // сторона клетки атласа в метрах при scale = 1 (лист ≈ 0.85 клетки)

export async function loadLeafTextures(base = 'assets/leaves/') {
  const loader = new THREE.TextureLoader();
  const [map, alphaMap] = await Promise.all([
    loader.loadAsync(base + 'leaf-color.jpg'),
    loader.loadAsync(base + 'leaf-alpha.png'),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, alphaMap]) {
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, alphaMap };
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const EYE_TARGET = new THREE.Vector3(0, -0.11, -0.32); // куда летит лист — чуть ниже центра взгляда

function leafGeometry() {
  const geo = new THREE.PlaneGeometry(1, 1, 6, 6);
  geo.rotateX(-Math.PI / 2); // плоскость XZ, нормаль +Y; после поворота −Z — к кончику листа
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // кончик листа (−Z) — верх клетки; у картинки flipY, верх клетки — большее v
    uv.setXY(i, (x + 0.5) / ATLAS_COLS, (0.5 - z) / ATLAS_ROWS);
  }
  return geo;
}

function addInstanceAttributes(geo, n) {
  geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
  geo.setAttribute('aCurl', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
}

// общий кусок шейдера: смещение UV в клетку атласа и изгиб листа
function injectLeaf(shader, withNormal) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec2 aUvOffset;
      attribute vec3 aCurl;
      float leafBend(vec3 p) {
        float zt = min(p.z, 0.0), zb = max(p.z, 0.0);
        return aCurl.x * p.x * p.x + aCurl.y * zt * zt + 0.35 * aCurl.y * zb * zb + aCurl.z * p.x * p.z;
      }`)
    .replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = uv + aUvOffset;
      #endif
      #ifdef USE_ALPHAMAP
        vAlphaMapUv = uv + aUvOffset;
      #endif`)
    .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
      transformed.y += leafBend(position);`);
  if (withNormal) {
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      float zt0 = min(position.z, 0.0), zb0 = max(position.z, 0.0);
      float dydx = 2.0 * aCurl.x * position.x + aCurl.z * position.z;
      float dydz = 2.0 * aCurl.y * zt0 + 0.7 * aCurl.y * zb0 + aCurl.z * position.x;
      vec3 objectNormal = normalize(vec3(-dydx, 1.0, -dydz));`);
  }
}

/** Тень в форме листа: глубина с той же маской прозрачности и тем же изгибом. */
function leafDepthMaterial({ alphaMap }) {
  const mat = new THREE.MeshDepthMaterial({ alphaMap, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => injectLeaf(shader, false);
  return mat;
}

/** Материал с изгибом листа: y = cup·x² + tip·z² (к кончику, −Z) + twist·x·z. */
function leafMaterial({ map, alphaMap }) {
  const mat = new THREE.MeshLambertMaterial({ map, alphaMap, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: true });
  mat.onBeforeCompile = (shader) => injectLeaf(shader, true);
  return mat;
}

export class LeafView {
  constructor(scene, field, textures, { size = 1 } = {}) {
    this.field = field;
    this.size = LEAF_BASE * size;
    this.material = leafMaterial(textures);
    const n = field.count;
    const geo = leafGeometry();
    addInstanceAttributes(geo, n);
    this.mesh = new THREE.InstancedMesh(geo, this.material, n);
    this.mesh.receiveShadow = true;
    // листья отбрасывают тени по своей форме (маска прозрачности), а не квадратами
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = leafDepthMaterial(textures);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    // постоянные свойства листьев: клетка атласа, изгиб, оттенок с «затенением» нижних слоёв
    const uvo = geo.attributes.aUvOffset.array, curl = geo.attributes.aCurl.array;
    this.baseColor = new Float32Array(n * 3);
    const rng = mulberry32(n + 9);
    let maxLift = 0.0001;
    for (let i = 0; i < n; i++) maxLift = Math.max(maxLift, field.lift[i]);
    const liftRef = Math.min(maxLift, 0.03);
    for (let i = 0; i < n; i++) {
      const [col, row] = TILES[field.shape[i] % TILES.length];
      uvo[i * 2] = col / ATLAS_COLS;
      uvo[i * 2 + 1] = (ATLAS_ROWS - 1 - row) / ATLAS_ROWS;
      const b = field.bend[i];
      const h1 = (b & 15) / 15, h2 = ((b >> 4) & 15) / 15;
      curl[i * 3] = 0.15 + 0.45 * h1;            // края приподняты
      curl[i * 3 + 1] = -0.05 + 0.7 * h2;        // кончик загнут
      curl[i * 3 + 2] = (rng() - 0.5) * 0.45;    // лёгкое скручивание
      // нижние слои темнее — мягкая «тень» внутри ковра без карты теней
      const depth = Math.min(1, field.lift[i] / liftRef);
      const k = (0.62 + 0.38 * depth) * (0.93 + rng() * 0.12);
      // field.color — лёгкий сдвиг оттенка, естественная окраска текстуры сохраняется
      const warm = [1, 1.04, 0.97, 1.02][field.color[i] % 4];
      this.baseColor.set([k * warm, k, k * (2 - warm) * 0.98], i * 3);
    }
    geo.attributes.aUvOffset.needsUpdate = true;
    geo.attributes.aCurl.needsUpdate = true;

    this.hop = new Float32Array(n);   // подлёт при пинке
    this.spin = new Float32Array(n);
    this.flying = [];
    this.highlighted = new Set();
    this.raised = -1;
    this.wobbleId = -1;
    this.matrixDirty = false;
    this.colorDirty = false;
    for (let i = 0; i < n; i++) { this.writeMatrix(i); this.writeColor(i, 1); }
    this.flush();

    // листья, летящие в контейнер при сдаче (только эффект)
    const fxGeo = leafGeometry();
    addInstanceAttributes(fxGeo, 32);
    for (let k = 0; k < 32; k++) {
      const [col, row] = TILES[k % TILES.length];
      fxGeo.attributes.aUvOffset.setXY(k, col / ATLAS_COLS, (ATLAS_ROWS - 1 - row) / ATLAS_ROWS);
      fxGeo.attributes.aCurl.setXYZ(k, 0.3, 0.2, 0);
    }
    this.fx = new THREE.InstancedMesh(fxGeo, this.material, 32);
    this.fx.frustumCulled = false;
    this.fx.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < 32; k++) this.fx.setMatrixAt(k, ZERO);
    scene.add(this.fx);
    this.fxList = [];

    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthTest: false, depthWrite: false, opacity: 0.85 });
    this.glows = Array.from({ length: REMAINING_HIGHLIGHT }, () => {
      const s = new THREE.Sprite(glowMat);
      s.scale.set(0.4, 0.4, 1);
      s.visible = false; s.renderOrder = 3;
      scene.add(s);
      return s;
    });
  }

  writeMatrix(i, extraLift = 0, extraYaw = 0) {
    const f = this.field;
    if (f.state[i] !== ON_GROUND) {
      this.mesh.setMatrixAt(i, ZERO);
    } else {
      const s = this.leafScale(i);
      tmpE.set(f.tiltX[i] + this.hop[i] * 9, f.yaw[i] + this.spin[i] + extraYaw, f.tiltZ[i] - this.hop[i] * 6);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(f.x[i], f.y(i) + this.hop[i] + extraLift, f.z[i]);
      tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
      this.mesh.setMatrixAt(i, tmpM);
    }
    this.matrixDirty = true;
  }

  leafScale(i) {
    return this.field.scale[i] * this.size * SPECIES_SIZE[this.field.shape[i] % SPECIES_SIZE.length];
  }

  /** Радиус листа на земле (для выбора прицелом). */
  pickRadius(i) {
    return this.leafScale(i) * 0.36;
  }

  writeColor(i, k) {
    const b = this.baseColor;
    tmpC.setRGB(b[i * 3] * k, b[i * 3 + 1] * k, b[i * 3 + 2] * k);
    this.mesh.setColorAt(i, tmpC);
    this.colorDirty = true;
  }

  flush() {
    if (this.matrixDirty) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.matrixDirty = this.colorDirty = false;
  }

  refreshAll() {
    for (let i = 0; i < this.field.count; i++) this.writeMatrix(i);
    this.flush();
  }

  /** Подсветка выбранного листа (ярче и чуть приподнят) и тех, что заберёт захват. */
  setHighlight(target, group) {
    const key = `${target}|${group.join(',')}|${this.field.version}`;
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    const next = new Set(group);
    if (target >= 0) next.add(target);
    for (const i of this.highlighted) if (!next.has(i)) this.writeColor(i, 1);
    for (const i of next) this.writeColor(i, i === target ? 1.5 : 1.22);
    this.highlighted = next;
    if (this.raised >= 0 && this.raised !== target && this.raised !== this.wobbleId) this.writeMatrix(this.raised);
    this.raised = target;
    if (target >= 0 && target !== this.wobbleId) this.writeMatrix(target, 0.006);
  }

  /** Лист «просыпается» во время подбора: дрожит и чуть приподнимается. */
  setWobble(target, p, now) {
    if (this.wobbleId >= 0 && this.wobbleId !== target) this.writeMatrix(this.wobbleId);
    this.wobbleId = target;
    if (target < 0) return;
    this.writeMatrix(target, 0.006 + 0.035 * p * p, Math.sin(now * 38) * 0.09 * p);
  }

  /** Собранные листья плавно подлетают к камере и исчезают. */
  flyToCamera(ids, now) {
    const f = this.field;
    ids.forEach((i, k) => {
      this.flying.push({
        i, t0: now + k * 0.045, dur: 0.5 + Math.min(k, 6) * 0.015,
        from: new THREE.Vector3(f.x[i], f.y(i) + (i === this.wobbleId ? 0.04 : 0), f.z[i]),
        yaw: f.yaw[i], tilt: f.tiltX[i], s: this.leafScale(i),
        spin: (k % 2 ? 1 : -1) * (2 + (i % 5) * 0.4),
      });
    });
    if (ids.includes(this.wobbleId)) this.wobbleId = -1;
    if (ids.includes(this.raised)) this.raised = -1;
  }

  /** Короткий поток листьев в контейнер при сдаче. */
  depositBurst(from, to, n, now) {
    const count = Math.min(32, Math.max(4, Math.ceil(n * 0.6)));
    this.fxList = [];
    for (let k = 0; k < count; k++) {
      this.fxList.push({
        k, t0: now + k * 0.022, dur: 0.42 + Math.random() * 0.12,
        from: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.15)),
        to: to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.4)),
        spin: Math.random() * 6,
      });
    }
  }

  /** Пинок листьев ногами: лёгкий сдвиг, поворот и подлёт. Возвращает число задетых. */
  kick(px, pz, vx, vz, dt, rng) {
    const f = this.field;
    const speed = Math.hypot(vx, vz);
    if (speed < 0.6) return 0;
    let n = 0;
    const R = 0.4;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      const dx = f.x[i] - px, dz = f.z[i] - pz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = (1 - d / R) * dt * 1.6;
      const nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : 0;
      f.nudge(i, (vx * 0.5 + nx * speed * 0.6) * k, (vz * 0.5 + nz * speed * 0.6) * k);
      this.hop[i] = Math.min(0.05, this.hop[i] + k * 0.2);
      this.spin[i] += (rng() - 0.5) * k * 6;
      n++;
    }
    return n;
  }

  update(now, dt, camera, remainingIds) {
    const f = this.field;
    for (let i = 0; i < f.count; i++) {
      if (this.hop[i] > 0) {
        this.hop[i] = Math.max(0, this.hop[i] - dt * 0.3);
        if (i !== this.wobbleId) this.writeMatrix(i, i === this.raised ? 0.006 : 0);
      }
    }
    // полёт к камере: подъём, кувырок и плавный перелёт к точке перед глазами
    if (this.flying.length) {
      const target = camera.localToWorld(tmpB.copy(EYE_TARGET));
      this.flying = this.flying.filter((fl) => {
        const t = (now - fl.t0) / fl.dur;
        if (t < 0) return true; // ждёт своей очереди и лежит на месте
        if (t >= 1) { this.mesh.setMatrixAt(fl.i, ZERO); this.matrixDirty = true; return false; }
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        // квадратичная кривая: старт → точка над листом → перед камерой
        tmpA.copy(fl.from); tmpA.y += 0.3;
        const u = 1 - e;
        tmpP.set(
          u * u * fl.from.x + 2 * u * e * tmpA.x + e * e * target.x,
          u * u * fl.from.y + 2 * u * e * tmpA.y + e * e * target.y,
          u * u * fl.from.z + 2 * u * e * tmpA.z + e * e * target.z,
        );
        tmpE.set(fl.tilt + t * 2.4, fl.yaw + t * fl.spin, Math.sin(t * Math.PI) * 0.9);
        tmpQ.setFromEuler(tmpE);
        const fade = t > 0.78 ? 1 - (t - 0.78) / 0.22 : 1;
        const s = fl.s * (1 - 0.35 * e) * fade;
        tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
        this.mesh.setMatrixAt(fl.i, tmpM);
        this.matrixDirty = true;
        return true;
      });
    }
    if (this.fxList.length) {
      this.fxList = this.fxList.filter((fx) => {
        const t = Math.max(0, (now - fx.t0) / fx.dur);
        if (t >= 1) { this.fx.setMatrixAt(fx.k, ZERO); return false; }
        tmpP.lerpVectors(fx.from, fx.to, t);
        tmpP.y += Math.sin(t * Math.PI) * 0.6;
        tmpE.set(t * 3 + fx.spin, fx.spin + t * 5, t * 2); tmpQ.setFromEuler(tmpE);
        const s = now < fx.t0 ? 0 : this.size * 1.6;
        tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
        this.fx.setMatrixAt(fx.k, tmpM);
        return true;
      });
      this.fx.instanceMatrix.needsUpdate = true;
    }
    let g = 0;
    if (remainingIds) {
      for (const i of remainingIds) {
        if (g >= this.glows.length) break;
        const s = this.glows[g++];
        s.visible = true;
        s.position.set(f.x[i], surfaceHeight(f.x[i], f.z[i]) + 0.25 + Math.sin(now * 2.4 + i) * 0.04, f.z[i]);
      }
    }
    for (; g < this.glows.length; g++) this.glows[g].visible = false;
    this.flush();
  }
}
