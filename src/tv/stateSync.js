// The {t:'state'} message the TV sends the phone, and the check for when it has changed. The game loop calls
// changed() every frame without allocating, and message() only when it returned true.
//
// Fields: phase, lives, level (always), wind ('calm'|'warning'|'gust') and windDir (-1|0|1) from the forecast,
// and after a level stars, score and runScore from the result (runScore also at game over).
import { forecastOf } from './windFx.js';

function resultFields(session) {
  const r = session && session.result;
  return r && typeof r === 'object' ? r : null;
}

export function buildStateMessage(session) {
  const f = forecastOf(session);
  const r = resultFields(session);
  const msg = {
    t: 'state',
    phase: session.phase,
    lives: session.lives,
    level: session.level,
    wind: f.state,
    windDir: f.dir || 0,
  };
  if (r && r.kind === 'level') {
    msg.stars = r.stars;
    msg.score = r.score;
    msg.runScore = r.runScore;
  } else if (r && r.kind === 'run') {
    msg.runScore = r.runScore;
  }
  return msg;
}

export function createStateSync() {
  let phase, lives, level, wind, windDir, stars, score, runScore;
  let seen = false;
  return {
    // True when anything the phone shows differs from the last message built. Updates what it compares against.
    changed(session) {
      const f = forecastOf(session);
      const r = resultFields(session);
      const nextWindDir = f.dir || 0;
      const nextStars = r ? r.stars : undefined;
      const nextScore = r ? r.score : undefined;
      const nextRun = r ? r.runScore : undefined;
      const same =
        seen &&
        phase === session.phase &&
        lives === session.lives &&
        level === session.level &&
        wind === f.state &&
        windDir === nextWindDir &&
        stars === nextStars &&
        score === nextScore &&
        runScore === nextRun;
      phase = session.phase;
      lives = session.lives;
      level = session.level;
      wind = f.state;
      windDir = nextWindDir;
      stars = nextStars;
      score = nextScore;
      runScore = nextRun;
      seen = true;
      return !same;
    },
    reset() {
      seen = false;
    },
  };
}
