import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FALL_ANGLE, WALK_SPEED } from '../game/balance.js';
import { buildEnvironment } from './environment.js';
import { nextQuality, TV_QUALITY } from './quality.js';
import { stepGait, clipTimeScale, WALK_ABOVE, WALK_STRIDE, RUN_STRIDE } from './gait.js';
import { jumpPose, createPose, POSE_BONES } from './jumpPose.js';
import { THEMES } from './themes.js';
import { BRIDGE_LENGTH } from '../game/session.js';
import { CAMERA_FOV, DEFAULT_CAMERA, createCinematic, isCameraMode, nextCamera, povCamera, stepRate } from './cameras.js';

const NO_GAPS = [];
const GAP_FALL_SWING = 0.7; // seconds for the camera to swing over a gap the walker is falling through
const p01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const CAMERA_Y_FOLLOW = 0.3; // the camera rises this fraction of the walker's jump height
const SOLDIER_URL = '/models/Soldier.glb';
const ARM_WEIGHT = 1.2; // vs 1 for walk/idle: arms end up ~55% of the way to the T-pose (~50 deg out)
const ARM_TRACKS = /^mixamorig:?(Left|Right)(Shoulder|Arm|ForeArm)\.quaternion$/;
const POV_FALL_BLEND = 0.2; // seconds for the first-person camera to hand over to the walker's tumble
// ?tv previews the TV variant (cheaper materials and quality rules) on a desktop browser.
const IS_TV = /SmartTV|Web0S|NetCast|Tizen/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('tv');

