import { describe, it, expect } from 'vitest';
import { scoreLevel } from '../src/game/scoring.js';

const par = 32;
const stars = (falls, time) => scoreLevel({ level: 1, falls, time, parTime: par }).stars;

describe('scoreLevel stars', () => {
  it('3 stars for no falls at or under par', () => {
    expect(stars(0, 20)).toBe(3);
    expect(stars(0, 32)).toBe(3);
  });
  it('2 stars for a clean run a little over par, or one fall within 1.35x par', () => {
    expect(stars(0, 32.01)).toBe(2);
    expect(stars(0, 32 * 1.35)).toBe(2);
    expect(stars(1, 20)).toBe(2);
    expect(stars(1, 32 * 1.35)).toBe(2);
  });
  it('1 star otherwise', () => {
    expect(stars(0, 32 * 1.35 + 0.01)).toBe(1);
    expect(stars(1, 32 * 1.35 + 0.01)).toBe(1);
    expect(stars(2, 10)).toBe(1);
    expect(stars(5, 100)).toBe(1);
  });
});

describe('scoreLevel score', () => {
  const score = (o) => scoreLevel({ level: 1, time: 32, falls: 0, parTime: par, ...o }).score;

  it('is 500 + 100 * level + time bonus + clean bonus', () => {
    expect(score({ level: 1 })).toBe(500 + 100 + 0 + 300);
    expect(score({ level: 4 })).toBe(500 + 400 + 0 + 300);
  });
  it('pays 40 a second for beating par, rounded, and nothing for being slow', () => {
    expect(score({ time: 22 })).toBe(900 + 400);
    expect(score({ time: 31.99 })).toBe(900 + Math.round(0.01 * 40));
    expect(score({ time: 20.3 })).toBe(900 + Math.round(11.7 * 40));
    expect(score({ time: 50 })).toBe(900);
  });
  it('gives +300 for no falls and takes 120 a fall otherwise', () => {
    expect(score({ falls: 0 })).toBe(900);
    expect(score({ falls: 1 })).toBe(600 - 120);
    expect(score({ falls: 2 })).toBe(600 - 240);
  });
  it('never drops below 100', () => {
    expect(score({ falls: 10, time: 99 })).toBe(100);
    expect(score({ falls: 4, time: 99 })).toBe(500 + 100 - 480);
  });
});
