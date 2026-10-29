import * as THREE from 'three';
import { buildEnvironment } from './environment.js';
import { nextQuality, TV_QUALITY } from './quality.js';
import { createWalker } from './walker.js';
import { THEMES } from './themes.js';
import { BRIDGE_LENGTH } from '../game/session.js';
import { createWindStreaks } from './windStreaks.js';
import { CALM, easeToward, forecastOf, streakOpacity, streakSpeed, windSway } from './windFx.js';
import { CAMERA_FOV, DEFAULT_CAMERA, createCinematic, isCameraMode, nextCamera, povCamera, stepRate } from './cameras.js';

const NO_GAPS = [];
const GAP_FALL_SWING = 0.7; // seconds for the camera to swing over a gap the walker is falling through
const p01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const CAMERA_Y_FOLLOW = 0.3; // the camera rises this fraction of the walker's jump height
const POV_FALL_BLEND = 0.2; // seconds for the first-person camera to hand over to the walker's tumble
// ?tv previews the TV variant (cheaper materials and quality rules) on a desktop browser.
const IS_TV = /SmartTV|Web0S|NetCast|Tizen/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('tv');

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
  // The smoothed look of the wind: the forecast flips between states, the picture eases between them.
  let windOpacity = 0;
  let windSpeed = 0;
  let windSwayNow = 0;
  let windDir = 1; // the last gust's direction, held while the streaks fade out

  // the sky's image-based light does most of the fill now; the hemisphere only lifts the shadows a little
  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(); // sky bounce on the side the camera sees, so the walker stays readable
  fill.position.set(3, 8, 12);
  scene.add(fill);
  const sun = new THREE.DirectionalLight();
  const sunOffset = new THREE.Vector3(); // sun.position relative to the walker: the theme's sun direction * 100
  sun.castShadow = !IS_TV;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 60, far: 140 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  applyLights(theme);
  // Desktop: shadows are switched through sun.castShadow (one shader rebuild). Clearing renderer.shadowMap.enabled
  // instead would leave the sun's shadow map bound and stamped on the planks, saving nothing.
  const adaptQuality = createAdaptiveQuality(renderer, (on) => (sun.castShadow = on));

  function applyLights(t) {
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

  // Re-bakes the look for a theme (themes.js): sky cube and PMREM, fog, lights, the lite rock's vertex lighting,
  // clouds, waterfalls, birds and stars. The bake is a one-off hitch (the sky is 6 cube faces plus PMREM), so main.js
  // calls it on the win screen. The time is logged to the console and the server log.
  function setTheme(next) {
    if (!next || next.id === theme.id) return;
    const t0 = performance.now();
    applyLights(next);
    env.setTheme(next);
    renderer.getContext().finish(); // wait for the GPU, so the time below is the real cost, not just the queueing
    const ms = performance.now() - t0;
    console.log(`[theme] ${theme.id} -> ${next.id}: ${ms.toFixed(0)} ms`);
    window.reportToServer?.('theme', `${theme.id} -> ${next.id} ${ms.toFixed(0)} ms`);
    theme = next;
  }

  // Camera views (cameras.js): chase | pov | cinematic. The choice stays across levels and respawns.
  let camMode = DEFAULT_CAMERA;
  let camShown = null; // the view the camera is currently set up for (fov, walker visibility, the cinematic's smoothing)
  let bobPhase = 0;
  const cinematic = createCinematic(BRIDGE_LENGTH);
  const qNormal = new THREE.Quaternion();
  const qFall = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const eulerPov = new THREE.Euler(0, 0, 0, 'YXZ'); // yaw, pitch, then roll about the view axis
  const eyeFall = new THREE.Vector3();
  function setCamera(mode) {
    if (isCameraMode(mode)) camMode = mode;
    return camMode;
  }

  const walker = createWalker(scene, { isTV: IS_TV });
  // A TV has no developer tools of its own; with `ares-inspect` attached, this handle lets a remote
  // console toggle scene parts and render scale live to find what the TV's GPU struggles with.
  window.__bridge = { THREE, renderer, scene, camera, quality: adaptQuality, setTheme };
  let lastT = null;
  let gameT = 0; // the scene's own clock: it advances by dt, which is 0 while paused, so nothing that moves with it keeps going

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // First person: the eye at the soldier's head, rolling with his lean (cameras.js). In a fall the camera is his head:
  // it takes his tumble (position and orientation) after a short hand-over, and drops with him into the clouds.
  function povView(w, s, speed, dt) {
    const pivot = walker.pivot;
    bobPhase = (bobPhase + 2 * Math.PI * stepRate(speed) * dt) % (4 * Math.PI); // 4 PI: the half-rate sway repeats too
    const pose = walker.focus.pose;
    const v = povCamera(w, bobPhase, pose ?? undefined);
    camera.position.set(v.x, v.y, v.z);
    eulerPov.set(v.pitch, 0, v.roll);
    camera.quaternion.setFromEuler(eulerPov);
    if (s.phase === 'falling') {
      const k = smooth(p01(s.phaseTime / POV_FALL_BLEND));
      eyeFall.set(0, 1.65, 0).applyQuaternion(pivot.quaternion).add(pivot.position);
      qPitch.setFromEuler(eulerPov.set(v.pitch, 0, 0));
      qFall.copy(pivot.quaternion).multiply(qPitch);
      qNormal.copy(camera.quaternion);
      camera.quaternion.copy(qNormal.slerp(qFall, k));
      camera.position.lerp(eyeFall, k);
    }
  }

  return {
    render(s, t) {
      const pivot = walker.pivot;
      const w = s.walker;
      const z = -w.z;
      const dt = lastT === null || s.paused ? 0 : Math.min(Math.max(t - lastT, 0), 0.05); // paused: the soldier, streaks and sway hold still
      lastT = t;
      gameT += dt;
      const gaps = s.gaps ?? NO_GAPS;
      if (gaps !== gapsApplied) {
        gapsApplied = gaps;
        env.setGaps(gaps);
      }
      sun.position.set(sunOffset.x, sunOffset.y, z + sunOffset.z); // shadow box follows the walker
      env.update(gameT, camera); // clouds, water, birds and the cloth/rope ripple (uWindTime) all stand still in a pause
      // Wind: ease toward what the forecast asks for, then hand it to the ropes and the streaks (no allocation here).
      const f = forecastOf(s);
      const calm = f === CALM || f.state === 'calm';
      windOpacity = easeToward(windOpacity, streakOpacity(f), dt, calm ? 3 : 6);
      windSpeed = easeToward(windSpeed, streakSpeed(f), dt, calm ? 2 : 4);
      windSwayNow = easeToward(windSwayNow, windSway(f), dt, calm ? 2.5 : 5);
      if (f.dir) windDir = f.dir > 0 ? 1 : -1;
      env.setWind(windSwayNow);
      sun.target.position.set(0, 0, z);
      walker.setVisible(s.phase !== 'gameover' && camMode !== 'pov'); // first person: nothing may block the eye
      walker.update(w, s.phase, s.phaseTime, s.fallCause, s.input, dt, gameT);
      const lift = w.y ?? 0;
      const { speed, falling, gapFall } = walker.focus;
      if (camMode !== camShown) {
        camShown = camMode;
        camera.fov = CAMERA_FOV[camMode];
        camera.updateProjectionMatrix();
        cinematic.reset(); // a new angle starts where it should be, not gliding in from the last one
      }
      if (camMode === 'pov') {
        povView(w, s, speed, dt);
      } else if (camMode === 'cinematic') {
        const c = cinematic.update(w, pivot.position.y, falling, dt);
        camera.position.set(c.x, c.y, c.z);
        camera.lookAt(c.lx, c.ly, c.lz);
      } else if (gapFall) {
        // From the usual spot behind him the deck would hide the drop, so the camera swings up over the
        // hole and looks steeply down through it after him, into the clouds.
        const k = smooth(p01(s.phaseTime / GAP_FALL_SWING));
        camera.position.set(0, 2.4 + 2.0 * k, z + 5 - 4.2 * k);
        camera.lookAt(0, pivot.position.y + 1, z - 0.5 * k);
      } else {
        camera.position.set(w.lean * 0.6, 2.4 + CAMERA_Y_FOLLOW * lift, z + 5);
        if (!falling && windSwayNow * windSwayNow > 0.25) {
          // a strong gust buffets the chase camera a little: tiny, and only above half strength
          const shake = (Math.abs(windSwayNow) - 0.5) * 0.06;
          camera.position.x += Math.sin(gameT * 37) * shake;
          camera.position.y += Math.sin(gameT * 29 + 1) * shake * 0.6;
        }
        if (falling) {
          camera.lookAt(pivot.position.x, pivot.position.y + 1, z - 1); // watch him drop into the clouds
        } else {
          camera.lookAt(0, 1.1 + CAMERA_Y_FOLLOW * lift, z - 8);
        }
      }
      streaks.update(dt, windOpacity, windSpeed, windDir, camera); // after the camera's fov is settled for this view
      adaptQuality();
      renderer.render(scene, camera);
    },
    setTheme,
    setCamera,
    // chase -> pov -> cinematic -> chase; returns the new view's id
    cycleCamera: () => setCamera(nextCamera(camMode)),
    get camera() {
      return camMode;
    },
    get theme() {
      return theme.id;
    },
    get quality() {
      return adaptQuality.describe();
    },
  };
}