// World layout: the walker starts at z = 0 and walks toward -z. x is right, y is up.
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TV }); // MSAA is costly on TV GPUs
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5; // the physical sky is bright; this keeps golden hour from blowing out
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: this is the soft filter (PCFSoftShadowMap was removed)
  const scene = new THREE.Scene();
  let gapsApplied = null; // the session builds a new gaps array per level, so a reference check says when to rebuild
  let theme = THEMES[0]; // golden: the look the scene is built with; main.js applies the level's theme right away
  const env = buildEnvironment(scene, renderer, { theme, lite: IS_TV }); // sky, fog, rock, bridge, clouds
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

  // the sky's image-based light does most of the fill now; the hemisphere only lifts the shadows a little
  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(); // sky bounce on the side the camera sees, so the walker stays readable
  fill.position.set(3, 8, 12);
  scene.add(fill);
  const sun = new THREE.DirectionalLight();
  const sunOffset = new THREE.Vector3(); // sun.position relative to the walker: the theme's sun direction * 100
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 60, far: 140 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  applyLights(theme);
  // Shadows are switched through sun.castShadow (one shader rebuild). Clearing renderer.shadowMap.enabled
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

  const walker = buildWalker();
  walker.name = 'walker';
  scene.add(walker);
  // A TV has no developer tools of its own; with `ares-inspect` attached, this handle lets a remote
  // console toggle scene parts and render scale live to find what the TV's GPU struggles with.
  window.__bridge = { THREE, renderer, scene, camera, quality: adaptQuality, setTheme };
  let rig = null; // set once the Soldier model has loaded
  loadSoldier(walker, (r) => (rig = r));
  let lastT = null;

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
    bobPhase = (bobPhase + 2 * Math.PI * stepRate(speed) * dt) % (4 * Math.PI); // 4 PI: the half-rate sway repeats too
    const pose = rig ? rig.pose : null;
    const v = povCamera(w, bobPhase, pose ?? undefined);
    camera.position.set(v.x, v.y, v.z);
    eulerPov.set(v.pitch, 0, v.roll);
    camera.quaternion.setFromEuler(eulerPov);
    if (s.phase === 'falling') {
      const k = smooth(p01(s.phaseTime / POV_FALL_BLEND));
      eyeFall.set(0, 1.65, 0).applyQuaternion(walker.quaternion).add(walker.position);
      qPitch.setFromEuler(eulerPov.set(v.pitch, 0, 0));
      qFall.copy(walker.quaternion).multiply(qPitch);
      qNormal.copy(camera.quaternion);
      camera.quaternion.copy(qNormal.slerp(qFall, k));
      camera.position.lerp(eyeFall, k);
    }
  }

  return {
    render(s, t) {
      const w = s.walker;
      const z = -w.z;
      const dt = lastT === null ? 0 : Math.min(Math.max(t - lastT, 0), 0.05);
      lastT = t;
      const gaps = s.gaps ?? NO_GAPS;
      if (gaps !== gapsApplied) {
        gapsApplied = gaps;
        env.setGaps(gaps);
      }
      sun.position.set(sunOffset.x, sunOffset.y, z + sunOffset.z); // shadow box follows the walker
      env.update(t, camera);
      sun.target.position.set(0, 0, z);
      walker.visible = s.phase !== 'gameover' && camMode !== 'pov'; // first person: nothing may block the eye
      const lift = w.y ?? 0; // height above the planks (a jump)
      walker.position.set(0, lift, z);
      walker.rotation.set(0, 0, -w.lean); // positive lean = leaning right
      const playing = s.phase === 'playing';
      const falling = s.phase === 'falling';
      const speed = playing ? w.speed ?? (s.input.walking ? WALK_SPEED : 0) : 0;
      const airborne = playing && !!w.airborne;
      if (speed > WALK_ABOVE && !rig && !airborne) {
        walker.position.y = lift + 0.06 * Math.abs(Math.sin(t * 9)); // footstep bob (the real clip moves the body itself)
      }
      if (rig) {
        rig.update({ speed, falling, airborne, vy: w.vy ?? 0, fallTime: s.phaseTime }, dt);
        // The jump's lean forward and the landing dip, both from the pose so they move with the bones.
        walker.position.y += rig.pose.pivotY;
        walker.rotation.x = -rig.pose.pitch;
      }
      const gapFall = falling && s.fallCause === 'gap';
      if (falling) {
        const p = s.phaseTime;
        walker.position.y = lift - 4.9 * p * p;
        if (gapFall) {
          // straight down through the gap, tipping a little forward
          walker.rotation.x = -Math.min(0.4, p * 0.5);
        } else {
          const dir = Math.sign(w.lean) || 1;
          walker.position.x = dir * p * 1.8;
          walker.rotation.z = -dir * (FALL_ANGLE + p * 2.5);
        }
      }
      if (camMode !== camShown) {
        camShown = camMode;
        camera.fov = CAMERA_FOV[camMode];
        camera.updateProjectionMatrix();
        cinematic.reset(); // a new angle starts where it should be, not gliding in from the last one
      }
      if (camMode === 'pov') {
        povView(w, s, speed, dt);
      } else if (camMode === 'cinematic') {
        const c = cinematic.update(w, walker.position.y, falling, dt);
        camera.position.set(c.x, c.y, c.z);
        camera.lookAt(c.lx, c.ly, c.lz);
      } else if (gapFall) {
        // From the usual spot behind him the deck would hide the drop, so the camera swings up over the
        // hole and looks steeply down through it after him, into the clouds.
        const k = smooth(p01(s.phaseTime / GAP_FALL_SWING));
        camera.position.set(0, 2.4 + 2.0 * k, z + 5 - 4.2 * k);
        camera.lookAt(0, walker.position.y + 1, z - 0.5 * k);
      } else {
        camera.position.set(w.lean * 0.6, 2.4 + CAMERA_Y_FOLLOW * lift, z + 5);
        if (falling) {
          camera.lookAt(walker.position.x, walker.position.y + 1, z - 1); // watch him drop into the clouds
        } else {
          camera.lookAt(0, 1.1 + CAMERA_Y_FOLLOW * lift, z - 8);
        }
      }
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
  let state = { scale: Math.min(IS_TV ? TV_QUALITY.startScale : 1, options.maxScale), shadows: true, goodStreak: 0 };
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

// Simple figure with arms out for balance. The group's origin is at the feet so it pivots there.
function buildWalker() {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x4a5560 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9946b });
  const packCloth = new THREE.MeshStandardMaterial({ color: 0x4f5a3a });
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), cloth);
  legs.position.y = 0.55;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 8), cloth);
  torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 1.78;
  const arms = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.5, 4, 6), skin);
  arms.rotation.z = Math.PI / 2;
  arms.position.y = 1.45;
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.22), packCloth);
  backpack.position.set(0, 1.3, 0.24); // +z faces the camera, so the pack is visible from behind
  g.add(legs, torso, head, arms, backpack);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

