// Idle / Walk / Run blending, as pure functions so the rules can be unit-tested away from the rig.
export const FADE = 0.3; // crossfade time, seconds
export const RUN_ABOVE = 2; // m/s: faster than this plays the Run clip (walk is 1.4, run 2.8)
export const WALK_ABOVE = 0.2; // m/s: faster than this plays the Walk clip
// Metres the feet cover per clip cycle (a Mixamo cycle is two steps), so a clip's timeScale can match the speed:
// Walk is 1.03 s per cycle (1.45 m at 1.4 m/s), Run 0.7 s per cycle (about 2.2 m at ~3.1 m/s).
export const WALK_STRIDE = 1.45;
export const RUN_STRIDE = 2.2;

const toward = (value, target, step) => value + Math.sign(target - value) * Math.min(step, Math.abs(target - value));

// One frame of the crossfade: each weight moves toward its target at 1 / FADE per second (the same rate for
// all three, so a walk -> run fade always sums to 1 and nothing pops). Returns the new { idle, walk, run }.
export function stepGait({ walk, run }, speed, dt) {
  const step = dt / FADE;
  const wantRun = speed > RUN_ABOVE;
  const wantWalk = !wantRun && speed > WALK_ABOVE;
  const w = toward(walk, wantWalk ? 1 : 0, step);
  const r = toward(run, wantRun ? 1 : 0, step);
  const total = w + r;
  return total > 1 ? { idle: 0, walk: w / total, run: r / total } : { idle: 1 - total, walk: w, run: r };
}

// Playback rate that makes a clip's feet cover `speed` m/s; `duration` is the clip length in seconds.
export function clipTimeScale(speed, stride, duration, min, max) {
  return Math.min(max, Math.max(min, speed / (stride / duration)));
}
