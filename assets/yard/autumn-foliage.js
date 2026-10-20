// Подключать в том же проекте Three.js. Не меняет PNG и сохраняет alpha.
// После загрузки glTF: applyAutumnFoliage(gltf.scene, THREE);
export function applyAutumnFoliage(root, THREE, tint = '#c58b32') {
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const transform = (source) => {
      if (!/Leaves/i.test(source.name)) return source;
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
      mat.customProgramCacheKey = () => 'yard-autumn-v1';
      mat.needsUpdate = true;
      return mat;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(transform) : transform(mesh.material);
  });
}
