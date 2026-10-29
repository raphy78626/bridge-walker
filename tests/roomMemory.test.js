import { describe, it, expect } from 'vitest';
import { loadRoom, saveRoom } from '../src/tv/roomMemory.js';

function memoryStore() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}
const KEY = 'abcDEF123_-abcDEF123_-';

describe('roomMemory', () => {
  it('gives back the room and key it saved, for the join after a reload', () => {
    const store = memoryStore();
    expect(loadRoom(store)).toEqual({});
    saveRoom(store, { t: 'room', room: 'ABCD', key: KEY });
    expect(loadRoom(store)).toEqual({ room: 'ABCD', key: KEY });
  });

  it('saves nothing malformed, and reads nothing malformed', () => {
    const store = memoryStore();
    saveRoom(store, { room: 'abcd', key: KEY });
    saveRoom(store, { room: 'ABCD' });
    expect(loadRoom(store)).toEqual({});
    store.setItem('bridge-walker.room', '{not json');
    expect(loadRoom(store)).toEqual({});
    store.setItem('bridge-walker.room', JSON.stringify({ room: 'ABCD', key: 'short' }));
    expect(loadRoom(store)).toEqual({});
  });

  it('a missing or throwing store means a new room, never an error', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
    expect(loadRoom(null)).toEqual({});
    expect(loadRoom(broken)).toEqual({});
    expect(() => saveRoom(broken, { room: 'ABCD', key: KEY })).not.toThrow();
    expect(() => saveRoom(null, { room: 'ABCD', key: KEY })).not.toThrow();
  });
});
