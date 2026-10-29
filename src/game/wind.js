import { mulberry32 } from './rng.js';
import { difficulty } from './difficulty.js';
import { WIND_WARNING_S } from './forecast.js';

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

export const GUST_COOLDOWN_S = 3; // the Wind Master's gusts are at least this far apart (trigger to trigger)
export const CONTROLLED_GUST_S = 1.5; // how long a Wind Master gust blows
export const GUST_GRACE_S = 1; // a fall this soon after a gust ended still counts as the gust's doing

// Wind that only blows when somebody asks for it (the Wind Master in windmaster mode). Same force(t) / peek(t) API as
// createWind, so forecastAt() and the session work with it unchanged. trigger(dir, t) books a sine-shaped gust that
// starts WIND_WARNING_S after t, which is exactly the forecast's warning window: the walker always sees the full
// notice. Times are the session's level time, which stands still while paused or falling.
// A trigger is refused (false) until the cooldown since the last trigger is over AND the last gust has finished, so a
// gust is never booked while another is pending or blowing: at most one is ever queued, and warnings never overlap.
export function createControlledWind({ maxForce = 0.6, cooldown = GUST_COOLDOWN_S, length = CONTROLLED_GUST_S } = {}) {
  const gusts = []; // { start, length, strength } in time order; strength is the signed peak force
  let lastTrigger = -Infinity;
  const lastEnd = () => (gusts.length ? gusts[gusts.length - 1].start + gusts[gusts.length - 1].length : -Infinity);
  const readyAt = () => Math.max(lastTrigger + cooldown, lastEnd());

  return {
    force(t) {
      for (const g of gusts) {
        if (t >= g.start && t <= g.start + g.length) return g.strength * Math.sin((Math.PI * (t - g.start)) / g.length);
      }
      return 0;
    },

    // The gust blowing at t, else the next booked one, else a gust that never comes (start Infinity, strength 0:
    // the forecast reads that as calm). Like createWind, a gust that ends exactly at t is over.
    peek(t) {
      const g = gusts.find((x) => t < x.start + x.length);
      return g ? { ...g } : { start: Infinity, length, strength: 0 };
    },

    // Book a gust (dir -1 pushes left, +1 right) to start at t + WIND_WARNING_S. False when refused.
    trigger(dir, t) {
      if (dir !== -1 && dir !== 1) return false;
      if (!Number.isFinite(t) || t < readyAt()) return false;
      while (gusts.length > 4) gusts.shift(); // long finished
      gusts.push({ start: t + WIND_WARNING_S, length, strength: dir * maxForce });
      lastTrigger = t;
      return true;
    },

    ready: (t) => t >= readyAt(),
    // Seconds until trigger() would be accepted (0 when ready).
    readyIn: (t) => Math.max(0, readyAt() - t),
    // Whether a gust was blowing at t, or had ended less than `grace` seconds before.
    blewWithin: (t, grace = GUST_GRACE_S) => gusts.some((g) => t >= g.start && t <= g.start + g.length + grace),
  };
}
