import { mulberry32 } from './rng.js';
import { difficulty } from './difficulty.js';

const FIRST_START = 8; // metres: no gap in the first stretch of bridge
const END_MARGIN = 5; // the last gap starts at least this far from the far side
const MIN_SPACING = 6; // metres of solid planks between one gap's end and the next one's start
// The layout is planned with a hair more than MIN_SPACING, so rounding to a millimetre can never eat into it.
const PLAN_SPACING = MIN_SPACING + 0.01;
const SALT = 0x5bd1e995; // keeps the layout's random stream apart from the wind's (seed + level)

const mm = (x) => Math.round(x * 1000) / 1000;

// Eased for real players after TV play tests (was capped at 1.3 m): a walking jump clears 1.96 m, so the
// worst-case take-off window at the 1.25 m cap is about 0.71 m (see difficulty.js).
export const gapLength = (level) => difficulty(level).gapLength;

// Returns a fresh, ascending array of { start, end } in metres along the bridge. Same seed and level, same layout.
export function generateGaps(seed, level, bridgeLength) {
  const len = gapLength(level);
  const lastStart = bridgeLength - END_MARGIN;
  const pitch = len + PLAN_SPACING;
  // A bridge can only hold so many gaps with 6 m between them (8 gaps of 1.2 m would need > 58 m of starts).
  const fits = Math.floor((lastStart - FIRST_START) / pitch) + 1;
  const count = Math.max(0, Math.min(difficulty(level).gapCount, fits));

  const rand = mulberry32((seed + level) ^ SALT);
  // Spread the leftover room: sorted random offsets never shrink the spacing and never pass lastStart.
  const slack = lastStart - FIRST_START - (count - 1) * pitch;
  const offsets = Array.from({ length: count }, () => rand() * slack).sort((a, b) => a - b);

  return offsets.map((off, i) => {
    const start = mm(FIRST_START + i * pitch + off);
    return { start, end: mm(start + len) };
  });
}

// Metres from z to the start of the next gap ahead (start > z), or Infinity. gaps must be sorted.
export function distanceToNextGap(gaps, z) {
  for (const g of gaps) if (g.start > z) return g.start - z;
  return Infinity;
}

// The gap the walker is over, or null.
export function gapAt(gaps, z) {
  return gaps.find((g) => g.start < z && z < g.end) ?? null;
}
