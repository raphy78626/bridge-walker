import { describe, it, expect } from 'vitest';
import { createMatch } from '../src/game/match.js';
import { controlledPlayer, soloController, startAllowed, routeInput, gatesWanted, matchReady, modeSwitch, createPlayerGates, flowPhase } from '../src/tv/matchLink.js';
import { TILT_TIMEOUT_MS } from '../src/tv/link.js';

describe('solo phone routing: one phone steers the one walker', () => {
  const both = { 1: true, 2: true };
  it('the phone in slot 1 steers player 1 when it is connected, and the slot-2 phone steers nothing', () => {
    expect(controlledPlayer('solo', 1, both)).toBe(1);
    expect(controlledPlayer('solo', 2, both)).toBe(0);
    expect(controlledPlayer('solo', 1, { 1: true, 2: false })).toBe(1);
  });
  it('the slot-2 phone steers only when slot 1 is empty (the reconnect case)', () => {
    expect(controlledPlayer('solo', 2, { 1: false, 2: true })).toBe(1);
    expect(soloController({ 1: false, 2: true })).toBe(2);
    expect(soloController(both)).toBe(1);
    expect(soloController({ 1: false, 2: false })).toBe(0);
  });
  it('a lone phone steers, whichever slot it is in, when the roster is not given', () => {
    expect(controlledPlayer('solo', 1)).toBe(1);
    expect(controlledPlayer('solo', 2)).toBe(1);
  });
  it('the two-player modes go by slot', () => {
    for (const mode of ['race', 'windmaster']) {
      expect(controlledPlayer(mode, 1, both)).toBe(1);
      expect(controlledPlayer(mode, 2, both)).toBe(2);
    }
  });
  it('only the controlling phone may start a solo game; in a match either phone may', () => {
    expect(startAllowed('solo', 1, both)).toBe(true);
    expect(startAllowed('solo', 2, both)).toBe(false);
    expect(startAllowed('solo', 2, { 1: false, 2: true })).toBe(true);
    expect(startAllowed('race', 2, both)).toBe(true);
    expect(startAllowed('windmaster', 1, both)).toBe(true);
  });
  it('a single phone in slot 2 still opens the solo gate (a reconnect while the old socket lingers)', () => {
    expect(gatesWanted('solo', { 1: false, 2: true })).toEqual({ 1: true, 2: false });
    expect(gatesWanted('solo', { 1: true, 2: false })).toEqual({ 1: true, 2: false });
    expect(gatesWanted('solo', { 1: true, 2: true })).toEqual({ 1: true, 2: false });
    expect(gatesWanted('solo', { 1: false, 2: false })).toEqual({ 1: false, 2: false });
    expect(matchReady('solo', { 1: false, 2: true })).toBe(true);
  });
  it('race and windmaster open each gate for its own phone and need both to run', () => {
    expect(gatesWanted('race', { 1: true, 2: false })).toEqual({ 1: true, 2: false });
    expect(matchReady('race', { 1: true, 2: false })).toBe(false);
    expect(matchReady('windmaster', { 1: true, 2: true })).toBe(true);
    expect(matchReady('windmaster', { 1: false, 2: true })).toBe(false);
  });
});

describe('mode switch guard', () => {
  it('switches in the lobby, and when a round or the match is over', () => {
    const solo = createMatch({ mode: 'solo' });
    expect(modeSwitch(solo, { t: 'mode', mode: 'race' })).toBe('race');
    const race = createMatch({ mode: 'race' });
    expect(modeSwitch(race, { t: 'mode', mode: 'windmaster', p: 2 })).toBe('windmaster');
  });
  it('refuses while a round is being played', () => {
    for (const mode of ['solo', 'race', 'windmaster']) {
      const m = createMatch({ mode });
      m.start();
      expect(m.canChangeMode).toBe(false);
      expect(modeSwitch(m, { t: 'mode', mode: mode === 'solo' ? 'race' : 'solo' })).toBe(null);
    }
  });
  it('refuses the mode already running (a new match would throw the old one away) and unknown modes', () => {
    const m = createMatch({ mode: 'race' });
    expect(modeSwitch(m, { t: 'mode', mode: 'race' })).toBe(null);
    expect(modeSwitch(m, { t: 'mode', mode: 'banana' })).toBe(null);
    expect(modeSwitch(m, { t: 'tilt', v: 0 })).toBe(null);
    expect(modeSwitch(m, null)).toBe(null);
  });
});

