// Game rules for one or two players, above the single-walker session. The TV builds one match per mode and
// feeds it the phones' messages; it never needs to know which mode is running to move a walker.
//
//   solo        one session, one phone (player 1). Exactly the session's own phases and rules.
//   race        two sessions, same seed (identical gaps and wind). Falls cost no lives, only time. The first to the far
//               end wins the round; the other is frozen where it stands. Every round is the next level. The leader
//               waits for the other at RACE_LEASH metres ahead, except in the final sprint.
//   windmaster  one session and one controlled wind. One player walks, the other sends gusts (at least
//               WIND_MASTER_MIN_FORCE strong). Roles swap after every round (a cleared level or a game over). The
//               seeded wind is off.
//
// match.phase is 'lobby' | 'playing' | 'roundOver' | 'matchOver' in race and windmaster ('playing' includes falling
// and respawning). In solo it is the session's own phase (lobby, playing, falling, won, gameover) so the existing
// single-player flow carries over unchanged.
import { createSession, START_LIVES, LEDGE_CLOCK_START_S, BRIDGE_LENGTH } from './session.js';
import { createControlledWind } from './wind.js';
import { WIND_MASTER_FALL_POINTS } from './scoring.js';
import { MODES } from '../shared/protocol.js';

export const RACE_ROUNDS_TO_WIN = 3; // first to this many round wins takes the match
// The two racers share one camera, which stays behind the one further back: a leader far ahead is too small to see his own
// gaps. So the leader may be at most RACE_LEASH metres ahead, and waits there for the other. The last RACE_SPRINT metres
// are free: once the leash would reach into them it lets go, and the finish is a real sprint.
export const RACE_LEASH = 6;
export const RACE_SPRINT = 10;
export const raceLeash = (otherZ) => (otherZ + RACE_LEASH >= BRIDGE_LENGTH - RACE_SPRINT ? null : otherZ + RACE_LEASH);
export const WINDMASTER_ROUNDS = 4; // rounds in a windmaster match: each player walks twice
// The seeded wind's peak force is tuned for a walker who must beat it (0.25 on level 1), which is far too gentle for a
// gust a player sends on purpose: it almost never topples anyone. A Wind Master's gust is at least this strong.
export const WIND_MASTER_MIN_FORCE = 0.7;
export const windMasterForce = (levelMaxWind) => Math.max(levelMaxWind, WIND_MASTER_MIN_FORCE);

// tally and scores are read every frame by the TV (stateSync.changed, the HUD), so they are immutable snapshots that are
// replaced when a number changes, never copied on every read.
const pair = (a, b) => Object.freeze({ 1: a, 2: b });
const ZERO = pair(0, 0);

// Applies a decoded phone message (tilt, walk, run, jump) to one session.
function applyInput(session, msg) {
  switch (msg.t) {
    case 'tilt':
      session.input.tilt = msg.v;
      return true;
    case 'walk':
      session.input.walking = msg.on;
      return true;
    case 'run':
      session.input.running = msg.on;
      return true;
    case 'jump':
      session.input.jump = true;
      return true;
    default:
      return false;
  }
}

function clearSessionInput(session) {
  Object.assign(session.input, { tilt: 0, walking: false, running: false, jump: false });
}

// leash (race only): false lets a racer run on alone, for tests of the other rules. The game always has it on.
export function createMatch({ mode = 'solo', seed = 1, winsToWin = RACE_ROUNDS_TO_WIN, rounds = WINDMASTER_ROUNDS, leash = true } = {}) {
  if (!MODES.includes(mode)) mode = 'solo';
  if (mode === 'race') return createRace(seed, winsToWin, leash);
  if (mode === 'windmaster') return createWindMaster(seed, rounds);
  return createSolo(seed);
}

function createSolo(seed) {
  const session = createSession({ seed });
  let scores = ZERO;
  return {
    mode: 'solo',
    players: [1],
    sessions: { 1: session },
    get phase() { return session.phase; },
    get round() { return session.level; },
    get level() { return session.level; },
    get result() { return session.result; },
    get scores() {
      if (scores[1] !== session.runScore) scores = pair(session.runScore, 0);
      return scores;
    },
    get paused() { return session.paused; },
    get gustReady() { return false; },
    get canChangeMode() { return session.phase === 'lobby' || session.phase === 'won' || session.phase === 'gameover'; },
    walkerOf: () => null,
    windMasterOf: () => null,
    input: (player, msg) => player === 1 && applyInput(session, msg),
    clearInput: (player) => player === 1 && clearSessionInput(session),
    start: () => session.start(),
    update: (dt) => session.update(dt),
    togglePause: () => session.togglePause(),
  };
}

