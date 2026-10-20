// Земля участка: трава, дорожка и детали, а поверх — «подстилка» из-под лежащих листьев.
// Под убранными листьями газон становится свежим, поэтому чистая часть двора
// заметно отличается от неубранной.

import * as THREE from '../../vendor/three.module.min.js';
import { ZONE } from '../config.js';
import { PATH, OBSTACLES } from '../layout.js';
import { ON_GROUND, mulberry32 } from '../leaves.js';
import { canvas, paintGrass, toTexture, shade } from './textures.js';

const PX = 1024;
const W = ZONE.maxX - ZONE.minX, D = ZONE.maxZ - ZONE.minZ;
const sx = (x) => ((x - ZONE.minX) / W) * PX;
const sz = (z) => ((z - ZONE.minZ) / D) * PX;
const m = PX / W; // пикселей на метр

export class Ground {
  constructor(field) {
    this.field = field;
    this.base = canvas(PX);
    this.paintBase(this.base.getContext('2d'));
    this.blob = canvas(64);
    const b = this.blob.getContext('2d');
    const g = b.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(214,190,128,0.55)');
    g.addColorStop(1, 'rgba(214,190,128,0)');
    b.fillStyle = g; b.fillRect(0, 0, 64, 64);
    this.canvas = canvas(PX);
    this.ctx = this.canvas.getContext('2d');
    this.texture = toTexture(this.canvas);
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    const geo = new THREE.PlaneGeometry(W, D);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.texture }));
    this.mesh.position.set((ZONE.minX + ZONE.maxX) / 2, 0, (ZONE.minZ + ZONE.maxZ) / 2);
    this.mesh.receiveShadow = true;
    this.lastVersion = -1;
    this.lastPaint = -Infinity;
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

  /** Перерисовывает подстилку, если листья изменились (не чаще, чем раз в 0,25 с). */
  update(now) {
    if (this.field.version === this.lastVersion) return;
    if (now - this.lastPaint < 0.25) return;
    this.redraw();
    this.lastPaint = now;
  }

  redraw() {
    const ctx = this.ctx, f = this.field;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.base, 0, 0);
    // увядшая, примятая трава под лежащими листьями: мягкие пятна, сливающиеся в скоплениях
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      const r = (0.26 + f.scale[i] * 0.1) * m;
      ctx.drawImage(this.blob, sx(f.x[i]) - r, sz(f.z[i]) - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // мелкий сор: обрывки листьев и веточки
    for (let i = 0; i < f.count; i++) {
      if (f.state[i] !== ON_GROUND) continue;
      ctx.fillStyle = i % 3 ? 'rgba(160,110,50,0.35)' : 'rgba(120,85,45,0.35)';
      const x = sx(f.x[i]) + Math.sin(i * 12.9) * 0.18 * m, y = sz(f.z[i]) + Math.cos(i * 7.3) * 0.18 * m;
      ctx.fillRect(x, y, 2.5, 1.5);
    }
    this.texture.needsUpdate = true;
    this.lastVersion = f.version;
  }
}
