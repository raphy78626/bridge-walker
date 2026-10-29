import { describe, it, expect } from 'vitest';
import { buildStateMessage, createStateSync } from '../src/tv/stateSync.js';
import { STATUS, statusText } from '../src/phone/status.js';
import { onBridge } from './helpers/onBridge.js';

const base = { phase: 'playing', lives: 3, level: 1 };
const fc = (state, dir = 1, strength = 0.5) => ({ state, dir, strength, eta: 1, remaining: 2 });

describe('state message', () => {
  it('keeps the old fields and adds the wind, calm by default', () => {
    expect(buildStateMessage(base)).toEqual({ t: 'state', phase: 'playing', lives: 3, level: 1, paused: false, keepMoving: false, wind: 'calm', windDir: 0, windLevel: 0 });
  });

  it('carries the forecast state and direction', () => {
    const m = buildStateMessage({ ...base, forecast: fc('warning', -1) });
    expect(m).toMatchObject({ wind: 'warning', windDir: -1 });
  });

  it('carries the strength bucket 1..3 while the wind is live, 0 when calm or without a direction', () => {
    const level = (f) => buildStateMessage({ ...base, forecast: f }).windLevel;
    expect(level(fc('warning', 1, 0.2))).toBe(1);
    expect(level(fc('warning', 1, 0.5))).toBe(2);
    expect(level(fc('gust', -1, 1))).toBe(3);
    expect(level(fc('calm', 0, 0))).toBe(0);
    expect(level(fc('warning', 0, 1))).toBe(0);
    expect(buildStateMessage(base).windLevel).toBe(0);
  });

  it('adds stars, score and runScore after a level, and the run score at game over', () => {
    const won = { ...base, phase: 'won', result: { kind: 'level', level: 1, stars: 2, score: 1240, runScore: 3400 } };
    expect(buildStateMessage(won)).toMatchObject({ stars: 2, score: 1240, runScore: 3400 });
    const over = { ...base, phase: 'gameover', result: { kind: 'run', level: 3, runScore: 3400 } };
    const m = buildStateMessage(over);
    expect(m.runScore).toBe(3400);
    expect('stars' in m).toBe(false);
    expect('stars' in buildStateMessage({ ...base, result: null })).toBe(false);
  });
});

describe('state sync (send on change only)', () => {
  it('reports the first call, then only real changes', () => {
    const sync = createStateSync();
    expect(sync.changed(base)).toBe(true);
    expect(sync.changed({ ...base })).toBe(false);
    expect(sync.changed({ ...base, time: 12, forecast: fc('calm', 0) })).toBe(false); // per-frame fields do not count
    expect(sync.changed({ ...base, forecast: fc('warning') })).toBe(true);
    expect(sync.changed({ ...base, forecast: fc('warning', 1, 0.52) })).toBe(false); // same bucket: no message
    expect(sync.changed({ ...base, forecast: fc('warning', 1, 0.9) })).toBe(true); // a bigger bucket
    expect(sync.changed({ ...base, forecast: fc('warning', 1, 0.95) })).toBe(false);
    expect(sync.changed({ ...base, forecast: fc('warning') })).toBe(true); // and back down
    expect(sync.changed({ ...base, forecast: fc('gust') })).toBe(true);
    expect(sync.changed({ ...base, forecast: fc('gust', -1) })).toBe(true); // the side changed
    expect(sync.changed(base)).toBe(true); // back to calm
  });

  it('reports pause and resume', () => {
    const sync = createStateSync();
    sync.changed(base);
    expect(buildStateMessage({ ...base, paused: true }).paused).toBe(true);
    expect(sync.changed({ ...base, paused: true })).toBe(true);
    expect(sync.changed({ ...base, paused: true })).toBe(false);
    expect(sync.changed(base)).toBe(true);
  });

  it('reports lives, level, phase and a new result', () => {
    const sync = createStateSync();
    sync.changed(base);
    expect(sync.changed({ ...base, lives: 2 })).toBe(true);
    expect(sync.changed({ ...base, lives: 2, level: 2 })).toBe(true);
    expect(sync.changed({ ...base, lives: 2, level: 2, phase: 'won' })).toBe(true);
    const result = { kind: 'level', stars: 3, score: 100, runScore: 100 };
    expect(sync.changed({ ...base, lives: 2, level: 2, phase: 'won', result })).toBe(true);
    expect(sync.changed({ ...base, lives: 2, level: 2, phase: 'won', result: { ...result } })).toBe(false);
  });

  it('reset makes the next call report again', () => {
    const sync = createStateSync();
    sync.changed(base);
    sync.reset();
    expect(sync.changed(base)).toBe(true);
  });
});

describe('phone status line', () => {
  it('keeps the old line when the TV sends no score', () => {
    expect(statusText({ phase: 'playing', lives: 3, level: 2 })).toBe(`${STATUS.playing} · ❤ 3 · Level 2`);
    expect(statusText({ phase: 'playing', paused: true, lives: 3, level: 2 })).toBe('Paused — tap ▶ to resume · ❤ 3 · Level 2');
    expect(statusText({ phase: 'won', lives: 3, level: 2 })).toBe(`${STATUS.won} · ❤ 3 · Level 2`);
  });

  it('shows the stars and score after a level', () => {
    const t = statusText({ phase: 'won', lives: 2, level: 1, stars: 2, score: 1240, runScore: 1240 });
    expect(t.startsWith('★★☆ 1,240 pts')).toBe(true);
    expect(t).toContain('Level 1');
  });

  it('shows the run score at game over', () => {
    expect(statusText({ phase: 'gameover', lives: 0, level: 3, runScore: 3400 })).toContain('3,400 pts');
  });
});

