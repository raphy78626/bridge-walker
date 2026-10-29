// How hard each level is. Level 1 is the game as it was tuned after the TV play tests; each level after
// nudges the wind, the balance and the gaps a little further, up to caps that keep every level winnable.
export const MAX_WIND = 1.2; // keeps every level winnable: full tilt pushes back 3.0

const mm = (x) => Math.round(x * 1000) / 1000;

// A standing or walking jump clears ~1.96 m, so the 1.25 m cap leaves a take-off window of ~0.71 m.
export function difficulty(level) {
  const n = Math.max(1, level);
  const up = n - 1; // levels above the first
  const gapCount = Math.min(2 + n, 7);
  return {
    maxWind: mm(Math.min(MAX_WIND, 0.25 + 0.12 * up)), // peak gust force
    gustGapMin: mm(Math.max(2, 3 - 0.2 * up)), // seconds of calm between gusts
    gustGapMax: mm(Math.max(3.5, 6 - 0.5 * up)),
    instability: mm(Math.min(1.4, 1 + 0.07 * up)), // multiplies how fast a lean grows on its own
    gapCount,
    gapLength: mm(Math.min(0.9 + 0.1 * n, 1.25)), // metres
    parTime: 32 + (gapCount - 3), // seconds to beat for 3 stars (a walk alone takes ~43)
  };
}
