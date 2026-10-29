// How the phones' messages reach the match: which phone steers which player, who is allowed to change the mode, and
// what the phase of a two-player match means for the level flow (themes, banners). Pure, so it is unit-tested; main.js
// only wires it to the socket.
import { MODES } from '../shared/protocol.js';
import { createControllerGate } from './link.js';

// Solo has one soldier, always player 1's. A phone that landed in slot 2 (it reconnected while its old socket still
// lingered in slot 1) must still steer it, so in solo every phone counts as player 1. Race and windmaster go by slot.
export const controlledPlayer = (mode, phone) => (mode === 'solo' ? 1 : phone);

// Whether a controller gate is "paired" for player 1 and 2, from which phones are connected: solo needs any one phone for
// player 1; the two-player modes need each phone for its own player.
export function gatesWanted(mode, phones) {
  if (mode === 'solo') return { 1: !!(phones[1] || phones[2]), 2: false };
  return { 1: !!phones[1], 2: !!phones[2] };
}

// May the game run (and START be taken)? Solo with any phone; race and windmaster only with both.
export const matchReady = (mode, phones) => (mode === 'solo' ? !!(phones[1] || phones[2]) : !!(phones[1] && phones[2]));

// The mode a {t:'mode'} message switches to, or null when it must be ignored: a mode the game does not know, the mode
// already running (that would throw the match away for nothing), or a round in progress.
export function modeSwitch(match, msg) {
  if (!msg || msg.t !== 'mode' || !MODES.includes(msg.mode)) return null;
  if (msg.mode === match.mode || !match.canChangeMode) return null;
  return msg.mode;
}

// One controller gate per player (link.js): is that player's phone still sending tilt? Silence for 500 ms means it locked
// or dropped, and the walker must not keep walking on its own, so the TV zeroes that player's input (match.clearInput).
export function createPlayerGates(timeoutMs) {
  const gates = { 1: createControllerGate(timeoutMs), 2: createControllerGate(timeoutMs) };
  const phones = { 1: false, 2: false };
  let mode = 'solo';
  const sync = (now) => {
    const want = gatesWanted(mode, phones);
    for (const p of [1, 2]) {
      if (want[p] && !gates[p].paired) gates[p].pair(now);
      else if (!want[p] && gates[p].paired) gates[p].unpair();
    }
  };
  return {
    gates,
    phones, // slot -> a phone is connected
    get mode() {
      return mode;
    },
    pair(phone, now) {
      phones[phone] = true;
      sync(now);
    },
    leave(phone, now) {
      phones[phone] = false;
      sync(now);
    },
    leaveAll() {
      phones[1] = phones[2] = false;
      sync(0);
    },
    setMode(next, now) {
      mode = next;
      sync(now);
    },
    // A tilt from `phone`: it keeps its player's gate alive. Returns the player it steers.
    tilt(phone, now) {
      const player = controlledPlayer(mode, phone);
      gates[player].tilt(now);
      return player;
    },
    live: (player, now) => gates[player].live(now),
    ready: () => matchReady(mode, phones),
    get count() {
      return (phones[1] ? 1 : 0) + (phones[2] ? 1 : 0);
    },
  };
}

// The single-player phase names (themes.js's level flow, levelFlow.js) for a match in any mode: 'lobby', 'playing', and at
// the end of a round 'won' (a cleared level: the next one's look is baked behind the results panel) or 'gameover'
// (the match is over, or the Wind Master walker failed the level, which the next player repeats).
export function flowPhase(match) {
  if (match.mode === 'solo') return match.phase;
  switch (match.phase) {
    case 'roundOver':
      return match.result && match.result.outcome === 'gameover' ? 'gameover' : 'won';
    case 'matchOver':
      return 'gameover';
    default:
      return match.phase;
  }
}
