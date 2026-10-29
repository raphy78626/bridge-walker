import { MAX_WIND } from './difficulty.js';

export const WIND_WARNING_S = 1.8; // seconds of notice before a gust starts

export const calmForecast = () => ({ state: 'calm', dir: 0, strength: 0, eta: Infinity, remaining: 0 });

// What the wind is about to do at time t, read from wind.peek without advancing it.
// dir +1 pushes the lean to the right (the sign of the wind force); strength is the gust's peak over MAX_WIND.
export function forecastAt(wind, t) {
  const g = wind.peek(t);
  const end = g.start + g.length;
  const dir = Math.sign(g.strength);
  const strength = Math.min(1, Math.abs(g.strength) / MAX_WIND);
  if (t >= g.start) return { state: 'gust', dir, strength, eta: 0, remaining: Math.max(0, end - t) };
  const eta = g.start - t;
  if (eta <= WIND_WARNING_S + 1e-9) return { state: 'warning', dir, strength, eta, remaining: 0 };
  return { state: 'calm', dir: 0, strength: 0, eta, remaining: 0 };
}
