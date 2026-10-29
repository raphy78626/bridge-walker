import { mulberry32 } from './rng.js';
import { difficulty } from './difficulty.js';

const LEVEL_1 = difficulty(1);

// Sideways gusts that push the walker's lean: calm for gustGapMin-gustGapMax seconds, then a sine-shaped gust
// lasting 1-2 s. The gusts come from one seeded stream, drawn in order and remembered, so force(t) and peek(t)
// are both pure functions of t: asking about the future never changes what force(t) returns.
export function createWind({
  seed = 1,
  maxForce = 0.6,
  gustGapMin = LEVEL_1.gustGapMin,
  gustGapMax = LEVEL_1.gustGapMax,
} = {}) {
  const rand = mulberry32(seed);
  const between = (lo, hi) => lo + rand() * (hi - lo);

  const gusts = []; // { start, length, strength } in time order; strength is the signed peak force
  const nextGust = () => {
    const prev = gusts[gusts.length - 1];
    const start = prev ? prev.start + prev.length + between(gustGapMin, gustGapMax) : between(gustGapMin, gustGapMax);
    const length = between(1, 2);
    const strength = (rand() < 0.5 ? -1 : 1) * between(0.4, 1) * maxForce;
    gusts.push({ start, length, strength });
  };
  nextGust();

  // The first gust that has not finished by t (t > start + length means finished).
  let hint = 0;
  const gustAt = (t) => {
    while (hint > 0 && t <= gusts[hint - 1].start + gusts[hint - 1].length) hint--;
    for (;;) {
      if (hint === gusts.length) nextGust();
      const g = gusts[hint];
      if (t <= g.start + g.length) return g;
      hint++;
    }
  };

  return {
    force(t) {
      const { start, length, strength } = gustAt(t);
      if (t < start) return 0;
      return strength * Math.sin((Math.PI * (t - start)) / length);
    },

    // The gust blowing at t, or else the next one to come: { start, length, strength } (strength is signed).
    // At the exact moment a gust ends, that gust is over and the next one is returned.
    peek(t) {
      const g = gustAt(t);
      if (t < g.start + g.length) return { ...g };
      return { ...gustAt(g.start + g.length + 1e-9) };
    },
  };
}
