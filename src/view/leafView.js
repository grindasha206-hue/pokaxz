// Отрисовка листьев: один instanced-меш с готовыми текстурами (6 видов),
// изгибы листа — в вершинном шейдере. Подсветка, дрожание при подборе, полёт к камере,
// лёгкое покачивание под ногами (без смещения), опускание листьев после сбора нижних,
// подсветка последних листьев.

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

function leafGeometry(seg = 4) {
  // 4 × 4 — 32 треугольника: изгибы плавные, а листьев тысячи; в самых больших зонах — 3 × 3 (18)
  const geo = new THREE.PlaneGeometry(1, 1, seg, seg);
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
  geo.setAttribute('aCurl', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
}

// общий кусок шейдера: смещение UV в клетку атласа и изгиб листа
function injectLeaf(shader, withNormal) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec2 aUvOffset;
      attribute vec4 aCurl; // x — края вверх, y — кончик, z — скручивание, w — волна вдоль листа
      float leafBend(vec3 p) {
        float zt = min(p.z, 0.0), zb = max(p.z, 0.0);
        return aCurl.x * p.x * p.x + aCurl.y * zt * zt + 0.35 * aCurl.y * zb * zb + aCurl.z * p.x * p.z
          + aCurl.w * 0.035 * (1.0 + sin(p.z * 9.0 + p.x * 3.0));
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
      float wv = aCurl.w * 0.035 * cos(position.z * 9.0 + position.x * 3.0);
      float dydx = 2.0 * aCurl.x * position.x + aCurl.z * position.z + 3.0 * wv;
      float dydz = 2.0 * aCurl.y * zt0 + 0.7 * aCurl.y * zb0 + aCurl.z * position.x + 9.0 * wv;
      vec3 objectNormal = normalize(vec3(-dydx, 1.0, -dydz));`);
  }
}

/** Тень в форме листа: глубина с той же маской прозрачности и тем же изгибом. */
function leafDepthMaterial({ alphaMap }) {
  const mat = new THREE.MeshDepthMaterial({ alphaMap, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => injectLeaf(shader, false);
  return mat;
}

/** Материал с изгибом листа; цвет текстуры немного приглушён (насыщенность ×0.8). */
function leafMaterial({ map, alphaMap }) {
  const mat = new THREE.MeshLambertMaterial({ map, alphaMap, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: true });
  mat.onBeforeCompile = (shader) => {
    injectLeaf(shader, true);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float leafLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(vec3(leafLum), diffuseColor.rgb, 0.88);`);
  };
  return mat;
}

