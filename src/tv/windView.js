import { CALM, easeToward, forecastOf, streakOpacity, streakSpeed, windSway } from './windFx.js';

// The smoothed look of the wind: the forecast flips between states, the picture eases between them.
// update(session, dt) moves opacity / speed (the streaks), sway (the ropes, cloth and camera shake) and dir
// toward what the forecast asks for. One object, reused every frame: no allocation.
export function createWindView() {
  const view = {
    opacity: 0,
    speed: 0,
    sway: 0,
    dir: 1, // the last gust's direction, held while the streaks fade out
    update(s, dt) {
      const f = forecastOf(s);
      const calm = f === CALM || f.state === 'calm';
      view.opacity = easeToward(view.opacity, streakOpacity(f), dt, calm ? 3 : 6);
      view.speed = easeToward(view.speed, streakSpeed(f), dt, calm ? 2 : 4);
      view.sway = easeToward(view.sway, windSway(f), dt, calm ? 2.5 : 5);
      if (f.dir) view.dir = f.dir > 0 ? 1 : -1;
    },
  };
  return view;
}