// TV GPUs vary wildly. Every 2 s, trade resolution (and then shadows) for a smooth frame rate,
// and win them back when there is headroom. The rules live in quality.js.
function createAdaptiveQuality(renderer, setShadows) {
  const options = IS_TV ? TV_QUALITY : { maxScale: Math.min(window.devicePixelRatio, 1.5) };
  let state = { scale: Math.min(IS_TV ? TV_QUALITY.startScale : 1, options.maxScale), shadows: !IS_TV, goodStreak: 0 };
  let frames = 0;
  // Ignore the first seconds: loading the model, textures and sounds and compiling shaders stalls a TV
  // to ~11 fps for about 8 s, which would otherwise knock it straight down to the floor with shadows off.
  let since = performance.now() + 10000;
  renderer.setPixelRatio(state.scale);
  function adapt() {
    if (adapt.paused) return; // set during remote profiling
    const now = performance.now();
    if (now < since) return;
    frames += 1;
    if (now - since < 2000) return;
    const fps = (frames * 1000) / (now - since);
    frames = 0;
    since = now;
    const next = nextQuality(fps, state, options);
    // setPixelRatio reallocates the drawing buffer, and a shadow switch rebuilds shaders: only when it changed.
    if (next.scale !== state.scale) renderer.setPixelRatio(next.scale);
    if (next.shadows !== state.shadows) setShadows(next.shadows);
    state = next;
  }
  adapt.describe = () => `scale=${state.scale.toFixed(1)} shadows=${state.shadows}`;
  return adapt;
}
