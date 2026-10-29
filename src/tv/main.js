import QRCode from 'qrcode';
import { connect } from '../shared/client.js';
import { createMatch, WINDMASTER_ROUNDS } from '../game/match.js';
import { createScene } from './scene.js';
import { createHud } from './hud.js';
import { TILT_TIMEOUT_MS, phoneUrl, reconnectDelay } from './link.js';
import { controlledPlayer, createPlayerGates, flowPhase, modeSwitch } from './matchLink.js';
import { lobbyView, pairingPanelVisible } from './matchHud.js';
import { matchResultView } from './matchResults.js';
import { RACE_VIEW_LABELS, windSessionOf } from './raceView.js';
import { createAudio, createEagleScheduler } from './audio.js';
import { createCueTracker, playCues } from './audioCues.js';
import { themeForLevel } from './themes.js';
import { themeForTransition, levelBanner } from './levelFlow.js';
import { createGustTrigger, forecastOf } from './windFx.js';
import { recordLevel, recordRun, resultView, sameResult } from './results.js';
import { createStateSync, sessionFor, stateMessageFor } from './stateSync.js';
import { CAMERA_LABELS, loadCameraMode, saveCameraMode } from './cameras.js';

const newMatch = (mode) => createMatch({ mode, seed: Date.now() % 100000 });
let match = newMatch('solo'); // solo until a phone picks another mode (and replaced by a new match when it does)
const hud = createHud();
const links = createPlayerGates(TILT_TIMEOUT_MS); // which phones are here, and one controller gate per player
const audio = createAudio();
const soundCues = [createCueTracker(), createCueTracker()]; // a soldier each: a race has two
const eagles = createEagleScheduler({ audio });
const gusts = createGustTrigger(); // one whoosh per gust, at the start of its warning
const stateSyncs = { 1: createStateSync(), 2: createStateSync() }; // tells the loop when a phone's status line needs a new message
const wasLive = { 1: false, 2: false }; // each player's input was live last frame, so going quiet clears it once
let hasRoom = false; // the server has given us a room: the QR code is good
let shownResult = null; // the match.result the panel is showing
startSound();
// Where autoplay is blocked (a TV's browser app, desktop testing), any remote key or click counts.
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, startSound, { once: true });

// The webOS app may play audio straight away (checked on the LG TV). Ask for the ambience first, so
// it starts by itself whenever the context does resume; the pairing and START messages retry too.
function startSound() {
  audio.startAmbience();
  audio.unlock();
}
let net = null;
let attempt = 0; // failed reconnects in a row, for the backoff
// Connect before building the 3D scene, so a graphics failure can never block pairing.
openSocket();
const scene = createSceneOrStub();
// Remote profiling and play-testing over ares-inspect: sound state, the live match and its first session.
if (window.__bridge) {
  Object.defineProperties(window.__bridge, {
    audio: { value: audio, configurable: true },
    match: { get: () => match, configurable: true },
    session: { get: () => match.sessions[1], configurable: true },
    links: { value: links, configurable: true },
  });
}
hud.setMode(match.mode);
applyTheme(themeForLevel(match.level)); // level 1's look and sound
scene.setCamera?.(loadCameraMode());

// The look (sky, fog, lighting) and the sound change together. The scene skips a theme it already shows.
function applyTheme(theme) {
  scene.setTheme?.(theme);
  audio.setTheme(theme.id);
}

function createSceneOrStub() {
  try {
    return createScene(document.getElementById('game'));
  } catch (err) {
    console.error(err); // reaches the server log via the reporter in tv.html
    return { render() {} }; // no scene: the HUD, sound and pairing still work
  }
}

// No phone is paired any more: the game pauses and the last tilt/walk values are forgotten.
function dropController() {
  links.leaveAll();
  for (const p of [1, 2]) match.clearInput(p);
}

// A phone sends 'mode': the old match is thrown away (the guard in matchLink.js decided that is allowed) and a fresh one
// of that mode takes its place, in the lobby, with level 1's look.
function switchMode(mode) {
  match = newMatch(mode);
  links.setMode(mode, performance.now());
  for (const p of [1, 2]) {
    stateSyncs[p].reset();
    soundCues[p - 1].reset();
  }
  gusts.reset();
  levelPhase = flowPhase(match);
  hud.setMode(mode);
  applyTheme(themeForLevel(match.level));
  syncResult(null);
  updatePanel();
  pushStates();
}

