// What the TV's HUD says in the two-player modes, as plain data. No DOM and no three.js, so it is unit-tested; hud.js only
// places the strings. All of it works from a match (src/game/match.js).
import { BRIDGE_LENGTH } from '../game/session.js';
import { GUST_COOLDOWN_S, CONTROLLED_GUST_S } from '../game/wind.js';
import { WIND_WARNING_S } from '../game/forecast.js';
import { PLAYER_COLORS, PLAYER_NAMES } from '../shared/players.js';
import { keepMovingOf } from './keepMoving.js';

export const MODE_LABELS = { solo: 'Solo', race: 'Race', windmaster: 'Wind Master' };
export const MODE_BLURBS = {
  solo: 'One soldier, one phone',
  race: 'Two bridges, same gaps: first across wins the round',
  windmaster: 'One walks, one sends gusts: roles swap every round',
};
export const PICK_MODE_HINT = 'Pick a mode on your phone, then press START';

// The whole gust ring: a gust may be sent again this long after the last one was (the same figure as the phone's ring).
export const GUST_RING_S = Math.max(GUST_COOLDOWN_S, WIND_WARNING_S + CONTROLLED_GUST_S);

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const fallsText = (n) => `${n} ${n === 1 ? 'fall' : 'falls'}`;
export const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const distText = (z) => `${Math.min(BRIDGE_LENGTH, Math.max(0, Math.floor(z)))} / ${BRIDGE_LENGTH} m`;
export const pname = (p) => PLAYER_NAMES[p];
// A racer held at the leash (game/match.js RACE_LEASH): his panel and his phone say who he is waiting for.
export const waitingOf = (s) => !!s && s.phase === 'playing' && !s.paused && !s.halted && s.waiting === true;

// "Round 2 · P1 1 – 0 P2" (race: the round wins).
export function raceRoundLine(round, tally) {
  return `Round ${round} · P1 ${tally[1]} – ${tally[2]} P2`;
}

// The race HUD: a panel for each racer (teal left, orange right) and the round line. `progress` is 0..1 along the bridge,
// for the track at the bottom that shows both dots.
export function raceHudView(match) {
  const players = {};
  for (const p of [1, 2]) {
    const s = match.sessions[p];
    players[p] = {
      name: pname(p),
      color: PLAYER_COLORS[p],
      dist: distText(s.walker.z),
      progress: clamp01(s.walker.z / BRIDGE_LENGTH),
      time: mmss(match.elapsed), // the shared round clock: a lane still on the ledge reads the same as the other
      falls: fallsText(s.levelFalls),
      keepMoving: keepMovingOf(s),
      waiting: waitingOf(s),
    };
  }
  return { round: match.round, roundLine: raceRoundLine(match.round, match.tally), players };
}

// "P1 walking · P2 Wind Master"
export const rolesText = (walker, windMaster) => `${pname(walker)} walking · ${pname(windMaster)} Wind Master`;

// The Wind Master HUD: who is who, the round and the scores, and the gust bar in the Wind Master's colour. The bar fills as
// the cooldown runs out (empty right after a gust is sent, full when the next may be sent).
export function windmasterHudView(match, rounds) {
  const walker = match.walkerOf();
  const windMaster = match.windMasterOf();
  const ready = !!match.gustReady;
  const fill = ready ? 1 : clamp01(1 - match.gustIn / GUST_RING_S);
  const [a, b] = [match.scores[1], match.scores[2]];
  return {
    walker,
    windMaster,
    roles: rolesText(walker, windMaster),
    walkerColor: PLAYER_COLORS[walker],
    masterColor: PLAYER_COLORS[windMaster],
    roundLine: `Round ${match.round}${rounds ? ` of ${rounds}` : ''} · P1 ${a} – ${b} P2`,
    gustReady: ready,
    gustFill: fill,
    gustLabel: ready ? 'GUST READY' : 'WAIT…',
  };
}

// The lobby / pairing panel's slots and lines. `phones` is { 1: bool, 2: bool }, which phones are connected.
export function lobbyView(match, phones) {
  const slots = [1, 2].map((p) => ({
    player: p,
    color: PLAYER_COLORS[p],
    connected: !!phones[p],
    text: `P${p} ${phones[p] ? '● connected' : '○ waiting…'}`,
  }));
  const twoPlayer = match.mode !== 'solo';
  const missing = twoPlayer && !(phones[1] && phones[2]);
  return {
    slots,
    modeLabel: MODE_LABELS[match.mode] ?? MODE_LABELS.solo,
    blurb: MODE_BLURBS[match.mode] ?? '',
    hint: PICK_MODE_HINT,
    // Race and Wind Master cannot start with one phone: say who is missing.
    warning: missing ? `${MODE_LABELS[match.mode]} needs two phones: waiting for ${phones[1] ? 'P2' : phones[2] ? 'P1' : 'both players'}` : '',
  };
}

// The panel shows in the lobby (a match that has not started, or is being set up again), and whenever the game cannot run
// because a phone it needs is missing, or no room is open. It hides as soon as a round is running.
export function pairingPanelVisible(match, { ready, hasRoom }) {
  if (!hasRoom) return true;
  return !ready || match.phase === 'lobby';
}

