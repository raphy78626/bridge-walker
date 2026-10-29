import { describe, it, expect } from 'vitest';
import { buildStateMessage, createStateSync } from '../src/tv/stateSync.js';
import { STATUS, statusText } from '../src/phone/status.js';

const base = { phase: 'playing', lives: 3, level: 1 };
const fc = (state, dir = 1, strength = 0.5) => ({ state, dir, strength, eta: 1, remaining: 2 });

describe('state message', () => {
  it('keeps the old fields and adds the wind, calm by default', () => {
    expect(buildStateMessage(base)).toEqual({ t: 'state', phase: 'playing', lives: 3, level: 1, paused: false, wind: 'calm', windDir: 0, windLevel: 0 });
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
