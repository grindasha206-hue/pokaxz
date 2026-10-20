// Готовые ресурсы двора (assets/yard): PBR-материалы Poly Haven и модели Quaternius (CC0).
// Один общий материал на каждый вид поверхности; модели клонируются с общими геометрией
// и материалами. Если файл не загрузился, сцена строится с запасными материалами,
// а ошибка видна в консоли и в assets.errors.

import * as THREE from '../../vendor/three.module.min.js';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';

const BASE = 'assets/yard/';

// размер одного повтора текстуры на поверхности, м (по реальному масштабу рисунка)
const MATERIALS = {
  wood:    { dir: 'oak_wood_planks',  tile: 1.6, normalScale: 0.55 },
  plaster: { dir: 'white_plaster_02', tile: 2.0, normalScale: 0.3 },
  stone:   { dir: 'stone_wall',       tile: 1.6, normalScale: 0.6 },
  roof:    { dir: 'grey_roof_tiles',  tile: 2.0, normalScale: 0.5 },
  grass:   { dir: 'grass_ground',     tile: 2.2, normalScale: 0.3 },
};

const MODELS = {
  tree1: 'models/CommonTree_1.gltf',
  tree3: 'models/CommonTree_3.gltf',
  bush: 'models/Bush_Common.gltf',
};

async function loadMaterial(loader, key, def, aniso) {
  const dir = BASE + 'materials/' + def.dir + '/';
  const [map, normalMap, roughnessMap] = await Promise.all([
    loader.loadAsync(dir + 'color.jpg'),
    loader.loadAsync(dir + 'normal.jpg'),
    loader.loadAsync(dir + 'roughness.jpg'),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;          // цвет — sRGB
  for (const t of [map, normalMap, roughnessMap]) { // normal и roughness — данные, без преобразования
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
  }
  const mat = new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(def.normalScale, def.normalScale),
  });
  mat.name = key;
  mat.userData.tile = def.tile; // для UV в метрах (см. worldUV)
  return mat;
}

export async function loadYardAssets(renderer) {
  const errors = [];
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const mats = {}, models = {};
  await Promise.all([
    ...Object.entries(MATERIALS).map(([k, def]) => loadMaterial(texLoader, k, def, aniso)
      .then((m) => { mats[k] = m; })
      .catch((e) => errors.push(`материал ${def.dir}: ${e?.message || e}`))),
    ...Object.entries(MODELS).map(([k, file]) => gltfLoader.loadAsync(BASE + file)
      .then((g) => { models[k] = prepareModel(g.scene); })
      .catch((e) => errors.push(`модель ${file}: ${e?.message || e}`))),
  ]);
  if (errors.length) console.warn('Ресурсы двора загружены не полностью:', errors);
  // подстройка под стилизованную сцену: штукатурка светлее, газон чуть зеленее и спокойнее,
  // чтобы на нём читались листья (множитель цвета, текстуры не меняются)
  mats.plaster?.color.setRGB(2.5, 2.42, 2.3); // текстура тёмно-серая (≈0,27 в линейном цвете), стены — светлая штукатурка
  mats.grass?.color.setRGB(0.88, 1.06, 0.72);
  mats.stone?.color.setRGB(1.1, 1.05, 0.98);
  // вариант древесины потемнее — для столбов и прожилин (те же текстуры)
  if (mats.wood) {
    mats.darkWood = mats.wood.clone();
    mats.darkWood.color.set('#8a7564');
    mats.darkWood.userData.tile = mats.wood.userData.tile;
  }
  return { mats, models, errors };
}

function prepareModel(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}

// ── осенняя окраска листвы ───────────────────────────────────
// По мотивам assets/yard/autumn-foliage.js: оттенок только для материалов Leaves*, кора
// не меняется, прозрачность сохраняется. Материал создаётся один раз на пару (исходник, оттенок).
const autumnCache = new Map();
function autumnMaterial(source, tint) {
  if (!/Leaves/i.test(source.name)) return source;
  const key = source.uuid + tint;
  if (autumnCache.has(key)) return autumnCache.get(key);
  const mat = source.clone();
  const color = new THREE.Color(tint);
  mat.color.set(0xffffff);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.autumnTint = { value: color };
    shader.fragmentShader = 'uniform vec3 autumnTint;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float leafLight = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      leafLight = clamp(0.68 + leafLight * 0.6, 0.0, 1.0);
      diffuseColor.rgb = autumnTint * leafLight;
    `);
  };
  mat.customProgramCacheKey = () => 'yard-autumn-' + tint;
  autumnCache.set(key, mat);
  return mat;
}

/**
 * Ставит копию модели: высота нормализуется по bounding box до height метров,
 * основание — на землю, листва окрашивается в tint (null — без изменений).
 */
export function placeModel(scene, model, { x, z, height, tint = null, rotY = 0 }) {
  const obj = model.clone(); // геометрия и материалы общие
  if (tint) obj.traverse((o) => {
    if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => autumnMaterial(m, tint)) : autumnMaterial(o.material, tint);
  });
  const box = new THREE.Box3().setFromObject(model);
  const k = height / (box.max.y - box.min.y);
  obj.scale.setScalar(k);
  obj.rotation.y = rotY;
  obj.position.set(x, -box.min.y * k - 0.03, z); // корни чуть в земле
  scene.add(obj);
  return obj;
}

/**
 * UV в метрах для коробок и выдавленных фигур: по каждой вершине берём две оси,
 * перпендикулярные нормали, и делим на размер повтора. Так текстура не растягивается
 * на большие стены и одинакова по масштабу на всех объектах с общим материалом.
 */
export function worldUV(geo, tile, scale = new THREE.Vector3(1, 1, 1)) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  if (!p || !n) return geo;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * scale.x, y = p.getY(i) * scale.y, z = p.getZ(i) * scale.z;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = x; v = z; }      // горизонтальная грань
    else if (ax >= az) { u = z; v = y; }             // грань вдоль X
    else { u = x; v = y; }                           // грань вдоль Z
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
