// Отрисовка листьев: три формы × два изгиба, инстансинг, подсветка, полёт к руке,
// реакция на шаги и подсветка последних листьев.

import * as THREE from '../../vendor/three.module.min.js';
import { REMAINING_HIGHLIGHT } from '../config.js';
import { ON_GROUND, SHAPES, mulberry32 } from '../leaves.js';
import { surfaceHeight } from '../layout.js';
import { glowTexture } from './textures.js';

export const LEAF_COLORS = ['#e4a62e', '#cc8a2a', '#de6a22', '#a8462b', '#bb3a26', '#ebc24b', '#8f5d2e'];
const LEAF_SIZE = 0.3; // длина листа в метрах при scale = 1

// Контуры листьев в локальной плоскости XZ: черешок к −Z, кончик к +Z, длина ≈ 1.
function outline(shape, n) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2; // 0 — кончик
    let x, z;
    if (shape === 0) {
      // клён: пять заострённых лопастей
      const a = t > Math.PI ? t - Math.PI * 2 : t;
      const lobe = (c, amp, w) => amp * Math.exp(-(((a - c) / w) ** 2));
      let r = 0.2 + lobe(0, 0.38, 0.22) + lobe(1.2, 0.33, 0.24) + lobe(-1.2, 0.33, 0.24)
        + lobe(2.25, 0.2, 0.22) + lobe(-2.25, 0.2, 0.22);
      r += 0.018 * Math.abs(Math.sin(a * 16));
      x = Math.sin(a) * r; z = Math.cos(a) * r + 0.06;
    } else if (shape === 1) {
      // берёза/вяз: овальный, заострённый, с мелкими зубчиками
      const w = 0.3, L = 0.5;
      const c = Math.cos(t);
      x = Math.sin(t) * w * (1 - 0.38 * Math.max(0, c) ** 2) * (1 + 0.035 * Math.sin(t * 22));
      z = c * L;
    } else {
      // дуб: вытянутый, с округлыми лопастями
      const w = 0.24, L = 0.52;
      const c = Math.cos(t);
      x = Math.sin(t) * w * (0.78 + 0.24 * Math.cos(t * 10)) * (1 - 0.2 * Math.max(0, -c));
      z = c * L;
    }
    pts.push([x, z]);
  }
  return pts;
}