// The pairing panel shows in the lobby (the QR for the other player, the slots, the mode) and whenever a phone the game
// needs is missing; it hides once a round runs.
function updatePanel() {
  const up = pairingPanelVisible(match, { ready: links.ready(), hasRoom });
  hud.setPanelUp(up);
  if (up) {
    if (hasRoom) hud.setLobby(lobbyView(match, links.phones));
    hud.showPairing();
  } else {
    hud.hidePairing();
  }
}

function openSocket() {
  try {
    const conn = connect(onMessage, () => conn.send({ t: 'join', role: 'tv' }), onClose);
    net = conn;
  } catch (err) {
    console.error(err);
    onClose();
  }
}

// The Mac server restarted or went to sleep: stop the game, say so, and keep trying.
// A socket that fails to open also ends in a close event, so this is the only retry path.
function onClose() {
  dropController();
  hasRoom = false;
  hud.showReconnecting();
  setTimeout(openSocket, reconnectDelay(attempt));
  attempt += 1;
}

// The phone needs HTTPS for its motion sensors; phoneUrl() decides which address goes in the QR code.
async function phoneUrlFor(room) {
  const info = await fetch('/api/info').then((r) => r.json());
  return phoneUrl(location, info, room);
}

async function onMessage(msg) {
  switch (msg.t) {
    case 'room': {
      let url;
      try {
        url = await phoneUrlFor(msg.room);
      } catch (err) {
        console.error(err);
        net.ws.close(); // no link to show: close, and the reconnect path asks again
        break;
      }
      attempt = 0; // the server is back and answering: the next outage starts the backoff over
      await QRCode.toCanvas(document.getElementById('qr'), url, { width: 280, margin: 1 });
      hud.showPairing(url, msg.room);
      hasRoom = true;
      updatePanel();
      break;
    }
    case 'paired': {
      const phone = msg.player === 2 ? 2 : 1;
      links.pair(phone, performance.now());
      stateSyncs[phone].reset();
      pushState(phone);
      updatePanel();
      startSound();
      break;
    }
    case 'peer-left': {
      // A phone went away. The game pauses while one it needs is missing (a solo game needs any one).
      if (msg.player === 1 || msg.player === 2) links.leave(msg.player, performance.now());
      else links.leaveAll();
      for (const p of [1, 2]) if (!links.gates[p].paired) match.clearInput(p);
      updatePanel();
      break;
    }
    case 'tilt': {
      const now = performance.now();
      const player = links.tilt(phoneOf(msg), now);
      if (links.gates[player].paired) match.input(player, msg);
      break;
    }
    case 'walk':
    case 'run':
      match.input(controlledPlayer(match.mode, phoneOf(msg)), msg); // zeroed again by the loop if this phone's tilt goes quiet
      break;
    case 'jump': {
      // One-shot: the session consumes it. Ignored unless the phone is live, like tilt and walking.
      const player = controlledPlayer(match.mode, phoneOf(msg));
      if (links.live(player, performance.now())) match.input(player, msg);
      break;
    }
    case 'gust':
      match.input(phoneOf(msg), msg); // the Wind Master's; the match refuses anyone else's, and one during the cooldown
      break;
    case 'camera': {
      const view = scene.cycleCamera?.();
      if (view) {
        if (match.mode === 'solo') saveCameraMode(view);
        hud.showToast(match.mode === 'race' ? RACE_VIEW_LABELS[view] : CAMERA_LABELS[view]);
      }
      break;
    }
    case 'mode': {
      const next = modeSwitch(match, msg);
      if (next) switchMode(next);
      break;
    }
    case 'start':
      if (links.ready()) match.start(); // a race or a Wind Master round needs both phones
      startSound();
      break;
    case 'pause':
      if (links.live(controlledPlayer(match.mode, phoneOf(msg)), performance.now())) match.togglePause(); // the state sync tells the phones
      break;
    case 'volume':
      audio.setVolumes(msg); // the phone remembers the levels and sends them again on every pairing
      break;
  }
}

// The slot a phone message came from (the server stamps every one with p).
const phoneOf = (msg) => (msg.p === 2 ? 2 : 1);