function createRace(seed, winsToWin, leash) {
  const sessions = {
    1: createSession({ seed, infiniteLives: true, ledgeClockAfter: LEDGE_CLOCK_START_S }),
    2: createSession({ seed, infiniteLives: true, ledgeClockAfter: LEDGE_CLOCK_START_S }),
  };
  const both = [sessions[1], sessions[2]];
  // elapsed is the round's own clock, from start() of the round: the one race times and tie-breaks use. A lane's session.time
  // leaves out the ledge wait (and a fall's animation), so two lanes' times are not comparable.
  const m = { phase: 'lobby', round: 1, result: null, tally: ZERO, scores: ZERO, elapsed: 0 };

  function finish() {
    const done = [1, 2].filter((p) => sessions[p].phase === 'won');
    if (!done.length) return;
    // Lanes are checked every tick, so everyone who finished did so on this tick, at the same elapsed time: the tie goes to
    // whoever got furthest past, then to player 1. (Not to the lane clock, which a ledge wait skews.)
    const winner = done.reduce((a, b) => (sessions[a].walker.z >= sessions[b].walker.z ? a : b));
    for (const s of both) if (s.phase !== 'won') s.halt();
    m.tally = pair(m.tally[1] + (winner === 1 ? 1 : 0), m.tally[2] + (winner === 2 ? 1 : 0));
    const won = sessions[winner].result.score;
    m.scores = pair(m.scores[1] + (winner === 1 ? won : 0), m.scores[2] + (winner === 2 ? won : 0));
    const matchWinner = m.tally[winner] >= winsToWin ? winner : 0;
    m.result = {
      kind: 'race',
      round: m.round,
      level: m.round,
      winner,
      times: { 1: m.elapsed, 2: m.elapsed }, // the shared round clock; a lane that did not finish shows DNF
      falls: { 1: sessions[1].levelFalls, 2: sessions[2].levelFalls },
      finished: { 1: sessions[1].phase === 'won', 2: sessions[2].phase === 'won' },
      stars: sessions[winner].result.stars,
      score: sessions[winner].result.score,
      tally: m.tally,
      scores: m.scores,
      matchWinner,
    };
    m.phase = matchWinner ? 'matchOver' : 'roundOver';
  }

  return {
    mode: 'race',
    players: [1, 2],
    sessions,
    get phase() { return m.phase; },
    get round() { return m.round; },
    get level() { return m.round; },
    get result() { return m.result; },
    get tally() { return m.tally; },
    get scores() { return m.scores; },
    get elapsed() { return m.elapsed; }, // seconds since this round's start(), not counting a pause
    get paused() { return sessions[1].paused; },
    gustReady: false,
    get canChangeMode() { return m.phase === 'lobby' || m.phase === 'matchOver'; }, // not between rounds: a switch would wipe the tally
    walkerOf: () => null,
    windMasterOf: () => null,
    input: (player, msg) => sessions[player] !== undefined && applyInput(sessions[player], msg),
    clearInput: (player) => sessions[player] !== undefined && clearSessionInput(sessions[player]),

    start() {
      if (m.phase === 'playing') return;
      if (m.phase === 'matchOver') Object.assign(m, { round: 1, tally: ZERO, scores: ZERO });
      else if (m.phase === 'roundOver') m.round += 1;
      m.result = null;
      m.elapsed = 0;
      for (const s of both) s.start({ level: m.round, lives: START_LIVES, runScore: 0 });
      m.phase = 'playing';
    },

    update(dt) {
      if (m.phase !== 'playing') return;
      if (!sessions[1].paused) m.elapsed += dt;
      if (leash) {
        sessions[1].leash = raceLeash(sessions[2].walker.z);
        sessions[2].leash = raceLeash(sessions[1].walker.z);
      }
      for (const s of both) s.update(dt);
      finish();
    },

    // Both lanes pause together (a falling lane too, which the single session would refuse).
    togglePause() {
      if (m.phase !== 'playing') return;
      const next = !sessions[1].paused;
      for (const s of both) s.paused = next;
    },
  };
}

