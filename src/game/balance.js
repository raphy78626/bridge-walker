// Tuning knobs. Harder: raise GRAVITY or WALK_WOBBLE. Easier: raise CONTROL or DAMPING. Wind strength lives in session.js.
// Eased three times after TV + iPhone play tests (originally 0.6 / 2.2 / 1.5 / 3.0 / 1.2): players
// still fell within seconds. A lean now takes ~4 s to double on its own while walking (was ~1.2 s).
export const FALL_ANGLE = 1.0; // radians (~57°): lean beyond this and the walker falls
export const WALK_SPEED = 1.4; // metres per second
export const RUN_SPEED = 2.8; // metres per second
export const JUMP_VY = 3.2; // m/s upward at take-off: ~0.65 s in the air, ~0.52 m peak
export const GRAVITY_ACCEL = 9.8; // m/s^2 pulling a jumping walker back down
// Eased for real players after TV play tests: jumps carry further and gaps stay short (see gaps.js).
export const JUMP_FORWARD = 3.0; // m/s: the least forward speed a jump carries, so a standing jump clears ~1.96 m
const RUN_JUMP_BOOST = 1.15; // a running jump keeps 15% more speed than the run (~3.22 m/s, ~2.10 m)
const GRAVITY = 0.4; // how fast a lean grows on its own
const WALK_WOBBLE = 1.2; // walking multiplies instability by this
const RUN_WOBBLE = 1.6; // running multiplies it by this (standing, and being airborne, use 1)
const CONTROL = 3.0; // how hard a full phone tilt pushes back (4.0 felt too sensitive)
const DAMPING = 1.6; // higher = calmer, slower sway

export function createWalker() {
  return { lean: 0, leanVel: 0, z: 0, fallen: false, y: 0, vy: 0, airborne: false, speed: 0 };
}

// One physics step. tilt in [-1, 1], wind in lean-acceleration units, dt in seconds.
// running overrides walking. jump is a one-shot: it starts a jump only from the ground.
export function stepWalker(w, { tilt, walking, running = false, jump = false, wind }, dt) {
  if (w.fallen) return w;

  const inputSpeed = running ? RUN_SPEED : walking ? WALK_SPEED : 0;
  let { y, vy, airborne, speed } = w;
  if (jump && !airborne) {
    airborne = true;
    vy = JUMP_VY;
    speed = Math.max(inputSpeed * RUN_JUMP_BOOST, JUMP_FORWARD); // held constant until landing
  }

  // In the air the lean is as unstable as standing still, whatever the feet were doing.
  const instability = GRAVITY * (airborne ? 1 : running ? RUN_WOBBLE : walking ? WALK_WOBBLE : 1);
  const acc = instability * Math.sin(w.lean) + wind + CONTROL * tilt - DAMPING * w.leanVel;
  const leanVel = w.leanVel + acc * dt;
  const lean = w.lean + leanVel * dt;

  let dz;
  if (!airborne) {
    speed = inputSpeed;
    dz = inputSpeed * dt;
  } else {
    const next = y + vy * dt - 0.5 * GRAVITY_ACCEL * dt * dt; // exact for constant gravity
    if (next > 0) {
      y = next;
      vy -= GRAVITY_ACCEL * dt;
      dz = speed * dt;
    } else {
      // Touches down part-way through this step: fly until then, then follow the input.
      const tLand = Math.min(dt, (vy + Math.sqrt(vy * vy + 2 * GRAVITY_ACCEL * y)) / GRAVITY_ACCEL);
      dz = speed * tLand + inputSpeed * (dt - tLand);
      y = 0;
      vy = 0;
      airborne = false;
      speed = inputSpeed;
    }
  }

  const fallen = Math.abs(lean) > FALL_ANGLE;
  if (fallen) return { lean, leanVel, z: w.z + dz, fallen, y: 0, vy: 0, airborne: false, speed: 0 };
  return { lean, leanVel, z: w.z + dz, fallen, y, vy, airborne, speed };
}
