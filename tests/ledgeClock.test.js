// The level clock and the wind wait on the rock ledge. Solo waits for the bridge for as long as it takes; the two-player
// modes start a lane's clock after LEDGE_CLOCK_START_S even if the walker never steps on, so nobody can stall a match.
// And a Wind Master gust cannot be booked against a clock that has not started.
import { describe, it, expect } from 'vitest';
import { createMatch } from '../src/game/match.js';
import { createSession, LEDGE_CLOCK_START_S, START_Z } from '../src/game/session.js';
import { onBridge } from './helpers/onBridge.js';

const DT = 1 / 60;
const tick = (m, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) m.update(DT); };

describe('the ledge clock', () => {
  it('is 4 seconds', () => {
    expect(LEDGE_CLOCK_START_S).toBe(4);
  });

  it('solo never starts the clock on the ledge, however long he waits', () => {
    const s = createSession({ seed: 1 });
    s.start();
    expect(s.walker.z).toBe(START_Z);
    tick(s, 30);
    expect(s.time).toBe(0);
    const m = createMatch({ mode: 'solo', seed: 1 });
    m.start();
    tick(m, 30);
    expect(m.sessions[1].time).toBe(0);
  });

  it('a session with ledgeClockAfter starts its clock after that long on the ledge', () => {
    const s = createSession({ seed: 1, ledgeClockAfter: LEDGE_CLOCK_START_S });
    s.start();
    tick(s, LEDGE_CLOCK_START_S - 0.1);
    expect(s.time).toBe(0);
    tick(s, 1);
    expect(s.time).toBeGreaterThan(0.8);
    expect(s.time).toBeLessThan(1);
    expect(s.walker.z).toBe(START_Z); // he never moved
  });

  it('race and windmaster start the lane clock after 4 s on the ledge; stepping on earlier starts it at once', () => {
    for (const mode of ['race', 'windmaster']) {
      const m = createMatch({ mode, seed: 3 });
      m.start();
      const s = m.sessions[1];
      tick(m, 3.9);
      expect(s.time).toBe(0);
      tick(m, 0.6);
      expect(s.time).toBeGreaterThan(0);
      const n = createMatch({ mode, seed: 3 });
      n.start();
      onBridge(n);
      tick(n, 0.5);
      expect(n.sessions[1].time).toBeGreaterThan(0.4); // the first step starts it, as ever
    }
  });

  it('the ledge wait restarts with each round, and a paused wait does not count', () => {
    const m = createMatch({ mode: 'race', seed: 3 });
    m.start();
    m.togglePause();
    tick(m, 10);
    m.togglePause();
    tick(m, 3.5);
    expect(m.sessions[1].time).toBe(0); // the 10 paused seconds were not ledge time
  });
});

describe('Wind Master gusts on the ledge', () => {
  const wm = () => createMatch({ mode: 'windmaster', seed: 9 });

  it('are refused while the walker is still on the ledge, and gustReady says false', () => {
    const m = wm();
    m.start();
    expect(m.sessions[1].walker.z).toBe(START_Z);
    expect(m.gustReady).toBe(false);
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(false);
    tick(m, 2);
    expect(m.gustReady).toBe(false);
    expect(m.input(2, { t: 'gust', dir: -1 })).toBe(false);
    expect(m.sessions[1].forecast.state).toBe('calm'); // nothing was booked, so no warning hangs
    expect(m.gustIn).toBe(Infinity);
  });

  it('are accepted as soon as the walker steps on the bridge', () => {
    const m = wm();
    m.start();
    onBridge(m);
    expect(m.gustReady).toBe(false); // the clock has not ticked yet
    m.update(DT);
    expect(m.gustReady).toBe(true);
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(true);
  });

  it('are accepted after 4 s even if the walker never stepped on (nobody can stall the round)', () => {
    const m = wm();
    m.start();
    tick(m, LEDGE_CLOCK_START_S + 0.2);
    expect(m.gustReady).toBe(true);
    expect(m.input(2, { t: 'gust', dir: 1 })).toBe(true);
    tick(m, 0.2);
    expect(m.sessions[1].forecast.state).toBe('warning'); // and the warning runs on a clock that is running
    tick(m, 3);
    expect(m.sessions[1].forecast.state).not.toBe('warning'); // it does not hang
  });
});
