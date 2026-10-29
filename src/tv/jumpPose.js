// Procedural jump, landing and falling poses for the Mixamo Soldier, which ships with no jump clip.
// jumpPose() is pure: it turns a little state into per-bone Euler angles plus a pivot dip and pitch, and
// scene.js applies them to the bones after the mixer has run.
//
// The angles are an ABSOLUTE pose relative to each bone's T-pose (bind) rotation, not an offset on top of the
// animation: Idle stands with the pelvis twisted ~45 deg from Walk and Run, so the same additive "tuck" would
// fold the legs diagonally in a standing jump and straight in a running one. Each bone carries [x, y, z, w]:
// x, y, z are weight-multiplied angles (zero when w is) and w is how far the bone is blended from the
// animation toward that pose, so the rig solves  bone = slerp(animated, bind * Euler(x/w, y/w, z/w), w).
//
// Bone axes (found by rotating each bone in the T-pose and watching where its child went; the soldier faces -z,
// his right is +x). Positive angle means:
//   Hips, Spine*   x: lean forward
//   UpLeg (L, R)   x: thigh swings BACK (negative = knee up, forward)   z: left knee toward the midline, right
//                  knee away from it (so a spread is -z left, +z right)
//   Leg   (L, R)   x: knee bends (shin goes backward); never negative, or the knee would hyperextend
//   Foot  (L, R)   x: toes point down (plantar flexion)
//   Arm   (L)      x: swings BACK (negative = forward)   z: arm lowers (negative = raise)
//   Arm   (R)      x: swings FORWARD                     z: arm lowers (negative = raise)
//   ForeArm (L, R) x: like the arm's x, so the elbow folds forward with -x on the left and +x on the right
export const POSE_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2',
  'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
];

export const PUSH_TIME = 0.12; // s after take-off while the legs are still driving
export const PUSH_VY = 2; // m/s: and still rising this fast
export const LAND_TIME = 0.28; // s of landing squat after touch-down
export const FLAIL_HZ = 2.5; // falling: one windmill / kick per 0.4 s
const AIR_IN = 0.14; // s to blend from the run / walk / idle clip into the jump pose
const FLAIL_IN = 0.15; // s to blend into the flail
const SQUAT_IN = 0.12; // s from the descent pose to the deepest squat
const LAND_DIP = 0.12; // m the pivot drops in the squat
const PITCH = { push: 0.05, tuck: 0.1, descent: 0.04, squat: 0.07 }; // rad, whole body forward about the feet

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, k) => a + (b - a) * k;

// Anatomical description -> the table of Euler angles per bone (see the axis notes above).
function makePose(p) {
  const t = p.trunk;
  const spread = p.spread ?? 0;
  const arm = p.armFwd;
  const up = p.armUp;
  const el = p.elbow;
  return [
    [t * 0.3, 0, 0], [t * 0.3, 0, 0], [t * 0.2, 0, 0], [t * 0.2, 0, 0],
    [-arm, 0, -up], [-el, 0, 0], [arm, 0, -up], [el, 0, 0],
    [-p.thighL, 0, -spread], [p.kneeL, 0, 0], [p.footL, 0, 0],
    [-p.thighR, 0, spread], [p.kneeR, 0, 0], [p.footR, 0, 0],
  ];
}

// Legs and arms in radians: thigh = how far the thigh is lifted forward, knee = bend, foot = toes down.
// armFwd swings the arms forward from the T-pose (out to the side), armUp raises them.
const PUSH = makePose({ trunk: 0.12, thighL: -0.12, thighR: -0.12, kneeL: 0.05, kneeR: 0.05, footL: 0.8, footR: 0.8, spread: 0.05, armFwd: 1.0, armUp: 0.7, elbow: 0.25 });
const TUCK = makePose({ trunk: 0.4, thighL: 1.15, thighR: 1.15, kneeL: 1.75, kneeR: 1.75, footL: 0.3, footR: 0.3, spread: 0.1, armFwd: 0.8, armUp: 0.25, elbow: 0.4 });
const DESCENT = makePose({ trunk: 0.12, thighL: 0.6, thighR: 0.6, kneeL: 0.35, kneeR: 0.35, footL: 0.1, footR: 0.1, spread: 0.08, armFwd: 0.25, armUp: 0.3, elbow: 0.2 });
const SQUAT = makePose({ trunk: 0.5, thighL: 0.7, thighR: 0.7, kneeL: 1.22, kneeR: 1.22, footL: -0.5, footR: -0.5, spread: 0.1, armFwd: 0.5, armUp: -0.3, elbow: 0.3 });

const N = POSE_BONES.length;
const LEG_IN_POSE = { thighL: 8, thighR: 11, kneeL: 9, kneeR: 12 }; // indices into a pose table
const scratch = Array.from({ length: N }, () => [0, 0, 0]); // the air / landing pose being mixed

export function createPose() {
  const bones = {};
  for (const name of POSE_BONES) bones[name] = [0, 0, 0, 0];
  return { phase: 'ground', pivotY: 0, pitch: 0, bones };
}

// The phase name for a state. state = { airborne, vy, tAir, tLand, falling }.
export function phaseOf({ airborne = false, vy = 0, tAir = 0, tLand = Infinity, falling = false }) {
  if (falling) return 'falling';
  if (airborne) return tAir < PUSH_TIME && vy > PUSH_VY ? 'pushoff' : vy >= 0 ? 'rise' : 'descent';
  return tLand < LAND_TIME ? 'landing' : 'ground';
}

