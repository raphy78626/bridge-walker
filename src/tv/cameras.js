// Camera views: pure helpers (no three.js), so the rules can be unit-tested away from the scene.
//   chase      behind the walker (the original camera, which stays in scene.js)
//   pov        first person, at the soldier's eye, rolling with his lean
//   cinematic  a low side angle that pans smoothly after him
import { WALK_SPEED, RUN_SPEED, JUMP_VY } from '../game/balance.js';
import { WALK_STRIDE, RUN_STRIDE, RUN_ABOVE } from './gait.js';

export const CAMERA_MODES = ['chase', 'pov', 'cinematic'];
export const CAMERA_LABELS = { chase: 'Chase cam', pov: 'First person', cinematic: 'Cinematic' };
export const DEFAULT_CAMERA = 'chase';
export const CAMERA_FOV = { chase: 60, pov: 70, cinematic: 64 };

export const isCameraMode = (m) => CAMERA_MODES.includes(m);
// chase -> pov -> cinematic -> chase. Anything unknown counts as chase, so the next one is pov.
export const nextCamera = (mode) => CAMERA_MODES[(isCameraMode(mode) ? CAMERA_MODES.indexOf(mode) + 1 : 1) % CAMERA_MODES.length];

// The chosen view survives a reload. localStorage can be missing or throw (a private window, a TV browser), so
// both calls swallow errors and a bad stored value falls back to chase.
const STORAGE_KEY = 'bridge.camera';
export function loadCameraMode(storage = globalThis.localStorage) {
  try {
    const m = storage?.getItem(STORAGE_KEY);
    return isCameraMode(m) ? m : DEFAULT_CAMERA;
  } catch {
    return DEFAULT_CAMERA;
  }
}
export function saveCameraMode(mode, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // not worth losing a frame over
  }
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---------- first person ----------

export const POV = {
  eye: 1.65, // m above the pivot (the soldier's feet)
  rollScale: 0.8, // the camera rolls this much of the lean: enough to feel the balance, not enough to lose the bridge
  pitch: -0.2, // rad: looks a little down, so the planks and the next gap are in view
  bobWalk: 0.03, // m of head bob at a walk, rising to bobRun at a run
  bobRun: 0.045,
  swayAmp: 0.015, // m of side-to-side head sway, at half the step rate
  jumpPitch: 0.08, // rad of look-up on take-off (and look-down on the way back)
  dipPitch: 0.8, // rad per metre the landing squat drops the pivot: a nod on landing
};

// Steps per second: a Walk/Run cycle is two steps over WALK_STRIDE / RUN_STRIDE metres.
export function stepRate(speed) {
  return (2 * speed) / (speed > RUN_ABOVE ? RUN_STRIDE : WALK_STRIDE);
}

// The first-person eye for a walker { z, y, vy, airborne, speed, lean } (the session's shape). `phase` is the head
// bob's phase in radians; the scene advances it by 2 * PI * stepRate(speed) each second, so a change of
// speed never makes the bob jump. `pose` is the jump pose's { pivotY (landing dip, <= 0), pitch (body lean forward) }.
// Returns the world position and the camera angles: roll about the view axis, pitch about its right (up is positive).
export function povCamera(w, phase = 0, pose = {}) {
  const lean = w.lean ?? 0;
  const lift = w.y ?? 0;
  const speed = w.speed ?? 0;
  const moving = w.airborne ? 0 : clamp(speed / WALK_SPEED, 0, 1); // the head does not bob in the air or standing still
  const gait = clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
  const bob = moving * (POV.bobWalk + (POV.bobRun - POV.bobWalk) * gait) * Math.sin(phase);
  const sway = moving * POV.swayAmp * Math.sin(phase * 0.5);
  const dip = pose.pivotY ?? 0;
  // The head sits on the leaning body: it swings out to the side and sinks as he tips over.
  const x = POV.eye * Math.sin(lean) + sway;
  const y = lift + POV.eye * Math.cos(lean) + bob + dip;
  // Rising he looks up a little; dropping he looks down. The squat on landing nods the view down.
  const vy = clamp((w.vy ?? 0) / JUMP_VY, -1.5, 1);
  const pitch = POV.pitch + POV.jumpPitch * vy + POV.dipPitch * dip - (pose.pitch ?? 0);
  const roll = -lean * POV.rollScale + 0.01 * moving * Math.sin(phase * 0.5);
  return { x, y, z: -(w.z ?? 0), roll, pitch };
}

