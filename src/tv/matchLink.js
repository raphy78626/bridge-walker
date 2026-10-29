// How the phones' messages reach the match: which phone steers which player, who is allowed to change the mode, and
// what the phase of a two-player match means for the level flow (themes, banners). Pure, so it is unit-tested; main.js
// only wires it to the socket.
import { MODES } from '../shared/protocol.js';
import { createControllerGate } from './link.js';

// Solo has one soldier, always player 1's, and ONE phone steers it: the phone in slot 1 when it is connected. The slot-2 phone
// steers only when slot 1 is empty (it reconnected while its old socket still held slot 1, or the first phone left). With
// two phones in a solo game, the other one is a spectator: everything it sends to steer is ignored.
export const soloController = (phones) => (phones[1] ? 1 : phones[2] ? 2 : 0);

// The player a phone's input drives: 0 for none. Race and windmaster go by slot. Solo: player 1 for the controlling phone, none
// for the other. Without the roster (`phones`, slot -> connected) a lone phone is assumed.
export function controlledPlayer(mode, phone, phones = { [phone]: true }) {
  if (mode !== 'solo') return phone;
  return phone === soloController(phones) ? 1 : 0;
}

// May this phone's START begin the game? In solo only the controlling phone's; in a match either player's.
export const startAllowed = (mode, phone, phones) => mode !== 'solo' || controlledPlayer(mode, phone, phones) === 1;

// Whether a controller gate is "paired" for player 1 and 2, from which phones are connected: solo needs any one phone for
// player 1; the two-player modes need each phone for its own player.
export function gatesWanted(mode, phones) {
  if (mode === 'solo') return { 1: !!(phones[1] || phones[2]), 2: false };
  return { 1: !!phones[1], 2: !!phones[2] };
}

// May the game run? Solo with any phone; race and windmaster only with both. This is about connections (the pairing panel and
// whether the clock runs); starting a round needs more, see createPlayerGates().canStart.
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
    // Who steers player 1 in solo (1 or 2, by slot), 0 in the two-player modes and with nobody connected.
    get controller() {
      return mode === 'solo' ? soloController(phones) : 0;
    },
    // A phone that is connected in solo but not the one steering: it is only shown "Solo game in progress".
    spectator(phone) {
      return mode === 'solo' && !!phones[phone] && soloController(phones) !== phone;
    },
    // A tilt from `phone`: it keeps its player's gate alive. Returns the player it steers, 0 when it steers nobody (a solo
    // spectator): its tilt is ignored, so a silent controlling phone is never kept "live" by the other one.
    tilt(phone, now) {
      const player = controlledPlayer(mode, phone, phones);
      if (player) gates[player].tilt(now);
      return player;
    },
    live: (player, now) => gates[player].live(now),
    ready: () => matchReady(mode, phones),
    // May a round begin? Every phone the mode needs must be live (it has sent tilt lately), not just occupy its slot: a
    // socket left behind by a dropped phone would otherwise let a race start with nobody on one lane.
    canStart: (now) => (mode === 'solo' ? gates[1].live(now) : gates[1].live(now) && gates[2].live(now)),
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

// One controller message from a phone (msg.p is its slot, stamped by the server) applied to the match: the routing that decides
// which phone drives which walker. Returns true when the message was controller input. main.js calls it for these types.
export function routeInput(match, links, msg, now) {
  const phone = msg.p === 2 ? 2 : 1;
  switch (msg.t) {
    case 'tilt': {
      const player = links.tilt(phone, now);
      if (player && links.gates[player].paired) match.input(player, msg);
      return true;
    }
    case 'walk':
    case 'run': {
      const player = controlledPlayer(match.mode, phone, links.phones);
      if (player) match.input(player, msg); // zeroed again by the loop if this phone's tilt goes quiet
      return true;
    }
    case 'jump': {
      // One-shot: the session consumes it. Ignored unless the phone is live, like tilt and walking.
      const player = controlledPlayer(match.mode, phone, links.phones);
      if (player && links.live(player, now)) match.input(player, msg);
      return true;
    }
    case 'gust':
      match.input(phone, msg); // the Wind Master's; the match refuses anyone else's, and one during the cooldown
      return true;
    case 'pause': {
      const player = controlledPlayer(match.mode, phone, links.phones);
      if (player && links.live(player, now)) match.togglePause(); // the state sync tells the phones
      return true;
    }
    case 'start':
      if (startAllowed(match.mode, phone, links.phones) && links.canStart(now)) match.start();
      return true;
    default:
      return false;
  }
}