// state: { airborne, vy (m/s, up positive), tAir (s since take-off), tLand (s since the last touch-down,
// Infinity if none), falling, tFall (s since the fall began), lead (+1 right leg leads the tuck, -1 left) }.
// Writes into and returns `out` (a createPose()), so a frame allocates nothing.
export function jumpPose(state, out = createPose()) {
  const { airborne = false, vy = 0, tAir = 0, tLand = Infinity, falling = false, tFall = 0, lead = 1 } = state;
  out.phase = phaseOf(state);

  const inAir = airborne && !falling;
  const alpha = inAir ? smooth(tAir / AIR_IN) : 0; // how much the air pose covers the landing one
  const landing = tLand < LAND_TIME;
  const beta = landing ? 1 - smooth((tLand - SQUAT_IN) / (LAND_TIME - SQUAT_IN)) : 0; // squat engagement: holds, then eases out
  const gamma = falling ? smooth(tFall / FLAIL_IN) : 0;
  const total = alpha + (1 - alpha) * beta;

  // Air pose: push-off blends into the tuck with time, the tuck into the descent as the fall speed builds.
  const toTuck = smooth((tAir - 0.05) / 0.24);
  const toDescent = smooth((-vy - 0.2) / 2);
  const tuckAmount = toTuck * (1 - toDescent);
  // Landing pose: the descent carries on into the squat, so the touch-down itself never pops.
  const toSquat = smooth(tLand / SQUAT_IN);

  for (let i = 0; i < N; i++) {
    const s = scratch[i];
    for (let a = 0; a < 3; a++) {
      const air = lerp(lerp(PUSH[i][a], TUCK[i][a], toTuck), DESCENT[i][a], toDescent);
      const land = lerp(DESCENT[i][a], SQUAT[i][a], toSquat);
      s[a] = alpha * air + (1 - alpha) * beta * land;
    }
  }
  // One leg leads the tuck, as in a stride jump: it comes up higher and bends a little less.
  const k = alpha * tuckAmount * 0.12 * lead;
  scratch[LEG_IN_POSE.thighR][0] -= k;
  scratch[LEG_IN_POSE.thighL][0] += k;
  scratch[LEG_IN_POSE.kneeR][0] -= k * 1.5;
  scratch[LEG_IN_POSE.kneeL][0] += k * 1.5;

  const dip = (1 - alpha) * (landing ? smooth(tLand / SQUAT_IN) * (1 - smooth((tLand - SQUAT_IN) / (LAND_TIME - SQUAT_IN))) : 0);
  const landPitch = lerp(PITCH.descent, PITCH.squat, toSquat);
  const airPitch = lerp(lerp(PITCH.push, PITCH.tuck, toTuck), PITCH.descent, toDescent);
  out.pivotY = falling ? 0 : -LAND_DIP * dip;
  out.pitch = falling ? 0 : alpha * airPitch + (1 - alpha) * beta * landPitch;

  const flailW = 1 - gamma;
  const theta = 2 * Math.PI * FLAIL_HZ * tFall;
  for (let i = 0; i < N; i++) {
    const o = out.bones[POSE_BONES[i]];
    const s = scratch[i];
    const f = gamma > 0 ? flail(i, theta) : null;
    for (let a = 0; a < 3; a++) o[a] = flailW * s[a] + (f ? gamma * f[a] : 0);
    o[3] = flailW * total + gamma;
  }
  return out;
}

// Falling: the arms thrash in opposite phase, the legs pedal, the trunk wobbles. All on one 2.5 Hz beat, with
// the limbs phase-shifted so the motion rolls through the body instead of moving in lockstep.
const flailOut = [0, 0, 0];
function flail(i, th) {
  const f = flailOut;
  f[0] = f[1] = f[2] = 0;
  switch (POSE_BONES[i]) {
    case 'Hips': f[0] = 0.1; f[2] = 0.1 * Math.sin(th + 1); break;
    case 'Spine': f[0] = 0.15 + 0.1 * Math.sin(th + 2); f[1] = 0.2 * Math.sin(th); break;
    case 'Spine1': f[1] = 0.15 * Math.sin(th + 0.5); break;
    case 'Spine2': f[0] = 0.1; break;
    case 'LeftArm': f[0] = -(0.6 + 0.9 * Math.sin(th)); f[2] = -(0.7 + 0.6 * Math.cos(th)); break;
    case 'RightArm': f[0] = 0.6 + 0.9 * Math.sin(th + Math.PI); f[2] = -(0.7 + 0.6 * Math.cos(th + Math.PI)); break;
    case 'LeftForeArm': f[0] = -(0.7 + 0.5 * Math.sin(th - 1.2)); break;
    case 'RightForeArm': f[0] = 0.7 + 0.5 * Math.sin(th + Math.PI - 1.2); break;
    case 'LeftUpLeg': f[0] = -(0.5 + 0.6 * Math.sin(th + 0.8)); f[2] = -0.15; break;
    case 'RightUpLeg': f[0] = -(0.5 + 0.6 * Math.sin(th + 0.8 + Math.PI)); f[2] = 0.15; break;
    case 'LeftLeg': f[0] = 0.9 + 0.7 * Math.sin(th - 0.4); break;
    case 'RightLeg': f[0] = 0.9 + 0.7 * Math.sin(th - 0.4 + Math.PI); break;
    case 'LeftFoot': case 'RightFoot': f[0] = 0.4; break;
    default:
  }
  return f;
}
