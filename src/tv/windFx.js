// Pure helpers for how wind looks and sounds. Nothing here touches three.js, Web Audio or the DOM, so it is all
// unit-tested; scene.js, hud.js, main.js and the phone just call it.
//
// The game rules provide session.forecast = { state: 'calm'|'warning'|'gust', dir: -1|0|1, strength: 0..1, eta, remaining }.
// dir +1 pushes the walker to the RIGHT, which on screen is wind blowing from the left edge to the right edge.
// Until the rules supply it, a missing forecast reads as calm.

import { WIND_WARNING_S } from '../game/forecast.js'; // seconds of warning before a gust: one definition, in the rules

export const CALM = Object.freeze({ state: 'calm', dir: 0, strength: 0, eta: 0, remaining: 0 });

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0); // NaN and negatives give 0

export function forecastOf(session) {
  const f = session && session.forecast;
  return f && typeof f === 'object' ? f : CALM;
}

const isLive = (f) => f.state === 'warning' || f.state === 'gust';
const strengthOf = (f) => (Number.isFinite(f.strength) ? clamp01(f.strength) : 0.6);

// 0..1 through the warning (0 at its start, 1 when the gust arrives). A forecast without an eta counts as halfway.
export function warningProgress(f) {
  return Number.isFinite(f.eta) ? clamp01(1 - f.eta / WIND_WARNING_S) : 0.5;
}

// How hard the wind is blowing, 0..1 before the gust's own strength: nothing when calm, a rising breeze through
// the warning, and the full gust. The streaks, the rope sway and the whoosh all follow this.
export function windRamp(f) {
  if (!f || !f.dir) return 0;
  if (f.state === 'gust') return 1;
  if (f.state === 'warning') return 0.3 + 0.35 * warningProgress(f);
  return 0;
}

export const STREAK_MAX_OPACITY = 0.75;
// Opacity of the wind streaks: invisible when calm, faint through the warning, strongest in the gust.
export function streakOpacity(f) {
  const ramp = windRamp(f);
  return ramp === 0 ? 0 : STREAK_MAX_OPACITY * ramp * (0.6 + 0.4 * strengthOf(f));
}

export const STREAK_MAX_SPEED = 1.5; // screen widths per second, at the peak of a full gust
// How fast the streaks cross the view; slow through the warning, quick in the gust.
export function streakSpeed(f) {
  const ramp = windRamp(f);
  return ramp === 0 ? 0 : STREAK_MAX_SPEED * ramp * (0.5 + 0.5 * strengthOf(f));
}

// Signed sideways sway for the ropes and cloth, -1..1: positive leans toward +x, the way a +1 gust blows.
export function windSway(f) {
  const ramp = windRamp(f);
  return ramp === 0 ? 0 : Math.sign(f.dir) * ramp * (0.5 + 0.5 * strengthOf(f));
}

// Eases a value toward its target at `rate` per second, independent of the frame rate.
export function easeToward(current, target, dt, rate) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// ---------- HUD indicator ----------

// The strength bar has three steps, so the DOM changes when the step does, not every frame.
export function strengthLevel(strength) {
  const s = Number.isFinite(strength) ? clamp01(strength) : 0.6;
  return s < 0.4 ? 1 : s < 0.75 ? 2 : 3;
}

// What the HUD's wind indicator shows. The result is one of a few shared frozen objects (no allocation per frame),
// so the HUD can compare by reference and touch the DOM only when it changes:
//   { visible, state, from, level }  from: 'left' | 'right', the screen edge the wind blows in from.
const OFF = Object.freeze({ visible: false, state: 'calm', from: null, level: 0 });
const TABLE = {};
for (const state of ['warning', 'gust']) {
  for (const from of ['left', 'right']) {
    for (let level = 1; level <= 3; level++) {
      TABLE[`${state}:${from}:${level}`] = Object.freeze({ visible: true, state, from, level });
    }
  }
}
export function windIndicator(f) {
  if (!f || !isLive(f) || !f.dir) return OFF;
  const from = f.dir > 0 ? 'left' : 'right'; // wind pushing right comes in from the left
  return TABLE[`${f.state}:${from}:${strengthLevel(f.strength)}`];
}
export const WIND_OFF = OFF;

// ---------- one cue per gust ----------

// The whoosh sweeps through the whole warning (WIND_WARNING_S) and peaks as the gust arrives, so it only makes sense
// when most of the warning is still ahead. After a fall during a warning the walker respawns into a gust that is
// already part-way through it: that one stays silent rather than re-firing a full sweep.
export const GUST_WHOOSH_MIN_ETA = 1.2;

// Fires once per gust: true on the frame the forecast first leaves calm (the start of the warning) with at least
// GUST_WHOOSH_MIN_ETA seconds of warning left, and not again until it has been calm. A gust that is already blowing
// (or whose warning is mostly gone) does not fire. A forecast without an eta counts as a fresh warning.
export function createGustTrigger() {
  let active = false;
  return {
    update(f) {
      const live = !!f && isLive(f) && !!f.dir;
      const lead = f && Number.isFinite(f.eta) ? f.eta : WIND_WARNING_S;
      const fire = live && !active && lead > GUST_WHOOSH_MIN_ETA;
      active = live; // a gust seen late is still "this gust": it must not fire when its warning is nearly over
      return fire;
    },
    reset() {
      active = false;
    },
  };
}
