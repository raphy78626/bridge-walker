// The TV's stand-in for the soldier's shadow. Real shadow maps cost a TV's GPU too much (and switching them on and
// off rebuilds shaders, a hitch), so on a TV a soft dark disc lies on the planks under his feet instead: one small
// plane, one draw call. This file is the pure part (no three.js): how dark and how big the disc is.

export const BLOB_OPACITY = 0.7; // at the planks, standing still
export const BLOB_FALL_FADE_S = 0.3; // a fall takes the disc away this fast
const AIR_FALLOFF = 1.6; // per metre of jump height: at 0.5 m up the disc is a little over half as dark
const AIR_SPREAD = 0.3; // the disc grows by up to this fraction, and softens, as he rises
const MIN_VISIBLE = 0.01;

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

// height: metres above the planks (a jump); fallTime: seconds into a fall, or 0 when not falling.
// Writes { opacity, scale } into `out` (reused every frame) and returns whether anything is left to draw.
export function blobLook(height, fallTime, out) {
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const air = 1 / (1 + AIR_FALLOFF * h); // 1 on the planks, towards 0 high up
  const fall = Number.isFinite(fallTime) && fallTime > 0 ? clamp01(1 - fallTime / BLOB_FALL_FADE_S) : 1;
  out.opacity = BLOB_OPACITY * air * fall;
  out.scale = 1 + AIR_SPREAD * (1 - air);
  return out.opacity > MIN_VISIBLE;
}
