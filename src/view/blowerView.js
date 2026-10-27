// Воздуходувка в руках: корпус с мотором справа внизу, труба к соплу у земли перед игроком.
// Видна только когда выбрана. Под струёй — едва заметная трапеция (что захватит струя), во время
// работы по ней бегут светлые штрихи воздуха.

import * as THREE from '../../vendor/three.module.min.js';
import { surfaceHeight } from '../layout.js';
import { BLOWER_STREAM as S } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);
const STREAKS = 24;

export class BlowerView {
  constructor(scene) {
    const orange = new THREE.MeshLambertMaterial({ color: '#d9762b' });
    const dark = new THREE.MeshLambertMaterial({ color: '#2f3134' });
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.3), orange);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 12), dark);
    motor.rotation.z = Math.PI / 2; motor.position.set(0, -0.02, 0.06);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12, Math.PI), dark);
    handle.position.set(0, 0.09, -0.02); handle.rotation.y = Math.PI / 2;
    this.body.add(box, motor, handle);
    this.tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1, 12), orange);
    this.nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 12), dark);
    for (const m of [box, motor, this.tube, this.nozzle]) { m.castShadow = true; m.frustumCulled = false; }
    this.group.add(this.body, this.tube, this.nozzle);
    // трапеция струи на земле
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.zoneMat = new THREE.MeshBasicMaterial({ color: '#fff6dc', transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    this.zone = new THREE.Mesh(geo, this.zoneMat);
    this.zone.frustumCulled = false;
    this.zone.renderOrder = 2;
    this.group.add(this.zone);
    // штрихи воздуха
    this.streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.02, 0.22).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }), STREAKS);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 3;
    this.group.add(this.streaks);
    this.seeds = Array.from({ length: STREAKS }, () => [Math.random(), Math.random() - 0.5]);
    this.group.visible = false;
    scene.add(this.group);
    this.v = [new THREE.Vector3(), new THREE.Vector3()];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3();
  }

  /** p — игрок; st — характеристики (blowerStats); spin — разгон 0…1; now — время для штрихов. */
  update(visible, p, camera, st, spin, now) {
    this.group.visible = visible;
    if (!visible) return;
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw), rx = -dz, rz = dx;
    const hand = camera.localToWorld(this.v[0].set(0.26, -0.4, -0.5));
    this.body.position.copy(hand);
    this.body.rotation.set(0, p.yaw, 0);
    // сопло — у земли чуть перед игроком, с лёгкой дрожью при работе
    const shake = spin * 0.006 * Math.sin(now * 90);
    const tx = p.x + dx * (S.start - 0.05) + rx * 0.12, tz = p.z + dz * (S.start - 0.05) + rz * 0.12;
    const tip = this.v[1].set(tx, surfaceHeight(tx, tz) + 0.12 + shake, tz);
    const from = hand.clone().add(new THREE.Vector3(dx * 0.12, -0.04, dz * 0.12));
    const len = from.distanceTo(tip);
    const dir = tip.clone().sub(from).normalize();
    this.tube.position.copy(from).add(tip).multiplyScalar(0.5);
    this.tube.scale.set(1, len, 1);
    this.tube.quaternion.setFromUnitVectors(UP, dir);
    this.nozzle.position.copy(tip);
    this.nozzle.quaternion.copy(this.tube.quaternion);
    // трапеция: от сопла до конца струи, расширяется
    const a0 = S.start, a1 = S.start + st.range, h0 = st.width / 2, h1 = h0 + st.range * S.spreadK;
    const pos = this.zone.geometry.attributes.position;
    const pt = (k, a, l) => {
      const x = p.x + dx * a + rx * l, z = p.z + dz * a + rz * l;
      pos.setXYZ(k, x, surfaceHeight(x, z) + 0.09, z);
    };
    pt(0, a0, -h0); pt(1, a0, h0); pt(2, a1, h1); pt(3, a1, -h1);
    pos.needsUpdate = true;
    this.zoneMat.opacity = 0.06 + 0.06 * spin;
    // штрихи бегут от сопла и тают к концу струи
    this.streaks.visible = spin > 0.05;
    if (this.streaks.visible) {
      this.seeds.forEach(([ph, side], k) => {
        const u = (ph + now * (0.9 + 0.6 * spin)) % 1, a = a0 + u * st.range, l = side * 2 * (h0 + u * st.range * S.spreadK);
        const x = p.x + dx * a + rx * l, z = p.z + dz * a + rz * l, sc = spin * (1 - u);
        this.e.set(0, p.yaw, 0); this.q.setFromEuler(this.e);
        this.m.compose(this.s.set(x, surfaceHeight(x, z) + 0.06 + u * 0.05, z), this.q, new THREE.Vector3(sc, sc, sc));
        this.streaks.setMatrixAt(k, this.m);
      });
      this.streaks.instanceMatrix.needsUpdate = true;
    }
  }
}
