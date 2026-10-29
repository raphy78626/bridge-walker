// "KEEP MOVING!": on the bridge, standing still for too long topples the walker (session.idleTime, game/session.js). The
// warning shows once he has stood still this long, well before the push starts (IDLE_GRACE), on the TV and on the phone.
export const KEEP_MOVING_AFTER_S = 0.6;

// Is this session's walker standing still long enough to warn? Not while paused, and only while playing. A halted lane
// (the race loser, frozen where he stands) keeps its last idleTime, so it must be excluded here.
export const keepMovingOf = (session) => !!session && session.phase === 'playing' && !session.paused && !session.halted && (session.idleTime ?? 0) > KEEP_MOVING_AFTER_S;
