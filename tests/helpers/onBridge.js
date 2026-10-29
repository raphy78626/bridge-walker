// Levels start on the rock ledge before the bridge (START_Z), where he can't fall and the clock and wind wait.
// Many tests are about what happens on the bridge, so they put him at its first plank, as levels used to start.
export function toBridge(session) {
  session.walker = { ...session.walker, z: 0 };
  return session;
}

export function matchToBridge(match) {
  for (const p of match.players) if (match.sessions[p]) toBridge(match.sessions[p]);
  return match;
}

// Either a session or a match.
export function onBridge(x) {
  return x && x.sessions ? matchToBridge(x) : toBridge(x);
}

// onBridge, then one frame, so the level clock is running. A Wind Master gust is refused until it is (it is booked against
// that clock), so the gust tests start here; everything else about the first plank is the same.
export function steppedOn(x, dt = 1 / 60) {
  onBridge(x);
  x.update(dt);
  return x;
}
