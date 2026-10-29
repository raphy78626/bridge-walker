import { describe, it, expect } from 'vitest';
import { phoneId, newPhoneId, PHONE_ID_KEY } from '../src/phone/identity.js';
import { isValidPhoneId, decode, encode } from '../src/shared/protocol.js';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)), data };
};
const counting = () => {
  let n = 0;
  return (len) => Uint8Array.from({ length: len }, (_, i) => (n += 37 + i) & 255);
};

describe('phone identity', () => {
  it('makes a valid id: 1-64 chars of A-Za-z0-9_-', () => {
    for (let i = 0; i < 20; i++) expect(isValidPhoneId(newPhoneId())).toBe(true);
    expect(isValidPhoneId(newPhoneId(counting()))).toBe(true);
  });

  it('makes a different one each time (random)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newPhoneId()));
    expect(ids.size).toBe(50);
  });

  it('generates once and keeps it in the storage: the same id on every later call', () => {
    const storage = memory();
    const first = phoneId(storage, counting());
    expect(isValidPhoneId(first)).toBe(true);
    expect(storage.data.get(PHONE_ID_KEY)).toBe(first);
    expect(phoneId(storage, counting())).toBe(first);
    expect(phoneId(storage)).toBe(first);
  });

  it('replaces a stored value that is not a valid id', () => {
    const storage = memory();
    storage.setItem(PHONE_ID_KEY, 'not valid!!');
    const id = phoneId(storage);
    expect(isValidPhoneId(id)).toBe(true);
    expect(storage.data.get(PHONE_ID_KEY)).toBe(id);
  });

  it('survives storage that throws on read and write (private mode): still a valid id', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const id = phoneId(broken);
    expect(isValidPhoneId(id)).toBe(true);
  });

  it('survives a missing storage (sessionStorage itself throws on access)', () => {
    expect(isValidPhoneId(phoneId(null))).toBe(true);
    expect(isValidPhoneId(phoneId(undefined))).toBe(true);
  });

  it('works without crypto (falls back to Math.random)', () => {
    const id = newPhoneId(null);
    expect(isValidPhoneId(id)).toBe(true);
  });

  it('the join the phone sends round-trips the relay decoder with the id', () => {
    const id = phoneId(memory());
    expect(decode(encode({ t: 'join', role: 'phone', room: 'ABCD', id }))).toEqual({ t: 'join', role: 'phone', room: 'ABCD', id });
  });
});
