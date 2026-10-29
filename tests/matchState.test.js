import { describe, it, expect } from 'vitest';
import { createMatch } from '../src/game/match.js';
import { matchStateFor, roleOf } from '../src/game/matchState.js';
import { encode, decode } from '../src/shared/protocol.js';
import { onBridge, steppedOn } from './helpers/onBridge.js';

const DT = 1 / 60;
// What the TV's own state message carries (src/tv/stateSync.js), written out so this test does not follow that file.
const buildStateMessage = (s) => ({
  t: 'state', phase: s.phase, lives: s.lives, level: s.level, paused: false, wind: 'warning', windDir: -1, windLevel: 3,
  stars: 3, score: 123456, runScore: 123456,
});

describe('matchStateFor', () => {
  it('solo: only mode, you, role and gustReady', () => {
    const m = createMatch({ mode: 'solo' });
    expect(matchStateFor(m, 1)).toEqual({ mode: 'solo', you: 1, role: 'walker', gustReady: false, canChangeMode: true });
  });

  it('canChangeMode tells the phone whether to show its mode picker: lobby yes, mid-round no, in every mode', () => {
    for (const mode of ['solo', 'race', 'windmaster']) {
      const m = createMatch({ mode, seed: 3 });
      expect(matchStateFor(m, 1).canChangeMode).toBe(true);
      expect(matchStateFor(m, 2).canChangeMode).toBe(true);
      m.start();
      expect(matchStateFor(m, 1).canChangeMode).toBe(false);
      expect(matchStateFor(m, 2).canChangeMode).toBe(false);
    }
  });

  it('race: both players are racers, with their own phase and falls', () => {
    const m = createMatch({ mode: 'race', seed: 3 });
    expect(matchStateFor(m, 2)).toMatchObject({ mode: 'race', you: 2, role: 'racer', phase: 'lobby', round: 1, tally: { 1: 0, 2: 0 } });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    const s = m.sessions[2];
    s.walker = { ...s.walker, lean: 1.2 };
    m.update(DT);
    expect(matchStateFor(m, 2)).toMatchObject({ phase: 'falling', falls: 1 });
    expect(matchStateFor(m, 1)).toMatchObject({ phase: 'playing', falls: 0 });
    expect(matchStateFor(m, 1).result).toBeUndefined();
    expect('lives' in matchStateFor(m, 1)).toBe(false);
  });

  it('windmaster: roles, lives and gustReady follow the match, and the result shows between rounds', () => {
    const m = createMatch({ mode: 'windmaster', seed: 3 });
    expect([roleOf(m, 1), roleOf(m, 2)]).toEqual(['walker', 'windmaster']);
    m.start();
    steppedOn(m); // levels start on the safe ledge; these tests begin on the first plank
    expect(matchStateFor(m, 2)).toMatchObject({ role: 'windmaster', gustReady: true, phase: 'playing', lives: 3 });
    expect(matchStateFor(m, 1)).toMatchObject({ role: 'walker', gustReady: true }); // a walker's phone ignores it
    m.input(2, { t: 'gust', dir: 1 });
    expect(matchStateFor(m, 2).gustReady).toBe(false);
    for (let i = 0; i < 3; i++) {
      m.sessions[1].walker = { ...m.sessions[1].walker, lean: 1.2 };
      m.update(DT);
      for (let k = 0; k < 160; k++) m.update(DT);
    }
    const msg = matchStateFor(m, 1);
    expect(msg).toMatchObject({ phase: 'roundOver', role: 'windmaster', result: { kind: 'windmaster', walker: 1, windMaster: 2 } });
  });

  it('merged with the TV state it round-trips the protocol and stays under the relay size limit (1024 bytes)', () => {
    const m = createMatch({ mode: 'windmaster', seed: 3 });
    m.start();
    onBridge(m); // levels start on the safe ledge; these tests begin on the first plank
    m.sessions[1].result = { kind: 'level', level: 12, time: 123.456789, falls: 12, stars: 3, score: 123456, parTime: 38, runScore: 123456 };
    const base = buildStateMessage(m.sessions[1]);
    const big = { ...base, ...matchStateFor(m, 1), result: { ...matchStateFor(m, 1).result, kind: 'windmaster', round: 4, level: 12, walker: 1, windMaster: 2, outcome: 'won', walkerResult: m.sessions[1].result, fallsCaused: 12, roundScores: { 1: 123456, 2: 1800 }, scores: { 1: 123456, 2: 1800 }, matchWinner: 1 }, to: 1 };
    const raw = encode(big);
    expect(raw.length).toBeLessThan(1024);
    expect(decode(raw)).toEqual(big);
    const race = createMatch({ mode: 'race', winsToWin: 99 });
    race.start();
    onBridge(race); // levels start on the safe ledge; these tests begin on the first plank
    race.sessions[1].walker = { ...race.sessions[1].walker, z: 59.99 };
    race.sessions[1].gaps = [];
    race.input(1, { t: 'walk', on: true });
    race.update(DT);
    expect(encode({ ...buildStateMessage(race.sessions[1]), ...matchStateFor(race, 1), to: 1 }).length).toBeLessThan(1024);
  });
});
