import { describe, it, expect } from 'vitest';
import { createMatch, WINDMASTER_ROUNDS, WIND_MASTER_MIN_FORCE, windMasterForce } from '../src/game/match.js';
import { createWalker } from '../src/game/balance.js';
import { createSession, distanceToNextGap, START_LIVES, FALL_DURATION, WIND_WARNING_S } from '../src/game/session.js';
import { createControlledWind, GUST_COOLDOWN_S, CONTROLLED_GUST_S } from '../src/game/wind.js';
import { forecastAt } from '../src/game/forecast.js';
import { difficulty, MAX_WIND } from '../src/game/difficulty.js';
import { WIND_MASTER_FALL_POINTS } from '../src/game/scoring.js';
import { onBridge, steppedOn } from './helpers/onBridge.js';
import { START_Z } from '../src/game/session.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));
// One bot step for a walker: keep balance, walk, jump at a gap's edge. Goes through match.input like a phone would.
function drive(match, player, { walk = true } = {}) {
  const s = match.sessions[match.mode === 'windmaster' ? 1 : player];
  const d = distanceToNextGap(s.gaps, s.walker.z);
  match.input(player, { t: 'tilt', v: steady(s.walker) });
  match.input(player, { t: 'walk', on: walk });
  if (walk && s.phase === 'playing' && !s.walker.airborne && d > 0 && d < 0.35) match.input(player, { t: 'jump' });
}
function runUntil(match, done, maxSeconds, each) {
  for (let t = 0; t < maxSeconds && !done(); t += DT) {
    each?.();
    match.update(DT);
  }
}
const FALL_TICKS = Math.ceil((FALL_DURATION + 0.2) / DT);

describe('createControlledWind', () => {
  it('is calm until triggered, with the same force/peek shape as createWind', () => {
    const w = createControlledWind({ maxForce: 0.5 });
    expect(w.force(0)).toBe(0);
    expect(w.force(100)).toBe(0);
    expect(forecastAt(w, 3)).toEqual({ state: 'calm', dir: 0, strength: 0, eta: Infinity, remaining: 0 });
  });

  it('books a gust to start WIND_WARNING_S after the trigger, signed by dir and scaled by maxForce', () => {
    const w = createControlledWind({ maxForce: 0.6 });
    expect(w.trigger(-1, 2)).toBe(true);
    const g = w.peek(2);
    expect(g.start).toBeCloseTo(2 + WIND_WARNING_S, 9);
    expect(g.length).toBe(CONTROLLED_GUST_S);
    expect(g.strength).toBeCloseTo(-0.6, 9);
    expect(w.force(2 + WIND_WARNING_S - 0.01)).toBe(0); // nothing blows during the warning
    expect(w.force(g.start + g.length / 2)).toBeCloseTo(-0.6, 9); // the peak, pushing left
    expect(w.force(g.start + g.length + 0.01)).toBe(0);
  });

  it('gives the forecast a full warning, then the gust, then calm', () => {
    const w = createControlledWind({ maxForce: 0.6 });
    w.trigger(1, 0);
    expect(forecastAt(w, 0)).toMatchObject({ state: 'warning', dir: 1, eta: WIND_WARNING_S });
    expect(forecastAt(w, 1.0)).toMatchObject({ state: 'warning', dir: 1 });
    expect(forecastAt(w, 1.0).eta).toBeCloseTo(0.8, 9);
    expect(forecastAt(w, WIND_WARNING_S + 0.5)).toMatchObject({ state: 'gust', dir: 1, eta: 0 });
    expect(forecastAt(w, WIND_WARNING_S + CONTROLLED_GUST_S + 0.01).state).toBe('calm');
  });

  it('refuses a second trigger until the cooldown is over and the gust has finished', () => {
    const w = createControlledWind({ maxForce: 0.6 });
    expect(w.trigger(1, 0)).toBe(true);
    expect(w.ready(0)).toBe(false);
    expect(w.trigger(-1, 0.5)).toBe(false); // while the warning runs
    expect(w.trigger(-1, WIND_WARNING_S + 0.5)).toBe(false); // while it blows
    const free = Math.max(GUST_COOLDOWN_S, WIND_WARNING_S + CONTROLLED_GUST_S);
    expect(w.readyIn(1)).toBeCloseTo(free - 1, 9);
    expect(w.trigger(-1, free - 0.01)).toBe(false);
    expect(w.trigger(-1, free)).toBe(true);
    expect(w.peek(free + 0.1).strength).toBeLessThan(0);
  });

  it('never has more than one gust pending, and the next warning is always the full length', () => {
    const w = createControlledWind({ maxForce: 1 });
    let t = 0;
    for (let i = 0; i < 6; i++) {
      while (!w.trigger(i % 2 ? -1 : 1, t)) t += 0.05;
      expect(forecastAt(w, t).eta).toBeCloseTo(WIND_WARNING_S, 6);
    }
  });

  it('rejects a bad direction', () => {
    const w = createControlledWind({});
    for (const d of [0, 2, '1', NaN, undefined]) expect(w.trigger(d, 0)).toBe(false);
    expect(w.ready(0)).toBe(true);
  });

  it('works as a session wind source and the session forecast follows it', () => {
    let wind;
    const s = createSession({ seed: 3, windSource: ({ maxForce }) => (wind = createControlledWind({ maxForce })) });
    s.level = 4;
    s.start();
    onBridge(s); // levels start on the safe ledge; these tests begin on the first plank
    expect(s.forecast.state).toBe('calm');
    for (let i = 0; i < 60; i++) { s.input.tilt = steady(s.walker); s.update(DT); }
    expect(wind.trigger(1, s.time)).toBe(true);
    s.update(DT);
    expect(s.forecast).toMatchObject({ state: 'warning', dir: 1 });
    expect(s.forecast.eta).toBeCloseTo(WIND_WARNING_S - DT, 6);
    expect(s.forecast.strength).toBeCloseTo(difficulty(4).maxWind / 1.2, 6);
  });
});

