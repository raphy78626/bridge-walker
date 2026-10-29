import { describe, it, expect, vi } from 'vitest';

// distanceToNextGap lands with the game rules; until it exists, stand in with the same contract
// (metres to the next gap start, or Infinity). Once the real one exists it is used untouched.
vi.mock('../src/game/session.js', async (importOriginal) => {
  const real = await importOriginal();
  const stub = (gaps, z) => {
    const ahead = gaps.map((g) => g.start - z).filter((d) => d >= 0);
    return ahead.length ? Math.min(...ahead) : Infinity;
  };
  return { ...real, distanceToNextGap: real.distanceToNextGap ?? stub };
});

const { formatTime, messageFor, createHud, gapHint, pausedOf } = await import('../src/tv/hud.js');

describe('hud text', () => {
  it('formats the timer as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(43.9)).toBe('00:43');
    expect(formatTime(125.7)).toBe('02:05');
  });

  it('shows a message for each phase', () => {
    expect(messageFor({ phase: 'lobby' })).toBe('Press START on your phone');
    expect(messageFor({ phase: 'playing' })).toBe('');
    expect(messageFor({ phase: 'playing', paused: true })).toBe(''); // the pause panel says it, not a line across the scene
    expect(messageFor({ phase: 'falling', lives: 1 })).toBe('You fell! 1 life left');
    expect(messageFor({ phase: 'falling', lives: 2 })).toBe('You fell! 2 lives left');
    expect(messageFor({ phase: 'falling', lives: 0 })).toBe('You fell!');
    expect(messageFor({ phase: 'gameover' })).toBe('GAME OVER — press START to try again');
    expect(messageFor({ phase: 'won', level: 1 })).toBe('You crossed! Press START for level 2');
  });
});

describe('pairing panel', () => {
  function fakeDoc() {
    const els = {};
    return {
      els,
      getElementById: (id) => (els[id] ??= { hidden: false, textContent: '' }),
    };
  }

  it('shows "Reconnecting…" in place of the dead QR code, then restores it with the new room', () => {
    const doc = fakeDoc();
    const hud = createHud(doc);
    hud.hidePairing();
    hud.showReconnecting();
    expect(doc.els.pairing.hidden).toBe(false);
    expect(doc.els['pairing-status'].hidden).toBe(false);
    expect(doc.els['pairing-status'].textContent).toBe('Reconnecting…');
    for (const id of ['qr', 'pairing-hint', 'pairing-code', 'phone-url']) expect(doc.els[id].hidden).toBe(true);

    hud.showPairing('https://10.0.0.7:5174/phone.html?room=ABCD', 'ABCD');
    expect(doc.els['pairing-status'].hidden).toBe(true);
    for (const id of ['qr', 'pairing-hint', 'pairing-code', 'phone-url']) expect(doc.els[id].hidden).toBe(false);
    expect(doc.els['room-code'].textContent).toBe('ABCD');
  });
});

describe('gap hint', () => {
  const at = (z, extra = {}) => ({ phase: 'playing', gaps: [{ start: 20, end: 22 }], walker: { z }, ...extra });

  it('shows the banner inside 4 m of the next gap and not before', () => {
    expect(gapHint(at(10))).toBe('');
    expect(gapHint(at(16))).toBe('');
    expect(gapHint(at(16))).toBe(''); // exactly 4 m ahead is the edge, not inside it
    expect(gapHint(at(17.5))).toBe('GAP AHEAD — JUMP!');
    expect(gapHint(at(19.9))).toBe('GAP AHEAD — JUMP!');
  });

  it('is empty once the gap is reached, outside of play, or when there are no gaps', () => {
    expect(gapHint(at(20.5))).toBe(''); // already over the gap
    expect(gapHint(at(18, { phase: 'falling' }))).toBe('');
    expect(gapHint(at(18, { phase: 'lobby' }))).toBe('');
    expect(gapHint(at(18, { gaps: [] }))).toBe('');
    expect(gapHint(at(18, { gaps: undefined }))).toBe('');
  });

  it('writes to the DOM only when the hint changes', () => {
    const writes = [];
    const els = {};
    const doc = {
      getElementById: (id) =>
        (els[id] ??= new Proxy(
          { style: {}, classList: { toggle() {} }, hidden: false },
          {
            set(o, k, v) {
              if (id === 'gap-hint') writes.push([k, v]);
              o[k] = v;
              return true;
            },
          },
        )),
    };
    const hud = createHud(doc);
    const base = { time: 0, level: 1, lives: 3, lean: 0 };
    const state = (z) => ({ ...base, ...at(z), walker: { z, lean: 0 } });
    hud.render(state(10)); // no hint, and the element starts with none
    expect(writes).toEqual([]);
    hud.render(state(18));
    expect(writes).toEqual([['textContent', 'GAP AHEAD — JUMP!'], ['hidden', false]]);
    writes.length = 0;
    hud.render(state(18.5));
    hud.render(state(19));
    expect(writes).toEqual([]); // same text: no writes
    hud.render(state(21));
    expect(writes).toEqual([['textContent', ''], ['hidden', true]]);
  });
});

