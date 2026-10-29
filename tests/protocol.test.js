import { describe, it, expect } from 'vitest';
import { encode, decode, RELAYED } from '../src/shared/protocol.js';

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

  it('rejects a join with an unknown role', () => {
    expect(decode(encode({ t: 'join', role: 'spectator', room: 'ABCD' }))).toBeNull();
  });

  it('strips extra fields from a TV join', () => {
    expect(decode(encode({ t: 'join', role: 'tv', room: 'XXXX', evil: 1 })))
      .toEqual({ t: 'join', role: 'tv' });
  });

  it('only relays gameplay messages between peers', () => {
    expect([...RELAYED].sort()).toEqual(['camera', 'jump', 'run', 'start', 'state', 'tilt', 'walk']);
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

  it('accepts camera (cycle the view) and strips any fields', () => {
    expect(decode(encode({ t: 'camera' }))).toEqual({ t: 'camera' });
    expect(decode(encode({ t: 'camera', mode: 'evil' }))).toEqual({ t: 'camera' });
  });

  it('accepts jump and strips any fields', () => {
    expect(decode(encode({ t: 'jump' }))).toEqual({ t: 'jump' });
    expect(decode(encode({ t: 'jump', height: 99, on: true }))).toEqual({ t: 'jump' });
  });
});