describe('mode switch guard: the tally and scores are not wiped between rounds', () => {
  // Gets a match to the end of its round: the walker on the last metre, no gap in the way, and a step over the line.
  function finishRound(m, player = 1) {
    const s = m.sessions[m.mode === 'race' ? player : 1];
    s.walker = { ...s.walker, z: 59.99 };
    s.gaps = [];
    m.input(player, { t: 'walk', on: true });
    m.update(1 / 60);
  }
  it('race: lobby and matchOver yes; playing no; roundOver no', () => {
    const m = createMatch({ mode: 'race', leash: false, winsToWin: 2 });
    expect(modeSwitch(m, { t: 'mode', mode: 'solo' })).toBe('solo');
    m.start();
    expect(modeSwitch(m, { t: 'mode', mode: 'solo' })).toBe(null);
    finishRound(m);
    expect(m.phase).toBe('roundOver');
    expect(modeSwitch(m, { t: 'mode', mode: 'windmaster', p: 2 })).toBe(null); // the other phone cannot wipe the tally
    expect(modeSwitch(m, { t: 'mode', mode: 'solo', p: 1 })).toBe(null);
  });
  it('race: at matchOver a switch is allowed', () => {
    const m = createMatch({ mode: 'race', leash: false, winsToWin: 1 });
    m.start();
    finishRound(m);
    expect(m.phase).toBe('matchOver');
    expect(modeSwitch(m, { t: 'mode', mode: 'solo', p: 2 })).toBe('solo');
  });
  it('windmaster: refused at roundOver, allowed in the lobby and at matchOver', () => {
    const m = createMatch({ mode: 'windmaster', rounds: 2 });
    expect(modeSwitch(m, { t: 'mode', mode: 'race' })).toBe('race');
    m.start();
    finishRound(m, 1);
    expect(m.phase).toBe('roundOver');
    expect(modeSwitch(m, { t: 'mode', mode: 'race', p: 2 })).toBe(null);
    m.start();
    finishRound(m, 2); // the roles swapped: player 2 walks
    expect(m.phase).toBe('matchOver');
    expect(modeSwitch(m, { t: 'mode', mode: 'race', p: 2 })).toBe('race');
  });
  it('solo: allowed when not playing (lobby, won, game over), refused while playing or falling', () => {
    const m = createMatch({ mode: 'solo' });
    expect(modeSwitch(m, { t: 'mode', mode: 'race' })).toBe('race');
    m.start();
    expect(modeSwitch(m, { t: 'mode', mode: 'race' })).toBe(null);
    finishRound(m);
    expect(m.phase).toBe('won');
    expect(modeSwitch(m, { t: 'mode', mode: 'race' })).toBe('race');
  });
});

describe('one controller gate per player', () => {
  it('a player whose tilt goes quiet for 500 ms is no longer live, the other still is', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.setMode('race', 0);
    g.pair(1, 0);
    g.pair(2, 0);
    g.tilt(1, 100);
    g.tilt(2, 100);
    expect(g.live(1, 500) && g.live(2, 500)).toBe(true);
    g.tilt(2, 500);
    expect(g.live(1, 700)).toBe(false); // 600 ms since player 1's last tilt
    expect(g.live(2, 700)).toBe(true);
  });
  it('is not live before any tilt after pairing beyond the timeout, and not at all when unpaired', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.setMode('race', 0);
    expect(g.live(1, 0)).toBe(false);
    g.pair(1, 0);
    expect(g.live(1, 400)).toBe(true);
    expect(g.live(1, 600)).toBe(false);
    g.leave(1, 700);
    g.tilt(1, 710);
    expect(g.gates[1].paired).toBe(false);
  });
  it('in solo with two phones, only the slot-1 phone keeps player 1 live: the other one\'s tilt is ignored', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.pair(1, 0);
    g.pair(2, 0);
    expect(g.controller).toBe(1);
    expect(g.spectator(1)).toBe(false);
    expect(g.spectator(2)).toBe(true);
    expect(g.tilt(1, 100)).toBe(1);
    expect(g.tilt(2, 400)).toBe(0); // ignored: no player
    expect(g.live(1, 550)).toBe(true); // 450 ms since phone 1's tilt
    expect(g.tilt(2, 700)).toBe(0);
    expect(g.live(1, 700)).toBe(false); // phone 2 chattering does not keep a silent phone 1 alive
  });

  it('in solo, a tilt from the phone in slot 2 keeps player 1 live (slot 1 is empty)', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.pair(2, 0);
    expect(g.gates[1].paired).toBe(true);
    expect(g.tilt(2, 50)).toBe(1);
    expect(g.live(1, 300)).toBe(true);
    expect(g.ready()).toBe(true);
    g.leave(2, 400);
    expect(g.gates[1].paired).toBe(false);
    expect(g.ready()).toBe(false);
  });
  it('a second phone pairing mid-solo changes nothing: player 1 stays live and paired', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.pair(1, 0);
    g.tilt(1, 10);
    g.pair(2, 20);
    expect(g.gates[1].paired).toBe(true);
    expect(g.gates[2].paired).toBe(false);
    expect(g.live(1, 100)).toBe(true);
    expect(g.count).toBe(2);
  });
  it('switching to race pairs the gates of the phones that are there', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.pair(1, 0);
    g.pair(2, 0);
    g.setMode('race', 1000);
    expect(g.gates[2].paired).toBe(true);
    expect(g.ready()).toBe(true);
    g.setMode('solo', 2000);
    expect(g.gates[2].paired).toBe(false);
    expect(g.gates[1].paired).toBe(true);
  });
  it('control passes to the slot-2 phone when the slot-1 phone leaves, and back when it returns', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.pair(1, 0);
    g.pair(2, 0);
    g.leave(1, 100);
    expect(g.controller).toBe(2);
    expect(g.spectator(2)).toBe(false);
    expect(g.gates[1].paired).toBe(true); // player 1 is still being played, by phone 2
    g.pair(1, 200);
    expect(g.controller).toBe(1);
    expect(g.spectator(2)).toBe(true);
  });

  it('a phone that is not controlling is not a spectator in a race, and nobody is when not connected', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.setMode('race', 0);
    g.pair(1, 0);
    g.pair(2, 0);
    expect(g.controller).toBe(0);
    expect(g.spectator(1) || g.spectator(2)).toBe(false);
    g.setMode('solo', 10);
    expect(g.spectator(2)).toBe(true);
    g.leave(2, 20);
    expect(g.spectator(2)).toBe(false);
  });

  it('leaveAll unpairs everything', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.setMode('race', 0);
    g.pair(1, 0);
    g.pair(2, 0);
    g.leaveAll();
    expect(g.count).toBe(0);
    expect(g.gates[1].paired || g.gates[2].paired).toBe(false);
  });
});

