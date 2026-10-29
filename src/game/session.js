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
// Each level starts on the rock ledge before the bridge: solid ground, a safe place to get ready. The level timer
// (and with it the wind) only starts once he steps onto the bridge.
export const START_Z = -2.5;
// In a match (race, Wind Master) a walker who never steps on the bridge would stall the round for ever, so a lane's clock
// starts after this long on the ledge anyway. Solo has nothing to stall: its clock waits for the bridge.
export const LEDGE_CLOCK_START_S = 4;
// On the bridge he has to keep moving. Standing still is fine for IDLE_GRACE seconds; after that the bridge
// swings him harder and harder (IDLE_PUSH per second, more than a full tilt can hold within a few seconds).
export const IDLE_GRACE = 2;
const IDLE_PUSH = 1.2;
const LEASH_GAP_MARGIN = 0.1; // a leash that ends over a gap holds him this far before its near edge instead
// He counts as waiting this close to the limit, in the air too: he catches up with a moving limit in small steps and hops,
// and "WAIT FOR P2" must not blink on and off with each one.
const LEASH_NEAR = 0.6;

// Options (all optional; the defaults are the solo game):
//   infiniteLives: falls still cost time and count in levelFalls, but lives never run out (race mode).
//   ledgeClockAfter: seconds on the ledge after which the level clock (and the wind) start even though he has not stepped
//     onto the bridge. null (solo) waits for the bridge for as long as it takes.
//   windSource: ({ seed, level, maxForce, gustGapMin, gustGapMax }) => wind, called each time a level begins, in
//     place of the seeded createWind. The wind needs force(t) and peek(t); windmaster mode passes a controlled wind.
export function createSession({ seed = 1, infiniteLives = false, windSource = null, ledgeClockAfter = null } = {}) {
  let wind = null;
  let instability = 1; // this level's lean-growth multiplier
  let pace = 1; // this level's walk and run speed multiplier

  const s = {
    phase: 'lobby', // lobby | playing | falling | gameover | won
    lives: START_LIVES,
    level: 1,
    time: 0, // seconds on the bridge this level (0 while he is still on the ledge, unless ledgeClockAfter ran out)
    ledgeTime: 0, // seconds spent on the ledge with the clock not yet running
    phaseTime: 0, // seconds since the current phase began
    walker: createWalker(),
    idleTime: 0, // seconds standing still on the bridge; the TV and phone say "keep moving" as it builds
    // The race's leash: the furthest he may walk (metres), or null for no limit. The race sets it every tick from the other
    // walker; nothing else does. At the limit he stands and balances, and waiting there is not standing still (no idle push).
    leash: null,
    waiting: false, // held at the leash this tick
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
    halted: false, // a round that ended for someone else (the race loser): frozen where it stands until start()

    togglePause() {
      if (s.phase === 'playing') s.paused = !s.paused;
    },

    // Freezes a level in progress where it stands (the race loser). start() brings it back.
    halt() {
      if (s.phase === 'playing' || s.phase === 'falling') {
        s.halted = true;
        s.forecast = calmForecast(); // the round is over for this lane: no WIND warning lingering on the results
      }
    },

    // opts (used by the match, which decides the level and the lives): { level, lives, runScore } override what
    // the phase would have done. Without opts this is the solo game: next level after a win, level 1 after game over.
    start({ level, lives, runScore } = {}) {
      if ((s.phase === 'playing' || s.phase === 'falling') && !s.halted) return;
      if (s.phase === 'won') s.level += 1;
      if (s.phase === 'gameover') {
        s.level = 1;
        s.lives = START_LIVES;
        s.runScore = 0;
      }
      if (level != null) s.level = level;
      if (lives != null) s.lives = lives;
      if (runScore != null) s.runScore = runScore;
      s.halted = false;
      const d = difficulty(s.level);
      s.time = 0;
      s.ledgeTime = 0;
      s.levelFalls = 0;
      s.parTime = d.parTime;
      s.result = null;
      s.paused = false;
      instability = d.instability;
      pace = d.pace;
      s.walker = { ...createWalker(), z: START_Z };
      s.idleTime = 0;
      s.waiting = false;
      s.gaps = generateGaps(seed, s.level, BRIDGE_LENGTH);
      s.fallCause = null;
      const windParams = { seed: seed + s.level, maxForce: d.maxWind, gustGapMin: d.gustGapMin, gustGapMax: d.gustGapMax };
      wind = windSource ? windSource({ ...windParams, level: s.level }) : createWind(windParams);
      enter('playing');
    },

    update(dt) {
      const jump = s.input.jump;
      s.input.jump = false; // consumed whether or not a jump could happen
      if (s.paused || s.halted) return;
      s.phaseTime += dt;
      if (s.phase === 'playing') {
        const onBridge = s.walker.z >= 0 && s.walker.z < BRIDGE_LENGTH;
        if (s.time === 0 && !onBridge) s.ledgeTime += dt;
        // The clock (and the wind) start with the first step on the bridge, or, in a match, when the ledge wait runs out.
        if (onBridge || s.time > 0 || (ledgeClockAfter != null && s.ledgeTime >= ledgeClockAfter)) s.time += dt;
        const { tilt, walking, running } = s.input;
        const onFeet = (walking || running) && !s.walker.airborne;
        s.idleTime = onBridge && !onFeet && !s.walker.airborne && !s.waiting ? s.idleTime + dt : 0;
        const idlePush = s.idleTime > IDLE_GRACE ? IDLE_PUSH * (s.idleTime - IDLE_GRACE) * (Math.sign(s.walker.lean) || 1) : 0;
        const sway = onFeet ? 0.15 * Math.sin(s.time * 11) : 0; // footsteps rock the walker
        const push = onBridge ? wind.force(s.time) + sway + idlePush : 0;
        const prevZ = s.walker.z;
        s.walker = stepWalker(s.walker, { tilt, walking, running, jump, wind: push, instability, pace, ground: !onBridge }, dt);
        // Held at the leash: no further than the limit (a jump in the air carries on, and lands where it lands), and never
        // pulled back from where he already stands. stepWalker returns a fresh walker, so it is safe to change in place.
        const limit = leashLimit();
        if (!s.walker.airborne && !s.walker.fallen && s.walker.z > limit) {
          s.walker.z = Math.max(prevZ, limit);
          s.walker.speed = 0;
        }
        s.waiting = s.walker.z >= limit - LEASH_NEAR;
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
        if (s.lives > 0 || infiniteLives) {
          s.walker = { ...createWalker(), z: respawnZ() };
          s.idleTime = 0;
          s.waiting = false;
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

  // Where the leash holds him: Infinity without one. A limit over a gap would stand him in it, so it moves to the near edge.
  function leashLimit() {
    if (s.leash == null) return Infinity;
    const gap = gapAt(s.gaps, s.leash);
    return gap ? gap.start - LEASH_GAP_MARGIN : s.leash;
  }

  function loseLife(cause) {
    if (!infiniteLives) s.lives -= 1;
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
