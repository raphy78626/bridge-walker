import { describe, it, expect } from 'vitest';
import { statusText, viewOf, startLabel, roundResultText, keepMovingFor, createKeepMovingBuzz, KEEP_MOVING_TEXT, STATUS } from '../src/phone/status.js';

describe('viewOf', () => {
  it('behaves as solo when the two-player fields are missing', () => {
    expect(viewOf({ phase: 'playing', lives: 3, level: 1 })).toEqual({ mode: 'solo', player: 1, role: 'walker', windMaster: false, gustReady: false, idle: false, canChangeMode: false, spectator: false });
    expect(viewOf({ phase: 'lobby' }, 2)).toMatchObject({ mode: 'solo', player: 2, role: 'walker', idle: true });
  });

  it('ignores junk in the new fields', () => {
    expect(viewOf({ mode: 'coop', you: 7, role: 'windmaster', gustReady: 'yes', phase: 'playing' })).toEqual({
      mode: 'solo', player: 1, role: 'walker', windMaster: false, gustReady: false, idle: false, canChangeMode: false, spectator: false,
    });
  });

  it('a Wind Master only in windmaster mode', () => {
    expect(viewOf({ mode: 'windmaster', role: 'windmaster', you: 2, gustReady: true, phase: 'playing' })).toMatchObject({ windMaster: true, player: 2, gustReady: true });
    expect(viewOf({ mode: 'windmaster', role: 'walker', phase: 'playing' }).windMaster).toBe(false);
    expect(viewOf({ mode: 'windmaster', phase: 'playing' }).windMaster).toBe(false); // role missing: behaves as solo
    expect(viewOf({ mode: 'race', role: 'windmaster', phase: 'playing' })).toMatchObject({ windMaster: false, role: 'racer' });
  });

  it('is idle (Start and the mode picker show) except while playing or falling', () => {
    for (const phase of ['lobby', 'won', 'gameover', 'roundOver', 'matchOver']) expect(viewOf({ phase }).idle).toBe(true);
    for (const phase of ['playing', 'falling']) expect(viewOf({ phase }).idle).toBe(false);
  });
});

describe('the mode picker follows canChangeMode', () => {
  it('shows only when the TV says a change is allowed', () => {
    expect(viewOf({ phase: 'lobby', canChangeMode: true }).canChangeMode).toBe(true);
    expect(viewOf({ mode: 'race', phase: 'roundOver', canChangeMode: false }).canChangeMode).toBe(false); // idle, but no picker
    expect(viewOf({ mode: 'race', phase: 'roundOver', canChangeMode: false }).idle).toBe(true);
    expect(viewOf({ mode: 'race', phase: 'matchOver', canChangeMode: true }).canChangeMode).toBe(true);
    expect(viewOf({ phase: 'playing', canChangeMode: true }).canChangeMode).toBe(true); // the flag is the TV's word, not guessed
  });
  it('a TV that does not send it (an older one) gets the old behaviour: the picker shows when idle', () => {
    expect(viewOf({ phase: 'lobby' }).canChangeMode).toBe(true);
    expect(viewOf({ phase: 'playing' }).canChangeMode).toBe(false);
    expect(viewOf({ phase: 'roundOver', canChangeMode: 'yes' }).canChangeMode).toBe(true);
  });
});