describe('per-phone state for a match', async () => {
  const { createMatch } = await import('../src/game/match.js');
  const { stateMessageFor, sessionFor } = await import('../src/tv/stateSync.js');
  const DT = 1 / 60;

  it('is the session message with the match fields over it, aimed at that phone only', () => {
    const m = createMatch({ mode: 'race', seed: 4 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const msg = stateMessageFor(m, 2);
    expect(msg).toMatchObject({ t: 'state', to: 2, mode: 'race', you: 2, role: 'racer', phase: 'playing', round: 1, level: 1 });
    expect(stateMessageFor(m, 1)).toMatchObject({ to: 1, you: 1 });
  });

  it('solo adds only mode, you, role, gustReady and canChangeMode to the old message, and routes it to the phone', () => {
    const m = createMatch({ mode: 'solo', seed: 4 });
    const msg = stateMessageFor(m, 2); // a phone that landed in slot 2 gets the solo session's state, aimed at itself
    expect(msg).toEqual({ ...buildStateMessage(m.sessions[1]), mode: 'solo', you: 2, role: 'walker', gustReady: false, canChangeMode: true, to: 2 });
  });

  it('a solo spectator (the second phone) is flagged in its message, and only then', () => {
    const m = createMatch({ mode: 'solo', seed: 4 });
    expect(stateMessageFor(m, 2, { spectator: true })).toMatchObject({ spectator: true, to: 2, you: 2 });
    expect('spectator' in stateMessageFor(m, 1)).toBe(false);
    expect('spectator' in stateMessageFor(m, 2, { spectator: false })).toBe(false);
    expect('spectator' in stateMessageFor(m, 2, {})).toBe(false);
  });

  it('the state sync sends again when a phone becomes a spectator, or stops being one', () => {
    const m = createMatch({ mode: 'solo', seed: 4 });
    const sync = createStateSync();
    expect(sync.changed(m.sessions[1], m, false)).toBe(true);
    expect(sync.changed(m.sessions[1], m, false)).toBe(false);
    expect(sync.changed(m.sessions[1], m, true)).toBe(true); // the first phone came back: this one now only watches
    expect(sync.changed(m.sessions[1], m, true)).toBe(false);
    expect(sync.changed(m.sessions[1], m, false)).toBe(true);
    expect(sync.changed(m.sessions[1], m)).toBe(false); // no argument means false
  });

  it('each racer gets his own session, the windmaster modes the one walker', () => {
    const race = createMatch({ mode: 'race', seed: 4 });
    expect(sessionFor(race, 1)).toBe(race.sessions[1]);
    expect(sessionFor(race, 2)).toBe(race.sessions[2]);
    const wm = createMatch({ mode: 'windmaster', seed: 4 });
    expect(sessionFor(wm, 1)).toBe(wm.sessions[1]);
    expect(sessionFor(wm, 2)).toBe(wm.sessions[1]);
  });

  it('a race phone is told about its own fall and nobody else is', () => {
    const m = createMatch({ mode: 'race', seed: 4 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const syncs = { 1: createStateSync(), 2: createStateSync() };
    for (const p of [1, 2]) expect(syncs[p].changed(sessionFor(m, p), m)).toBe(true);
    for (const p of [1, 2]) expect(syncs[p].changed(sessionFor(m, p), m)).toBe(false);
    m.sessions[2].walker = { ...m.sessions[2].walker, lean: 1.2 };
    m.update(DT);
    expect(syncs[1].changed(sessionFor(m, 1), m)).toBe(false);
    expect(syncs[2].changed(sessionFor(m, 2), m)).toBe(true);
  });

  it('watches what only a match changes: the mode, a round ending under a still-playing session, the Wind Master\'s gust readiness', () => {
    const wm = createMatch({ mode: 'windmaster', seed: 9 });
    const sync = createStateSync();
    expect(sync.changed(wm.sessions[1], wm)).toBe(true);
    expect(sync.changed(wm.sessions[1], wm)).toBe(false);
    wm.start();
    onBridge(wm); // levels start on the safe ledge; these tests begin on the first plank
    sync.changed(wm.sessions[1], wm);
    for (let i = 0; i < 30; i++) wm.update(DT);
    expect(wm.gustReady).toBe(true);
    sync.changed(wm.sessions[1], wm);
    wm.input(2, { t: 'gust', dir: 1 });
    expect(sync.changed(wm.sessions[1], wm)).toBe(true); // the gust is booked: not ready any more
    expect(sync.changed(wm.sessions[1], wm)).toBe(false);

    const solo = createMatch({ mode: 'solo' });
    const other = createStateSync();
    other.changed(solo.sessions[1], solo);
    expect(other.changed(solo.sessions[1], solo)).toBe(false);
    expect(other.changed(wm.sessions[1], wm)).toBe(true); // a different mode is a change
  });

  it('a race round ending is a change even though no session phase moved but one', () => {
    const m = createMatch({ mode: 'race', seed: 4, winsToWin: 3 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const sync = createStateSync();
    sync.changed(sessionFor(m, 1), m);
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 59.99, speed: 2 };
    m.input(1, { t: 'walk', on: true });
    for (let i = 0; i < 30 && m.phase === 'playing'; i++) m.update(DT);
    expect(m.phase).toBe('roundOver');
    expect(sync.changed(sessionFor(m, 2), m)).toBe(true); // the loser's session never left 'playing'
  });
});
