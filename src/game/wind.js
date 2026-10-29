import { mulberry32 } from './rng.js';

const MIN_GAP = 3; // seconds of calm between gusts
const MAX_GAP = 6;

// Sideways gusts that push the walker's lean. force(t) must be called with non-decreasing t.
export function createWind({ seed = 1, maxForce = 0.6 } = {}) {
  const rand = mulberry32(seed);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const newStrength = () => (rand() < 0.5 ? -1 : 1) * between(0.4, 1) * maxForce;

  let start = between(MIN_GAP, MAX_GAP);
  let length = between(1, 2);
  let strength = newStrength();

  return {
    force(t) {
      while (t > start + length) {
        start += length + between(MIN_GAP, MAX_GAP);
        length = between(1, 2);
        strength = newStrength();
      }
      if (t < start) return 0;
      return strength * Math.sin((Math.PI * (t - start)) / length);
    },
  };
}
