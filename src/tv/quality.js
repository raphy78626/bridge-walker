// Adaptive render quality, as a pure function so the rules can be unit-tested.
// state: { scale, shadows, goodStreak }. fps is measured over the last reading window (2 s).
export const MIN_SCALE = 0.4;
export const SCALE_STEP = 0.1;
const GOOD_READINGS = 2;

// options.shadows === false: shadows are permanently off and never come back. Each switch rebuilds shaders (a hitch),
// and a TV hovering at 36-46 fps would otherwise toggle them again and again. The TV fakes the soldier's shadow
// with a blob (blobShadow.js) instead.
//
// Desktop defaults: drop resolution under 40 fps, shadows under 35 at the floor, win back above 55.
const DESKTOP = { minScale: MIN_SCALE, maxScale: 1.5, slowFps: 40, verySlowFps: 35, fastFps: 55 };

// Measured on an LG 55UR9050 (PowerVR BXE-4-32, 50 Hz panel). With the TV's sparse clouds over one opaque cloud layer
// the scene holds the panel's 50 fps at 0.7 scale; 0.8 drops to ~45 and judders, so 0.7 is also the ceiling. The floor
// stays 0.6 (0.4, 512x288, looked blocky on a 55" screen). Each scale change reallocates the drawing buffer, so the
// TV should simply sit at 0.7.
export const TV_QUALITY = { minScale: 0.6, maxScale: 0.7, slowFps: 38, verySlowFps: 32, fastFps: 46, startScale: 0.7, shadows: false };

const round2 = (n) => Math.round(n * 100) / 100;

export function nextQuality(fps, state, options = {}) {
  const { minScale, maxScale, slowFps, verySlowFps, fastFps, shadows: canHaveShadows } = { ...DESKTOP, shadows: true, ...options };
  const { scale, goodStreak } = state;
  const shadows = canHaveShadows && state.shadows; // with shadows ruled out, the state's flag is ignored: always off
  if (fps < slowFps && scale > minScale) {
    return { scale: Math.max(minScale, round2(scale - SCALE_STEP)), shadows, goodStreak: 0 };
  }
  if (fps < verySlowFps && shadows) {
    return { scale, shadows: false, goodStreak: 0 };
  }
  if (fps > fastFps) {
    const streak = goodStreak + 1;
    if (streak >= GOOD_READINGS) {
      // Shadows come back before resolution does (when they are allowed at all); each step needs a fresh pair of good readings.
      if (!shadows && canHaveShadows) return { scale, shadows: true, goodStreak: 0 };
      if (scale < maxScale) return { scale: Math.min(maxScale, round2(scale + SCALE_STEP)), shadows, goodStreak: 0 };
    }
    return { scale, shadows, goodStreak: Math.min(streak, GOOD_READINGS) };
  }
  return { scale, shadows, goodStreak: 0 };
}