describe('the second phone in a solo game only watches', () => {
  const watching = (o) => ({ mode: 'solo', phase: 'playing', lives: 3, level: 1, spectator: true, you: 2, ...o });

  it('says "Solo game in progress" while the game runs (playing, falling, paused)', () => {
    expect(statusText(watching())).toBe('Solo game in progress');
    expect(statusText(watching({ phase: 'falling' }))).toBe('Solo game in progress');
    expect(statusText(watching({ paused: true }))).toBe('Solo game in progress');
    expect(statusText(watching({ keepMoving: true }))).toBe('Solo game in progress'); // the other phone's walker, not its own
  });

  it('between games it waits for the other phone, since its own Start would do nothing', () => {
    for (const phase of ['lobby', 'won', 'gameover']) expect(statusText(watching({ phase }))).toBe('Waiting for the other phone to start');
  });

  it('the view marks it a spectator, which hides Start and Pause; the mode picker follows canChangeMode', () => {
    expect(viewOf(watching())).toMatchObject({ spectator: true, mode: 'solo', player: 2 });
    expect(viewOf(watching({ phase: 'lobby', canChangeMode: true }))).toMatchObject({ spectator: true, canChangeMode: true, idle: true });
    expect(viewOf({ mode: 'solo', phase: 'playing', you: 1 }).spectator).toBe(false);
    expect(viewOf({ mode: 'race', phase: 'playing', spectator: true }).spectator).toBe(false); // only a solo notion
    expect(viewOf({ mode: 'solo', phase: 'playing', spectator: 'yes' }).spectator).toBe(false);
  });

  it('keepMovingFor is false for it, so it never buzzes for a walker it does not steer', () => {
    expect(keepMovingFor(watching({ keepMoving: true }))).toBe(false);
  });

  it('the phone that steers sees the usual line', () => {
    expect(statusText({ mode: 'solo', phase: 'playing', lives: 3, level: 1, you: 1 })).toBe(`${STATUS.playing} · ❤ 3 · Level 1`);
  });
});

describe('startLabel', () => {
  it('names what Start does', () => {
    expect(startLabel({ phase: 'lobby' })).toBe('Start');
    expect(startLabel({ phase: 'won' })).toBe('Start');
    expect(startLabel({ phase: 'roundOver' })).toBe('Next round');
    expect(startLabel({ phase: 'matchOver' })).toBe('New match');
  });
});

describe('statusText, two players', () => {
  it('is untouched for solo', () => {
    expect(statusText({ phase: 'playing', lives: 3, level: 2 })).toBe(`${STATUS.playing} · ❤ 3 · Level 2`);
    expect(statusText({ mode: 'solo', you: 1, role: 'walker', gustReady: false, phase: 'won', lives: 2, level: 1, stars: 3, score: 900 })).toBe('★★★ 900 pts · ❤ 2 · Level 1');
  });

  it('race: own falls instead of lives', () => {
    expect(statusText({ mode: 'race', you: 2, role: 'racer', phase: 'playing', falls: 2, level: 3 })).toBe('Race! Get to the end first · Falls 2 · Level 3');
    expect(statusText({ mode: 'race', you: 2, role: 'racer', phase: 'falling', falls: 3, level: 3 })).toBe('You fell! · Falls 3 · Level 3');
  });

  it('windmaster: the walker sees lives, the Wind Master sees the wind they made', () => {
    expect(statusText({ mode: 'windmaster', you: 1, role: 'walker', phase: 'playing', lives: 2, level: 4 })).toBe('Balance! Jump the gaps · ❤ 2 · Level 4');
    expect(statusText({ mode: 'windmaster', you: 2, role: 'windmaster', phase: 'playing', level: 4, wind: 'warning' })).toBe('You are the Wind Master — blow them off! · gust coming');
    expect(statusText({ mode: 'windmaster', you: 2, role: 'windmaster', phase: 'falling', level: 4 })).toBe('They fell! · Level 4');
  });

  it('shows the round result for each player', () => {
    const race = { kind: 'race', winner: 2, tally: { 1: 1, 2: 2 }, matchWinner: 0 };
    expect(statusText({ mode: 'race', you: 2, role: 'racer', phase: 'roundOver', result: race })).toBe('You won the round! · Wins 2–1');
    expect(statusText({ mode: 'race', you: 1, role: 'racer', phase: 'roundOver', result: race })).toBe('P2 won the round · Wins 1–2');
    expect(roundResultText({ mode: 'race', you: 1, phase: 'matchOver', result: { ...race, matchWinner: 2 } })).toBe('P2 won the match · Wins 1–2');
    const wm = { kind: 'windmaster', walker: 1, windMaster: 2, outcome: 'won', fallsCaused: 1, roundScores: { 1: 1240, 2: 150 }, scores: { 1: 1240, 2: 150 }, matchWinner: 0 };
    expect(statusText({ mode: 'windmaster', you: 1, role: 'windmaster', phase: 'roundOver', result: wm })).toBe('You made it! · +1,240 pts · Total 1,240');
    expect(statusText({ mode: 'windmaster', you: 2, role: 'walker', phase: 'roundOver', result: wm })).toBe('1 fall caused · +150 pts · Total 150');
  });

  it('windmaster match end: the winner and the total only', () => {
    const r = { kind: 'windmaster', walker: 2, windMaster: 1, outcome: 'gameover', fallsCaused: 3, roundScores: { 1: 450, 2: 0 }, scores: { 1: 1450, 2: 1240 }, matchWinner: 1 };
    expect(statusText({ mode: 'windmaster', you: 1, phase: 'matchOver', result: r })).toBe('You won the match! · Total 1,450');
    expect(statusText({ mode: 'windmaster', you: 2, phase: 'matchOver', result: r })).toBe('P1 won the match · Total 1,240');
    expect(statusText({ mode: 'windmaster', you: 2, phase: 'matchOver', result: { ...r, matchWinner: 0 } })).toBe('Match drawn · Total 1,240');
  });

  it('falls back to a plain line when a result is missing', () => {
    expect(statusText({ mode: 'race', you: 1, phase: 'roundOver' })).toBe('Round over — press Next round');
    expect(statusText({ mode: 'windmaster', you: 1, phase: 'matchOver', result: { kind: 'bogus' } })).toBe('Match over — press New match');
    expect(statusText({ mode: 'race', you: 1, phase: 'lobby' })).toContain('Race');
  });
});

