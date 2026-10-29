import { describe, it, expect } from 'vitest';
import { createMatch, RACE_COUNTDOWN } from '../src/game/match.js';
import { START_Z } from '../src/game/session.js';
import { countdownText, GO_SHOW_S } from '../src/tv/matchHud.js';
import { matchStateFor } from '../src/game/matchState.js';
import { stateMessageFor, createStateSync, sessionFor } from '../src/tv/stateSync.js';
import { statusText } from '../src/phone/status.js';

const DT = 1 / 60;
const race = () => createMatch({ mode: 'race', seed: 7 });
const tick = (m, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) m.update(DT); };
const hold = (m) => { for (const p of [1, 2]) m.input(p, { t: 'walk', on: true }); };

describe('the race countdown', () => {
  it('opens every round with 3, 2, 1 while both walkers stand on the ledge and the clock waits', () => {
    const m = race();
    m.start();
    expect(RACE_COUNTDOWN).toBe(3);
    expect(countdownText(m)).toBe('3');
    hold(m); // holding WALK through the countdown does not move them
    tick(m, 1.5);
    expect(countdownText(m)).toBe('2');
    tick(m, 1);
    expect(countdownText(m)).toBe('1');
    for (const p of [1, 2]) expect(m.sessions[p].walker.z).toBe(START_Z);
    expect(m.elapsed).toBe(0);
  });

  it('then GO!: they set off at once, the clock starts, and GO! clears after a moment', () => {
    const m = race();
    m.start();
    hold(m);
    tick(m, RACE_COUNTDOWN + DT);
    expect(countdownText(m)).toBe('GO!');
    tick(m, 0.5);
    expect(m.sessions[1].walker.z).toBeGreaterThan(START_Z);
    expect(m.elapsed).toBeGreaterThan(0.4);
    tick(m, GO_SHOW_S);
    expect(countdownText(m)).toBe('');
  });

  it('drops a jump pressed before GO', () => {
    const m = race();
    m.start();
    tick(m, 1);
    m.input(1, { t: 'jump' });
    tick(m, RACE_COUNTDOWN);
    expect(m.sessions[1].walker.airborne).toBe(false);
    expect(m.sessions[1].walker.y).toBe(0);
  });

  it('stands still while paused', () => {
    const m = race();
    m.start();
    tick(m, 1.2);
    m.togglePause();
    tick(m, 5);
    expect(countdownText(m)).toBe('2');
    m.togglePause();
    tick(m, 2);
    expect(countdownText(m)).toBe('GO!');
  });

  it('starts again with every round', () => {
    const m = race();
    m.start();
    tick(m, RACE_COUNTDOWN + 1);
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 59.99 };
    m.sessions[2].walker = { ...m.sessions[2].walker, z: 55 };
    m.sessions[1].gaps = [];
    m.input(1, { t: 'walk', on: true });
    tick(m, 0.2);
    expect(m.phase).toBe('roundOver');
    expect(countdownText(m)).toBe('');
    m.start();
    expect(countdownText(m)).toBe('3');
  });

  it('is race only', () => {
    for (const mode of ['solo', 'windmaster']) {
      const m = createMatch({ mode, seed: 7 });
      m.start();
      expect(countdownText(m)).toBe('');
    }
  });

  it('reaches the phones: "Get ready… 3", and a state change at each number', () => {
    const m = race();
    m.start();
    expect(matchStateFor(m, 1).countdown).toBe(3);
    expect(statusText(stateMessageFor(m, 2), 2)).toBe('Get ready… 3');
    const sync = createStateSync();
    sync.changed(sessionFor(m, 1), m);
    tick(m, 0.5);
    expect(sync.changed(sessionFor(m, 1), m)).toBe(false); // still 3
    tick(m, 0.6);
    expect(sync.changed(sessionFor(m, 1), m)).toBe(true); // now 2
    tick(m, RACE_COUNTDOWN);
    expect(matchStateFor(m, 1).countdown).toBe(0);
    expect(statusText(stateMessageFor(m, 1), 1)).not.toMatch(/Get ready/);
  });
});