// ---------- cinematic ----------

// One step of a critically damped spring (no overshoot): moves `x` (with velocity `v`) towards `target`, settling in
// roughly 4 / omega seconds. Exact for any dt, so a long frame cannot make it unstable. Returns [x, v].
export function dampStep(x, v, target, omega, dt) {
  const e = Math.exp(-omega * dt);
  const d = x - target;
  const t = (v + omega * d) * dt;
  return [target + (d + t) * e, (v - omega * t) * e];
}

// A raised three-quarter "drone" shot from behind and to one side, looking ahead along the bridge. The first
// version sat low at the side and, on the TV, mostly framed a dark rock wall with the soldier as a silhouette.
export const CINEMA = {
  side: 3.4, // m to the side of the bridge axis
  ahead: -4, // negative: behind the walker, so the bridge, the gaps ahead and the sky are all in frame
  deck: 3.2, // camera height at mid-bridge: above the deck, looking down into the canyon
  ledge: 4.2, // camera height over the rock ledges at both ends, which would otherwise swallow it
  lookAhead: 5, // the aim point runs this far ahead of him, so the shot leads into the canyon
  ledgeMetres: 3.4, // how far from either end of the bridge the ledge height is fully applied
  ledgeBlend: 3, // and how far it takes to come down to the deck height
  camOmega: 2.6, // follow speeds: the camera lags the walker a little, the aim point less
  lookOmega: 4.5,
  fallCamOmega: 3.5,
  fallLookOmega: 6,
  cut: 9, // a target further than this from the camera is a cut (a new level, a respawn), so it snaps
  lookHeight: 0.6, // aim point above the pivot (about his hips)
};

// The side camera as a little state machine. update() takes the walker's { z, y } and where the walker really is
// (`subjectY`, which drops during a fall), and returns the camera position and the point it looks at.
export function createCinematic(bridgeLength = 60) {
  const cam = { p: [0, 0, 0], v: [0, 0, 0] };
  const look = { p: [0, 0, 0], v: [0, 0, 0] };
  let primed = false;
  const out = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 };
  const ledgeHeight = (d) => {
    const edge = Math.min(d, bridgeLength - d); // metres from the nearer end of the bridge
    const k = clamp((edge - CINEMA.ledgeMetres) / CINEMA.ledgeBlend, 0, 1);
    return CINEMA.ledge + (CINEMA.deck - CINEMA.ledge) * k * k * (3 - 2 * k);
  };
  return {
    reset() {
      primed = false;
    },
    // w: { z (m along the bridge), y (jump height) }; subjectY: the pivot's real height (below the deck while falling).
    update(w, subjectY, falling, dt) {
      const sz = -w.z;
      const lift = w.y ?? 0;
      const base = ledgeHeight(w.z + CINEMA.ahead);
      const target = [
        CINEMA.side,
        base + 0.3 * lift + (falling ? 0.55 * subjectY : 0), // a fall is followed down, half as fast as he drops
        sz - CINEMA.ahead,
      ];
      const aim = [0, subjectY + CINEMA.lookHeight, sz - (falling ? 0 : CINEMA.lookAhead)]; // a fall is watched, not led
      if (!primed || Math.abs(target[2] - cam.p[2]) > CINEMA.cut) {
        cam.p = target.slice();
        look.p = aim.slice();
        cam.v = [0, 0, 0];
        look.v = [0, 0, 0];
        primed = true;
      } else {
        const wc = falling ? CINEMA.fallCamOmega : CINEMA.camOmega;
        const wl = falling ? CINEMA.fallLookOmega : CINEMA.lookOmega;
        for (let i = 0; i < 3; i++) {
          [cam.p[i], cam.v[i]] = dampStep(cam.p[i], cam.v[i], target[i], wc, dt);
          [look.p[i], look.v[i]] = dampStep(look.p[i], look.v[i], aim[i], wl, dt);
        }
      }
      out.x = cam.p[0];
      out.y = cam.p[1];
      out.z = cam.p[2];
      out.lx = look.p[0];
      out.ly = look.p[1];
      out.lz = look.p[2];
      return out;
    },
  };
}
