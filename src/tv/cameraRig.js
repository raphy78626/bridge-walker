import * as THREE from 'three';
import { BRIDGE_LENGTH } from '../game/session.js';
import { CAMERA_FOV, DEFAULT_CAMERA, createCinematic, isCameraMode, nextCamera, povCamera, stepRate } from './cameras.js';

// The chase view's usual spot: this far behind the walker and above the planks, aimed this far ahead and this high.
// A focus can override each (`back`, `up`, `aim`, `aimY`): the race's shared view pulls back and up to keep both in frame.
const CHASE = { back: 5, up: 2.4, aim: 8, aimY: 1.1 };
const GAP_FALL_SWING = 0.7; // seconds for the camera to swing over a gap the walker is falling through
const CAMERA_Y_FOLLOW = 0.3; // the camera rises this fraction of the walker's jump height
const POV_FALL_BLEND = 0.2; // seconds for the first-person camera to hand over to the walker's tumble
const p01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);

// Camera views (cameras.js): chase | pov | cinematic. The choice stays across levels and respawns.
// Owns the one THREE.PerspectiveCamera it is given: its position, aim and fov, and the chase view's wind shake.
//   .update(focus, sway, dt, t)
//     focus  what to follow, a walker's `focus` (walker.js): { w (the session's walker), x (his bridge's lateral offset),
//            position and quaternion (his pivot), pose, speed, falling, gapFall, phaseTime }. Anything of that shape
//            will do, so two players can be framed by handing in a made-up focus between them (raceView.js).
//            The chase view also reads the optional back / up / aim / aimY (see CHASE).
//     sway   the smoothed wind, -1..1: a strong gust buffets the chase view
//     dt, t  frame time and the scene's own clock (both stand still in a pause)
//   .setMode(mode) / .cycle() / .mode
export function createCameraRig(camera, bridgeLength = BRIDGE_LENGTH) {
  let mode = DEFAULT_CAMERA;
  let shown = null; // the view the camera is currently set up for (fov, the cinematic's smoothing)
  let bobPhase = 0;
  const cinematic = createCinematic(bridgeLength);
  const qNormal = new THREE.Quaternion();
  const qFall = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const eulerPov = new THREE.Euler(0, 0, 0, 'YXZ'); // yaw, pitch, then roll about the view axis
  const eyeFall = new THREE.Vector3();

  function setMode(next) {
    if (isCameraMode(next)) mode = next;
    return mode;
  }

  // First person: the eye at the soldier's head, rolling with his lean (cameras.js). In a fall the camera is his head:
  // it takes his tumble (position and orientation) after a short hand-over, and drops with him into the clouds.
  function povView(f, dt) {
    bobPhase = (bobPhase + 2 * Math.PI * stepRate(f.speed) * dt) % (4 * Math.PI); // 4 PI: the half-rate sway repeats too
    const v = povCamera(f.w, bobPhase, f.pose ?? undefined);
    camera.position.set(f.x + v.x, v.y, v.z);
    eulerPov.set(v.pitch, 0, v.roll);
    camera.quaternion.setFromEuler(eulerPov);
    if (f.falling) {
      const k = smooth(p01(f.phaseTime / POV_FALL_BLEND));
      eyeFall.set(0, 1.65, 0).applyQuaternion(f.quaternion).add(f.position);
      qPitch.setFromEuler(eulerPov.set(v.pitch, 0, 0));
      qFall.copy(f.quaternion).multiply(qPitch);
      qNormal.copy(camera.quaternion);
      camera.quaternion.copy(qNormal.slerp(qFall, k));
      camera.position.lerp(eyeFall, k);
    }
  }

  function cinematicView(f, dt) {
    const c = cinematic.update(f.w, f.position.y, f.falling, dt);
    camera.position.set(f.x + c.x, c.y, c.z);
    camera.lookAt(f.x + c.lx, c.ly, c.lz);
  }

  function chaseView(f, sway, t) {
    const z = -f.w.z;
    const lift = f.w.y ?? 0;
    if (f.gapFall) {
      // From the usual spot behind him the deck would hide the drop, so the camera swings up over the
      // hole and looks steeply down through it after him, into the clouds.
      const k = smooth(p01(f.phaseTime / GAP_FALL_SWING));
      camera.position.set(f.x, 2.4 + 2.0 * k, z + 5 - 4.2 * k);
      camera.lookAt(f.x, f.position.y + 1, z - 0.5 * k);
      return;
    }
    camera.position.set(f.x + f.w.lean * 0.6, (f.up ?? CHASE.up) + CAMERA_Y_FOLLOW * lift, z + (f.back ?? CHASE.back));
    if (!f.falling && sway * sway > 0.25) {
      // a strong gust buffets the chase camera a little: tiny, and only above half strength
      const shake = (Math.abs(sway) - 0.5) * 0.06;
      camera.position.x += Math.sin(t * 37) * shake;
      camera.position.y += Math.sin(t * 29 + 1) * shake * 0.6;
    }
    if (f.falling) {
      camera.lookAt(f.position.x, f.position.y + 1, z - 1); // watch him drop into the clouds
    } else {
      camera.lookAt(f.x, (f.aimY ?? CHASE.aimY) + CAMERA_Y_FOLLOW * lift, z - (f.aim ?? CHASE.aim));
    }
  }

  function update(focus, sway, dt, t) {
    if (mode !== shown) {
      shown = mode;
      camera.fov = CAMERA_FOV[mode];
      camera.updateProjectionMatrix();
      cinematic.reset(); // a new angle starts where it should be, not gliding in from the last one
    }
    if (mode === 'pov') povView(focus, dt);
    else if (mode === 'cinematic') cinematicView(focus, dt);
    else chaseView(focus, sway, t);
  }

  return {
    update,
    setMode,
    // chase -> pov -> cinematic -> chase; returns the new view's id
    cycle: () => setMode(nextCamera(mode)),
    get mode() {
      return mode;
    },
  };
}