describe('session options', () => {
  it('infiniteLives: a fall costs no life and never ends the run', () => {
    const s = createSession({ seed: 5, infiniteLives: true });
    s.start();
    onBridge(s); // levels start on the safe ledge; these tests begin on the first plank
    for (let i = 0; i < 5; i++) {
      s.walker = { ...s.walker, lean: 1.2 };
      s.update(DT);
      expect(s.phase).toBe('falling');
      for (let k = 0; k < FALL_TICKS; k++) s.update(DT);
      expect(s.phase).toBe('playing');
    }
    expect(s.lives).toBe(START_LIVES);
    expect(s.levelFalls).toBe(5);
  });

  it('start({ level, lives }) overrides the level and lives; plain start() is unchanged', () => {
    const s = createSession({ seed: 5 });
    s.start({ level: 3, lives: 2 });
    onBridge(s); // levels start on the safe ledge; these tests begin on the first plank
    expect(s).toMatchObject({ level: 3, lives: 2, phase: 'playing' });
    const t = createSession({ seed: 5 });
    t.start();
    onBridge(t); // levels start on the safe ledge; these tests begin on the first plank
    expect(t).toMatchObject({ level: 1, lives: START_LIVES });
  });

  it('halt() freezes a level in progress until start()', () => {
    const s = createSession({ seed: 5 });
    s.start();
    onBridge(s); // levels start on the safe ledge; these tests begin on the first plank
    s.input.walking = true;
    for (let i = 0; i < 60; i++) { s.input.tilt = steady(s.walker); s.update(DT); }
    s.halt();
    const z = s.walker.z;
    const time = s.time;
    for (let i = 0; i < 60; i++) s.update(DT);
    expect(s.walker.z).toBe(z);
    expect(s.time).toBe(time);
    s.start();
    onBridge(s); // levels start on the safe ledge; these tests begin on the first plank
    expect(s).toMatchObject({ halted: false, time: 0 });
  });

  it('halt() calms the forecast: a lane stopped mid-gust must not keep its WIND warning on the results', () => {
    const s = createSession({ seed: 5 });
    s.start();
    onBridge(s);
    s.input.walking = true;
    for (let i = 0; i < 1800 && s.forecast.state === 'calm'; i++) { s.input.tilt = steady(s.walker); s.update(DT); }
    expect(s.forecast.state).not.toBe('calm');
    s.halt();
    expect(s.forecast.state).toBe('calm');
  });
});

describe('solo match', () => {
  it('is the session: same phases, one player, input from player 1 only', () => {
    const m = createMatch({ mode: 'solo', seed: 5 });
    expect(m).toMatchObject({ mode: 'solo', players: [1], phase: 'lobby', round: 1 });
    expect(Object.keys(m.sessions)).toEqual(['1']);
    expect(m.walkerOf()).toBeNull();
    expect(m.windMasterOf()).toBeNull();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m.phase).toBe('playing');
    expect(m.input(2, { t: 'walk', on: true })).toBe(false);
    expect(m.sessions[1].input.walking).toBe(false);
    expect(m.input(1, { t: 'walk', on: true })).toBe(true);
    expect(m.input(1, { t: 'gust', dir: 1 })).toBe(false);
    runUntil(m, () => m.phase === 'won', 120, () => drive(m, 1));
    expect(m.phase).toBe('won');
    expect(m.result).toBe(m.sessions[1].result);
    expect(m.scores[1]).toBe(m.sessions[1].runScore);
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m).toMatchObject({ phase: 'playing', level: 2, round: 2 });
  });

  it('falls cost lives, exactly as before', () => {
    const m = createMatch({ mode: 'solo', seed: 5 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.sessions[1].walker = { ...m.sessions[1].walker, lean: 1.2 };
    m.update(DT);
    expect(m.phase).toBe('falling');
    expect(m.sessions[1].lives).toBe(START_LIVES - 1);
  });

  it('an unknown mode falls back to solo', () => {
    expect(createMatch({ mode: 'coop' }).mode).toBe('solo');
    expect(createMatch().mode).toBe('solo');
  });
});

