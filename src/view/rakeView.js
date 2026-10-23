// Грабли в руках: черенок от рук к голове на земле, голова с зубьями поперёк взгляда.
// Видны только когда выбраны. Под головой — едва заметная полоса, которую захватит взмах.

import * as THREE from '../../vendor/three.module.min.js';
import { surfaceHeight } from '../layout.js';
import { RAKE_STROKE } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);

export class RakeView {
  constructor(scene) {
    const wood = new THREE.MeshLambertMaterial({ color: '#a37a4c' });
    const metal = new THREE.MeshLambertMaterial({ color: '#5c6166' });
    this.group = new THREE.Group();
    this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 1, 8), wood);
    this.head = new THREE.Group();
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.025, 0.035), metal);
    this.bar.position.y = 0.06;
    this.head.add(this.bar);
    this.tineGeo = new THREE.BoxGeometry(0.008, 0.075, 0.008).translate(0, 0.028, 0.01);
    this.tines = new THREE.InstancedMesh(this.tineGeo, metal, 40);
    this.head.add(this.tines);
    for (const m of [this.handle, this.bar, this.tines]) { m.castShadow = true; m.frustumCulled = false; }
    this.group.add(this.handle, this.head);
    // полоса захвата
    this.strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#fff6dc', transparent: true, opacity: 0.1, depthWrite: false }));
    this.strip.renderOrder = 2;
    this.group.add(this.strip);
    this.group.visible = false;
    scene.add(this.group);
    this.width = 0;
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
  }

  setWidth(w) {
    if (w === this.width) return;
    this.width = w;
    this.bar.scale.x = w;
    const n = Math.min(40, Math.round(w / 0.045));
    const m = new THREE.Matrix4();
    for (let k = 0; k < 40; k++) {
      m.makeTranslation(k < n ? -w / 2 + (k + 0.5) * w / n : 0, 0, 0);
      if (k >= n) m.makeScale(0, 0, 0);
      this.tines.setMatrixAt(k, m);
    }
    this.tines.instanceMatrix.needsUpdate = true;
  }

  /**
   * p — игрок {x, z, yaw}; d — расстояние головы от игрока; lift — подъём головы (возврат);
   * span — {start, end} следующего взмаха (для полосы); camera — для точки рук.
   */
  update(visible, p, camera, d, lift, span) {
    this.group.visible = visible;
    if (!visible) return;
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    const hx = p.x + dx * d, hz = p.z + dz * d;
    const hy = surfaceHeight(hx, hz) + lift;
    this.head.position.set(hx, hy, hz);
    this.head.rotation.set(0, p.yaw, 0);
    // руки — справа внизу перед камерой
    const hand = camera.localToWorld(this.tmpA.set(0.2, -0.42, -0.28));
    const top = this.tmpB.set(hx, hy + 0.07, hz);
    const len = hand.distanceTo(top);
    this.handle.position.copy(hand).add(top).multiplyScalar(0.5);
    this.handle.scale.set(1, len, 1);
    this.handle.quaternion.setFromUnitVectors(UP, top.sub(hand).normalize());
    // полоса: от точки чуть дальше головы до конца протяжки
    const a0 = span.end, a1 = span.start + RAKE_STROKE.reach, mid = (a0 + a1) / 2;
    const sx = p.x + dx * mid, sz = p.z + dz * mid;
    this.strip.position.set(sx, surfaceHeight(sx, sz) + 0.09, sz);
    this.strip.rotation.set(0, p.yaw, 0);
    this.strip.scale.set(this.width, 1, a1 - a0);
  }
}
