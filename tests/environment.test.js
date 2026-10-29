import { describe, it, expect } from 'vitest';
import { plankOverlapsGap, gateHalfSpan } from '../src/tv/environment.js';

// Planks sit every 0.45 m and are 0.32 m deep, so plank i covers [0.45 i - 0.16, 0.45 i + 0.16] metres along the bridge.
describe('bridge gaps', () => {
  it('keeps every plank when there are no gaps', () => {
    for (let i = 0; i < 134; i++) expect(plankOverlapsGap(i, [])).toBe(false);
  });

  it('drops the planks whose span touches the gap, and only those', () => {
    const gaps = [{ start: 10, end: 12 }];
    const removed = [];
    for (let i = 0; i < 134; i++) if (plankOverlapsGap(i, gaps)) removed.push(i);
    // 22 -> [9.74, 10.06] straddles the start; 27 -> [11.99, 12.31] straddles the end
    expect(removed).toEqual([22, 23, 24, 25, 26, 27]);
  });

  it('a plank that only touches the gap edge stays', () => {
    expect(plankOverlapsGap(0, [{ start: 0.16, end: 1 }])).toBe(false);
  });

  it('handles several gaps', () => {
    const gaps = [{ start: 5, end: 6 }, { start: 30, end: 31 }];
    expect(plankOverlapsGap(12, gaps)).toBe(true); // 5.4 m
    expect(plankOverlapsGap(67, gaps)).toBe(true); // 30.15 m
    expect(plankOverlapsGap(40, gaps)).toBe(false);
  });
});

describe('the gate at the far end', () => {
  it('keeps its old posts, 1.6 m either side, for the single bridge', () => {
    expect(gateHalfSpan([0])).toBeCloseTo(1.6);
  });

  it('stands clear of both bridges of a race: 0.95 m outside the outer hand rope', () => {
    const half = gateHalfSpan([-1.2, 1.2]);
    expect(half).toBeCloseTo(1.2 + 0.65 + 0.95);
    expect(half - 0.4).toBeGreaterThan(1.2 + 0.65); // the post's inner face is outside the hand rope
  });
});