describe('banner and toast', () => {
  function fakeTimers() {
    const pending = [];
    return {
      pending,
      setTimeout: (fn, ms) => (pending.push({ fn, ms }), pending.length),
      clearTimeout: (id) => (pending[id - 1].fn = () => {}),
      fire: () => pending.forEach((p) => p.fn()),
    };
  }
  const doc = () => {
    const els = {};
    return { els, getElementById: (id) => (els[id] ??= { hidden: true, textContent: '' }) };
  };

  it('shows the level banner for about 3 s, then hides it', () => {
    const d = doc();
    const t = fakeTimers();
    createHud(d, t).showBanner('Level 2 \u2014 Misty Morning');
    expect(d.els['level-banner']).toMatchObject({ hidden: false, textContent: 'Level 2 \u2014 Misty Morning' });
    expect(t.pending[0].ms).toBe(3000);
    t.fire();
    expect(d.els['level-banner'].hidden).toBe(true);
  });

  it('shows the camera name briefly, and a second view restarts the clock', () => {
    const d = doc();
    const t = fakeTimers();
    const hud = createHud(d, t);
    hud.showToast('First person');
    hud.showToast('Cinematic');
    expect(d.els['cam-toast'].textContent).toBe('Cinematic');
    t.fire(); // the first timer was cancelled; only the second hides it
    expect(d.els['cam-toast'].hidden).toBe(true);
    expect(t.pending[0].ms).toBeLessThan(3000);
  });
});

