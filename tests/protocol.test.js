import { describe, it, expect } from 'vitest';
import { encode, decode, RELAYED, isValidPhoneId } from '../src/shared/protocol.js';

describe('protocol', () => {
  it('round-trips a tilt message', () => {
    expect(decode(encode({ t: 'tilt', v: 0.25 }))).toEqual({ t: 'tilt', v: 0.25 });
  });

  it('clamps tilt to [-1, 1]', () => {
    expect(decode(encode({ t: 'tilt', v: 5 }))).toEqual({ t: 'tilt', v: 1 });
    expect(decode(encode({ t: 'tilt', v: -5 }))).toEqual({ t: 'tilt', v: -1 });
  });

  it('rejects malformed input', () => {
    expect(decode('not json')).toBeNull();
    expect(decode(encode({ t: 'tilt', v: 'left' }))).toBeNull();
    expect(decode(encode({ t: 'walk', on: 'yes' }))).toBeNull();
    expect(decode(encode({ t: 'launch-missiles' }))).toBeNull();
    expect(decode(encode({ nope: true }))).toBeNull();
  });

  it('requires a 4-letter uppercase room code for phones', () => {
    expect(decode(encode({ t: 'join', role: 'phone', room: 'ABCD' })))
      .toEqual({ t: 'join', role: 'phone', room: 'ABCD' });
  });

  it('turns a bad or missing phone room into an empty code, so the server can answer no-room', () => {
    const noRoom = { t: 'join', role: 'phone', room: '' };
    expect(decode(encode({ t: 'join', role: 'phone', room: 'abcd' }))).toEqual(noRoom);
    expect(decode(encode({ t: 'join', role: 'phone' }))).toEqual(noRoom);
    expect(decode(encode({ t: 'join', role: 'phone', room: ['ABCD'] }))).toEqual(noRoom);
    expect(decode(encode({ t: 'join', role: 'phone', room: 'ABCDE' }))).toEqual(noRoom);
  });

  describe('a phone\'s stable id', () => {
    const join = (id) => decode(encode({ t: 'join', role: 'phone', room: 'ABCD', id }));
    it('passes a valid id (1-64 of A-Z a-z 0-9 _ -) through', () => {
      for (const id of ['a', 'Z9_-', 'x'.repeat(64), '3f2b1c9e-8d4a-4b7e-9a10-0c5d6e7f8a9b']) {
        expect(join(id)).toEqual({ t: 'join', role: 'phone', room: 'ABCD', id });
      }
    });
    it('drops an invalid id, and the join goes on without one (today\'s behaviour)', () => {
      for (const id of ['', 'x'.repeat(65), 'has space', 'semi;colon', 'ünï', '../x', 'a.b', 12, null, ['a'], { a: 1 }, true]) {
        expect(join(id), JSON.stringify(id)).toEqual({ t: 'join', role: 'phone', room: 'ABCD' });
      }
    });
    it('a join with no id has none', () => {
      expect(decode(encode({ t: 'join', role: 'phone', room: 'ABCD' }))).toEqual({ t: 'join', role: 'phone', room: 'ABCD' });
    });
    it('keeps the id even with a bad room (rooms.join answers no-room)', () => {
      expect(decode(encode({ t: 'join', role: 'phone', room: 'x', id: 'abc' }))).toEqual({ t: 'join', role: 'phone', room: '', id: 'abc' });
    });
    it('a TV join has no id', () => {
      expect(decode(encode({ t: 'join', role: 'tv', id: 'abc' }))).toEqual({ t: 'join', role: 'tv' });
    });
    it('exports the id rule', () => {
      expect(isValidPhoneId('abc_DEF-123')).toBe(true);
      expect(isValidPhoneId('')).toBe(false);
      expect(isValidPhoneId('a'.repeat(65))).toBe(false);
      expect(isValidPhoneId(5)).toBe(false);
    });
  });

  it('rejects a join with an unknown role', () => {
    expect(decode(encode({ t: 'join', role: 'spectator', room: 'ABCD' }))).toBeNull();
  });

  it('strips extra fields from a TV join', () => {
    expect(decode(encode({ t: 'join', role: 'tv', room: 'XXXX', evil: 1 })))
      .toEqual({ t: 'join', role: 'tv' });
  });

  it('only relays gameplay messages between peers', () => {
    expect([...RELAYED].sort()).toEqual(['camera', 'gust', 'jump', 'mode', 'pause', 'run', 'start', 'state', 'tilt', 'volume', 'walk']);
  });

  it('validates run: needs a boolean on', () => {
    expect(decode(encode({ t: 'run', on: true }))).toEqual({ t: 'run', on: true });
    expect(decode(encode({ t: 'run', on: false }))).toEqual({ t: 'run', on: false });
    expect(decode(encode({ t: 'run', on: 'yes' }))).toBeNull();
    expect(decode(encode({ t: 'run', on: 1 }))).toBeNull();
    expect(decode(encode({ t: 'run' }))).toBeNull();
  });

  it('strips extra fields from run', () => {
    expect(decode(encode({ t: 'run', on: true, evil: 1 }))).toEqual({ t: 'run', on: true });
  });

  it('accepts pause (toggle) and strips any fields', () => {
    expect(decode(encode({ t: 'pause' }))).toEqual({ t: 'pause' });
    expect(decode(encode({ t: 'pause', x: 1 }))).toEqual({ t: 'pause' });
  });

  it('accepts volume with music and sfx clamped to 0..1, and rejects non-numbers', () => {
    expect(decode(encode({ t: 'volume', music: 0.4, sfx: 1 }))).toEqual({ t: 'volume', music: 0.4, sfx: 1 });
    expect(decode(encode({ t: 'volume', music: 7, sfx: -2 }))).toEqual({ t: 'volume', music: 1, sfx: 0 });
    expect(decode(encode({ t: 'volume', music: 'loud', sfx: 1 }))).toBeNull();
    expect(decode(encode({ t: 'volume', music: 0.5 }))).toBeNull();
  });

  it('accepts camera (cycle the view) and strips any fields', () => {
    expect(decode(encode({ t: 'camera' }))).toEqual({ t: 'camera' });
    expect(decode(encode({ t: 'camera', mode: 'evil' }))).toEqual({ t: 'camera' });
  });

  it('accepts jump and strips any fields', () => {
    expect(decode(encode({ t: 'jump' }))).toEqual({ t: 'jump' });
    expect(decode(encode({ t: 'jump', height: 99, on: true }))).toEqual({ t: 'jump' });
  });

  it('accepts gust with dir -1 or 1 only, and strips other fields', () => {
    expect(decode(encode({ t: 'gust', dir: -1 }))).toEqual({ t: 'gust', dir: -1 });
    expect(decode(encode({ t: 'gust', dir: 1, p: 2, strength: 99 }))).toEqual({ t: 'gust', dir: 1 });
    for (const dir of [0, 2, '1', null, undefined, 0.5]) expect(decode(encode({ t: 'gust', dir }))).toBeNull();
    expect(decode(encode({ t: 'gust' }))).toBeNull();
  });

  it('accepts mode for the three known modes only', () => {
    for (const mode of ['solo', 'race', 'windmaster']) expect(decode(encode({ t: 'mode', mode, evil: 1 }))).toEqual({ t: 'mode', mode });
    for (const mode of ['coop', '', 1, null]) expect(decode(encode({ t: 'mode', mode }))).toBeNull();
    expect(decode(encode({ t: 'mode' }))).toBeNull();
  });

  it('lets state carry `to` as 1 or 2 and rejects any other value', () => {
    expect(decode(encode({ t: 'state', phase: 'lobby', to: 2 }))).toEqual({ t: 'state', phase: 'lobby', to: 2 });
    expect(decode(encode({ t: 'state', phase: 'lobby' }))).toEqual({ t: 'state', phase: 'lobby' });
    expect(decode(encode({ t: 'state', phase: 'lobby', to: null }))).toEqual({ t: 'state', phase: 'lobby', to: null });
    for (const to of [0, 3, '1', [1]]) expect(decode(encode({ t: 'state', phase: 'lobby', to }))).toBeNull();
  });
});