describe('flow phase (the level flow of themes and banners)', () => {
  it('solo is the session phase itself', () => {
    expect(flowPhase({ mode: 'solo', phase: 'won' })).toBe('won');
    expect(flowPhase({ mode: 'solo', phase: 'falling' })).toBe('falling');
  });
  it('race: a round over looks like a won level, a match over like a game over', () => {
    expect(flowPhase({ mode: 'race', phase: 'lobby' })).toBe('lobby');
    expect(flowPhase({ mode: 'race', phase: 'playing' })).toBe('playing');
    expect(flowPhase({ mode: 'race', phase: 'roundOver', result: { kind: 'race' } })).toBe('won');
    expect(flowPhase({ mode: 'race', phase: 'matchOver', result: { kind: 'race' } })).toBe('gameover');
  });
  it('windmaster: a failed level is repeated (game over, no new look), a cleared one moves on', () => {
    expect(flowPhase({ mode: 'windmaster', phase: 'roundOver', result: { outcome: 'won' } })).toBe('won');
    expect(flowPhase({ mode: 'windmaster', phase: 'roundOver', result: { outcome: 'gameover' } })).toBe('gameover');
    expect(flowPhase({ mode: 'windmaster', phase: 'matchOver', result: { outcome: 'won' } })).toBe('gameover');
  });
});

describe('START needs live phones, not just occupied slots', () => {
  it('race: both phones must have sent tilt lately; a slot held only by a dead socket does not count', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.setMode('race', 0);
    g.pair(1, 0);
    g.pair(2, 0);
    expect(g.ready()).toBe(true); // both slots are occupied...
    g.tilt(2, 1000);
    expect(g.canStart(1100)).toBe(false); // ...but player 1 has said nothing for 1100 ms: his socket is dead
    g.tilt(1, 1150);
    expect(g.canStart(1200)).toBe(true);
    expect(g.canStart(1800)).toBe(false); // everything went quiet
  });
  it('windmaster the same, solo needs only its controlling phone', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.setMode('windmaster', 0);
    g.pair(1, 0);
    g.pair(2, 0);
    g.tilt(1, 2000);
    expect(g.canStart(2100)).toBe(false);
    g.tilt(2, 2100);
    expect(g.canStart(2100)).toBe(true);
    const solo = createPlayerGates(TILT_TIMEOUT_MS);
    solo.pair(1, 0);
    expect(solo.canStart(3000)).toBe(false);
    solo.tilt(1, 3000);
    expect(solo.canStart(3100)).toBe(true);
  });
  it('solo with two phones: the spectator\'s tilt does not make a dead controlling phone startable', () => {
    const g = createPlayerGates(TILT_TIMEOUT_MS);
    g.pair(1, 0);
    g.pair(2, 0);
    g.tilt(2, 5000);
    expect(g.canStart(5100)).toBe(false);
  });
  it('nobody paired: never', () => {
    for (const mode of ['solo', 'race', 'windmaster']) {
      const g = createPlayerGates(TILT_TIMEOUT_MS);
      g.setMode(mode, 0);
      expect(g.canStart(0)).toBe(false);
    }
  });
});

