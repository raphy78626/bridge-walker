import QRCode from 'qrcode';
import { connect } from '../shared/client.js';
import { createSession } from '../game/session.js';
import { createScene } from './scene.js';
import { createHud } from './hud.js';
import { createControllerGate, phoneUrl, reconnectDelay } from './link.js';
import { createAudio, createEagleScheduler } from './audio.js';
import { createCueTracker, playCues } from './audioCues.js';
import { themeForLevel } from './themes.js';
import { themeForTransition, levelBanner } from './levelFlow.js';
import { createGustTrigger, forecastOf } from './windFx.js';
import { recordLevel, recordRun, resultView, sameResult } from './results.js';
import { buildStateMessage, createStateSync } from './stateSync.js';
import { CAMERA_LABELS, loadCameraMode, saveCameraMode } from './cameras.js';

const session = createSession({ seed: Date.now() % 100000 });
const hud = createHud();
const gate = createControllerGate();
const controller = { tilt: 0, walking: false, running: false }; // the phone's latest values, applied only while it is live
const audio = createAudio();
const soundCues = createCueTracker();
const eagles = createEagleScheduler({ audio });
const gusts = createGustTrigger(); // one whoosh per gust, at the start of its warning
const stateSync = createStateSync(); // tells the loop when the phone's status line needs a new message
let shownResult = null; // the session.result the panel is showing
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
// Remote profiling and play-testing over ares-inspect: sound state and the live session.
if (window.__bridge) Object.assign(window.__bridge, { audio, session });
applyTheme(themeForLevel(session.level)); // level 1's look and sound
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
  gate.unpair();
  controller.tilt = 0;
  controller.walking = false;
  controller.running = false;
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
      break;
    }
    case 'paired':
      gate.pair(performance.now());
      hud.hidePairing();
      pushState();
      startSound();
      break;
    case 'peer-left':
      // No controller: pause the game until a phone pairs again.
      dropController();
      hud.showPairing();
      break;
    case 'tilt':
      controller.tilt = msg.v;
      gate.tilt(performance.now());
      break;
    case 'walk':
      controller.walking = msg.on;
      break;
    case 'run':
      controller.running = msg.on;
      break;
    case 'jump':
      // One-shot: the session consumes it. Ignored unless the phone is live, like tilt and walking.
      if (gate.live(performance.now())) session.input.jump = true;
      break;
    case 'camera': {
      const mode = scene.cycleCamera?.();
      if (mode) {
        saveCameraMode(mode);
        hud.showToast(CAMERA_LABELS[mode]);
      }
      break;
    }
    case 'start':
      session.start();
      startSound();
      break;
    case 'pause':
      if (gate.live(performance.now())) session.togglePause(); // the state sync tells the phone
      break;
    case 'volume':
      audio.setVolumes(msg); // the phone remembers the levels and sends them again on every pairing
      break;
  }
}

function pushState() {
  stateSync.changed(session); // the message below is the latest, so the loop need not send it again
  net?.send(buildStateMessage(session));
}

// localStorage can be missing or throw (private mode, a locked-down TV browser): records then just are not kept.
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Shows the results panel for a new session.result (best scores are kept per level, and for the run), and hides it
// when the result goes away. A level result and a run result each call this once.
function syncResult(result) {
  if (sameResult(result, shownResult)) return;
  shownResult = result;
  if (!result) {
    hud.hideResults();
    return;
  }
  const recorded = result.kind === 'run' ? recordRun(storage(), result) : recordLevel(storage(), result);
  hud.showResults(resultView(result, recorded));
}

let prev = performance.now();
let levelPhase = session.phase; // last phase seen, for the level transitions
let audioPaused = false; // session.paused as the audio last heard it
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
  // Paused while no phone is paired. A phone that has stopped sending tilt (locked, or dropped)
  // counts as gone too: its last values must not keep the walker walking.
  const live = gate.live(now);
  session.input.tilt = live ? controller.tilt : 0;
  session.input.walking = live && controller.walking;
  session.input.running = live && controller.running;
  if (gate.paired) session.update(dt);
  if (session.paused !== audioPaused) {
    audioPaused = session.paused; // sound freezes with the game, so a gust whoosh resumes in step with its warning
    audio.setPaused(audioPaused);
  }
  if (session.phase !== levelPhase) {
    // Entering 'won' applies the NEXT level's theme, so the sky bake hides behind the win screen.
    const theme = themeForTransition(levelPhase, session.phase, session.level);
    if (theme) applyTheme(theme);
    const banner = levelBanner(levelPhase, session.phase, session.level);
    if (banner) hud.showBanner(banner);
    levelPhase = session.phase;
  }
  if (stateSync.changed(session)) net?.send(buildStateMessage(session)); // phase, lives, level, wind, result: on change only
  const forecast = forecastOf(session);
  if (gusts.update(forecast)) audio.gust({ dir: forecast.dir, strength: forecast.strength });
  syncResult(session.result ?? null);
  playCues(audio, soundCues.update(session), session.walker.speed); // footsteps, jump, landing, scream
  eagles.tick(now);
  scene.render(session, now / 1000);
  hud.render(session);
}
requestAnimationFrame(frame);
