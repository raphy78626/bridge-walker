import { createWalker, stepWalker } from './balance.js';
import { createWind } from './wind.js';
import { generateGaps, gapAt, distanceToNextGap } from './gaps.js';
import { difficulty, MAX_WIND } from './difficulty.js';

export { distanceToNextGap, MAX_WIND };

export const BRIDGE_LENGTH = 60; // metres
export const START_LIVES = 3;
export const FALL_DURATION = 2.5; // seconds the fall animation plays before respawn
const GAP_RESPAWN_BACK = 1.5; // metres before the gap you fell into that you get put back

export function createSession({ seed = 1 } = {}) {
  let wind = null;

  const s = {
    phase: 'lobby', // lobby | playing | falling | gameover | won
    lives: START_LIVES,
    level: 1,
    time: 0, // seconds on the bridge this level
    phaseTime: 0, // seconds since the current phase began
    walker: createWalker(),
    fallCause: null, // 'balance' | 'gap' | null: why we are in (or just left) the falling phase
    gaps: [], // [{ start, end }] metres along the bridge; a new array each time a level begins
    // jump is a one-shot: the TV sets it true, the next update() consumes it.
    input: { tilt: 0, walking: false, running: false, jump: false },

    start() {
      if (s.phase === 'playing' || s.phase === 'falling') return;
      if (s.phase === 'won') s.level += 1;
      if (s.phase === 'gameover') {
        s.level = 1;
        s.lives = START_LIVES;
      }
      s.time = 0;
      s.walker = createWalker();
      s.gaps = generateGaps(seed, s.level, BRIDGE_LENGTH);
      s.fallCause = null;
      wind = createWind({ seed: seed + s.level, maxForce: difficulty(s.level).maxWind });
      enter('playing');
    },

    update(dt) {
      s.phaseTime += dt;
      const jump = s.input.jump;
      s.input.jump = false; // consumed whether or not a jump could happen
      if (s.phase === 'playing') {
        s.time += dt;
        const { tilt, walking, running } = s.input;
        const onFeet = (walking || running) && !s.walker.airborne;
        const sway = onFeet ? 0.15 * Math.sin(s.time * 11) : 0; // footsteps rock the walker
        s.walker = stepWalker(s.walker, { tilt, walking, running, jump, wind: wind.force(s.time) + sway }, dt);
        if (s.walker.fallen) {
          s.lives -= 1;
          s.fallCause = 'balance';
          enter('falling');
        } else if (!s.walker.airborne && gapAt(s.gaps, s.walker.z)) {
          s.walker = { ...s.walker, fallen: true, speed: 0 };
          s.lives -= 1;
          s.fallCause = 'gap';
          enter('falling');
        } else if (s.walker.z >= BRIDGE_LENGTH) {
          // A winning jump lands him: otherwise he hovers on the win screen and the next level's
          // fresh walker reads as a landing (a stray thud).
          s.walker = { ...s.walker, y: 0, vy: 0, airborne: false, speed: 0 };
          enter('won');
        }
      } else if (s.phase === 'falling' && s.phaseTime >= FALL_DURATION) {
        if (s.lives > 0) {
          s.walker = { ...createWalker(), z: respawnZ() };
          s.fallCause = null;
          enter('playing');
        } else {
          enter('gameover');
        }
      }
    },
  };

  // After a gap fall: back up 1.5 m before the gap. After a balance fall: the same spot, unless that
  // spot is over a gap (he toppled mid-jump), where he would fall straight through again.
  function respawnZ() {
    const gap = gapAt(s.gaps, s.walker.z);
    return gap ? gap.start - GAP_RESPAWN_BACK : s.walker.z;
  }

  function enter(phase) {
    s.phase = phase;
    s.phaseTime = 0;
  }

  return s;
}