function leafGeometry(shape, bend) {
  const n = 72;
  const out = outline(shape, n);
  const cx = 0, cz = shape === 0 ? 0.02 : -0.04;
  const pos = [], col = [], idx = [];
  const bendY = (x, z) => bend === 0
    ? 0.16 * x * x + 0.05 * z * z          // чашечка: края приподняты
    : 0.04 * x * x + 0.22 * Math.max(0, z) ** 2 + 0.08 * Math.max(0, -z) ** 2; // кончик загнут
  const push = (x, z, shadeK) => {
    pos.push(x, bendY(x, z) + 0.002, z);
    col.push(shadeK, shadeK, shadeK);
    return pos.length / 3 - 1;
  };
  const c0 = push(cx, cz, 1.12);
  const rings = [0.45, 0.8, 1];
  const ringIdx = rings.map((s) => out.map(([x, z]) => {
    const px = cx + (x - cx) * s, pz = cz + (z - cz) * s;
    // светлая центральная жилка, чуть темнее к краю
    const vein = Math.exp(-((px / 0.025) ** 2)) * 0.12;
    return push(px, pz, 1.04 - 0.16 * s + vein);
  }));
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    idx.push(c0, ringIdx[0][k2], ringIdx[0][k]);
    for (let r = 0; r < rings.length - 1; r++) {
      const a = ringIdx[r][k], b = ringIdx[r][k2], c = ringIdx[r + 1][k], d = ringIdx[r + 1][k2];
      idx.push(a, b, d, a, d, c);
    }
  }
  // черешок
  const sz0 = shape === 0 ? -0.12 : -0.46, sz1 = sz0 - 0.2;
  const s0 = push(-0.012, sz0, 0.7), s1 = push(0.012, sz0, 0.7), s2 = push(-0.008, sz1, 0.6), s3 = push(0.008, sz1, 0.6);
  idx.push(s0, s1, s3, s0, s3, s2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.scale(LEAF_SIZE, LEAF_SIZE, LEAF_SIZE);
  return geo;
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class LeafView {
  constructor(scene, field) {
    this.field = field;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.geos = [];
    for (let s = 0; s < SHAPES; s++) for (let b = 0; b < 2; b++) this.geos.push(leafGeometry(s, b));
    // раскладка листьев по мешам
    const counts = new Array(this.geos.length).fill(0);
    this.meshOf = new Uint8Array(field.count);
    this.slotOf = new Uint32Array(field.count);
    for (let i = 0; i < field.count; i++) {
      const g = field.shape[i] * 2 + field.bend[i];
      this.meshOf[i] = g; this.slotOf[i] = counts[g]++;
    }
    this.meshes = this.geos.map((geo, g) => {
      const m = new THREE.InstancedMesh(geo, this.material, Math.max(1, counts[g]));
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    });
    this.baseColor = new Float32Array(field.count * 3);
    const rng = mulberry32(field.count + 9);
    for (let i = 0; i < field.count; i++) {
      tmpC.set(LEAF_COLORS[field.color[i]]);
      tmpC.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.08);
      this.baseColor.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    this.hop = new Float32Array(field.count);  // подлёт при пинке
    this.spin = new Float32Array(field.count);
    this.flying = [];                           // листья в полёте к руке
    this.highlighted = new Set();
    this.hoverId = -1;
    this.dirty = new Set();
    for (let i = 0; i < field.count; i++) { this.writeMatrix(i); this.writeColor(i, 1); }
    this.flushAll();

    // кольцо под выбранным листом и точки под захватываемыми
    const ringMat = new THREE.MeshBasicMaterial({ color: '#fff4cf', transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.18, 32).rotateX(-Math.PI / 2), ringMat);
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    scene.add(this.ring);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#fff0c0', transparent: true, opacity: 0.6, depthWrite: false });
    this.dotGeo = new THREE.RingGeometry(0.1, 0.12, 20).rotateX(-Math.PI / 2);
    this.dots = Array.from({ length: 12 }, () => {
      const d = new THREE.Mesh(this.dotGeo, dotMat);
      d.visible = false; d.renderOrder = 2;
      scene.add(d);
      return d;
    });
    // листья, летящие из руки в контейнер при сдаче (только эффект)
    this.fx = new THREE.InstancedMesh(this.geos[0], this.material, 32);
    this.fx.frustumCulled = false;
    this.fx.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < 32; k++) {
      this.fx.setMatrixAt(k, ZERO);
      this.fx.setColorAt(k, tmpC.set(LEAF_COLORS[k % LEAF_COLORS.length]));
    }
    scene.add(this.fx);
    this.fxList = [];
    // свечение над последними листьями
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthTest: false, depthWrite: false, opacity: 0.85 });
    this.glows = Array.from({ length: REMAINING_HIGHLIGHT }, () => {
      const s = new THREE.Sprite(glowMat);
      s.scale.set(0.55, 0.55, 1);
      s.visible = false; s.renderOrder = 3;
      scene.add(s);
      return s;
    });
  }

  writeMatrix(i, extraLift = 0) {
    const f = this.field;
    const mesh = this.meshes[this.meshOf[i]];
    if (f.state[i] !== ON_GROUND) {
      mesh.setMatrixAt(this.slotOf[i], ZERO);
    } else {
      const s = f.scale[i];
      tmpE.set(f.tiltX[i] + this.hop[i] * 2.2, f.yaw[i] + this.spin[i], f.tiltZ[i] - this.hop[i] * 1.6);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(f.x[i], f.y(i) + this.hop[i] + extraLift, f.z[i]);
      tmpS.set(s, s, s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(this.slotOf[i], tmpM);
    }
    this.dirty.add(this.meshOf[i]);
  }

  writeColor(i, k) {
    const b = this.baseColor;
    tmpC.setRGB(Math.min(1, b[i * 3] * k), Math.min(1, b[i * 3 + 1] * k), Math.min(1, b[i * 3 + 2] * k));
    this.meshes[this.meshOf[i]].setColorAt(this.slotOf[i], tmpC);
    this.dirty.add(this.meshOf[i] + 100);
  }

  flushAll() {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.dirty.clear();
  }

  flush() {
    for (const d of this.dirty) {
      if (d >= 100) { const m = this.meshes[d - 100]; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      else this.meshes[d].instanceMatrix.needsUpdate = true;
    }
    this.dirty.clear();
  }

  /** Обновляет все листья (после загрузки или сброса). */
  refreshAll() {
    for (let i = 0; i < this.field.count; i++) this.writeMatrix(i);
    this.flushAll();
  }

  /** Подсветка выбранного листа и тех, что заберёт захват. */
  setHighlight(target, group) {
    const key = `${target}|${group.join(',')}|${this.field.version}`;
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    const next = new Set(group);
    if (target >= 0) next.add(target);
    for (const i of this.highlighted) if (!next.has(i)) this.writeColor(i, 1);
    for (const i of next) this.writeColor(i, i === target ? 1.5 : 1.25);
    this.highlighted = next;
    this.hoverId = target;
    const f = this.field;
    if (target >= 0) {
      this.ring.visible = true;
      this.ring.position.set(f.x[target], f.y(target) + 0.012, f.z[target]);
      this.ring.scale.setScalar(0.8 + f.scale[target] * 0.5);
    } else this.ring.visible = false;
    let d = 0;
    for (const i of group) {
      if (i === target || d >= this.dots.length) continue;
      const dot = this.dots[d++];
      dot.visible = true;
      dot.position.set(f.x[i], f.y(i) + 0.01, f.z[i]);
    }
    for (; d < this.dots.length; d++) this.dots[d].visible = false;
  }

  /** Запускает полёт собранных листьев к руке. */
  flyToHand(ids, now) {
    const f = this.field;
    ids.forEach((i, k) => {
      this.flying.push({
        i, t0: now + k * 0.035, dur: 0.3,
        from: new THREE.Vector3(f.x[i], f.y(i), f.z[i]),
        yaw: f.yaw[i], s: f.scale[i],
        mesh: this.meshOf[i], slot: this.slotOf[i],
      });
      this.writeMatrix(i); // лист в мешке — на земле его больше нет
    });
    // полёт рисуем тем же инстансом поверх скрытого состояния
  }

  /** Короткий поток листьев из руки в контейнер при сдаче. */
  depositBurst(from, to, n, now) {
    const count = Math.min(32, Math.max(3, Math.ceil(n * 0.6)));
    this.fxList = [];
    for (let k = 0; k < count; k++) {
      this.fxList.push({
        k, t0: now + k * 0.025, dur: 0.42 + Math.random() * 0.12,
        from: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1)),
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
    const R = 0.42;
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      const dx = f.x[i] - px, dz = f.z[i] - pz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const k = (1 - d / R) * dt * 1.7;
      const nx = d > 1e-4 ? dx / d : 0, nz = d > 1e-4 ? dz / d : 0;
      f.nudge(i, (vx * 0.55 + nx * speed * 0.6) * k, (vz * 0.55 + nz * speed * 0.6) * k);
      this.hop[i] = Math.min(0.07, this.hop[i] + k * 0.25);
      this.spin[i] += (rng() - 0.5) * k * 6;
      n++;
    }
    return n;
  }

  update(now, dt, handPos, remainingIds) {
    const f = this.field;
    // затухание подлёта
    for (let i = 0; i < f.count; i++) {
      if (this.hop[i] > 0) {
        this.hop[i] = Math.max(0, this.hop[i] - dt * 0.35);
        this.writeMatrix(i);
      }
    }
    // полёт к руке
    this.flying = this.flying.filter((fl) => {
      const mesh = this.meshes[fl.mesh];
      const t = (now - fl.t0) / fl.dur;
      if (t < 0) {
        // ещё не взлетел — держим на месте
        tmpE.set(0, fl.yaw, 0); tmpQ.setFromEuler(tmpE);
        tmpM.compose(fl.from, tmpQ, tmpS.set(fl.s, fl.s, fl.s));
        mesh.setMatrixAt(fl.slot, tmpM);
        this.dirty.add(fl.mesh);
        return true;
      }
      if (t >= 1) {
        mesh.setMatrixAt(fl.slot, ZERO);
        this.dirty.add(fl.mesh);
        return false;
      }
      const e = t * t * (3 - 2 * t);
      tmpP.lerpVectors(fl.from, handPos, e);
      tmpP.y += Math.sin(t * Math.PI) * 0.25;
      tmpE.set(t * 2.5, fl.yaw + t * 4, t * 1.5); tmpQ.setFromEuler(tmpE);
      const s = fl.s * (1 - 0.75 * e);
      tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
      mesh.setMatrixAt(fl.slot, tmpM);
      this.dirty.add(fl.mesh);
      return true;
    });
    // поток в контейнер
    if (this.fxList.length) {
      this.fxList = this.fxList.filter((fx) => {
        const t = Math.max(0, (now - fx.t0) / fx.dur);
        if (t >= 1) { this.fx.setMatrixAt(fx.k, ZERO); return false; }
        tmpP.lerpVectors(fx.from, fx.to, t);
        tmpP.y += Math.sin(t * Math.PI) * 0.7;
        tmpE.set(t * 3 + fx.spin, fx.spin + t * 5, t * 2); tmpQ.setFromEuler(tmpE);
        const s = t < 0.01 ? 0 : 0.55 + 0.25 * Math.sin(t * Math.PI);
        tmpM.compose(tmpP, tmpQ, tmpS.set(s, s, s));
        this.fx.setMatrixAt(fx.k, tmpM);
        return true;
      });
      this.fx.instanceMatrix.needsUpdate = true;
    }
    // последние листья
    let g = 0;
    if (remainingIds) {
      for (const i of remainingIds) {
        if (g >= this.glows.length) break;
        const s = this.glows[g++];
        s.visible = true;
        s.position.set(f.x[i], surfaceHeight(f.x[i], f.z[i]) + 0.32 + Math.sin(now * 2.4 + i) * 0.05, f.z[i]);
      }
    }
    for (; g < this.glows.length; g++) this.glows[g].visible = false;
    this.flush();
  }
}