describe('wind indicator, timer, score and results panel', () => {
  // Every element records its writes, so a test can see exactly what the HUD touched.
  function recorder() {
    const writes = [];
    const els = {};
    const doc = {
      els,
      getElementById: (id) =>
        (els[id] ??= new Proxy(
          { style: {}, classList: { toggle(name, on) { writes.push([id, 'class:' + name, on]); } }, hidden: false },
          {
            set(o, k, v) {
              writes.push([id, k, v]);
              o[k] = v;
              return true;
            },
          },
        )),
    };
    return { doc, writes, only: (id) => writes.filter((w) => w[0] === id) };
  }
  const state = (extra = {}) => ({ phase: 'playing', time: 5, level: 1, lives: 3, walker: { z: 3, lean: 0 }, ...extra });
  const forecast = (st, dir, strength = 0.5) => ({ state: st, dir, strength, eta: 1, remaining: 0 });

  it('stays untouched while calm, and for a session with no forecast at all', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state());
    hud.render(state({ forecast: forecast('calm', 0) }));
    expect(r.only('wind')).toEqual([]);
  });

  it('shows the arrow on the side the wind comes from and writes only when something changes', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state({ forecast: forecast('warning', 1, 0.5) }));
    expect(r.only('wind')).toEqual([['wind', 'className', 'wind warning from-left lvl-2'], ['wind', 'hidden', false]]);
    r.writes.length = 0;
    for (const eta of [1.5, 1.0, 0.5]) hud.render(state({ forecast: { ...forecast('warning', 1, 0.52), eta } }));
    expect(r.only('wind')).toEqual([]); // same state, side and strength step: no DOM writes
    hud.render(state({ forecast: forecast('gust', 1, 0.52) }));
    expect(r.only('wind')).toEqual([['wind', 'className', 'wind gust from-left lvl-2'], ['wind', 'hidden', false]]);
    r.writes.length = 0;
    hud.render(state({ forecast: forecast('gust', -1, 0.95) }));
    expect(r.only('wind')).toEqual([['wind', 'className', 'wind gust from-right lvl-3'], ['wind', 'hidden', false]]);
    r.writes.length = 0;
    hud.render(state({ forecast: forecast('calm', 0) }));
    expect(r.only('wind')).toEqual([['wind', 'hidden', true]]);
  });

  it('shows the par, and the timer is gold only while under it', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state({ time: 10, parTime: 32 }));
    expect(r.doc.els.par.textContent).toBe('PAR 0:32');
    expect(r.only('timer').filter((w) => w[1] === 'class:under-par')).toEqual([['timer', 'class:under-par', true]]);
    hud.render(state({ time: 20, parTime: 32 }));
    expect(r.only('timer').filter((w) => w[1] === 'class:under-par')).toHaveLength(1); // no repeat write
    hud.render(state({ time: 33, parTime: 32 }));
    expect(r.only('timer').filter((w) => w[1] === 'class:under-par').pop()).toEqual(['timer', 'class:under-par', false]);
  });

  it('has no par and no gold timer when the session does not supply one', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state());
    expect(r.doc.els.par.textContent).toBe('');
    expect(r.only('timer').filter((w) => w[1] === 'class:under-par')).toEqual([]);
  });

  it('shows the run score under the lives', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state({ runScore: 1240 }));
    expect(r.doc.els.score.textContent).toBe('1,240 pts');
    hud.render(state());
    expect(r.doc.els.score.textContent).toBe('');
  });

  it('does not rewrite unchanged text every frame', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state());
    r.writes.length = 0;
    hud.render(state());
    hud.render(state());
    expect(r.writes.filter((w) => w[1] === 'textContent')).toEqual([]);
  });

  it('fills the level results panel and shows it', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.showResults({
      kind: 'level', title: 'LEVEL 2 COMPLETE', stars: 2, time: '0:29', par: 'PAR 0:32', falls: '1', score: '1,240',
      runScore: '3,390', bestScore: '1,500', bestTime: '0:27', bestLine: 'Best score 1,500 \u00b7 Best time 0:27', isNew: true,
      newLabel: 'NEW BEST TIME!', next: 'Press START for Level 3',
    });
    const e = r.doc.els;
    expect(e.results).toMatchObject({ hidden: false, className: 'results level' });
    expect(e['res-title'].textContent).toBe('LEVEL 2 COMPLETE');
    expect([0, 1, 2].map((i) => e[`res-star-${i}`].className)).toEqual(['star on', 'star on', 'star']);
    expect(e['res-time'].textContent).toBe('0:29');
    expect(e['res-falls'].textContent).toBe('1');
    expect(e['res-score'].textContent).toBe('1,240');
    expect(e['res-total'].textContent).toBe('3,390');
    expect(e['res-new'].hidden).toBe(false);
    expect(e['res-new'].textContent).toBe('NEW BEST TIME!');
    expect(e['res-best'].textContent).toBe('Best score 1,500 \u00b7 Best time 0:27');
    expect(e['res-next'].textContent).toBe('Press START for Level 3');
    hud.hideResults();
    expect(e.results.hidden).toBe(true);
  });

  it('fills the run summary, with NEW BEST RUN only when beaten', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.showResults({ kind: 'run', title: 'GAME OVER', level: 'Reached level 3', runScore: '3,400', bestRun: '5,120', isNew: false, next: 'Press START to try again' });
    expect(r.doc.els.results.className).toBe('results run');
    expect(r.doc.els['run-score'].textContent).toBe('3,400');
    expect(r.doc.els['run-best'].textContent).toContain('5,120');
    expect(r.doc.els['run-new'].hidden).toBe(true);
  });

  it('hides the "You crossed" message while the results panel is up', () => {
    const r = recorder();
    const hud = createHud(r.doc);
    hud.render(state({ phase: 'won' }));
    expect(r.doc.els.message.textContent).toBe('You crossed! Press START for level 2');
    hud.render(state({ phase: 'won', result: { kind: 'level', level: 1 } }));
    expect(r.doc.els.message.textContent).toBe('');
  });
});

describe('pausedOf', () => {
  it('is on only while a level is paused mid-play (a session or a match)', () => {
    expect(pausedOf({ phase: 'playing', paused: true })).toBe(true);
    expect(pausedOf({ phase: 'playing', paused: false })).toBe(false);
    expect(pausedOf({ phase: 'won', paused: true })).toBe(false);
    expect(pausedOf(null)).toBe(false);
  });
});
