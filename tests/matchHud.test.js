import { describe, it, expect } from 'vitest';
import { createMatch } from '../src/game/match.js';
import { PLAYER_COLORS } from '../src/shared/players.js';
import { raceHudView, windmasterHudView, lobbyView, pairingPanelVisible, raceRoundLine, rolesText, GUST_RING_S, MODE_LABELS, PICK_MODE_HINT } from '../src/tv/matchHud.js';
import { matchResultView } from '../src/tv/matchResults.js';
import { keepMovingOf, KEEP_MOVING_AFTER_S } from '../src/tv/keepMoving.js';
import { matchToBridge } from './helpers/onBridge.js';

const DT = 1 / 60;

describe('race HUD view-model', () => {
  it('a panel per racer in his colour, with metres, time and falls, and the round line', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    for (let i = 0; i < 60 * 65.2; i++) m.update(DT); // 1:05 on the round clock
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 23.7 };
    m.sessions[1].levelFalls = 1;
    m.sessions[2].walker = { ...m.sessions[2].walker, z: 5 };
    const v = raceHudView(m);
    expect(v.players[1]).toMatchObject({ name: 'P1', color: PLAYER_COLORS[1], dist: '23 / 60 m', falls: '1 fall', time: '01:05' });
    expect(v.players[2]).toMatchObject({ name: 'P2', color: PLAYER_COLORS[2], dist: '5 / 60 m', falls: '0 falls', time: '01:05' });
    expect(v.players[1].progress).toBeCloseTo(23.7 / 60);
    expect(v.roundLine).toBe('Round 1 · P1 0 – 0 P2');
  });

  it('both panels show the one round clock, even when a lane is still on the ledge', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    matchToBridge(m);
    m.sessions[2].walker = { ...m.sessions[2].walker, z: -2.5 };
    for (let i = 0; i < 60 * 3 + 1; i++) m.update(DT);
    expect(m.sessions[2].time).toBe(0); // his lane clock has not started...
    const v = raceHudView(m);
    expect(v.players[1].time).toBe('00:03'); // ...but the panels read the round's
    expect(v.players[2].time).toBe('00:03');
  });

  it('shows the round number and the tally as the match goes on', () => {
    expect(raceRoundLine(2, { 1: 1, 2: 0 })).toBe('Round 2 · P1 1 – 0 P2');
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 59.99, speed: 2 };
    m.input(1, { t: 'walk', on: true });
    for (let i = 0; i < 30 && m.phase === 'playing'; i++) m.update(DT);
    m.start();
    expect(raceHudView(m).roundLine).toBe('Round 2 · P1 1 – 0 P2');
  });

  it('clamps the progress and the metres to the bridge', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 75 };
    m.sessions[2].walker = { ...m.sessions[2].walker, z: -3 };
    const v = raceHudView(m);
    expect(v.players[1]).toMatchObject({ dist: '60 / 60 m', progress: 1 });
    expect(v.players[2]).toMatchObject({ dist: '0 / 60 m', progress: 0 });
  });
});

describe('Wind Master HUD view-model', () => {
  const tick = (m, n) => { for (let i = 0; i < n; i++) m.update(DT); };

  it('says who walks and who blows, in their colours', () => {
    const m = createMatch({ mode: 'windmaster', seed: 9 });
    m.start();
    const v = windmasterHudView(m, 4);
    expect(v.roles).toBe('P1 walking · P2 Wind Master');
    expect(rolesText(2, 1)).toBe('P2 walking · P1 Wind Master');
    expect(v).toMatchObject({ walker: 1, windMaster: 2, walkerColor: PLAYER_COLORS[1], masterColor: PLAYER_COLORS[2] });
    expect(v.roundLine).toBe('Round 1 of 4 · P1 0 – 0 P2');
  });

  it('the gust bar is full when ready, empty right after a gust, and fills through the cooldown', () => {
    const m = createMatch({ mode: 'windmaster', seed: 9 });
    m.start();
    matchToBridge(m); // the level clock (and the wind's) starts on the bridge, not on the ledge before it
    m.input(1, { t: 'walk', on: true }); // and standing still on it topples him: keep walking
    tick(m, 10);
    expect(windmasterHudView(m)).toMatchObject({ gustReady: true, gustFill: 1, gustLabel: 'GUST READY' });
    m.input(2, { t: 'gust', dir: 1 });
    const empty = windmasterHudView(m);
    expect(empty).toMatchObject({ gustReady: false, gustLabel: 'WAIT…' });
    expect(empty.gustFill).toBeCloseTo(0, 1);
    tick(m, 60);
    const half = windmasterHudView(m).gustFill;
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.5);
    tick(m, 60 * 3);
    expect(windmasterHudView(m)).toMatchObject({ gustReady: true, gustFill: 1 });
    expect(GUST_RING_S).toBeCloseTo(3.3);
  });

  it('swaps the roles after a round', () => {
    const m = createMatch({ mode: 'windmaster', seed: 9 });
    m.start();
    m.sessions[1].walker = { ...m.sessions[1].walker, z: 59.99, speed: 2 };
    m.input(1, { t: 'walk', on: true });
    for (let i = 0; i < 30 && m.phase === 'playing'; i++) m.update(DT);
    expect(m.phase).toBe('roundOver');
    expect(windmasterHudView(m).roles).toBe('P2 walking · P1 Wind Master');
  });
});