// Swaps the Soldier (skinned, animated) into the pivot once loaded; the primitive stays on any failure.
function loadSoldier(pivot, onReady) {
  new GLTFLoader().load(
    SOLDIER_URL,
    (gltf) => {
      const model = gltf.scene;
      // The Mixamo Soldier already faces -z (away from our camera), so no turn is needed.
      model.traverse((o) => {
        if (o.isSkinnedMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
      const rig = buildRig(model, gltf.animations); // may throw: do it before touching the placeholder
      pivot.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      pivot.clear();
      pivot.add(model);
      onReady(rig);
    },
    undefined,
    (err) => console.warn('Soldier model failed to load, keeping the placeholder figure', err),
  );
}

// One mixer: Idle/Walk/Run blended by speed, an arms-out layer taken from the T-pose, and the procedural
// jump / landing / falling pose from jumpPose.js laid over the bones afterwards.
function buildRig(model, clips) {
  const mixer = new THREE.AnimationMixer(model);
  const clip = (name) => THREE.AnimationClip.findByName(clips, name);
  const idle = mixer.clipAction(clip('Idle'));
  const walk = mixer.clipAction(clip('Walk'));
  const run = mixer.clipAction(clip('Run'));
  const tpose = clip('TPose');
  const armsClip = new THREE.AnimationClip('Arms', tpose.duration, tpose.tracks.filter((tr) => ARM_TRACKS.test(tr.name)));
  const arms = mixer.clipAction(armsClip);
  idle.play();
  walk.play(); // all clips always run so their times never restart; only the weights move
  run.play();
  walk.weight = 0;
  run.weight = 0;
  arms.setEffectiveWeight(ARM_WEIGHT).play();

  // Bones are looked up once; a bone the model lacks is simply skipped. The jump pose is blended toward
  // bind * Euler (the bind pose is the T-pose, whose local axes are what jumpPose.js describes).
  const pose = createPose();
  const driven = [];
  for (const name of POSE_BONES) {
    const bone = model.getObjectByName('mixamorig' + name);
    if (bone) driven.push({ bone, rest: bone.quaternion.clone(), o: pose.bones[name] });
  }
  const euler = new THREE.Euler();
  const delta = new THREE.Quaternion();
  const target = new THREE.Quaternion();
  let groundSpeed = 0; // the last speed on the planks: the gait mix holds through a jump
  let wasAirborne = false;
  let tAir = 0;
  let tLand = Infinity;
  const state = { airborne: false, vy: 0, tAir: 0, tLand: Infinity, falling: false, tFall: 0, lead: 1 }; // reused every frame
  let tuckLead = 1; // the tuck leads with the other leg each jump

  return {
    pose,
    // state: { speed (m/s), falling, airborne, vy (m/s), fallTime (s into the fall) }
    update({ speed, falling, airborne, vy, fallTime }, dt) {
      if (airborne && !wasAirborne) {
        tAir = 0;
        tuckLead = -tuckLead;
      } else if (!airborne && wasAirborne) {
        tLand = 0;
      }
      wasAirborne = airborne;
      if (!airborne) groundSpeed = speed;
      const g = stepGait({ walk: walk.weight, run: run.weight }, airborne ? groundSpeed : speed, dt);
      idle.weight = g.idle;
      walk.weight = g.walk;
      run.weight = g.run;
      // Walk and Run cycles are not the same length, so while they blend the quieter one follows
      // the louder one's phase; otherwise the feet fight each other for a third of a second.
      if (walk.weight > 0 && run.weight > 0) {
        const [lead, follow] = run.weight >= walk.weight ? [run, walk] : [walk, run];
        follow.time = (lead.time / lead.getClip().duration) * follow.getClip().duration;
      }
      // Frozen in the air so the legs do not keep walking; they pick up where they stopped on landing.
      walk.timeScale = airborne ? 0 : clipTimeScale(speed, WALK_STRIDE, walk.getClip().duration, 0.6, 1.5);
      run.timeScale = airborne ? 0 : clipTimeScale(speed, RUN_STRIDE, run.getClip().duration, 0.7, 1.4);
      idle.timeScale = falling ? 2.5 : 1; // flailing
      mixer.update(dt);

      state.airborne = airborne;
      state.vy = vy;
      state.tAir = tAir;
      state.tLand = tLand;
      state.falling = falling;
      state.tFall = fallTime;
      state.lead = tuckLead;
      jumpPose(state, pose);
      for (let i = 0; i < driven.length; i++) {
        const d = driven[i];
        const w = d.o[3];
        if (w < 0.001) continue;
        euler.set(d.o[0] / w, d.o[1] / w, d.o[2] / w);
        target.multiplyQuaternions(d.rest, delta.setFromEuler(euler));
        d.bone.quaternion.slerp(target, Math.min(1, w));
      }
      tAir += dt;
      tLand += dt;
    },
  };
}
