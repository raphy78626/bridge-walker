import * as THREE from 'three';

// The scene's lights, which a theme (themes.js) sets: a hemisphere light, a fill from the camera's side, and the sun
// (the moon at night), the only one that ever casts a shadow.
//   .apply(theme)       colours, strengths and the sun's direction, and the tone-mapping exposure
//   .follow(z)          keeps the sun and its shadow box on the walker
//   .setShadows(bool)   the sun's shadow switch (one shader rebuild)
export function createLighting(scene, renderer, { isTV, theme }) {
  // the sky's image-based light does most of the fill now; the hemisphere only lifts the shadows a little
  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(); // sky bounce on the side the camera sees, so the walker stays readable
  fill.position.set(3, 8, 12);
  scene.add(fill);
  const sun = new THREE.DirectionalLight();
  const sunOffset = new THREE.Vector3(); // sun.position relative to the walker: the theme's sun direction * 100
  sun.castShadow = !isTV;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 60, far: 140 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  function apply(t) {
    hemi.color.set(t.hemi.sky);
    hemi.groundColor.set(t.hemi.ground);
    hemi.intensity = t.hemi.intensity;
    fill.color.set(t.fill.color);
    fill.intensity = t.fill.intensity;
    sun.color.set(t.sun.color);
    sun.intensity = t.sun.intensity;
    sunOffset.set(...t.sun.dir).normalize().multiplyScalar(100);
    renderer.toneMappingExposure = t.exposure;
  }
  apply(theme);

  return {
    apply,
    follow(z) {
      sun.position.set(sunOffset.x, sunOffset.y, z + sunOffset.z); // shadow box follows the walker
      sun.target.position.set(0, 0, z);
    },
    // Desktop: shadows are switched through sun.castShadow (one shader rebuild). Clearing renderer.shadowMap.enabled
    // instead would leave the sun's shadow map bound and stamped on the planks, saving nothing.
    setShadows(on) {
      sun.castShadow = on;
    },
  };
}