describe('lobby and pairing panel', () => {
  it('shows the slots, the mode and the hint', () => {
    const v = lobbyView(createMatch({ mode: 'solo' }), { 1: true, 2: false });
    expect(v.slots.map((s) => s.text)).toEqual(['P1 ● connected', 'P2 ○ waiting…']);
    expect(v.slots.map((s) => s.color)).toEqual([PLAYER_COLORS[1], PLAYER_COLORS[2]]);
    expect(v.modeLabel).toBe('Solo');
    expect(v.hint).toBe('Pick a mode on your phone, then press START');
    expect(v.hint).toBe(PICK_MODE_HINT);
    expect(v.warning).toBe('');
  });

  it('names the mode and says who is missing when two phones are needed', () => {
    const race = createMatch({ mode: 'race', leash: false, countdown: 0 });
    expect(lobbyView(race, { 1: true, 2: false })).toMatchObject({ modeLabel: 'Race', warning: 'Race needs two phones: waiting for P2' });
    expect(lobbyView(race, { 1: false, 2: true }).warning).toContain('waiting for P1');
    expect(lobbyView(race, { 1: false, 2: false }).warning).toContain('both players');
    expect(lobbyView(race, { 1: true, 2: true }).warning).toBe('');
    expect(lobbyView(createMatch({ mode: 'windmaster' }), { 1: true, 2: true }).modeLabel).toBe(MODE_LABELS.windmaster);
  });

  it('is visible in the lobby and while a phone is missing, hidden once a round runs', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0 });
    expect(pairingPanelVisible(m, { ready: true, hasRoom: true })).toBe(true); // lobby
    m.start();
    expect(pairingPanelVisible(m, { ready: true, hasRoom: true })).toBe(false);
    expect(pairingPanelVisible(m, { ready: false, hasRoom: true })).toBe(true); // a phone dropped: say so
    expect(pairingPanelVisible(m, { ready: true, hasRoom: false })).toBe(true); // the server is away
  });

  it('a second phone pairing mid-solo does not bring the panel back', () => {
    const m = createMatch({ mode: 'solo' });
    m.start();
    expect(pairingPanelVisible(m, { ready: true, hasRoom: true })).toBe(false);
  });
});

describe('Race results', () => {
  const result = (over) => ({ kind: 'race', round: 2, winner: 1, times: { 1: 31.4, 2: 38 }, falls: { 1: 0, 2: 2 }, finished: { 1: true, 2: false }, tally: { 1: 1, 2: 0 }, matchWinner: 0, ...over });

  it('a round: who won, times, falls, the tally and what to press', () => {
    const v = matchResultView(result());
    expect(v.title).toBe('P1 WINS ROUND 2!');
    expect(v.titleColor).toBe(PLAYER_COLORS[1]);
    expect(v.rows.find((r) => r.label === 'TIME')).toMatchObject({ v1: '0:31', v2: 'DNF', win: 1 });
    expect(v.rows.find((r) => r.label === 'FALLS')).toMatchObject({ v1: '0', v2: '2', win: 1 });
    expect(v.tally).toBe('Round wins  P1 1 – 0 P2');
    expect(v.next).toBe('Press START for the next round');
    expect(v.over).toBe(false);
  });

  it('the match: the winner and the final count, and a new match to start', () => {
    const v = matchResultView(result({ winner: 2, tally: { 1: 1, 2: 3 }, matchWinner: 2, round: 4 }));
    expect(v.title).toBe('P2 WINS THE MATCH 3–1');
    expect(v.titleColor).toBe(PLAYER_COLORS[2]);
    expect(v.next).toBe('Press START for a new match');
    expect(v.over).toBe(true);
    expect(v.tally).toContain('P1 1 – 3 P2');
  });

  it('shows both times when both crossed, the quicker one winning the row', () => {
    const v = matchResultView(result({ finished: { 1: true, 2: true }, times: { 1: 40, 2: 39 }, winner: 2 }));
    expect(v.rows[0]).toMatchObject({ v1: '0:40', v2: '0:39', win: 2 });
  });

  it('works with a result a real match produced', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    m.sessions[2].walker = { ...m.sessions[2].walker, z: 59.99, speed: 2 };
    m.input(2, { t: 'walk', on: true });
    for (let i = 0; i < 30 && m.phase === 'playing'; i++) m.update(DT);
    const v = matchResultView(m.result);
    expect(v.title).toBe('P2 WINS ROUND 1!');
    expect(v.rows[0].v1).toBe('DNF');
  });
});

