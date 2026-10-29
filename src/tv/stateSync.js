// The {t:'state'} message the TV sends the phone, and the check for when it has changed. The game loop calls
// changed() every frame without allocating, and message() only when it returned true.
//
// Fields: phase, lives, level, paused, keepMoving (always), wind ('calm'|'warning'|'gust'), windDir (-1|0|1) and windLevel (0 calm,
// 1..3 the gust's strength bucket, the same three steps as the TV's wind arrow) from the forecast,
// and after a level stars, score and runScore from the result (runScore also at game over).
import { forecastOf, windLevelOf } from './windFx.js';
import { matchStateFor } from '../game/matchState.js';
import { keepMovingOf } from './keepMoving.js';

// The session a phone's status belongs to: its own in a race, the one walker's in every other mode.
export const sessionFor = (match, player) => (match.mode === 'race' ? match.sessions[player] : match.sessions[1]);

// What the TV sends one phone: its session's state, with the match's fields over it, aimed at that phone alone.
// Solo adds only mode, you, role and gustReady, so the single-player message is the old one plus those.
export const stateMessageFor = (match, player) => ({ ...buildStateMessage(sessionFor(match, player)), ...matchStateFor(match, player), to: player });

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
    paused: !!session.paused,
    wind: f.state,
    windDir: f.dir || 0,
    windLevel: windLevelOf(f),
    keepMoving: keepMovingOf(session), // standing still on the bridge for too long: the phone says so too
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

// One per phone. changed(session) is the single-player check; with the match it also
// watches what only a two-player match changes: the mode and role, the match phase (a round is over while a session is
// still 'playing'), the round, the tally, the scores, this racer's falls, the Wind Master's gust readiness and the result.
export function createStateSync() {
  let phase, lives, level, paused, wind, windDir, windLevel, stars, score, runScore, keepMoving;
  let mode, matchPhase, role, gustReady, round, tally1, tally2, scores1, scores2, falls, matchResult;
  let seen = false;
  return {
    // True when anything the phone shows differs from the last message built. Updates what it compares against.
    changed(session, match = null) {
      const nextKeep = keepMovingOf(session);
      const nextMode = match ? match.mode : undefined;
      const nextMatchPhase = match && match.mode !== 'solo' ? match.phase : undefined;
      const nextRole = match ? match.walkerOf() : undefined; // who walks (windmaster); null elsewhere
      const nextGust = match ? !!match.gustReady : false;
      const nextRound = match && match.mode !== 'solo' ? match.round : undefined;
      const tally = match && match.mode === 'race' ? match.tally : null;
      const scores = match && match.mode !== 'solo' ? match.scores : null;
      const nextT1 = tally ? tally[1] : undefined;
      const nextT2 = tally ? tally[2] : undefined;
      const nextS1 = scores ? scores[1] : undefined;
      const nextS2 = scores ? scores[2] : undefined;
      const nextFalls = match && match.mode === 'race' ? session.levelFalls : undefined;
      const nextResult = match && match.mode !== 'solo' ? match.result : undefined;
      const f = forecastOf(session);
      const r = resultFields(session);
      const nextWindDir = f.dir || 0;
      const nextWindLevel = windLevelOf(f);
      const nextStars = r ? r.stars : undefined;
      const nextScore = r ? r.score : undefined;
      const nextRun = r ? r.runScore : undefined;
      const same =
        seen &&
        phase === session.phase &&
        lives === session.lives &&
        level === session.level &&
        paused === !!session.paused &&
        wind === f.state &&
        windDir === nextWindDir &&
        windLevel === nextWindLevel &&
        stars === nextStars &&
        score === nextScore &&
        runScore === nextRun &&
        keepMoving === nextKeep &&
        mode === nextMode &&
        matchPhase === nextMatchPhase &&
        role === nextRole &&
        gustReady === nextGust &&
        round === nextRound &&
        tally1 === nextT1 &&
        tally2 === nextT2 &&
        scores1 === nextS1 &&
        scores2 === nextS2 &&
        falls === nextFalls &&
        matchResult === nextResult;
      phase = session.phase;
      lives = session.lives;
      level = session.level;
      paused = !!session.paused;
      wind = f.state;
      windDir = nextWindDir;
      windLevel = nextWindLevel;
      stars = nextStars;
      score = nextScore;
      runScore = nextRun;
      keepMoving = nextKeep;
      mode = nextMode;
      matchPhase = nextMatchPhase;
      role = nextRole;
      gustReady = nextGust;
      round = nextRound;
      tally1 = nextT1;
      tally2 = nextT2;
      scores1 = nextS1;
      scores2 = nextS2;
      falls = nextFalls;
      matchResult = nextResult;
      seen = true;
      return !same;
    },
    reset() {
      seen = false;
    },
  };
}