// main.js hands every controller message to routeInput; this is the whole of "which phone drives which walker".
describe('routing the phones\' messages to the match', () => {
  const room = (mode, { phones = [1, 2], tiltAt = 0 } = {}) => {
    const match = createMatch({ mode, seed: 4 });
    const links = createPlayerGates(TILT_TIMEOUT_MS);
    links.setMode(mode, 0);
    for (const p of phones) links.pair(p, 0);
    for (const p of phones) links.tilt(p, tiltAt);
    return { match, links };
  };
  const send = (r, msg, p, now = 100) => routeInput(r.match, r.links, { ...msg, p }, now);
  const walkerInput = (r) => r.match.sessions[1].input;

  it('solo, two live phones: the first phone steers, the second phone\'s tilt, walk, run, jump, pause and start do nothing', () => {
    const r = room('solo');
    send(r, { t: 'start' }, 1);
    expect(r.match.phase).toBe('playing');
    send(r, { t: 'tilt', v: 0.5 }, 1);
    send(r, { t: 'walk', on: true }, 1);
    expect(walkerInput(r)).toMatchObject({ tilt: 0.5, walking: true });
    // the second phone
    send(r, { t: 'tilt', v: -1 }, 2);
    send(r, { t: 'walk', on: false }, 2);
    send(r, { t: 'run', on: true }, 2);
    send(r, { t: 'jump' }, 2);
    send(r, { t: 'pause' }, 2);
    expect(walkerInput(r)).toEqual({ tilt: 0.5, walking: true, running: false, jump: false });
    expect(r.match.paused).toBe(false);
    // and it cannot start a game for the other one
    const idle = room('solo');
    send(idle, { t: 'start' }, 2);
    expect(idle.match.phase).toBe('lobby');
  });

  it('solo, two live phones: the first phone\'s jump and pause still work', () => {
    const r = room('solo');
    send(r, { t: 'start' }, 1);
    send(r, { t: 'jump' }, 1);
    expect(walkerInput(r).jump).toBe(true);
    send(r, { t: 'pause' }, 1);
    expect(r.match.paused).toBe(true);
  });

  it('solo, one phone in slot 2 (slot 1 empty): it steers', () => {
    const r = room('solo', { phones: [2] });
    send(r, { t: 'start' }, 2);
    expect(r.match.phase).toBe('playing');
    send(r, { t: 'tilt', v: 0.25 }, 2);
    send(r, { t: 'walk', on: true }, 2);
    send(r, { t: 'jump' }, 2);
    expect(walkerInput(r)).toMatchObject({ tilt: 0.25, walking: true, jump: true });
  });

  it('solo: when the slot-1 phone leaves, the slot-2 phone takes over', () => {
    const r = room('solo');
    send(r, { t: 'start' }, 1);
    r.links.leave(1, 200);
    send(r, { t: 'tilt', v: -0.5 }, 2, 210);
    send(r, { t: 'walk', on: true }, 2, 210);
    expect(walkerInput(r)).toMatchObject({ tilt: -0.5, walking: true });
  });

  it('race: each phone steers its own lane, and either may start', () => {
    const r = room('race');
    send(r, { t: 'start' }, 2);
    expect(r.match.phase).toBe('playing');
    send(r, { t: 'tilt', v: 0.3 }, 1);
    send(r, { t: 'tilt', v: -0.6 }, 2);
    send(r, { t: 'walk', on: true }, 2);
    expect(r.match.sessions[1].input).toMatchObject({ tilt: 0.3, walking: false });
    expect(r.match.sessions[2].input).toMatchObject({ tilt: -0.6, walking: true });
  });

  it('race: START is refused while one phone is only a dead socket', () => {
    const r = room('race');
    r.links.tilt(2, 900); // phone 2 is chattering, phone 1 has been silent since 0
    send(r, { t: 'start' }, 2, 1000);
    expect(r.match.phase).toBe('lobby');
    r.links.tilt(1, 1000);
    send(r, { t: 'start' }, 2, 1010);
    expect(r.match.phase).toBe('playing');
  });

  it('windmaster: the walker steers, the other phone\'s gust is accepted (the match decides who may)', () => {
    const r = room('windmaster');
    send(r, { t: 'start' }, 1);
    send(r, { t: 'tilt', v: 0.4 }, 1);
    send(r, { t: 'tilt', v: 1 }, 2); // the Wind Master's tilt means nothing
    expect(walkerInput(r).tilt).toBe(0.4);
  });

  it('ignores messages that are not controller input', () => {
    const r = room('solo');
    expect(send(r, { t: 'volume', music: 1, sfx: 1 }, 1)).toBe(false);
    expect(send(r, { t: 'camera' }, 1)).toBe(false);
  });
});
