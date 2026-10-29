import { describe, it, expect } from 'vitest';
import { createMatch, raceLeash, RACE_LEASH, RACE_SPRINT } from '../src/game/match.js';
import { BRIDGE_LENGTH, START_Z, IDLE_GRACE } from '../src/game/session.js';
import { matchStateFor } from '../src/game/matchState.js';
import { raceHudView } from '../src/tv/matchHud.js';
import { statusText } from '../src/phone/status.js';
import { stateMessageFor } from '../src/tv/stateSync.js';

const DT = 1 / 60;
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));
const race = () => createMatch({ mode: 'race', seed: 7 });
// Both lanes with no gaps and no wind, so only the leash moves anything.
function calmRace() {
  const m = race();
  m.start();
  for (const p of [1, 2]) m.sessions[p].gaps = [];
  return m;
}
function play(m, seconds, { walk1 = true, walk2 = false, each } = {}) {
  for (let t = 0; t < seconds; t += DT) {
    for (const [p, walk] of [[1, walk1], [2, walk2]]) {
      m.input(p, { t: 'tilt', v: steady(m.sessions[p].walker) });
      m.input(p, { t: 'walk', on: walk });
    }
    each?.();
    m.update(DT);
  }
}

describe('raceLeash', () => {
  it('lets the leader get RACE_LEASH metres ahead of the other walker', () => {
    expect(raceLeash(START_Z)).toBe(START_Z + RACE_LEASH);
    expect(raceLeash(20)).toBe(20 + RACE_LEASH);
  });

  it('lets go once the leash would reach into the final sprint', () => {
    const free = BRIDGE_LENGTH - RACE_SPRINT - RACE_LEASH;
    expect(raceLeash(free - 0.01)).toBeCloseTo(BRIDGE_LENGTH - RACE_SPRINT - 0.01);
    expect(raceLeash(free)).toBeNull();
    expect(raceLeash(55)).toBeNull();
  });
});

describe('the race leader waits for the other', () => {
  it('stops RACE_LEASH ahead of a walker still on the ledge, and stands there safely', () => {
    const m = calmRace();
    play(m, 20);
    const a = m.sessions[1];
    expect(a.walker.z).toBeCloseTo(START_Z + RACE_LEASH, 5);
    expect(a.walker.speed).toBe(0); // he stands: no walking animation or footsteps
    expect(a.waiting).toBe(true);
    expect(a.levelFalls).toBe(0);
    expect(a.idleTime).toBe(0);
    expect(m.phase).toBe('playing');
  });

  it('waiting at the leash is not standing still: letting go of WALK there builds no keep-moving push', () => {
    const m = calmRace();
    play(m, 10);
    play(m, IDLE_GRACE * 4, { walk1: false });
    const a = m.sessions[1];
    expect(a.idleTime).toBe(0);
    expect(a.levelFalls).toBe(0);
    expect(a.waiting).toBe(true);
  });

  it('moves on as the other walker catches up', () => {
    const m = calmRace();
    play(m, 10);
    m.sessions[2].walker = { ...m.sessions[2].walker, z: 10 };
    play(m, 10);
    expect(m.sessions[1].walker.z).toBeCloseTo(10 + RACE_LEASH, 5);
  });

  it('runs free in the final sprint and can win the round', () => {
    const m = calmRace();
    m.sessions[2].walker = { ...m.sessions[2].walker, z: BRIDGE_LENGTH - RACE_SPRINT - RACE_LEASH };
    m.sessions[1].walker = { ...m.sessions[1].walker, z: BRIDGE_LENGTH - RACE_SPRINT };
    play(m, 15);
    expect(m.phase).toBe('roundOver');
    expect(m.result.winner).toBe(1);
  });

  it('a leash that ends over a gap holds him before its edge, not in it', () => {
    const m = race();
    m.start();
    const gap = { start: START_Z + RACE_LEASH - 0.5, end: START_Z + RACE_LEASH + 0.7 };
    for (const p of [1, 2]) m.sessions[p].gaps = [gap];
    play(m, 15);
    const a = m.sessions[1];
    expect(a.levelFalls).toBe(0);
    expect(a.walker.z).toBeLessThan(gap.start);
    expect(a.walker.z).toBeGreaterThan(gap.start - 0.2);
    expect(a.waiting).toBe(true);
  });

  it('a jump that lands past the leash is not pulled back', () => {
    const m = calmRace();
    play(m, 10);
    m.input(1, { t: 'jump' });
    play(m, 2);
    const a = m.sessions[1];
    expect(a.walker.z).toBeGreaterThan(START_Z + RACE_LEASH + 1);
    const landed = a.walker.z;
    play(m, 5);
    expect(a.walker.z).toBe(landed);
    expect(a.levelFalls).toBe(0);
  });

  it('the laggard is never held back by the leader', () => {
    const m = calmRace();
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 30 };
    play(m, 5, { walk1: false, walk2: true });
    expect(m.sessions[2].waiting).toBe(false);
    expect(m.sessions[2].walker.z).toBeGreaterThan(START_Z + 5);
  });

  it('solo has no leash', () => {
    const m = createMatch({ mode: 'solo', seed: 7 });
    m.start();
    m.sessions[1].gaps = [];
    for (let t = 0; t < 15; t += DT) {
      m.input(1, { t: 'tilt', v: steady(m.sessions[1].walker) });
      m.input(1, { t: 'walk', on: true });
      m.update(DT);
    }
    expect(m.sessions[1].leash).toBeNull();
    expect(m.sessions[1].waiting).toBe(false);
    expect(m.sessions[1].walker.z).toBeGreaterThan(START_Z + RACE_LEASH + 5);
  });
});