describe('Wind Master results', () => {
  const round = (over) => ({
    kind: 'windmaster', round: 1, level: 1, walker: 1, windMaster: 2, outcome: 'won', fallsCaused: 2,
    roundScores: { 1: 620, 2: 300 }, scores: { 1: 620, 2: 300 }, matchWinner: 0, ...over,
  });

  it('a round: who walked, the outcome, the falls caused, round and total scores, and the role swap', () => {
    const v = matchResultView(round());
    expect(v.title).toBe('ROUND 1 COMPLETE');
    expect(v.sub).toBe('P1 crossed the bridge!');
    expect(v.tally).toBe('P2 Wind Master: 2 falls caused');
    expect(v.rows[0]).toMatchObject({ label: 'THIS ROUND', v1: '+620', v2: '+300', win: 1 });
    expect(v.rows[1]).toMatchObject({ label: 'TOTAL', v1: '620', v2: '300' });
    expect(v.note).toBe('Roles swap! P2 walks next');
    expect(v.next).toBe('Press START for round 2');
  });

  it('a walker who fell out of the level, and a single fall caused', () => {
    const v = matchResultView(round({ outcome: 'gameover', fallsCaused: 1, roundScores: { 1: 0, 2: 150 }, walker: 2, windMaster: 1 }));
    expect(v.sub).toBe('P2 ran out of lives');
    expect(v.tally).toBe('P1 Wind Master: 1 fall caused');
    expect(v.note).toBe('Roles swap! P1 walks next');
  });

  it('the match: the winner, the final score and a new match', () => {
    const v = matchResultView(round({ round: 4, scores: { 1: 900, 2: 1500 }, matchWinner: 2 }), { final: true });
    expect(v.title).toBe('P2 WINS THE MATCH');
    expect(v.titleColor).toBe(PLAYER_COLORS[2]);
    expect(v.note).toBe('Final score  P1 900 – 1,500 P2');
    expect(v.next).toBe('Press START for a new match');
    expect(v.over).toBe(true);
  });

  it('a drawn match is called a draw', () => {
    const v = matchResultView(round({ round: 4, scores: { 1: 900, 2: 900 }, matchWinner: 0 }), { final: true });
    expect(v.title).toBe('THE MATCH IS A DRAW');
  });

  it('nothing for a missing or a single-player result', () => {
    expect(matchResultView(null)).toBe(null);
    expect(matchResultView({ kind: 'level' })).toBe(null);
  });
});


describe('KEEP MOVING', () => {
  const sess = (o) => ({ phase: 'playing', paused: false, idleTime: 0, ...o });

  it('warns once he has stood still on the bridge a little, and only while playing', () => {
    expect(keepMovingOf(sess({ idleTime: KEEP_MOVING_AFTER_S + 0.01 }))).toBe(true);
    expect(keepMovingOf(sess({ idleTime: KEEP_MOVING_AFTER_S }))).toBe(false);
    expect(keepMovingOf(sess({ idleTime: 3, paused: true }))).toBe(false);
    expect(keepMovingOf(sess({ idleTime: 3, phase: 'falling' }))).toBe(false);
    expect(keepMovingOf(sess({ idleTime: 3, phase: 'won' }))).toBe(false);
    expect(keepMovingOf(sess({ idleTime: undefined }))).toBe(false);
    expect(keepMovingOf(null)).toBe(false);
  });

  it('shows on the racer who stands still, not the other', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    matchToBridge(m);
    m.input(2, { t: 'walk', on: true });
    for (let i = 0; i < 60; i++) m.update(DT); // a second: nobody has stood long enough for the warning's start at 0.6 s...
    const v = raceHudView(m);
    expect(v.players[1].keepMoving).toBe(true); // ...player 1 has stood for a second, player 2 has walked
    expect(v.players[2].keepMoving).toBe(false);
  });

  it('a halted lane (the race loser, frozen where he stands) stops warning', () => {
    expect(keepMovingOf(sess({ idleTime: 3, halted: true }))).toBe(false);
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    matchToBridge(m);
    for (let i = 0; i < 60; i++) m.update(DT); // both stand still for a second: both warned
    expect(raceHudView(m).players[2].keepMoving).toBe(true);
    m.sessions[2].halt(); // the round ended for him
    expect(m.sessions[2].idleTime).toBeGreaterThan(KEEP_MOVING_AFTER_S); // idleTime stays frozen...
    expect(raceHudView(m).players[2].keepMoving).toBe(false); // ...but the warning goes
  });

  it('a racer still on the ledge is not warned, and his metres never go negative', () => {
    const m = createMatch({ mode: 'race', leash: false, countdown: 0, seed: 2 });
    m.start();
    for (let i = 0; i < 120; i++) m.update(DT);
    const v = raceHudView(m);
    expect(v.players[1].keepMoving).toBe(false);
    expect(v.players[1].dist).toBe('0 / 60 m');
    expect(v.players[1].progress).toBe(0);
  });
});
