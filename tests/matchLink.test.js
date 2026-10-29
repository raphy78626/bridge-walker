import { describe, it, expect } from 'vitest';
import { createMatch } from '../src/game/match.js';
import { controlledPlayer, gatesWanted, matchReady, modeSwitch, createPlayerGates, flowPhase } from '../src/tv/matchLink.js';
import { TILT_TIMEOUT_MS } from '../src/tv/link.js';

describe('solo phone routing', () => {
  it('every phone steers player 1 in solo, whatever slot it landed in', () => {
    expect(controlledPlayer('solo', 1)).toBe(1);
    expect(controlledPlayer('solo', 2)).toBe(1);
  });
  it('the two-player modes go by slot', () => {
    for (const mode of ['race', 'windmaster']) {
      expect(controlledPlayer(mode, 1)).toBe(1);
      expect(controlledPlayer(mode, 2)).toBe(2);
    }
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
  it('in solo, a tilt from the phone in slot 2 keeps player 1 live', () => {
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
