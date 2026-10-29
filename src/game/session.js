import { createWalker, stepWalker } from './balance.js';
import { createWind } from './wind.js';
import { generateGaps, gapAt, distanceToNextGap } from './gaps.js';
import { difficulty, MAX_WIND } from './difficulty.js';
import { forecastAt, calmForecast, WIND_WARNING_S } from './forecast.js';
import { scoreLevel } from './scoring.js';

export { distanceToNextGap, MAX_WIND, WIND_WARNING_S };

export const BRIDGE_LENGTH = 60; // metres
export const START_LIVES = 3;
export const FALL_DURATION = 2.5; // seconds the fall animation plays before respawn
const GAP_RESPAWN_BACK = 1.5; // metres before the gap you fell into that you get put back

export function createSession({ seed = 1 } = {}) {
  let wind = null;
  let instability = 1; // this level's lean-growth multiplier

  const s = {
    phase: 'lobby', // lobby | playing | falling | gameover | won
    lives: START_LIVES,
    level: 1,
    time: 0, // seconds on the bridge this level
    phaseTime: 0, // seconds since the current phase began
    walker: createWalker(),
    fallCause: null, // 'balance' | 'gap' | null: why we are in (or just left) the falling phase
    gaps: [], // [{ start, end }] metres along the bridge; a new array each time a level begins
    levelFalls: 0, // falls this level (a gap fall and a balance fall both count)
    runScore: 0, // points banked this run; back to 0 when a new run starts after game over
    parTime: difficulty(1).parTime, // seconds to beat for three stars on the current level
    result: null, // null while playing; the level or run summary once it is won or over
    // What the wind is about to do: { state: 'calm' | 'warning' | 'gust', dir, strength, eta, remaining }.
    forecast: calmForecast(),
    // jump is a one-shot: the TV sets it true, the next update() consumes it.
    input: { tilt: 0, walking: false, running: false, jump: false },
    paused: false, // the phone's pause button; only during play, and it freezes everything (timer, wind, walker)

    togglePause() {
      if (s.phase === 'playing') s.paused = !s.paused;
    },

    start() {
      if (s.phase === 'playing' || s.phase === 'falling') return;
      if (s.phase === 'won') s.level += 1;
      if (s.phase === 'gameover') {
        s.level = 1;
        s.lives = START_LIVES;
        s.runScore = 0;
      }
      const d = difficulty(s.level);
      s.time = 0;
      s.levelFalls = 0;
      s.parTime = d.parTime;
      s.result = null;
      s.paused = false;
      instability = d.instability;
      s.walker = createWalker();
      s.gaps = generateGaps(seed, s.level, BRIDGE_LENGTH);
      s.fallCause = null;
      wind = createWind({ seed: seed + s.level, maxForce: d.maxWind, gustGapMin: d.gustGapMin, gustGapMax: d.gustGapMax });
      enter('playing');
    },

    update(dt) {
      const jump = s.input.jump;
      s.input.jump = false; // consumed whether or not a jump could happen
      if (s.paused) return;
      s.phaseTime += dt;
      if (s.phase === 'playing') {
        s.time += dt;
        const { tilt, walking, running } = s.input;
        const onFeet = (walking || running) && !s.walker.airborne;
        const sway = onFeet ? 0.15 * Math.sin(s.time * 11) : 0; // footsteps rock the walker
        s.walker = stepWalker(s.walker, { tilt, walking, running, jump, wind: wind.force(s.time) + sway, instability }, dt);
        if (s.walker.fallen) {
          loseLife('balance');
        } else if (!s.walker.airborne && gapAt(s.gaps, s.walker.z)) {
          s.walker = { ...s.walker, fallen: true, speed: 0 };
          loseLife('gap');
        } else if (s.walker.z >= BRIDGE_LENGTH) {
          // A winning jump lands him: otherwise he hovers on the win screen and the next level's
          // fresh walker reads as a landing (a stray thud).
          s.walker = { ...s.walker, y: 0, vy: 0, airborne: false, speed: 0 };
          const { stars, score } = scoreLevel({ level: s.level, time: s.time, falls: s.levelFalls, parTime: s.parTime });
          s.runScore += score;
          s.result = {
            kind: 'level', level: s.level, time: s.time, falls: s.levelFalls, stars, score, parTime: s.parTime, runScore: s.runScore,
          };
          enter('won');
        } else {
          s.forecast = forecastAt(wind, s.time);
        }
      } else if (s.phase === 'falling' && s.phaseTime >= FALL_DURATION) {
        if (s.lives > 0) {
          s.walker = { ...createWalker(), z: respawnZ() };
          s.fallCause = null;
          enter('playing');
        } else {
          s.result = { kind: 'run', level: s.level, runScore: s.runScore };
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

  function loseLife(cause) {
    s.lives -= 1;
    s.levelFalls += 1;
    s.fallCause = cause;
    enter('falling');
  }

  // The forecast only means something while playing: every other phase is calm.
  function enter(phase) {
    s.phase = phase;
    s.phaseTime = 0;
    s.forecast = phase === 'playing' ? forecastAt(wind, s.time) : calmForecast();
  }

  return s;
}