describe('the leash on screen', () => {
  it('the TV panel and the leader\'s phone say who he waits for; the other phone does not', () => {
    const m = calmRace();
    play(m, 10);
    expect(raceHudView(m).players[1].waiting).toBe(true);
    expect(raceHudView(m).players[2].waiting).toBe(false);
    expect(matchStateFor(m, 1).waiting).toBe(true);
    expect(matchStateFor(m, 2).waiting).toBe(false);
    expect(statusText(stateMessageFor(m, 1), 1)).toMatch(/^Wait for P2/);
    expect(statusText(stateMessageFor(m, 2), 2)).not.toMatch(/Wait for/);
  });

  it('is gone while paused and once the round is over', () => {
    const m = calmRace();
    play(m, 10);
    m.togglePause();
    expect(raceHudView(m).players[1].waiting).toBe(false);
    m.togglePause();
    // Both into the final sprint (the leash binds whoever is ahead), P2 a step from the line.
    m.sessions[1].walker = { ...m.sessions[1].walker, z: BRIDGE_LENGTH - RACE_SPRINT };
    m.sessions[2].walker = { ...m.sessions[2].walker, z: BRIDGE_LENGTH - 0.01 };
    play(m, 1, { walk1: false, walk2: true });
    expect(m.phase).toBe('roundOver');
    expect(raceHudView(m).players[1].waiting).toBe(false);
    expect(matchStateFor(m, 1).waiting).toBe(false);
  });
});

describe('WAIT FOR P2 does not blink', () => {
  it('stays on, step after step, while he keeps pace with a moving limit', () => {
    const m = calmRace();
    play(m, 8); // P1 reaches the leash while P2 stands on the ledge
    expect(m.sessions[1].waiting).toBe(true);
    let flips = 0;
    let last = m.sessions[1].waiting;
    play(m, 15, {
      walk2: true,
      each: () => {
        if (m.sessions[1].waiting !== last) { flips += 1; last = m.sessions[1].waiting; }
      },
    });
    expect(last).toBe(true);
    expect(flips).toBe(0);
  });
});
