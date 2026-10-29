import { describe, it, expect } from 'vitest';
import { BLOB_FALL_FADE_S, BLOB_OPACITY, blobLook } from '../src/tv/blobShadow.js';

const look = (h, f = 0) => {
  const out = { opacity: -1, scale: -1 };
  const visible = blobLook(h, f, out);
  return { ...out, visible };
};

describe('blob shadow look', () => {
  it('is fully dark at normal size on the planks', () => {
    expect(look(0)).toEqual({ opacity: BLOB_OPACITY, scale: 1, visible: true });
  });

  it('fades and spreads as he jumps up, and never goes negative or beyond the planks value', () => {
    const a = look(0.2);
    const b = look(0.8);
    const c = look(2);
    expect(a.opacity).toBeLessThan(BLOB_OPACITY);
    expect(b.opacity).toBeLessThan(a.opacity);
    expect(c.opacity).toBeLessThan(b.opacity);
    expect(c.opacity).toBeGreaterThan(0);
    expect(b.scale).toBeGreaterThan(a.scale);
    expect(look(-3)).toEqual(look(0)); // below the planks reads as on them
  });

  it('fades out over the first fraction of a second of a fall, then is not drawn', () => {
    const early = look(0, BLOB_FALL_FADE_S / 2);
    expect(early.opacity).toBeCloseTo(BLOB_OPACITY / 2, 5);
    expect(early.visible).toBe(true);
    expect(look(0, BLOB_FALL_FADE_S).visible).toBe(false);
    expect(look(0, 2).opacity).toBe(0);
  });

  it('copes with missing numbers', () => {
    expect(look(undefined, undefined)).toEqual(look(0, 0));
    expect(look(NaN, NaN)).toEqual(look(0, 0));
  });

  it('writes into the object it is given, so a frame allocates nothing', () => {
    const out = {};
    blobLook(0.5, 0, out);
    expect(Object.keys(out).sort()).toEqual(['opacity', 'scale']);
  });
});
