// Where the two racers stand and what the camera does about them. Pure (no three.js, no DOM), so it is unit-tested.
//
// Race mode puts two bridges side by side (LANE_X); player 1 takes the left one, player 2 the right. The camera has
// three views: 'shared' (both bridges in frame, centred between the two soldiers) and 'p1' / 'p2' (the usual chase
// camera on one of them). First person and the cinematic are solo views.
import { forecastOf, windRamp } from './windFx.js';

export const LANE_X = { 1: -1.2, 2: 1.2 }; // world x of each player's bridge; 2.4 m apart, centred on the old single bridge
export const RACE_BRIDGES = [LANE_X[1], LANE_X[2]];
export const SOLO_BRIDGES = [0];

export const RACE_VIEWS = ['shared', 'p1', 'p2'];
export const DEFAULT_RACE_VIEW = 'shared';
export const RACE_VIEW_LABELS = { shared: 'Shared view', p1: 'Following P1', p2: 'Following P2' };
export const isRaceView = (v) => RACE_VIEWS.includes(v);
// shared -> p1 -> p2 -> shared. Anything unknown counts as shared, so the next one is p1.
export const nextRaceView = (view) => RACE_VIEWS[(isRaceView(view) ? RACE_VIEWS.indexOf(view) + 1 : 1) % RACE_VIEWS.length];

// The chase camera for the shared view, as extras on the focus (cameraRig.js reads back / up / aim / aimY and falls back
// to its usual 5 / 2.4 / 8 / 1.1 for a single walker). The camera stays behind the player who is further back, so
// neither racer ever drops out of frame, and rises with the gap between them.
export const SHARED_CAM = {
  back: 6.5, // m behind the midpoint when they run level
  up: 3.4, // m above the planks
  perMetreBack: 0.5, // behind the midpoint by half the gap between them, so the laggard is still in front of the lens
  perMetreUp: 0.1,
  maxUp: 9,
  aim: 7, // m ahead of the midpoint the camera looks at
  aimY: 0.9,
  perMetreAim: 0.25,
};

// What a camera follows when the view is shared: the midpoint between the two walkers' focuses, in the shape
// walker.js's `focus` has. `out` is a reused object (made once with sharedFocusShell), so a frame allocates nothing.
export function sharedFocusShell(makePosition = () => ({ x: 0, y: 0, z: 0 }), makeQuaternion = () => ({ x: 0, y: 0, z: 0, w: 1 })) {
  return {
    w: { z: 0, y: 0, vy: 0, lean: 0, speed: 0, airborne: false },
    x: 0,
    position: makePosition(),
    quaternion: makeQuaternion(),
    pose: null,
    speed: 0,
    falling: false,
    gapFall: false,
    phaseTime: 0,
    back: SHARED_CAM.back,
    up: SHARED_CAM.up,
    aim: SHARED_CAM.aim,
    aimY: SHARED_CAM.aimY,
  };
}

// a, b: two walkers' focuses ({ w: { z }, x }). Returns `out`.
export function sharedFocus(out, a, b) {
  const gap = Math.abs(a.w.z - b.w.z);
  out.w.z = (a.w.z + b.w.z) / 2; // the session's z: metres along the bridge
  out.x = (a.x + b.x) / 2;
  out.position.x = out.x;
  out.position.z = -out.w.z;
  out.back = SHARED_CAM.back + SHARED_CAM.perMetreBack * gap;
  out.up = Math.min(SHARED_CAM.maxUp, SHARED_CAM.up + SHARED_CAM.perMetreUp * gap);
  out.aim = SHARED_CAM.aim + SHARED_CAM.perMetreAim * gap;
  return out;
}

// Which session the wind effects (arrow, streaks, rope sway, whoosh) follow. The two racers share a wind seed but not a
// clock (a fall stops a racer's time), so their forecasts can differ by a few seconds. Following one racer shows his;
// the shared view shows whichever has the stronger wind right now, and player 1's when neither has any.
export function windSessionOf(sessions, view) {
  if (!sessions[2] || view === 'p1') return sessions[1];
  if (view === 'p2') return sessions[2];
  return windRamp(forecastOf(sessions[2])) > windRamp(forecastOf(sessions[1])) ? sessions[2] : sessions[1];
}

// How the race's two soldiers should be drawn this frame: a session that was halted (the round's loser, frozen where he
// stands) must stand still, not keep walking on the spot, so the walker is told it is no longer playing.
export const walkerPhaseOf = (session) => (session.halted && session.phase === 'playing' ? 'halted' : session.phase);