describe('race match', () => {
  const race = (opts) => createMatch({ mode: 'race', leash: false, countdown: 0, seed: 7, ...opts });

  it('has two sessions in the lobby, and start() begins both', () => {
    const m = race();
    expect(m).toMatchObject({ mode: 'race', players: [1, 2], phase: 'lobby', round: 1, tally: { 1: 0, 2: 0 } });
    expect(m.walkerOf()).toBeNull();
    expect(m.windMasterOf()).toBeNull();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m.phase).toBe('playing');
    expect([m.sessions[1].phase, m.sessions[2].phase]).toEqual(['playing', 'playing']);
  });

  it('gives both lanes identical gaps and identical wind', () => {
    const m = race({ winsToWin: 99 });
    for (let level = 1; level <= 7; level++) {
      m.start();
      onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
      expect(m.level).toBe(level);
      expect(m.sessions[1].gaps).toEqual(m.sessions[2].gaps);
      expect(m.sessions[1].gaps.length).toBeGreaterThan(0);
      m.sessions[1].walker = { ...m.sessions[1].walker, z: 59.99 }; // player 1 steps over the line
      m.sessions[1].gaps = [];
      m.input(1, { t: 'walk', on: true });
      m.update(DT);
      expect(m.phase).toBe('roundOver');
    }
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.input(1, { t: 'walk', on: false });
    const a = m.sessions[1];
    const b = m.sessions[2];
    const states = new Set();
    for (let i = 0; i < 60 * 40; i++) {
      for (const p of [1, 2]) drive(m, p, { walk: false });
      m.update(DT);
      expect(b.forecast).toEqual(a.forecast);
      expect(b.walker.lean).toBe(a.walker.lean); // the same wind pushes the same way
      states.add(a.forecast.state);
    }
    expect(states.has('gust')).toBe(true); // the comparison was not of two calm lanes
  });

  it('routes each phone to its own walker', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.input(2, { t: 'walk', on: true });
    m.input(1, { t: 'tilt', v: 0.4 });
    m.input(2, { t: 'run', on: true });
    m.input(2, { t: 'jump' });
    expect(m.sessions[1].input).toEqual({ tilt: 0.4, walking: false, running: false, jump: false });
    expect(m.sessions[2].input).toEqual({ tilt: 0, walking: true, running: true, jump: true });
    expect(m.input(3, { t: 'walk', on: true })).toBe(false);
    expect(m.input(1, { t: 'gust', dir: 1 })).toBe(false); // no Wind Master in a race
    m.clearInput(2);
    expect(m.sessions[2].input).toEqual({ tilt: 0, walking: false, running: false, jump: false });
  });

  it('ends the round when one player reaches the end, and freezes the other', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.sessions[2].walker = { ...m.sessions[2].walker, z: START_Z }; // player 2 waits on the safe ledge
    runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 1); drive(m, 2, { walk: false }); });
    expect(m.phase).toBe('roundOver');
    expect(m.result).toMatchObject({
      kind: 'race',
      winner: 1,
      round: 1,
      finished: { 1: true, 2: false },
      tally: { 1: 1, 2: 0 },
      matchWinner: 0,
    });
    expect(m.result.times[1]).toBeGreaterThan(30);
    expect(m.result.times[2]).toBe(m.result.times[1]); // one round clock for both (his own lane clock only started after 4 s on the ledge)
    expect(m.sessions[2].time).toBeLessThan(m.result.times[2]);
    expect(m.tally).toEqual({ 1: 1, 2: 0 });
    expect(m.scores[1]).toBe(m.sessions[1].result.score);
    expect(m.scores[2]).toBe(0);
    const frozen = { ...m.sessions[2].walker };
    m.input(2, { t: 'walk', on: true });
    for (let i = 0; i < 120; i++) m.update(DT);
    expect(m.sessions[2].walker).toEqual(frozen);
  });

  it('declares player 2 the winner when player 2 gets there first', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 2); drive(m, 1, { walk: false }); });
    expect(m.result).toMatchObject({ winner: 2, tally: { 1: 0, 2: 1 } });
  });

  it('a tie in the same tick goes to the further walker, then to player 1', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    for (const p of [1, 2]) m.sessions[p].walker = { ...m.sessions[p].walker, z: 59.99 };
    m.sessions[1].gaps = [];
    m.sessions[2].gaps = [];
    for (const p of [1, 2]) m.input(p, { t: 'walk', on: true });
    m.update(DT);
    expect(m.phase).toBe('roundOver');
    expect(m.result.winner).toBe(1);
    expect(m.result.finished).toEqual({ 1: true, 2: true });
  });

  describe('the shared round clock', () => {
    it('counts from start(), stands still while paused and after the round, and restarts with the next round', () => {
      const m = race();
      expect(m.elapsed).toBe(0);
      m.start();
      for (let i = 0; i < 120; i++) m.update(DT);
      expect(m.elapsed).toBeCloseTo(2, 6); // the ledge wait counts: this is the clock on the wall
      m.togglePause();
      for (let i = 0; i < 120; i++) m.update(DT);
      expect(m.elapsed).toBeCloseTo(2, 6);
      m.togglePause();
      m.update(DT);
      expect(m.elapsed).toBeCloseTo(2 + DT, 6);
      onBridge(m);
      runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 1); drive(m, 2, { walk: false }); });
      const end = m.elapsed;
      for (let i = 0; i < 60; i++) m.update(DT);
      expect(m.elapsed).toBe(end);
      m.start();
      expect(m.elapsed).toBe(0);
    });

    it('the result times are that clock, for both lanes; the one who did not finish reads DNF', () => {
      const m = race();
      m.start();
      onBridge(m);
      m.sessions[2].walker = { ...m.sessions[2].walker, z: START_Z }; // player 2 waits on the ledge
      runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 1); drive(m, 2, { walk: false }); });
      expect(m.result.times).toEqual({ 1: m.elapsed, 2: m.elapsed });
      expect(m.result.times[1]).toBeGreaterThan(m.sessions[1].time - 1e-9); // never less than the lane clock
      expect(m.result.finished).toEqual({ 1: true, 2: false });
    });

    // Player 1 steps on at once; player 2 waits on the ledge, so his lane clock (which skips the wait) runs well behind
    // player 1's. Then both are put on the last metre and cross in the same frame.
    function sameFrameFinish(z1, z2) {
      const m = race();
      m.start();
      m.sessions[1].walker = { ...m.sessions[1].walker, z: 0 };
      for (let i = 0; i < 60 * 5; i++) { drive(m, 1); drive(m, 2, { walk: false }); m.update(DT); }
      expect(m.sessions[1].time).toBeGreaterThan(4.5);
      expect(m.sessions[2].time).toBeLessThan(1.5); // the ledge wait is not in it
      m.sessions[1].walker = { ...createWalker(), z: z1 };
      m.sessions[2].walker = { ...createWalker(), z: z2 };
      m.sessions[1].gaps = [];
      m.sessions[2].gaps = [];
      for (const p of [1, 2]) { m.input(p, { t: 'tilt', v: 0 }); m.input(p, { t: 'walk', on: true }); }
      m.update(DT);
      return m;
    }

    it('a same-frame finish after different ledge waits is not decided by the ledge wait: equal distance goes to player 1', () => {
      const m = sameFrameFinish(59.99, 59.99);
      expect(m.result.finished).toEqual({ 1: true, 2: true });
      expect(m.sessions[2].time).toBeLessThan(m.sessions[1].time); // the lane clock would have given it to player 2
      expect(m.result.winner).toBe(1);
      expect(m.result.times[1]).toBe(m.result.times[2]);
    });

    it('...and the further walker wins, whatever his lane clock says', () => {
      const m = sameFrameFinish(59.98, 59.995);
      expect(m.result.finished).toEqual({ 1: true, 2: true });
      expect(m.sessions[1].walker.z).toBeLessThan(m.sessions[2].walker.z);
      expect(m.result.winner).toBe(2);
    });
  });

  it('falls cost no lives, and the round goes on', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.sessions[1].walker = { ...m.sessions[1].walker, z: START_Z }; // player 1 waits on the safe ledge
    const s = m.sessions[2];
    for (let i = 0; i < 4; i++) {
      s.walker = { ...s.walker, lean: 1.2 };
      m.update(DT);
      expect(s.phase).toBe('falling');
      expect(m.sessions[1].phase).toBe('playing'); // the other lane is not held up
      for (let k = 0; k < FALL_TICKS; k++) m.update(DT);
    }
    expect(m.phase).toBe('playing');
    expect(s.phase).toBe('playing');
    expect(s.lives).toBe(START_LIVES);
    expect(s.levelFalls).toBe(4);
  });

  it('the next round is the next level, with both lanes fresh and the tally kept', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 1); drive(m, 2, { walk: false }); });
    const level1 = m.sessions[1].gaps;
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m).toMatchObject({ phase: 'playing', round: 2, level: 2, result: null, tally: { 1: 1, 2: 0 } });
    for (const p of [1, 2]) expect(m.sessions[p]).toMatchObject({ phase: 'playing', level: 2, time: 0, levelFalls: 0, halted: false });
    expect(m.sessions[1].gaps).toEqual(m.sessions[2].gaps);
    expect(m.sessions[1].gaps).not.toEqual(level1);
    expect(m.sessions[2].walker.z).toBe(0);
  });

  it('ends the match when a player has enough round wins, and start() then begins a new match', () => {
    const m = race({ winsToWin: 2 });
    for (let r = 1; r <= 2; r++) {
      m.start();
      onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
      runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 1); drive(m, 2, { walk: false }); });
    }
    expect(m.phase).toBe('matchOver');
    expect(m.result).toMatchObject({ round: 2, winner: 1, matchWinner: 1, tally: { 1: 2, 2: 0 } });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m).toMatchObject({ phase: 'playing', round: 1, level: 1, tally: { 1: 0, 2: 0 }, scores: { 1: 0, 2: 0 } });
  });

  it('pauses and resumes both lanes together', () => {
    const m = race();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.togglePause();
    expect(m.paused).toBe(true);
    const z = m.sessions[1].time;
    for (let i = 0; i < 30; i++) m.update(DT);
    expect(m.sessions[1].time).toBe(z);
    expect(m.sessions[2].time).toBe(z);
    m.togglePause();
    expect(m.paused).toBe(false);
    m.update(DT);
    expect(m.sessions[2].time).toBeGreaterThan(z);
  });

  it('allows a mode change only in the lobby and when the match is over, not between rounds (it would wipe the tally)', () => {
    const m = race({ winsToWin: 2 });
    expect(m.canChangeMode).toBe(true);
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m.canChangeMode).toBe(false);
    for (let round = 1; round <= 2; round++) {
      runUntil(m, () => m.phase !== 'playing', 120, () => { drive(m, 1); drive(m, 2, { walk: false }); });
      if (round === 1) {
        expect(m.phase).toBe('roundOver');
        expect(m.canChangeMode).toBe(false);
        m.start();
        onBridge(m);
      }
    }
    expect(m.phase).toBe('matchOver');
    expect(m.canChangeMode).toBe(true);
  });
});

