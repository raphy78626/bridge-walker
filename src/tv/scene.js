import * as THREE from 'three';
import { buildEnvironment } from './environment.js';
import { createAdaptiveQuality } from './adaptiveQuality.js';
import { createCameraRig } from './cameraRig.js';
import { createLighting } from './lighting.js';
import { THEMES } from './themes.js';
import { createWalker } from './walker.js';
import { createWindStreaks } from './windStreaks.js';
import { createWindView } from './windView.js';

const NO_GAPS = [];
// ?tv previews the TV variant (cheaper materials and quality rules) on a desktop browser.
const IS_TV = /SmartTV|Web0S|NetCast|Tizen/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('tv');

// The composer main.js uses: the renderer and the camera, with the parts that each own one job (the environment,
// the lights, the walker, the camera rig, the wind's look) wired together once per frame in render().
// World layout: the walker starts at z = 0 and walks toward -z. x is right, y is up.
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TV }); // MSAA is costly on TV GPUs
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5; // the physical sky is bright; this keeps golden hour from blowing out
  renderer.shadowMap.enabled = !IS_TV; // a TV never has shadows (see quality.js): no shadow code in any shader, no switching
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: this is the soft filter (PCFSoftShadowMap was removed)
  const scene = new THREE.Scene();
  let gapsApplied = null; // the session builds a new gaps array per level, so a reference check says when to rebuild
  let theme = THEMES[0]; // golden: the look the scene is built with; main.js applies the level's theme right away
  const env = buildEnvironment(scene, renderer, { theme, lite: IS_TV }); // sky, fog, rock, bridge, clouds
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  // Wind streaks ride on the camera, so they follow whichever view is active. One mesh, one draw call, hidden when calm.
  const streaks = createWindStreaks();
  camera.add(streaks.mesh);
  scene.add(camera);
  const wind = createWindView();
  const lighting = createLighting(scene, renderer, { isTV: IS_TV, theme });
  const adaptQuality = createAdaptiveQuality(renderer, lighting.setShadows, IS_TV);
  const cameraRig = createCameraRig(camera);
  const walker = createWalker(scene, { isTV: IS_TV });
  // A TV has no developer tools of its own; with `ares-inspect` attached, this handle lets a remote
  // console toggle scene parts and render scale live to find what the TV's GPU struggles with.
  window.__bridge = { THREE, renderer, scene, camera, quality: adaptQuality, setTheme };
  let lastT = null;
  let gameT = 0; // the scene's own clock: it advances by dt, which is 0 while paused, so nothing that moves with it keeps going

  // Re-bakes the look for a theme (themes.js): sky cube and PMREM, fog, lights, the lite rock's vertex lighting,
  // clouds, waterfalls, birds and stars. The bake is a one-off hitch (the sky is 6 cube faces plus PMREM), so main.js
  // calls it on the win screen. The time is logged to the console and the server log.
  function setTheme(next) {
    if (!next || next.id === theme.id) return;
    const t0 = performance.now();
    lighting.apply(next);
    env.setTheme(next);
    renderer.getContext().finish(); // wait for the GPU, so the time below is the real cost, not just the queueing
    const ms = performance.now() - t0;
    console.log(`[theme] ${theme.id} -> ${next.id}: ${ms.toFixed(0)} ms`);
    window.reportToServer?.('theme', `${theme.id} -> ${next.id} ${ms.toFixed(0)} ms`);
    theme = next;
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    render(s, t) {
      const w = s.walker;
      const dt = lastT === null || s.paused ? 0 : Math.min(Math.max(t - lastT, 0), 0.05); // paused: the soldier, streaks and sway hold still
      lastT = t;
      gameT += dt;
      const gaps = s.gaps ?? NO_GAPS;
      if (gaps !== gapsApplied) {
        gapsApplied = gaps;
        env.setGaps(gaps);
      }
      lighting.follow(-w.z);
      env.update(gameT, camera); // clouds, water, birds and the cloth/rope ripple (uWindTime) all stand still in a pause
      wind.update(s, dt); // eases toward what the forecast asks for; the ropes and the streaks follow (no allocation)
      env.setWind(wind.sway);
      walker.setVisible(s.phase !== 'gameover' && cameraRig.mode !== 'pov'); // first person: nothing may block the eye
      walker.update(w, s.phase, s.phaseTime, s.fallCause, s.input, dt, gameT);
      cameraRig.update(walker.focus, wind.sway, dt, gameT);
      streaks.update(dt, wind.opacity, wind.speed, wind.dir, camera); // after the camera's fov is settled for this view
      adaptQuality();
      renderer.render(scene, camera);
    },
    setTheme,
    setCamera: cameraRig.setMode,
    cycleCamera: cameraRig.cycle,
    get camera() {
      return cameraRig.mode;
    },
    get theme() {
      return theme.id;
    },
    get quality() {
      return adaptQuality.describe();
    },
  };
}
