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

const { formatTime, messageFor, createHud, gapHint } = await import('../src/tv/hud.js');

describe('hud text', () => {
  it('formats the timer as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(43.9)).toBe('00:43');
    expect(formatTime(125.7)).toBe('02:05');
  });

  it('shows a message for each phase', () => {
    expect(messageFor({ phase: 'lobby' })).toBe('Press START on your phone');
    expect(messageFor({ phase: 'playing' })).toBe('');
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