describe('windmaster match', () => {
  const wm = (opts) => createMatch({ mode: 'windmaster', seed: 9, ...opts });
  const tick = (m, n) => { for (let i = 0; i < n; i++) m.update(DT); };

  it('player 1 walks first and player 2 is the Wind Master; one session', () => {
    const m = wm();
    expect(m).toMatchObject({ mode: 'windmaster', players: [1, 2], phase: 'lobby', round: 1 });
    expect(Object.keys(m.sessions)).toEqual(['1']);
    expect(m.walkerOf()).toBe(1);
    expect(m.windMasterOf()).toBe(2);
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m.phase).toBe('playing');
    expect(m.sessions[1]).toMatchObject({ phase: 'playing', lives: START_LIVES, level: 1 });
  });

  it('has no wind of its own: it stays calm until the Wind Master asks', () => {
    const m = wm();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    for (let i = 0; i < 60 * 30; i++) { drive(m, 1, { walk: false }); m.update(DT); expect(m.sessions[1].forecast.state).toBe('calm'); }
  });

  it('a gust: a 1.8 s forecast warning, then the gust, then calm', () => {
    const m = wm();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    tick(m, 30);
    expect(m.gustReady).toBe(true);
    expect(m.input(2, { t: 'gust', dir: -1 })).toBe(true);
    const s = m.sessions[1];
    const t0 = s.time;
    m.update(DT);
    expect(s.forecast).toMatchObject({ state: 'warning', dir: -1 });
    expect(s.forecast.eta).toBeCloseTo(WIND_WARNING_S - DT, 6);
    const seen = new Set();
    let pushedLeft = false;
    for (let i = 0; i < 60 * 4; i++) {
      drive(m, 1, { walk: false });
      m.update(DT);
      seen.add(s.forecast.state);
      if (s.forecast.state === 'gust' && s.forecast.dir === -1) pushedLeft = true;
      if (s.forecast.state === 'warning') expect(s.time - t0).toBeLessThan(WIND_WARNING_S + 0.05);
    }
    expect([...seen]).toEqual(['warning', 'gust', 'calm']);
    expect(pushedLeft).toBe(true);
  });

  it('gusts have a floor: level 1 (maxWind 0.25) still blows at WIND_MASTER_MIN_FORCE', () => {
    expect(difficulty(1).maxWind).toBeLessThan(WIND_MASTER_MIN_FORCE);
    const m = wm();
    m.start();
    steppedOn(m); // the clock runs, so gusts are accepted
    m.input(2, { t: 'gust', dir: 1 });
    m.update(DT);
    expect(m.sessions[1].forecast.strength).toBeCloseTo(WIND_MASTER_MIN_FORCE / MAX_WIND, 6);
    // ...and it really pushes: the peak of a floor-strength gust shoves the lean harder than level 1's own 0.25 could
    const lean = (force) => {
      const w = createControlledWind({ maxForce: force });
      w.trigger(1, 0);
      return w.force(WIND_WARNING_S + 0.75);
    };
    expect(lean(WIND_MASTER_MIN_FORCE)).toBeGreaterThan(2.5 * lean(difficulty(1).maxWind));
  });

  it('a level whose own maxWind is above the floor keeps it', () => {
    expect(difficulty(6).maxWind).toBeGreaterThan(WIND_MASTER_MIN_FORCE);
    expect(windMasterForce(difficulty(6).maxWind)).toBe(difficulty(6).maxWind);
    expect(windMasterForce(difficulty(1).maxWind)).toBe(WIND_MASTER_MIN_FORCE);
    expect(windMasterForce(MAX_WIND)).toBe(MAX_WIND);
  });

  it('a gust that blows pushes the walker the way it points', () => {
    const lean = (dir) => {
      const m = wm();
      m.start();
      steppedOn(m); // the clock runs, so gusts are accepted
      m.input(2, { t: 'gust', dir });
      tick(m, 60 * 3); // no tilt from the walker: the wind alone moves the lean
      return m.sessions[1].walker.leanVel;
    };
    expect(lean(1)).toBeGreaterThan(lean(-1));
  });

  it('holds the cooldown: gusts too close together are refused, then allowed', () => {
    const m = wm();
    m.start();
    steppedOn(m); // the clock runs, so gusts are accepted
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(true);
    expect(m.gustReady).toBe(false);
    expect(m.input(2, { t: 'gust', dir: -1 })).toBe(false);
    tick(m, 60 * 1);
    expect(m.input(2, { t: 'gust', dir: -1 })).toBe(false);
    expect(m.gustIn).toBeGreaterThan(2);
    tick(m, Math.ceil(60 * 2.4));
    expect(m.gustReady).toBe(true);
    expect(m.gustIn).toBe(0);
    expect(m.input(2, { t: 'gust', dir: -1 })).toBe(true);
  });

  it('ignores gusts from the walker, and walker inputs from the Wind Master', () => {
    const m = wm();
    m.start();
    steppedOn(m); // the clock runs, so gusts are accepted
    expect(m.input(1, { t: 'gust', dir: 1 })).toBe(false);
    expect(m.gustReady).toBe(true); // nothing was booked
    expect(m.input(2, { t: 'walk', on: true })).toBe(false);
    expect(m.input(2, { t: 'tilt', v: 1 })).toBe(false);
    expect(m.input(2, { t: 'jump' })).toBe(false);
    expect(m.sessions[1].input).toEqual({ tilt: 0, walking: false, running: false, jump: false });
    expect(m.input(1, { t: 'walk', on: true })).toBe(true);
    expect(m.input(1, { t: 'tilt', v: -0.3 })).toBe(true);
    expect(m.sessions[1].input).toMatchObject({ tilt: -0.3, walking: true });
    expect(m.input(3, { t: 'gust', dir: 1 })).toBe(false);
    expect(m.input(2, { t: 'gust', dir: 5 })).toBe(false);
  });

  it('refuses gusts outside play: in the lobby, while paused, and while the walker is falling', () => {
    const m = wm();
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(false);
    expect(m.gustReady).toBe(false);
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.togglePause();
    expect(m.paused).toBe(true);
    expect(m.gustReady).toBe(false);
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(false);
    m.togglePause();
    m.sessions[1].walker = { ...m.sessions[1].walker, lean: 1.2 };
    m.update(DT);
    expect(m.sessions[1].phase).toBe('falling');
    expect(m.phase).toBe('playing');
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(false);
  });

  it('counts a fall caused by a gust, but not one with no wind or a step into a gap', () => {
    const m = wm();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const s = m.sessions[1];
    const topple = () => { s.walker = { ...s.walker, lean: 1.2 }; m.update(DT); };
    // calm fall
    topple();
    expect(m.sessions[1].fallCause).toBe('balance');
    tick(m, FALL_TICKS);
    // gap fall
    s.walker = { ...s.walker, z: s.gaps[0].start - 0.1 };
    m.input(1, { t: 'walk', on: true });
    runUntil(m, () => s.phase === 'falling', 5);
    expect(s.fallCause).toBe('gap');
    m.input(1, { t: 'walk', on: false });
    tick(m, FALL_TICKS);
    // the gust fall: the walker is leaning as the gust blows, and goes over
    m.input(2, { t: 'gust', dir: 1 });
    runUntil(m, () => s.forecast.state === 'gust', 5, () => drive(m, 1, { walk: false }));
    expect(s.forecast.state).toBe('gust');
    s.walker = { ...s.walker, lean: 0.9, leanVel: 0 };
    runUntil(m, () => s.phase === 'falling', 10);
    expect(s.phase).toBe('falling');
    expect(s.fallCause).toBe('balance');
    expect(m.result).toBeNull();
    expect(s.lives).toBe(0);
    tick(m, FALL_TICKS);
    // game over: three falls, one of them caused
    expect(m.phase).toBe('roundOver');
    expect(m.result).toMatchObject({
      kind: 'windmaster', walker: 1, windMaster: 2, outcome: 'gameover', fallsCaused: 1,
      roundScores: { 1: 0, 2: WIND_MASTER_FALL_POINTS }, scores: { 1: 0, 2: WIND_MASTER_FALL_POINTS },
    });
    expect(m.result.walkerResult).toMatchObject({ kind: 'run' });
  });

  it('a fall just after a gust ended still counts for the Wind Master', () => {
    const m = wm();
    m.start();
    steppedOn(m); // the clock runs, so gusts are accepted
    const s = m.sessions[1];
    m.input(2, { t: 'gust', dir: 1 });
    tick(m, Math.round(60 * (WIND_WARNING_S + CONTROLLED_GUST_S + 0.5)));
    expect(s.forecast.state).toBe('calm');
    s.walker = { ...s.walker, lean: 1.2 };
    m.update(DT);
    expect(s.fallCause).toBe('balance');
    // (the walker was toppled by hand: the gust only ended half a second ago, inside the grace window)
    tick(m, FALL_TICKS);
    // a second fall, well after the gust
    tick(m, 60 * 3);
    s.walker = { ...s.walker, lean: 1.2 };
    m.update(DT);
    tick(m, FALL_TICKS);
    s.walker = { ...s.walker, lean: 1.2 };
    m.update(DT);
    tick(m, FALL_TICKS);
    expect(m.result.fallsCaused).toBe(1);
  });

  it('swaps the roles after a cleared level, scores both players, and starts the walker fresh on the next level', () => {
    const m = wm();
    m.start();
    steppedOn(m); // the clock runs, so gusts are accepted
    runUntil(m, () => m.phase !== 'playing', 200, () => drive(m, 1));
    expect(m.phase).toBe('roundOver');
    expect(m.result).toMatchObject({ kind: 'windmaster', round: 1, level: 1, walker: 1, windMaster: 2, outcome: 'won', fallsCaused: 0 });
    expect(m.result.walkerResult).toMatchObject({ kind: 'level', stars: expect.any(Number) });
    expect(m.scores[1]).toBe(m.result.walkerResult.score);
    expect(m.scores[2]).toBe(0);
    expect(m.walkerOf()).toBe(2);
    expect(m.windMasterOf()).toBe(1);
    m.start();
    steppedOn(m); // the clock runs, so gusts are accepted
    expect(m).toMatchObject({ phase: 'playing', round: 2, level: 2 });
    expect(m.sessions[1]).toMatchObject({ phase: 'playing', lives: START_LIVES, level: 2, levelFalls: 0 });
    expect(m.sessions[1].time).toBeLessThan(0.1);
    expect(m.input(1, { t: 'walk', on: true })).toBe(false); // the old walker is now the Wind Master
    expect(m.input(2, { t: 'walk', on: true })).toBe(true);
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(false);
    expect(m.input(1, { t: 'gust', dir: 1 })).toBe(true);
    expect(m.sessions[1].forecast.state).toBe('calm'); // booked; the next update shows the warning
    m.update(DT);
    expect(m.sessions[1].forecast.state).toBe('warning');
  });

  it('swaps roles after a game over too, and the next player retries the same level', () => {
    const m = wm();
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const s = m.sessions[1];
    for (let i = 0; i < START_LIVES; i++) {
      s.walker = { ...s.walker, lean: 1.2 };
      m.update(DT);
      tick(m, FALL_TICKS);
    }
    expect(m.phase).toBe('roundOver');
    expect(m.result).toMatchObject({ outcome: 'gameover', walker: 1, windMaster: 2, fallsCaused: 0, round: 1 });
    expect([m.walkerOf(), m.windMasterOf()]).toEqual([2, 1]);
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m).toMatchObject({ phase: 'playing', round: 2, level: 1 });
    expect(s).toMatchObject({ lives: START_LIVES, phase: 'playing', level: 1 });
  });

  it('keeps score across rounds, then ends the match and names a winner', () => {
    const m = wm({ rounds: 2 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    runUntil(m, () => m.phase !== 'playing', 200, () => drive(m, 1)); // round 1: P1 clears level 1
    expect(m.phase).toBe('roundOver');
    const p1 = m.scores[1];
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const s = m.sessions[1];
    for (let i = 0; i < START_LIVES; i++) { // round 2: P2 walks and falls out
      s.walker = { ...s.walker, lean: 1.2 };
      m.update(DT);
      tick(m, FALL_TICKS);
    }
    expect(m.phase).toBe('matchOver');
    expect(m.result).toMatchObject({ round: 2, walker: 2, windMaster: 1, outcome: 'gameover', matchWinner: 1 });
    expect(m.scores).toEqual({ 1: p1, 2: 0 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m).toMatchObject({ phase: 'playing', round: 1, level: 1, scores: { 1: 0, 2: 0 } });
    expect(m.walkerOf()).toBe(1);
  });

  it('exposes the default length of a match', () => {
    expect(WINDMASTER_ROUNDS).toBe(4);
  });

  it('allows a mode change only in the lobby and when the match is over, not between rounds (it would wipe the scores)', () => {
    const m = wm({ rounds: 2 });
    expect(m.canChangeMode).toBe(true);
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(m.canChangeMode).toBe(false);
    runUntil(m, () => m.phase !== 'playing', 200, () => drive(m, 1));
    expect(m.phase).toBe('roundOver');
    expect(m.canChangeMode).toBe(false);
    m.start();
    onBridge(m);
    runUntil(m, () => m.phase !== 'playing', 200, () => drive(m, 2));
    expect(m.phase).toBe('matchOver');
    expect(m.canChangeMode).toBe(true);
  });
});

// The TV reads tally and scores every frame (stateSync.changed, hud.renderRace / renderWindMaster), so reading them must not
// allocate: the same object comes back until the numbers change, and nobody can mutate it from outside.
describe('tally and scores are stable objects', () => {
  const finishRound = (m, player = 1) => {
    const s = m.sessions[m.mode === 'race' ? player : 1];
    s.walker = { ...s.walker, z: 59.99 };
    s.gaps = [];
    m.input(player, { t: 'walk', on: true });
    m.update(DT);
  };

  it('race: the same objects every read, replaced only when a round is won, and frozen', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 7, winsToWin: 3 });
    const [t0, s0] = [m.tally, m.scores];
    expect(m.tally).toBe(t0);
    expect(m.scores).toBe(s0);
    m.start();
    for (let i = 0; i < 30; i++) m.update(DT);
    expect(m.tally).toBe(t0);
    expect(m.scores).toBe(s0);
    expect(Object.isFrozen(m.tally) && Object.isFrozen(m.scores)).toBe(true);
    expect(() => { 'use strict'; m.tally[1] = 9; }).toThrow();
    finishRound(m, 2);
    expect(m.tally).not.toBe(t0);
    expect(m.tally).toEqual({ 1: 0, 2: 1 });
    expect(m.scores[2]).toBe(m.sessions[2].result.score);
    const [t1, s1] = [m.tally, m.scores];
    for (let i = 0; i < 30; i++) m.update(DT);
    expect(m.tally).toBe(t1);
    expect(m.scores).toBe(s1);
    expect(t0).toEqual({ 1: 0, 2: 0 }); // the old snapshot is untouched
  });

  it('race: a new match after matchOver starts from fresh zero objects', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 7, winsToWin: 1 });
    m.start();
    finishRound(m, 1);
    expect(m.phase).toBe('matchOver');
    expect(m.tally).toEqual({ 1: 1, 2: 0 });
    m.start();
    expect(m.tally).toEqual({ 1: 0, 2: 0 });
    expect(m.scores).toEqual({ 1: 0, 2: 0 });
    expect(m.result).toBe(null);
  });

  it('race: the result keeps its own snapshot of the tally and scores', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 7, winsToWin: 3 });
    m.start();
    finishRound(m, 1);
    expect(m.result.tally).toEqual({ 1: 1, 2: 0 });
    m.start();
    finishRound(m, 2);
    expect(m.tally).toEqual({ 1: 1, 2: 1 });
    expect(m.result.tally).toEqual({ 1: 1, 2: 1 });
  });

  it('windmaster: the same scores object until a round ends', () => {
    const m = createMatch({ mode: 'windmaster', seed: 9, rounds: 3 });
    const s0 = m.scores;
    m.start();
    for (let i = 0; i < 30; i++) m.update(DT);
    expect(m.scores).toBe(s0);
    expect(Object.isFrozen(m.scores)).toBe(true);
    finishRound(m, 1);
    expect(m.scores).not.toBe(s0);
    expect(m.scores[1]).toBe(m.result.walkerResult.score);
    expect(m.scores[2]).toBe(0);
    const s1 = m.scores;
    for (let i = 0; i < 30; i++) m.update(DT);
    expect(m.scores).toBe(s1);
    expect(s0).toEqual({ 1: 0, 2: 0 });
  });

  it('solo: scores is the run score, the same object until it changes', () => {
    const m = createMatch({ mode: 'solo', seed: 1 });
    const s0 = m.scores;
    expect(s0).toEqual({ 1: 0, 2: 0 });
    expect(m.scores).toBe(s0);
    m.start();
    finishRound(m, 1);
    expect(m.scores).not.toBe(s0);
    expect(m.scores).toEqual({ 1: m.sessions[1].runScore, 2: 0 });
    expect(m.scores).toBe(m.scores);
  });
});
