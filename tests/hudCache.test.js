import { describe, it, expect, vi } from 'vitest';

// The HUD must not build strings on frames where nothing it shows has changed: count the formatter calls.
vi.mock('../src/tv/results.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, formatPar: vi.fn(real.formatPar), formatScore: vi.fn(real.formatScore) };
});
const { formatPar, formatScore } = await import('../src/tv/results.js');
const { createHud, formatTime } = await import('../src/tv/hud.js');

function recorder() {
  const els = {};
  const doc = {
    els,
    getElementById: (id) => (els[id] ??= { style: {}, classList: { toggle() {} }, hidden: false, textContent: '' }),
  };
  return doc;
}
const state = (extra = {}) => ({
  phase: 'playing',
  time: 5.2,
  parTime: 32,
  runScore: 1240,
  level: 2,
  lives: 3,
  walker: { z: 3.4, lean: 0 },
  ...extra,
});

describe('hud formats only what changed', () => {
  it('builds the par and score text once while their numbers stay the same', () => {
    const hud = createHud(recorder());
    hud.render(state());
    expect(formatPar).toHaveBeenCalledTimes(1);
    expect(formatScore).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 50; i++) hud.render(state({ time: 5.2 + i * 0.016, walker: { z: 3.4, lean: 0 } }));
    expect(formatPar).toHaveBeenCalledTimes(1);
    expect(formatScore).toHaveBeenCalledTimes(1);
  });

  it('rebuilds each one when its own number changes, with the same text as before', () => {
    const doc = recorder();
    const hud = createHud(doc);
    hud.render(state());
    expect(doc.els.par.textContent).toBe('PAR 0:32');
    expect(doc.els.score.textContent).toBe('1,240 pts');
    expect(doc.els.dist.textContent).toMatch(/^3 \/ \d+ m$/);
    hud.render(state({ runScore: 12500, parTime: 95 }));
    expect(doc.els.score.textContent).toBe('12,500 pts');
    expect(doc.els.par.textContent).toBe('PAR 1:35');
    expect(formatScore).toHaveBeenLastCalledWith(12500);
  });

  it('keeps the timer text per whole second, and the distance per whole metre', () => {
    const doc = recorder();
    const hud = createHud(doc);
    hud.render(state({ time: 59.9 }));
    expect(doc.els.timer.textContent).toBe(formatTime(59.9));
    hud.render(state({ time: 60.0 }));
    expect(doc.els.timer.textContent).toBe('01:00');
    hud.render(state({ walker: { z: 7.9, lean: 0 } }));
    expect(doc.els.dist.textContent.startsWith('7 / ')).toBe(true);
    hud.render(state({ walker: { z: 8.0, lean: 0 } }));
    expect(doc.els.dist.textContent.startsWith('8 / ')).toBe(true);
  });

  it('clears the score and par when the numbers go away, and shows level and lives', () => {
    const doc = recorder();
    const hud = createHud(doc);
    hud.render(state());
    hud.render(state({ runScore: undefined, parTime: undefined, level: 3, lives: 2 }));
    expect(doc.els.score.textContent).toBe('');
    expect(doc.els.par.textContent).toBe('');
    expect(doc.els.level.textContent).toBe('Level 3');
    expect(doc.els.lives.textContent).toBe('❤ 2');
  });
});
