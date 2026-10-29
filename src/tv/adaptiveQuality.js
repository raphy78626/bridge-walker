import { nextQuality, TV_QUALITY } from './quality.js';

// TV GPUs vary wildly. Every 2 s, trade resolution (and then shadows) for a smooth frame rate,
// and win them back when there is headroom. The rules live in quality.js.
export function createAdaptiveQuality(renderer, setShadows, isTV) {
  const options = isTV ? TV_QUALITY : { maxScale: Math.min(window.devicePixelRatio, 1.5) };
  let state = { scale: Math.min(isTV ? TV_QUALITY.startScale : 1, options.maxScale), shadows: !isTV, goodStreak: 0 };
  let frames = 0;
  // Ignore the first seconds: loading the model, textures and sounds and compiling shaders stalls a TV
  // to ~11 fps for about 8 s, which would otherwise knock it straight down to the floor with shadows off.
  let since = performance.now() + 10000;
  renderer.setPixelRatio(state.scale);
  function adapt() {
    if (adapt.paused) return; // set during remote profiling
    const now = performance.now();
    if (now < since) return;
    frames += 1;
    if (now - since < 2000) return;
    const fps = (frames * 1000) / (now - since);
    frames = 0;
    since = now;
    const next = nextQuality(fps, state, options);
    // setPixelRatio reallocates the drawing buffer, and a shadow switch rebuilds shaders: only when it changed.
    if (next.scale !== state.scale) renderer.setPixelRatio(next.scale);
    if (next.shadows !== state.shadows) setShadows(next.shadows);
    state = next;
  }
  adapt.describe = () => `scale=${state.scale.toFixed(1)} shadows=${state.shadows}`;
  return adapt;
}