// Each paired phone gets its own message: its player's session, with the match's fields over it, aimed at it alone.
function pushState(p) {
  stateSyncs[p].changed(sessionFor(match, p), match); // the message below is the latest, so the loop need not send it again
  net?.send(stateMessageFor(match, p));
}
function pushStates() {
  for (const p of [1, 2]) if (links.phones[p]) pushState(p);
}

// localStorage can be missing or throw (private mode, a locked-down TV browser): records then just are not kept.
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Shows the results panel for a new match.result (best scores are kept per level, and for the run, in solo), and hides it
// when the result goes away. A level result, a run result and a round or match result each call this once.
function syncResult(result) {
  if (sameResult(result, shownResult)) return;
  shownResult = result;
  if (!result) {
    hud.hideResults();
    return;
  }
  if (result.kind === 'race' || result.kind === 'windmaster') {
    hud.showResults(matchResultView(result, { final: match.phase === 'matchOver' }));
    return;
  }
  const recorded = result.kind === 'run' ? recordRun(storage(), result) : recordLevel(storage(), result);
  hud.showResults(resultView(result, recorded));
}

let prev = performance.now();
let levelPhase = flowPhase(match); // last phase seen, for the level transitions
let panelPhase = match.phase; // and for the pairing panel, which hides when a round starts
let audioPaused = false; // match.paused as the audio last heard it
let frames = 0;
let fpsSince = prev;
function frame(now) {
  requestAnimationFrame(frame); // first, so one exception in this frame cannot end the loop
  const dt = Math.min((now - prev) / 1000, 0.05); // a stalled tab must not teleport the walker
  prev = now;
  frames += 1;
  if (now - fpsSince > 10000) {
    // TVs vary wildly in GPU power; the server log shows how smoothly this one runs.
    window.reportToServer?.('fps', `${Math.round((frames * 1000) / (now - fpsSince))} ${scene.quality ?? ''}`);
    frames = 0;
    fpsSince = now;
  }
  // A phone that has stopped sending tilt (locked, or dropped) counts as gone: its last values must not keep the
  // walker walking. That is judged per player; going quiet clears that player's input once.
  for (const p of [1, 2]) {
    if (links.live(p, now)) wasLive[p] = true;
    else if (wasLive[p] || links.gates[p].paired) {
      wasLive[p] = false;
      match.clearInput(p);
    }
  }
  // Paused while a phone the game needs is not paired (solo: any one; race and Wind Master: both).
  if (links.ready()) match.update(dt);
  if (match.paused !== audioPaused) {
    audioPaused = match.paused; // sound freezes with the game, so a gust whoosh resumes in step with its warning
    audio.setPaused(audioPaused);
  }
  const phase = flowPhase(match);
  if (phase !== levelPhase) {
    // Entering 'won' applies the NEXT level's theme, so the sky bake hides behind the win screen.
    const theme = themeForTransition(levelPhase, phase, match.level);
    if (theme) applyTheme(theme);
    const banner = levelBanner(levelPhase, phase, match.level);
    if (banner) hud.showBanner(banner);
    levelPhase = phase;
  }
  if (match.phase !== panelPhase) {
    panelPhase = match.phase;
    updatePanel();
  }
  for (const p of [1, 2]) {
    // phase, lives, level, wind, result, and in a match its round, tally, scores and roles: on change only
    if (links.phones[p] && stateSyncs[p].changed(sessionFor(match, p), match)) net?.send(stateMessageFor(match, p));
  }
  const race = match.mode === 'race';
  // The wind the TV shows: the walker's, or in a race the one the view follows (raceView.js).
  const windSession = race ? windSessionOf(match.sessions, scene.raceView) : match.sessions[1];
  const forecast = forecastOf(windSession);
  if (gusts.update(forecast)) audio.gust({ dir: forecast.dir, strength: forecast.strength });
  syncResult(match.result ?? null);
  for (const p of [1, 2]) {
    const s = match.sessions[p];
    if (s) playCues(audio, soundCues[p - 1].update(s), s.walker.speed); // footsteps, jump, landing, scream
  }
  eagles.tick(now);
  scene.render(match, now / 1000);
  if (race) {
    hud.renderRace(match);
    hud.renderRaceMessage(match);
    hud.renderWind(forecast);
  } else {
    hud.render(match.sessions[1]);
    if (match.mode === 'windmaster') hud.renderWindMaster(match, WINDMASTER_ROUNDS);
  }
}
requestAnimationFrame(frame);
