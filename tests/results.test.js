import { describe, it, expect } from 'vitest';
import {
  RECORDS_KEY,
  formatClock,
  formatPar,
  formatScore,
  formatStars,
  bestLine,
  loadRecords,
  newBestLabel,
  recordLevel,
  recordRun,
  resultLine,
  resultView,
  sameResult,
  underPar,
} from '../src/tv/results.js';

const memory = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
};
const level = (o = {}) => ({ kind: 'level', level: 1, time: 41, falls: 2, stars: 2, score: 1240, parTime: 32, runScore: 1240, ...o });

describe('formatting', () => {
  it('draws filled and empty stars', () => {
    expect(formatStars(3)).toBe('★★★');
    expect(formatStars(2)).toBe('★★☆');
    expect(formatStars(1)).toBe('★☆☆');
    expect(formatStars(0)).toBe('☆☆☆');
    expect(formatStars(7)).toBe('★★★');
    expect(formatStars(-1)).toBe('☆☆☆');
    expect(formatStars(undefined)).toBe('☆☆☆');
  });

  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(32)).toBe('0:32');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(725)).toBe('12:05');
    expect(formatClock(NaN)).toBe('0:00');
  });

  it('groups thousands in scores', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(950)).toBe('950');
    expect(formatScore(1240)).toBe('1,240');
    expect(formatScore(1234567.4)).toBe('1,234,567');
    expect(formatScore(undefined)).toBe('0');
  });

  it('writes the par label, or nothing without a par', () => {
    expect(formatPar(32)).toBe('PAR 0:32');
    expect(formatPar(95)).toBe('PAR 1:35');
    expect(formatPar(undefined)).toBe('');
    expect(formatPar(0)).toBe('');
  });

  it('says whether the timer is still under par', () => {
    expect(underPar(10, 32)).toBe(true);
    expect(underPar(32, 32)).toBe(true);
    expect(underPar(32.1, 32)).toBe(false);
    expect(underPar(10, undefined)).toBe(false);
  });

  it('builds the phone line "★★☆ 1,240 pts"', () => {
    expect(resultLine(2, 1240)).toBe('★★☆ 1,240 pts');
    expect(resultLine(undefined, 1240)).toBe('');
  });
});

describe('level records', () => {
  it('records a first clear quietly: it is the best, but not a new best', () => {
    const st = memory();
    const r = recordLevel(st, level());
    expect(r).toEqual({ best: { score: 1240, time: 41 }, newScore: false, newTime: false });
    expect(JSON.parse(st.data[RECORDS_KEY]).levels['1']).toEqual({ score: 1240, time: 41 });
  });

  it('flags a better score and keeps the old best time when the clear was slower', () => {
    const st = memory();
    recordLevel(st, level({ score: 1000, time: 30 }));
    const r = recordLevel(st, level({ score: 1500, time: 45 }));
    expect(r).toEqual({ best: { score: 1500, time: 30 }, newScore: true, newTime: false });
  });

  it('flags a faster time even when the score is lower', () => {
    const st = memory();
    recordLevel(st, level({ score: 1500, time: 45 }));
    const r = recordLevel(st, level({ score: 900, time: 28 }));
    expect(r).toEqual({ best: { score: 1500, time: 28 }, newScore: false, newTime: true });
  });

  it('does not flag an equal or worse run, and keeps the records', () => {
    const st = memory();
    recordLevel(st, level({ score: 1500, time: 30 }));
    const r = recordLevel(st, level({ score: 1500, time: 30 }));
    expect(r).toEqual({ best: { score: 1500, time: 30 }, newScore: false, newTime: false });
    expect(recordLevel(st, level({ score: 100, time: 99 })).best).toEqual({ score: 1500, time: 30 });
  });

  it('keeps each level separate', () => {
    const st = memory();
    recordLevel(st, level({ level: 1, score: 1500 }));
    const r = recordLevel(st, level({ level: 2, score: 400, time: 50 }));
    expect(r.newScore).toBe(false);
    expect(loadRecords(st).levels['1'].score).toBe(1500);
    expect(loadRecords(st).levels['2'].score).toBe(400);
  });

  it('survives missing, broken and throwing storage', () => {
    expect(recordLevel(null, level()).best.score).toBe(1240);
    expect(recordLevel(memory({ [RECORDS_KEY]: '{not json' }), level()).best.score).toBe(1240);
    const angry = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('full');
      },
    };
    expect(recordLevel(angry, level()).best.score).toBe(1240);
    expect(recordRun(angry, { kind: 'run', level: 3, runScore: 900 })).toEqual({ best: 900, isNew: false });
  });
});

