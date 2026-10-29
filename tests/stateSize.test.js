// The relay closes a socket that sends a message over its maxPayload (server/relayPlugin.js), and the TV sends the state
// messages. So the worst message the TV can build in each mode, with the biggest numbers, must stay well under the limit.
import { describe, it, expect } from 'vitest';
import { createMatch } from '../src/game/match.js';
import { stateMessageFor } from '../src/tv/stateSync.js';
import { encode, decode, MAX_MESSAGE_BYTES } from '../src/shared/protocol.js';

const BUDGET = 700; // bytes; the relay's limit is MAX_MESSAGE_BYTES
const bytes = (msg) => new TextEncoder().encode(encode(msg)).length;
const DT = 1 / 60;

// A float with every digit a division can produce: what the clocks really hold.
const LONG = 123.45678901234567;

// A match of `mode` at the end of a match, with every number as big and as long as the game could make it.
function worstCase(mode) {
  const real = createMatch({ mode, seed: 5, winsToWin: 99, rounds: 99 });
  real.start();
  const s = real.sessions[1];
  s.level = 99;
  s.lives = 3;
  s.paused = true;
  s.idleTime = 9;
  s.forecast = { state: 'gust', dir: -1, strength: 1, eta: LONG, remaining: LONG };
  const levelResult = { kind: 'level', level: 99, time: LONG, falls: 999, stars: 3, score: 9999999, parTime: LONG, runScore: 99999999 };
  s.result = levelResult;
  const big = { 1: 99999999, 2: 99999999 };
  const wins = { 1: 99, 2: 99 };
  let result = null;
  if (mode === 'race') {
    for (const p of [1, 2]) real.sessions[p].result = { ...levelResult };
    result = {
      kind: 'race', round: 99, level: 99, winner: 2, times: { 1: LONG, 2: LONG }, falls: { 1: 999, 2: 999 }, finished: { 1: true, 2: true },
      stars: 3, score: 9999999, tally: { ...wins }, scores: { ...big }, matchWinner: 2,
    };
  } else if (mode === 'windmaster') {
    result = {
      kind: 'windmaster', round: 99, level: 99, walker: 2, windMaster: 1, outcome: 'gameover', walkerResult: { ...levelResult },
      fallsCaused: 999, roundScores: { ...big }, scores: { ...big }, matchWinner: 2,
    };
  }
  // The same match, but with the numbers a long game would reach (the real getters only return what a test could play).
  return Object.create(real, {
    phase: { value: mode === 'solo' ? 'won' : 'matchOver' },
    level: { value: 99 },
    round: { value: 99 },
    scores: { value: { ...big } },
    tally: { value: { ...wins } },
    result: { value: result },
  });
}

describe('the state message stays small', () => {
  it('has a limit of 1024 bytes on the relay', () => {
    expect(MAX_MESSAGE_BYTES).toBe(1024);
  });

  for (const mode of ['solo', 'race', 'windmaster']) {
    it(`${mode}: the worst end-of-round message, for either phone, is under ${BUDGET} bytes`, () => {
      const match = worstCase(mode);
      for (const p of [1, 2]) {
        const msg = stateMessageFor(match, p);
        expect(bytes(msg)).toBeLessThan(BUDGET);
        expect(bytes(msg)).toBeLessThan(MAX_MESSAGE_BYTES);
        expect(decode(encode(msg))).toEqual(msg); // and it still passes the relay's own decoder
      }
    });
  }

  it('the worst message of play (a gust blowing, keep moving, paused) is small too', () => {
    for (const mode of ['solo', 'race', 'windmaster']) {
      const match = Object.create(worstCase(mode), { phase: { value: 'playing' }, result: { value: null } });
      match.sessions[1].result = null;
      match.sessions[2] && (match.sessions[2].result = null);
      for (const p of [1, 2]) expect(bytes(stateMessageFor(match, p))).toBeLessThan(BUDGET / 2);
    }
  });

  it('times in a state message are rounded to 2 decimals', () => {
    const match = worstCase('race');
    const { result } = stateMessageFor(match, 1);
    expect(result.times).toEqual({ 1: 123.46, 2: 123.46 });
    const encoded = encode(stateMessageFor(match, 1));
    expect(encoded).not.toMatch(/\d\.\d{3,}/); // no number anywhere carries more than 2 decimals
    for (const mode of ['solo', 'windmaster']) expect(encode(stateMessageFor(worstCase(mode), 1))).not.toMatch(/\d\.\d{3,}/);
  });

  it('keeps what the phone reads, and drops the rest of the result', () => {
    const race = stateMessageFor(worstCase('race'), 2).result;
    expect(race).toMatchObject({ kind: 'race', winner: 2, matchWinner: 2, tally: { 1: 99, 2: 99 } });
    expect(race.scores).toEqual({ 1: 99999999, 2: 99999999 });
    const wm = stateMessageFor(worstCase('windmaster'), 1).result;
    expect(wm).toMatchObject({ kind: 'windmaster', windMaster: 1, outcome: 'gameover', fallsCaused: 999, matchWinner: 2 });
    expect(wm.roundScores).toEqual({ 1: 99999999, 2: 99999999 });
    expect(wm.walkerResult).toBeUndefined();
  });

  it('a real race round trips: the phone still reads the round result', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2, winsToWin: 1 });
    m.start();
    const s = m.sessions[1];
    s.walker = { ...s.walker, z: 59.99 };
    s.gaps = [];
    m.input(1, { t: 'walk', on: true });
    m.update(DT);
    const msg = stateMessageFor(m, 1);
    expect(msg).toMatchObject({ phase: 'matchOver', result: { kind: 'race', winner: 1, matchWinner: 1 } });
    expect(bytes(msg)).toBeLessThan(BUDGET);
  });
});
