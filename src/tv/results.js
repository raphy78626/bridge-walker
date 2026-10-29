// Pure helpers for the timer, the results panel and the best-score records. No DOM and no three.js.
//
// The session supplies, per level: parTime (s), levelFalls and runScore; and session.result, which is null while
// playing and, on 'won', { kind:'level', level, time, falls, stars:1..3, score, parTime, runScore }, on 'gameover'
// { kind:'run', level, runScore }. Every helper tolerates missing fields.

export const RECORDS_KEY = 'bridge.records';

const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

// 3 -> "★★★", 1 -> "★☆☆". Out-of-range counts are clamped to 0..3.
export function formatStars(n) {
  const filled = Math.max(0, Math.min(3, Math.round(num(n))));
  return '★'.repeat(filled) + '☆'.repeat(3 - filled);
}

// Seconds as m:ss ("0:32", "12:05"); the HUD timer itself stays mm:ss (hud.js formatTime).
export function formatClock(sec) {
  const total = Math.max(0, Math.floor(num(sec)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 1240 -> "1,240"
export function formatScore(n) {
  return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const formatPar = (parTime) => (Number.isFinite(parTime) && parTime > 0 ? `PAR ${formatClock(parTime)}` : '');

// The timer is gold while the walker is still under par. Without a par it is never gold.
export function underPar(time, parTime) {
  return Number.isFinite(parTime) && parTime > 0 && num(time) <= parTime;
}

// The phone's status after a level, e.g. "★★☆ 1,240 pts"; '' when there is no result.
export function resultLine(stars, score) {
  return Number.isFinite(stars) && Number.isFinite(score) ? `${formatStars(stars)} ${formatScore(score)} pts` : '';
}

// ---------- records ----------
// A storage object is anything with getItem/setItem (localStorage). It may be null, or throw: nothing is recorded then.
// The stored value is { levels: { "1": { score, time }, ... }, run: bestRunScore }.

export function loadRecords(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(RECORDS_KEY));
    if (parsed && typeof parsed === 'object') {
      return { levels: parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {}, run: num(parsed.run) };
    }
  } catch {}
  return { levels: {}, run: 0 };
}

function saveRecords(storage, records) {
  try {
    storage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {} // private mode, a full disk or no storage: the panel still shows this run's numbers
}

// Folds a finished level into the records. Returns what the panel shows:
//   { best: { score, time }, newScore, newTime }
// newScore / newTime are true only when an earlier record existed and this run beat it, so a first clear is
// recorded quietly. Best time is the fastest clear, whatever its score.
export function recordLevel(storage, result) {
  const records = loadRecords(storage);
  const key = String(result.level);
  const prev = records.levels[key];
  const score = num(result.score);
  const time = num(result.time, Infinity);
  const bestScore = prev && Number.isFinite(prev.score) ? Math.max(prev.score, score) : score;
  const bestTime = prev && Number.isFinite(prev.time) ? Math.min(prev.time, time) : time;
  const newScore = !!prev && Number.isFinite(prev.score) && score > prev.score;
  const newTime = !!prev && Number.isFinite(prev.time) && time < prev.time;
  records.levels[key] = { score: bestScore, time: Number.isFinite(bestTime) ? bestTime : null };
  saveRecords(storage, records);
  return { best: { score: bestScore, time: Number.isFinite(bestTime) ? bestTime : null }, newScore, newTime };
}

// Folds a finished run (game over) into the best run score. Returns { best, isNew }.
export function recordRun(storage, result) {
  const records = loadRecords(storage);
  const score = num(result.runScore);
  const isNew = records.run > 0 && score > records.run;
  records.run = Math.max(records.run, score);
  saveRecords(storage, records);
  return { best: records.run, isNew };
}

// Which record(s) this clear beat, as the panel's badge: 'NEW BEST SCORE!', 'NEW BEST TIME!' or
// 'NEW BEST SCORE & TIME!', and '' when neither. The best score and the best time can come from different runs.
export function newBestLabel(newScore, newTime) {
  if (newScore && newTime) return 'NEW BEST SCORE & TIME!';
  if (newScore) return 'NEW BEST SCORE!';
  if (newTime) return 'NEW BEST TIME!';
  return '';
}

// "Best score 1,500 · Best time 0:29" (just the score when there is no time record).
export function bestLine(score, time) {
  return `Best score ${score}${time ? ` · Best time ${time}` : ''}`;
}

// The numbers and labels for the results panel, all as strings, so hud.js only has to place them.
// `recorded` is what recordLevel / recordRun returned for this result.
export function resultView(result, recorded) {
  if (!result) return null;
  if (result.kind === 'run') {
    return {
      kind: 'run',
      title: 'GAME OVER',
      level: `Reached level ${num(result.level, 1)}`,
      runScore: formatScore(result.runScore),
      bestRun: formatScore(recorded ? recorded.best : result.runScore),
      isNew: !!(recorded && recorded.isNew),
      next: 'Press START to try again',
    };
  }
  const best = recorded ? recorded.best : { score: result.score, time: result.time };
  return {
    kind: 'level',
    title: `LEVEL ${num(result.level, 1)} COMPLETE`,
    stars: Math.max(0, Math.min(3, Math.round(num(result.stars)))),
    time: formatClock(result.time),
    par: formatPar(result.parTime),
    falls: String(Math.max(0, Math.round(num(result.falls)))),
    score: formatScore(result.score),
    runScore: formatScore(result.runScore),
    bestScore: formatScore(best.score),
    bestTime: best.time == null ? '' : formatClock(best.time),
    bestLine: bestLine(formatScore(best.score), best.time == null ? '' : formatClock(best.time)),
    newScore: !!(recorded && recorded.newScore),
    newTime: !!(recorded && recorded.newTime),
    isNew: !!(recorded && (recorded.newScore || recorded.newTime)),
    newLabel: newBestLabel(!!(recorded && recorded.newScore), !!(recorded && recorded.newTime)),
    next: `Press START for Level ${num(result.level, 1) + 1}`,
  };
}

// Same result? Compared by value, so a session that builds a fresh object each frame does not re-open the panel.
export function sameResult(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.level === b.level &&
    a.round === b.round && // a race or Wind Master round (undefined for the solo results)
    a.winner === b.winner &&
    a.walker === b.walker &&
    a.outcome === b.outcome &&
    a.time === b.time &&
    a.falls === b.falls &&
    a.stars === b.stars &&
    a.score === b.score &&
    a.runScore === b.runScore
  );
}