function createWindMaster(seed, rounds) {
  let wind = null; // this level's controlled wind: the session builds a fresh one each time a level begins
  const session = createSession({
    seed,
    ledgeClockAfter: LEDGE_CLOCK_START_S,
    windSource: ({ maxForce }) => (wind = createControlledWind({ maxForce: windMasterForce(maxForce) })),
  });
  const m = { phase: 'lobby', round: 1, result: null, scores: ZERO };
  let walker = 1; // who walks this round (or, between rounds, the next one)
  let level = 1;
  let fallsCaused = 0;
  let seenFalls = 0;
  const other = (p) => (p === 1 ? 2 : 1);
  const playing = () => m.phase === 'playing' && session.phase === 'playing' && !session.paused;
  // A gust is booked against the session clock, which stands still while he waits on the ledge: refuse until it runs.
  const gustable = () => playing() && session.time > 0;

  function endRound() {
    const won = session.phase === 'won';
    const walkerPoints = won ? session.result.score : 0;
    const windPoints = fallsCaused * WIND_MASTER_FALL_POINTS;
    const windMaster = other(walker);
    m.scores = pair(m.scores[1] + (walker === 1 ? walkerPoints : windPoints), m.scores[2] + (walker === 2 ? walkerPoints : windPoints));
    const last = m.round >= rounds;
    const [a, b] = [m.scores[1], m.scores[2]];
    m.result = {
      kind: 'windmaster',
      round: m.round,
      level: session.level,
      walker,
      windMaster,
      outcome: won ? 'won' : 'gameover',
      walkerResult: session.result,
      fallsCaused,
      roundScores: { [walker]: walkerPoints, [windMaster]: windPoints },
      scores: m.scores,
      matchWinner: last && a !== b ? (a > b ? 1 : 2) : 0, // 0 until the match is over, and for a draw
    };
    level = won ? session.level + 1 : session.level; // a failed level is the next player's to try
    if (!last) walker = windMaster; // roles swap; result.walker still names the one who just walked
    m.phase = last ? 'matchOver' : 'roundOver';
  }

  return {
    mode: 'windmaster',
    players: [1, 2],
    sessions: { 1: session },
    get phase() { return m.phase; },
    get round() { return m.round; },
    get level() { return session.level; },
    get result() { return m.result; },
    get scores() { return m.scores; },
    get paused() { return session.paused; },
    get gustReady() { return gustable() && wind.ready(session.time); },
    // Seconds until the Wind Master may send another gust: 0 when ready or when no round is running, Infinity while the
    // walker is still on the ledge (the clock has not started, so there is nothing to count down).
    get gustIn() { return gustable() ? wind.readyIn(session.time) : playing() ? Infinity : 0; },
    get canChangeMode() { return m.phase === 'lobby' || m.phase === 'matchOver'; }, // not between rounds: a switch would wipe the tally
    walkerOf: () => walker,
    windMasterOf: () => other(walker),
    clearInput: (player) => player === walker && clearSessionInput(session),

    input(player, msg) {
      if (player !== 1 && player !== 2) return false;
      if (msg.t === 'gust') {
        return player === other(walker) && gustable() && wind.trigger(msg.dir, session.time);
      }
      return player === walker && applyInput(session, msg);
    },

    start() {
      if (m.phase === 'playing') return;
      if (m.phase === 'matchOver') {
        Object.assign(m, { round: 1, scores: ZERO });
        walker = 1;
        level = 1;
      } else if (m.phase === 'roundOver') {
        m.round += 1;
      }
      m.result = null;
      fallsCaused = 0;
      seenFalls = 0;
      clearSessionInput(session);
      session.start({ level, lives: START_LIVES, runScore: 0 }); // a fresh walker: full lives
      m.phase = 'playing';
    },

    update(dt) {
      if (m.phase !== 'playing') return;
      session.update(dt);
      if (session.levelFalls > seenFalls) {
        seenFalls = session.levelFalls;
        // A fall counts for the Wind Master when the walker toppled with a gust blowing or just over. Stepping into a
        // gap is the walker's own doing.
        if (session.fallCause === 'balance' && wind.blewWithin(session.time)) fallsCaused += 1;
      }
      if (session.phase === 'won' || session.phase === 'gameover') endRound();
    },

    togglePause() {
      if (m.phase === 'playing') session.togglePause();
    },
  };
}
