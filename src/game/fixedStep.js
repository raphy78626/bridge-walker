// The game advances in fixed steps, whatever rate the TV draws at, so the balance, the wind and a jump play the same at
// 30, 40 or 50 fps (a variable dt changes how a lean grows between frames). Each frame adds its real time to an
// accumulator and runs as many whole steps as fit; the remainder waits for the next frame.
//
// STEP is 1/120 s, not 1/60: at a TV's 35-48 fps that is 2-3 steps a frame, so the walker moves almost the same distance
// every frame (at 1/60 it would alternate between one step and two, a visible judder). After a stall (a look change, a
// slow frame) at most MAX_STEPS run and the rest is dropped, as the old 50 ms cap did: the walker never teleports.
export const STEP = 1 / 120;
export const MAX_STEPS = 8; // 66 ms of game time per frame at most
const EPSILON = 1e-9; // 1/120 added up in floating point falls a hair short of a whole step: count it anyway

export function createFixedStep({ step = STEP, maxSteps = MAX_STEPS } = {}) {
  let acc = 0;
  return {
    // Adds dt seconds and calls update(step) once per whole step. Returns how many steps ran.
    advance(dt, update) {
      acc += Math.max(0, dt);
      let steps = 0;
      while (acc >= step - EPSILON && steps < maxSteps) {
        update(step);
        acc -= step;
        steps += 1;
      }
      if (acc >= step - EPSILON) acc = 0; // a stall's backlog is dropped, not caught up over the next frames
      return steps;
    },
    // Nothing owed: when the game was not being updated (no phone), time that passed is not to be made up.
    reset() {
      acc = 0;
    },
  };
}