describe('run records', () => {
  it('keeps the best run score and flags a beaten one', () => {
    const st = memory();
    expect(recordRun(st, { kind: 'run', level: 2, runScore: 2000 })).toEqual({ best: 2000, isNew: false });
    expect(recordRun(st, { kind: 'run', level: 3, runScore: 1500 })).toEqual({ best: 2000, isNew: false });
    expect(recordRun(st, { kind: 'run', level: 4, runScore: 3100 })).toEqual({ best: 3100, isNew: true });
    expect(loadRecords(st).run).toBe(3100);
  });

  it('keeps the level records when a run is recorded', () => {
    const st = memory();
    recordLevel(st, level());
    recordRun(st, { kind: 'run', level: 1, runScore: 5 });
    expect(loadRecords(st).levels['1'].score).toBe(1240);
  });
});

describe('result view', () => {
  it('lays out a level result for the panel', () => {
    const v = resultView(level({ level: 2, score: 1240, runScore: 3400, time: 41.6 }), {
      best: { score: 1500, time: 38 },
      newScore: false,
      newTime: false,
    });
    expect(v).toMatchObject({
      kind: 'level',
      title: 'LEVEL 2 COMPLETE',
      stars: 2,
      time: '0:41',
      par: 'PAR 0:32',
      falls: '2',
      score: '1,240',
      runScore: '3,400',
      bestScore: '1,500',
      bestTime: '0:38',
      bestLine: 'Best score 1,500 \u00b7 Best time 0:38',
      isNew: false,
      newLabel: '',
      next: 'Press START for Level 3',
    });
  });

  it('says which record was beaten: score, time or both', () => {
    const view = (newScore, newTime) => resultView(level(), { best: { score: 1240, time: 41 }, newScore, newTime });
    expect(view(true, false)).toMatchObject({ isNew: true, newScore: true, newTime: false, newLabel: 'NEW BEST SCORE!' });
    expect(view(false, true)).toMatchObject({ isNew: true, newScore: false, newTime: true, newLabel: 'NEW BEST TIME!' });
    expect(view(true, true)).toMatchObject({ isNew: true, newLabel: 'NEW BEST SCORE & TIME!' });
    expect(view(false, false)).toMatchObject({ isNew: false, newLabel: '' });
    expect(resultView(level(), null).newLabel).toBe('');
  });

  it('labels the best line, even when the best score and best time are from different runs', () => {
    const st = memory();
    recordLevel(st, level({ score: 1500, time: 45 })); // best score
    const r = recordLevel(st, level({ score: 900, time: 29 })); // best time, from another run
    const v = resultView(level({ score: 900, time: 29 }), r);
    expect(v.newLabel).toBe('NEW BEST TIME!');
    expect(v.bestLine).toBe('Best score 1,500 \u00b7 Best time 0:29');
  });

  it('builds the badge and the best line from their parts', () => {
    expect(newBestLabel(true, true)).toBe('NEW BEST SCORE & TIME!');
    expect(newBestLabel(false, false)).toBe('');
    expect(bestLine('1,500', '0:29')).toBe('Best score 1,500 \u00b7 Best time 0:29');
    expect(bestLine('1,500', '')).toBe('Best score 1,500'); // no time record
  });

  it('lays out a run summary', () => {
    const v = resultView({ kind: 'run', level: 3, runScore: 3400 }, { best: 5120, isNew: false });
    expect(v).toMatchObject({
      kind: 'run',
      title: 'GAME OVER',
      level: 'Reached level 3',
      runScore: '3,400',
      bestRun: '5,120',
      isNew: false,
      next: 'Press START to try again',
    });
    expect(resultView({ kind: 'run', level: 3, runScore: 6000 }, { best: 6000, isNew: true }).isNew).toBe(true);
  });

  it('is null without a result, and copes with a result missing fields', () => {
    expect(resultView(null, null)).toBe(null);
    const v = resultView({ kind: 'level', level: 1 }, null);
    expect(v.stars).toBe(0);
    expect(v.time).toBe('0:00');
    expect(v.par).toBe('');
  });
});

describe('sameResult', () => {
  it('compares by value, so a fresh object each frame does not reopen the panel', () => {
    expect(sameResult(level(), level())).toBe(true);
    expect(sameResult(level(), level({ score: 1 }))).toBe(false);
    expect(sameResult(null, null)).toBe(true);
    expect(sameResult(level(), null)).toBe(false);
  });
});
