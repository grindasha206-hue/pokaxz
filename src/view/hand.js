// Садовая перчатка внизу экрана. Рисуется отдельным проходом поверх сцены,
// поэтому не проваливается в стены и не перекрывает обзор.

import * as THREE from '../../vendor/three.module.min.js';

// положение ладони в пространстве камеры и направление к локтю (за край экрана)
const REST = new THREE.Vector3(0.27, -0.28, -0.5);
const REACH = new THREE.Vector3(0.11, -0.31, -0.62);
const ARM_REST = new THREE.Vector3(0.38, -0.5, 0.78).normalize();
const ARM_REACH = new THREE.Vector3(0.3, -0.2, 0.93).normalize();
const tmpDir = new THREE.Vector3(), tmpTarget = new THREE.Vector3();

export class Hand {
  constructor(fov) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#e8f0ff', '#9a7a55', 1.6));
    const sun = new THREE.DirectionalLight('#ffe1b5', 2.2);
    sun.position.set(-1, 2, 1.5);
    this.scene.add(sun);

    const glove = new THREE.MeshLambertMaterial({ color: '#d8a24a' });
    const seam = new THREE.MeshLambertMaterial({ color: '#b98535' });
    const cuff = new THREE.MeshLambertMaterial({ color: '#5f8a5b' });
    this.root = new THREE.Group();
    // модель: пальцы к −Z, манжета к +Z, ладонь к +Y (после поворота — вниз)
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), glove);
    palm.scale.set(0.95, 0.42, 1.05);
    this.root.add(palm);
    const knuckles = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.05, 4, 10), glove);
    knuckles.rotation.z = Math.PI / 2;
    knuckles.position.set(0, 0.004, -0.04);
    this.root.add(knuckles);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 16), glove);
    wrist.rotation.x = Math.PI / 2;
    wrist.position.z = 0.06;
    wrist.scale.set(1, 1, 0.72);
    this.root.add(wrist);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.054, 0.11, 18), cuff);
    c.rotation.x = Math.PI / 2;
    c.position.z = 0.135;
    c.scale.set(1, 1, 0.8);
    this.root.add(c);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.007, 6, 22), seam);
    band.position.z = 0.082;
    band.scale.set(1, 0.8, 1);
    this.root.add(band);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.3, 18), new THREE.MeshLambertMaterial({ color: '#8a5a3c' }));
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = 0.33;
    this.root.add(sleeve);
    this.fingers = [];
    const fGeo = new THREE.CapsuleGeometry(0.0125, 0.045, 4, 10);
    fGeo.translate(0, 0.0225 + 0.0125, 0);
    fGeo.rotateX(-Math.PI / 2); // вдоль −Z
    for (let k = 0; k < 4; k++) {
      const pivot = new THREE.Group();
      pivot.position.set(-0.033 + k * 0.022, 0, -0.045);
      pivot.rotation.y = (k - 1.5) * 0.06;
      const f = new THREE.Mesh(fGeo, glove);
      f.scale.z = [0.85, 1.05, 1, 0.78][k];
      pivot.add(f);
      this.root.add(pivot);
      this.fingers.push(pivot);
    }
    const thumbPivot = new THREE.Group();
    thumbPivot.position.set(0.045, 0.006, 0.0);
    const thumb = new THREE.Mesh(fGeo, glove);
    thumb.scale.set(1.15, 1.15, 0.85);
    thumbPivot.add(thumb);
    thumbPivot.rotation.set(0, -0.85, -0.3);
    this.root.add(thumbPivot);
    this.thumb = thumbPivot;
    this.root.scale.setScalar(0.88);
    this.scene.add(this.root);

    this.reach = 0;     // 0..1 — рука тянется к листу
    this.grip = 0;      // 0..1 — пальцы сжаты
    this.pulse = 0;     // короткий «хват» после подбора
    this.walk = 0;
    this.visible = true;
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** Мировая точка ладони (куда летят собранные листья). */
  worldPoint(mainCamera, out) {
    out.copy(this.root.position);
    out.z += 0.05;
    return mainCamera.localToWorld(out);
  }

  update(dt, { picking, progress, walkSpeed }) {
    const targetReach = picking ? Math.min(1, progress * 2.2) : 0;
    this.reach += (targetReach - this.reach) * Math.min(1, dt * 14);
    const targetGrip = picking ? Math.max(0, (progress - 0.55) / 0.45) : 0;
    this.grip += (Math.max(targetGrip, this.pulse) - this.grip) * Math.min(1, dt * 18);
    this.pulse = Math.max(0, this.pulse - dt * 3.5);
    this.walk += dt * walkSpeed * 2.4;
    const bobAmt = Math.min(1, walkSpeed / 3.6) * 0.008;
    this.root.position.lerpVectors(REST, REACH, this.reach);
    this.root.position.x += Math.sin(this.walk) * bobAmt;
    this.root.position.y += Math.abs(Math.cos(this.walk)) * bobAmt;
    // +Z модели смотрит к локтю; пальцы тянутся вперёд и вниз к листу
    tmpDir.lerpVectors(ARM_REST, ARM_REACH, this.reach).normalize();
    this.root.up.set(-0.25, 1, 0).normalize();
    this.root.lookAt(tmpTarget.copy(this.root.position).add(tmpDir));
    this.root.rotateZ(Math.PI + 0.85 - this.reach * 0.5); // тыльной стороной вверх и чуть набок
    this.fingers.forEach((f, k) => { f.rotation.x = 0.32 + k * 0.05 + this.grip * (1.1 + k * 0.08); });
    this.thumb.rotation.x = 0.2 + this.grip * 0.6;
  }

  grabbed() { this.pulse = 1; }

  render(renderer) {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