describe('KEEP MOVING on the phone', () => {
  const solo = (o) => ({ phase: 'playing', lives: 3, level: 2, keepMoving: true, ...o });

  it('keepMovingFor: only for a walker who is playing, not paused, and the TV says so', () => {
    expect(keepMovingFor(solo())).toBe(true);
    expect(keepMovingFor(solo({ keepMoving: false }))).toBe(false);
    expect(keepMovingFor({ phase: 'playing' })).toBe(false); // an older TV sends nothing
    expect(keepMovingFor(solo({ paused: true }))).toBe(false);
    for (const phase of ['lobby', 'falling', 'won', 'gameover', 'roundOver', 'matchOver']) expect(keepMovingFor(solo({ phase }))).toBe(false);
    expect(keepMovingFor(solo({ keepMoving: 'yes' }))).toBe(false); // only a real true
  });

  it('keepMovingFor: a racer is warned, a Wind Master (who has no soldier) is not', () => {
    expect(keepMovingFor(solo({ mode: 'race', role: 'racer', you: 2 }))).toBe(true);
    expect(keepMovingFor(solo({ mode: 'windmaster', role: 'walker', you: 1 }))).toBe(true);
    expect(keepMovingFor(solo({ mode: 'windmaster', role: 'windmaster', you: 2 }))).toBe(false);
  });

  it('the status line says KEEP MOVING! in every mode, in place of the usual instruction', () => {
    expect(statusText(solo())).toBe(`${KEEP_MOVING_TEXT} · ❤ 3 · Level 2`);
    expect(KEEP_MOVING_TEXT).toBe('KEEP MOVING!');
    expect(statusText(solo({ mode: 'race', role: 'racer', you: 1, falls: 2 }))).toBe(`${KEEP_MOVING_TEXT} · Falls 2 · Level 2`);
    expect(statusText(solo({ mode: 'windmaster', role: 'walker', you: 1 }))).toBe(`${KEEP_MOVING_TEXT} · ❤ 3 · Level 2`);
  });

  it('the status line goes back to normal when he moves, and is untouched for a Wind Master, paused, or not playing', () => {
    expect(statusText(solo({ keepMoving: false }))).toBe(`${STATUS.playing} · ❤ 3 · Level 2`);
    expect(statusText(solo({ mode: 'windmaster', role: 'windmaster', you: 2 }))).toMatch(/^You are the Wind Master/);
    expect(statusText(solo({ paused: true }))).toMatch(/^Paused/);
    expect(statusText(solo({ phase: 'falling' }))).toMatch(/^You fell!/);
  });

  it('the buzz fires once per onset, not on every state message while he stands still', () => {
    const buzz = createKeepMovingBuzz();
    const seq = [false, false, true, true, true, false, true, true];
    expect(seq.map((on) => buzz.update(on))).toEqual([false, false, true, false, false, false, true, false]);
    buzz.reset();
    expect(buzz.update(true)).toBe(true);
  });
});
