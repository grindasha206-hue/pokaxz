// Земля участка: трава, дорожка и детали (клевер, цветы, камни) — открываются после уборки.
// Круглых теней под листьями нет: глубину слоя даёт затенение нижних листьев.

import * as THREE from '../../vendor/three.module.min.js';
import { ZONE } from '../config.js';
import { PATH, OBSTACLES } from '../layout.js';
import { mulberry32 } from '../leaves.js';
import { canvas, paintGrass, toTexture, shade } from './textures.js';
import { worldUV } from './yardAssets.js';

const PX = 1024;
const W = ZONE.maxX - ZONE.minX, D = ZONE.maxZ - ZONE.minZ;
const sx = (x) => ((x - ZONE.minX) / W) * PX;
const sz = (z) => ((z - ZONE.minZ) / D) * PX;
const m = PX / W; // пикселей на метр

export class Ground {
  /** grass — готовый материал газона (assets/yard); без него — нарисованная земля целиком. */
  constructor(field, grass = null) {
    this.field = field;
    if (grass) { this.buildWithMaterial(grass); return; }
    this.base = canvas(PX);
    this.paintBase(this.base.getContext('2d'));
    this.canvas = canvas(PX);
    this.ctx = this.canvas.getContext('2d');
    this.texture = toTexture(this.canvas);
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    const geo = new THREE.PlaneGeometry(W, D);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.texture }));
    this.mesh.position.set((ZONE.minX + ZONE.maxX) / 2, 0, (ZONE.minZ + ZONE.maxZ) / 2);
    this.mesh.receiveShadow = true;
    this.redraw();
  }

  paintBase(ctx) {
    const rng = mulberry32(77);
    paintGrass(ctx, 0, 0, PX, PX, 9, 1);
    // мелкие цветы и клевер — открываются после уборки
    for (let i = 0; i < 260; i++) {
      const x = rng() * PX, y = rng() * PX;
      const kind = rng();
      if (kind < 0.55) {
        ctx.fillStyle = 'rgba(96,130,62,0.7)';
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 2, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        ctx.fillStyle = kind < 0.8 ? '#f3efe2' : kind < 0.92 ? '#c9a9d8' : '#f1d36a';
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8b93c';
        ctx.beginPath(); ctx.arc(x, y, 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // земля под грядкой и вокруг бочки
    for (const o of OBSTACLES) {
      if (o.id === 'bed') {
        ctx.fillStyle = '#6b5039';
        ctx.fillRect(sx(o.x0) - 6, sz(o.z0) - 6, (o.x1 - o.x0) * m + 12, (o.z1 - o.z0) * m + 12);
      }
    }
    // плитка дорожки
    const x0 = sx(PATH.x0), x1 = sx(PATH.x1);
    ctx.fillStyle = '#b9ae98';
    ctx.fillRect(x0 - 3, sz(PATH.z0), x1 - x0 + 6, sz(PATH.z1) - sz(PATH.z0));
    const tile = 0.5 * m;
    let row = 0;
    for (let y = sz(PATH.z0); y < sz(PATH.z1); y += tile, row++) {
      const off = (row % 2) * tile * 0.5;
      for (let x = x0 - off; x < x1; x += tile) {
        const l = Math.max(x, x0), r = Math.min(x + tile, x1);
        if (r - l < 4) continue;
        ctx.fillStyle = shade('#d6cdb8', (rng() - 0.5) * 22);
        ctx.beginPath(); ctx.roundRect(l + 1.5, y + 1.5, r - l - 3, tile - 3, 4); ctx.fill();
      }
    }
    // кромка дорожки
    ctx.fillStyle = 'rgba(70,80,40,0.35)';
    ctx.fillRect(x0 - 4, sz(PATH.z0), 2, sz(PATH.z1) - sz(PATH.z0));
    ctx.fillRect(x1 + 2, sz(PATH.z0), 2, sz(PATH.z1) - sz(PATH.z0));
    // шаговые камни к скамейке
    const stones = [[1.5, -4.6], [2.4, -4.4], [3.3, -4.65], [4.2, -4.45]];
    for (const [x, z] of stones) {
      ctx.fillStyle = shade('#cfc5b0', (rng() - 0.5) * 18);
      ctx.beginPath(); ctx.ellipse(sx(x), sz(z), 0.27 * m, 0.21 * m, rng() * 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(80,70,50,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  /** Газон — готовый PBR-материал с повтором по метрам; дорожка — отдельная плитка поверх. */
  buildWithMaterial(grass) {
    const geo = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2);
    worldUV(geo, grass.userData.tile);
    this.mesh = new THREE.Mesh(geo, grass);
    this.mesh.position.set((ZONE.minX + ZONE.maxX) / 2, 0, (ZONE.minZ + ZONE.maxZ) / 2);
    this.mesh.receiveShadow = true;
    // плитка дорожки: тонкий слой на 1 мм выше газона (листья лежат выше, от 2,5 мм)
    const pw = PATH.x1 - PATH.x0 + 0.08, pl = PATH.z1 - PATH.z0;
    const ppm = 96, c = canvas(Math.round(pw * ppm), Math.round(pl * ppm)), ctx = c.getContext('2d');
    const rng = mulberry32(78);
    ctx.fillStyle = '#9d9583'; ctx.fillRect(0, 0, c.width, c.height);
    const tile = 0.5 * ppm;
    let row = 0;
    for (let y = 0; y < c.height; y += tile, row++) {
      const off = (row % 2) * tile * 0.5;
      for (let x = -off; x < c.width; x += tile) {
        const l = Math.max(x, 2), r = Math.min(x + tile, c.width - 2);
        if (r - l < 6) continue;
        ctx.fillStyle = shade('#c9c0ab', (rng() - 0.5) * 20);
        ctx.beginPath(); ctx.roundRect(l + 2, y + 2, r - l - 4, tile - 4, 5); ctx.fill();
        // лёгкая неоднородность камня
        for (let k = 0; k < 14; k++) {
          ctx.fillStyle = `rgba(${rng() < 0.5 ? '120,110,95' : '220,212,196'},0.18)`;
          ctx.beginPath(); ctx.arc(l + rng() * (r - l), y + rng() * tile, 1 + rng() * 4, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    const path = new THREE.Mesh(new THREE.PlaneGeometry(pw, pl).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    path.position.set((PATH.x0 + PATH.x1) / 2 - this.mesh.position.x, 0.001, (PATH.z0 + PATH.z1) / 2 - this.mesh.position.z);
    path.receiveShadow = true;
    this.mesh.add(path);
  }

  update() { /* земля статична */ }

  redraw() {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.base, 0, 0);
    this.texture.needsUpdate = true;
  }
}
