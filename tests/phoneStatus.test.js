import { describe, it, expect } from 'vitest';
import { statusText, viewOf, startLabel, roundResultText, STATUS } from '../src/phone/status.js';

describe('viewOf', () => {
  it('behaves as solo when the two-player fields are missing', () => {
    expect(viewOf({ phase: 'playing', lives: 3, level: 1 })).toEqual({ mode: 'solo', player: 1, role: 'walker', windMaster: false, gustReady: false, idle: false });
    expect(viewOf({ phase: 'lobby' }, 2)).toMatchObject({ mode: 'solo', player: 2, role: 'walker', idle: true });
  });

  it('ignores junk in the new fields', () => {
    expect(viewOf({ mode: 'coop', you: 7, role: 'windmaster', gustReady: 'yes', phase: 'playing' })).toEqual({
      mode: 'solo', player: 1, role: 'walker', windMaster: false, gustReady: false, idle: false,
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