describe('player stamp', () => {
  const keep = (m) => decode(encode(m), { keepPlayer: true });
  it('is stripped by default (the server decodes what a phone sends and stamps the real slot itself)', () => {
    expect(decode(encode({ t: 'tilt', v: 0.5, p: 2 }))).toEqual({ t: 'tilt', v: 0.5 });
  });

  it('keeps the slot the server stamped on a phone message, for every phone type, when the TV asks', () => {
    expect(keep({ t: 'tilt', v: 0.5, p: 2 })).toEqual({ t: 'tilt', v: 0.5, p: 2 });
    expect(keep({ t: 'walk', on: true, p: 1 })).toEqual({ t: 'walk', on: true, p: 1 });
    expect(keep({ t: 'run', on: false, p: 2 })).toEqual({ t: 'run', on: false, p: 2 });
    expect(keep({ t: 'jump', p: 2 })).toEqual({ t: 'jump', p: 2 });
    expect(keep({ t: 'gust', dir: -1, p: 2 })).toEqual({ t: 'gust', dir: -1, p: 2 });
    expect(keep({ t: 'mode', mode: 'race', p: 1 })).toEqual({ t: 'mode', mode: 'race', p: 1 });
    expect(keep({ t: 'start', p: 2 })).toEqual({ t: 'start', p: 2 });
  });

  it('drops a stamp that is not a player slot, and adds none where there was none', () => {
    for (const p of [0, 3, '1', null, 1.5, [1]]) expect(keep({ t: 'tilt', v: 0, p })).toEqual({ t: 'tilt', v: 0 });
    expect(keep({ t: 'jump' })).toEqual({ t: 'jump' });
  });

  it('does not add a stamp to a join', () => {
    expect(keep({ t: 'join', role: 'tv', p: 2 })).toEqual({ t: 'join', role: 'tv' });
    expect(keep({ t: 'join', role: 'phone', room: 'ABCD', p: 2 })).toEqual({ t: 'join', role: 'phone', room: 'ABCD' });
  });
});