export class LeafView {
  constructor(scene, field, textures, { size = 1, segments = 4 } = {}) {
    this.field = field;
    this.size = LEAF_BASE * size;
    this.material = leafMaterial(textures);
    const n = field.count;
    const geo = leafGeometry(segments);
    addInstanceAttributes(geo, n);
    this.mesh = new THREE.InstancedMesh(geo, this.material, n);
    this.mesh.receiveShadow = true;
    // листья отбрасывают тени по своей форме (маска прозрачности), а не квадратами
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = leafDepthMaterial(textures);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    // постоянные свойства листьев: клетка атласа, изгибы, оттенок
    const uvo = geo.attributes.aUvOffset.array, curl = geo.attributes.aCurl.array;
    this.tint = new Float32Array(n * 3);
    const rng = mulberry32(n + 9);
    for (let i = 0; i < n; i++) {
      const [col, row] = TILES[field.shape[i] % TILES.length];
      uvo[i * 2] = col / ATLAS_COLS;
      uvo[i * 2 + 1] = (ATLAS_ROWS - 1 - row) / ATLAS_ROWS;
      const b = field.bend[i];
      const h1 = (b & 15) / 15, h2 = ((b >> 4) & 15) / 15;
      // несколько умеренных изгибов: края, кончик, лёгкое скручивание и волна вдоль листа
      curl[i * 4] = 0.12 + 0.3 * h1;
      curl[i * 4 + 1] = -0.03 + 0.5 * h2;
      curl[i * 4 + 2] = (rng() - 0.5) * 0.24;
      curl[i * 4 + 3] = rng() * 0.7;
      // field.color — лёгкий сдвиг оттенка, окраска текстуры сохраняется
      const warm = [1, 1.03, 0.98, 1.015][field.color[i] % 4], j = 0.94 + rng() * 0.1;
      this.tint.set([j * warm, j, j * (2 - warm) * 0.99], i * 3);
    }
    geo.attributes.aUvOffset.needsUpdate = true;
    geo.attributes.aCurl.needsUpdate = true;

    this.shown = Float32Array.from(field.lift); // высота, на которой лист сейчас нарисован
    this.tmpN = [];
    this.cover = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.cover[i] = Math.min(255, this.coverOf(i));
    this.falling = new Set();                    // листья, опускающиеся после сбора нижних
    this.stir = new Float32Array(n);             // покачивание под ногами (без смещения)
    this.stirring = new Set();
    this.now = 0;
    this.flying = [];
    this.flyingIds = new Set();
    this.slides = new Map();                     // листья, которые тянут грабли: откуда и когда
    this.sinking = [];                           // листья, проваливающиеся в приёмник
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
      fxGeo.attributes.aCurl.setXYZW(k, 0.3, 0.2, 0, 0.3);
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
    if (this.flyingIds.has(i)) return; // полёт рисуется в update()
    if (f.state[i] !== ON_GROUND) {
      this.mesh.setMatrixAt(i, ZERO);
    } else {
      const s = this.leafScale(i);
      // покачивание: лист чуть поднимает край и возвращается на место
      const st = this.stir[i], w = st ? Math.sin(this.now * 13 + i * 1.7) * st : 0;
      const fl = f.flat[i];
      tmpE.set(f.tiltX[i] * fl + w * 0.1, f.yaw[i] + extraYaw + w * 0.04, f.tiltZ[i] * fl + w * 0.07);
      tmpQ.setFromEuler(tmpE);
      let x = f.x[i], z = f.z[i];
      const sl = this.slides.get(i);
      if (sl) {
        // лист едет за граблями: от старого места к новому с той же скоростью, что и голова
        const t = Math.min(1, Math.max(0, (this.now - sl.t0) / sl.dur)), k = 1 - t * t * (3 - 2 * t);
        x += (sl.fx - x) * k; z += (sl.fz - z) * k;
      }
      tmpP.set(x, surfaceHeight(x, z) + this.shown[i] + st * 0.004 + extraLift, z);
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

  /** Сколько лежащих листьев накрывает лист i (для затенения нижних слоёв). */
  coverOf(i) {
    const f = this.field;
    let n = 0;
    for (const j of f.neighbours(i, this.tmpN)) if (f.order[j] > f.order[i] && f.state[j] === ON_GROUND) n++;
    return n;
  }

  writeColor(i, k) {
    // накрытые листья чуть темнее — перекрытия читаются без круглых теней;
    // одиночный лист на земле — полной яркости
    const shade = (1 - 0.1 * Math.min(2, this.cover[i])) * k;
    const t = this.tint;
    tmpC.setRGB(t[i * 3] * shade, t[i * 3 + 1] * shade, t[i * 3 + 2] * shade);
    this.mesh.setColorAt(i, tmpC);
    this.colorDirty = true;
  }

  flush() {
    if (this.matrixDirty) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.matrixDirty = this.colorDirty = false;
  }

  refreshAll() {
    this.shown.set(this.field.lift);
    for (let i = 0; i < this.field.count; i++) this.cover[i] = Math.min(255, this.coverOf(i));
    for (let i = 0; i < this.field.count; i++) { this.writeMatrix(i); this.writeColor(i, 1); }
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

  /** Собранные листья плавно подлетают к камере и исчезают — все, сколько взял захват. */
  flyToCamera(ids, now) {
    const f = this.field;
    ids.forEach((i, k) => {
      this.flyingIds.add(i);
      this.falling.delete(i);
      this.stirring.delete(i);
      this.flying.push({
        i, t0: now + k * 0.045, dur: 0.5 + Math.min(k, 6) * 0.015,
        from: new THREE.Vector3(f.x[i], surfaceHeight(f.x[i], f.z[i]) + this.shown[i] + (i === this.wobbleId ? 0.04 : 0), f.z[i]),
        yaw: f.yaw[i], tilt: f.tiltX[i] * f.flat[i], s: this.leafScale(i),
        spin: (k % 2 ? 1 : -1) * (2 + (i % 5) * 0.4),
      });
    });
    if (ids.includes(this.wobbleId)) this.wobbleId = -1;
    if (ids.includes(this.raised)) this.raised = -1;
  }

  /**
   * Грабли сдвинули листья: moved — [{i, fx, fz}] (откуда), новые места уже в поле.
   * Листья доезжают за dur секунд; высота и затенение кучи пересчитываются по changed.
   */
  slide(moved, changed, now, dur) {
    for (const { i, fx, fz } of moved) this.slides.set(i, { fx, fz, t0: now, dur });
    this.restack(changed);
  }

  /** Пересчёт высоты (плавно) и затенения листьев после перестройки кучи. */
  restack(ids) {
    for (const i of ids) {
      this.falling.add(i);
      const c = Math.min(255, this.coverOf(i));
      if (c !== this.cover[i]) { this.cover[i] = c; this.writeColor(i, this.highlighted.has(i) ? 1.22 : 1); }
    }
  }

  /** Лист гонит струя: покачивается и поворачивается на лету (k — сила 0…1). */
  flutter(i, k) {
    const v = 0.35 + 0.65 * k;
    if (v > this.stir[i]) { this.stir[i] = v; this.stirring.add(i); }
  }

  /** Листья проваливаются в приёмник (они уже проданы): доезжают до решётки и исчезают. */
  sink(from, to, now, dur) {
    const f = this.field;
    from.forEach(({ i, fx, fz }, k) => {
      this.flyingIds.add(i);
      this.falling.delete(i);
      this.sinking.push({
        i, fx, fz, tx: to.x + (Math.random() - 0.5) * to.r, tz: to.z + (Math.random() - 0.5) * to.r,
        t0: now + Math.min(k, 40) * 0.004, dur, y: this.shown[i], yaw: f.yaw[i], s: this.leafScale(i),
      });
    });
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

  /** Листья, лежавшие на собранных, плавно опускаются; открывшиеся снизу — светлеют. */
  settle(ids, removed = []) {
    for (const i of ids) this.falling.add(i);
    const f = this.field, near = new Set();
    for (const r of removed) for (const j of f.neighbours(r, this.tmpN)) if (f.order[j] < f.order[r] && f.state[j] === ON_GROUND) near.add(j);
    for (const j of near) {
      const c = this.coverOf(j);
      if (c !== this.cover[j]) { this.cover[j] = c; this.writeColor(j, this.highlighted.has(j) ? 1.22 : 1); }
    }
  }

  /**
   * Игрок идёт поверх листьев: они не сдвигаются, только коротко покачиваются.
   * Возвращает число задетых листьев (для шороха).
   */
  stepOver(px, pz, speed) {
    if (speed < 0.6) return 0;
    const f = this.field, R = 0.32;
    let n = 0;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      const dx = f.x[i] - px, dz = f.z[i] - pz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = 1 - d / R;
      if (k > this.stir[i]) { this.stir[i] = k; this.stirring.add(i); }
      n++;
    }
    return n;
  }

  update(now, dt, camera, remainingIds) {
    const f = this.field;
    this.now = now;
    for (const i of this.stirring) {
      this.stir[i] = Math.max(0, this.stir[i] - dt * 2.2);
      if (this.stir[i] === 0) this.stirring.delete(i);
      if (i !== this.wobbleId) this.writeMatrix(i, i === this.raised ? 0.006 : 0);
    }
    for (const i of this.falling) {
      const target = f.lift[i], d = target - this.shown[i];
      const step = dt * 0.25;
      this.shown[i] = Math.abs(d) <= step ? target : this.shown[i] + Math.sign(d) * step;
      if (this.shown[i] === target) { this.falling.delete(i); this.writeColor(i, this.highlighted.has(i) ? 1.22 : 1); }
      if (i !== this.wobbleId) this.writeMatrix(i, i === this.raised ? 0.006 : 0);
    }
    for (const [i, sl] of this.slides) {
      if (now - sl.t0 >= sl.dur) this.slides.delete(i);
      if (i !== this.wobbleId) this.writeMatrix(i, i === this.raised ? 0.006 : 0);
    }
    if (this.sinking.length) {
      this.sinking = this.sinking.filter((s) => {
        const t = Math.max(0, (now - s.t0) / s.dur);
        if (t >= 1) { this.mesh.setMatrixAt(s.i, ZERO); this.flyingIds.delete(s.i); this.matrixDirty = true; return false; }
        const e = t * t * (3 - 2 * t);
        const x = s.fx + (s.tx - s.fx) * e, z = s.fz + (s.tz - s.fz) * e;
        // последняя треть — лист уходит под решётку
        const down = t > 0.66 ? (t - 0.66) / 0.34 : 0;
        tmpP.set(x, surfaceHeight(x, z) + s.y - down * 0.08, z);
        tmpE.set(0, s.yaw + t * 0.6, 0); tmpQ.setFromEuler(tmpE);
        const sc = s.s * (1 - 0.6 * down);
        tmpM.compose(tmpP, tmpQ, tmpS.set(sc, sc, sc));
        this.mesh.setMatrixAt(s.i, tmpM);
        this.matrixDirty = true;
        return true;
      });
    }
    // полёт к камере: подъём, кувырок и плавный перелёт к точке перед глазами
    if (this.flying.length) {
      const target = camera.localToWorld(tmpB.copy(EYE_TARGET));
      this.flying = this.flying.filter((fl) => {
        const t = Math.max(0, (now - fl.t0) / fl.dur); // ждущие очереди лежат на месте (t = 0)
        if (t >= 1) { this.mesh.setMatrixAt(fl.i, ZERO); this.matrixDirty = true; this.flyingIds.delete(fl.i); return false; }
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
