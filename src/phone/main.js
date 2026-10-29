import { connect } from '../shared/client.js';
import { createTiltReader } from './tilt.js';
import { createGustTrigger, strengthOfLevel, windIndicator } from '../tv/windFx.js'; // pure helpers, no three.js
import { statusText, viewOf, startLabel } from './status.js';
import { PLAYER_COLORS } from '../shared/players.js';
import { GUST_COOLDOWN_S, CONTROLLED_GUST_S } from '../game/wind.js';
import { WIND_WARNING_S } from '../game/forecast.js';

const SIGN_KEY = 'bridge.tiltSign';

const gusts = createGustTrigger();
const $ = (id) => document.getElementById(id);
const room = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase();
const tilt = createTiltReader();
let net = null;
let calibStep = 'zero';
let sender = null;
let motionListening = false;
let me = 1; // this phone's player slot, given by the server at pairing (the TV's `you` can correct it)
let windMaster = false; // the play screen shows the two GUST buttons instead of WALK / RUN / JUMP
let wasReady = true; // gustReady as last seen, to start the cooldown ring when it turns false
const GUST_RING_S = Math.max(GUST_COOLDOWN_S, WIND_WARNING_S + CONTROLLED_GUST_S); // what the TV's gustReady takes to return

function loadSign() {
  try {
    return Number(localStorage.getItem(SIGN_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveSign(s) {
  try {
    localStorage.setItem(SIGN_KEY, String(s));
  } catch {}
}
function clearSign() {
  try {
    localStorage.removeItem(SIGN_KEY);
  } catch {}
}

function show(id) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== id;
}

// Close the socket and stop sending. Safe to call twice.
function dropSocket() {
  clearInterval(sender);
  net?.ws.close();
  net = null;
}

// The TV's room is gone once either side drops, so always return to Connect.
function showProblem(text) {
  dropSocket();
  show('screen-connect');
  $('connect-error').textContent = text;
  $('btn-connect').disabled = false;
}

$('room-label').textContent = room ? `Room ${room}` : 'Scan the QR code on the TV';
$('btn-connect').disabled = !room;

$('btn-connect').addEventListener('click', async () => {
  // iOS asks for motion permission, and only from a tap. Call it on the class, not detached.
  let asking = null;
  if (typeof window.DeviceMotionEvent?.requestPermission === 'function') {
    asking = DeviceMotionEvent.requestPermission().catch(() => 'denied'); // still inside the tap
  }
  $('btn-connect').disabled = true; // a double-tap must not open a second socket
  $('connect-error').textContent = '';
  if (asking && (await asking) !== 'granted') {
    $('connect-error').textContent = 'Motion access was denied. Allow it and try again.';
    $('btn-connect').disabled = false;
    return;
  }
  if (!motionListening) {
    motionListening = true;
    window.addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity;
      if (g && g.x != null) tilt.feed(g.x, g.y);
    });
  }
  navigator.wakeLock?.request('screen').catch(() => {});
  dropSocket();
  const conn = connect(onMessage, () => conn.send({ t: 'join', role: 'phone', room }));
  net = conn;
  conn.ws.addEventListener('close', () => {
    if (net !== conn) return; // closed on purpose, UI already handled
    showProblem('Disconnected — tap Connect to retry');
  });
});

function onMessage(msg) {
  if (msg.t === 'paired') {
    me = msg.player === 2 ? 2 : 1;
    showBadge(me);
    sendVolume(); // a freshly started TV app plays at full volume until it hears the saved levels
    startCalibration();
  } else if (msg.t === 'error') {
    showProblem(
      msg.reason === 'no-room'
        ? 'Room not found — rescan the QR code.'
        : msg.reason === 'room-full'
          ? 'Two phones are already playing — ask one to leave.'
          : 'Another phone took over.',
    );
  } else if (msg.t === 'peer-left') {
    showProblem('TV disconnected — scan the new QR code on the TV');
  } else if (msg.t === 'state') {
    const view = viewOf(msg, me);
    me = view.player;
    showBadge(me);
    showRole(view);
    $('status').textContent = statusText(msg, me);
    showWind(msg);
    $('btn-start').hidden = !view.idle;
    $('btn-start').textContent = startLabel(msg);
    $('modes').hidden = !view.canChangeMode;
    for (const b of document.querySelectorAll('.mode')) b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode));
    $('btn-pause').hidden = msg.phase !== 'playing';
    $('btn-pause').textContent = msg.paused ? '▶ Resume' : '⏸ Pause';
    if (msg.phase === 'falling') navigator.vibrate?.(300);
  }
}

function showBadge(player) {
  const el = $('badge');
  el.textContent = `P${player}`;
  el.className = `badge p${player}`;
  el.style.background = PLAYER_COLORS[player];
  el.setAttribute('aria-label', `You are player ${player}`);
}

// The Wind Master has no soldier to steer: two big GUST buttons replace WALK, RUN and JUMP, and a ring counts down the
// cooldown between gusts (gustReady from the TV). A walker or racer, or a TV that sends none of this, gets the usual pads.
function showRole(view) {
  if (view.windMaster !== windMaster) {
    windMaster = view.windMaster;
    releaseAll(); // a finger still on WALK when the roles swap must not leave the old walker walking
    $('screen-play').classList.toggle('windmaster', windMaster);
    for (const id of ['btn-walk', 'btn-run', 'btn-jump']) $(id).hidden = windMaster;
    for (const id of ['btn-gust-left', 'btn-gust-right']) $(id).hidden = !windMaster;
    $('gust-cool').hidden = !windMaster;
    wasReady = true;
  }
  if (!windMaster) return;
  const ready = view.gustReady && !view.idle;
  $('btn-gust-left').classList.toggle('cooling', !ready);
  $('btn-gust-right').classList.toggle('cooling', !ready);
  const cool = $('gust-cool');
  cool.hidden = view.idle; // between rounds there is nothing to count down, and the room is needed for Start
  if (view.idle) {
    cool.classList.remove('cooling');
    cool.classList.add('ready');
    wasReady = true;
    return;
  }
  if (!ready && wasReady) {
    cool.classList.remove('ready', 'cooling');
    void cool.getBoundingClientRect(); // restart the ring from empty
    cool.style.setProperty('--cooldown', `${GUST_RING_S}s`);
    cool.classList.add('cooling');
  } else if (ready) {
    cool.classList.remove('cooling');
    cool.classList.add('ready');
  }
  $('gust-state').textContent = ready ? 'GUST READY' : 'WAIT…';
  wasReady = ready;
}

// A small arrow next to the balance meter while a gust is coming or blowing, sized and buzzing by the gust's strength
// bucket (msg.windLevel, 1..3, from the TV), one buzz per warning (Android only).
function showWind(msg) {
  const ind = windIndicator({ state: msg.wind, dir: msg.windDir, strength: strengthOfLevel(msg.windLevel) });
  for (const side of ['left', 'right']) {
    const chip = $(`wind-${side}`);
    const on = ind.visible && ind.from === side;
    chip.hidden = !on;
    chip.className = on ? `wind-chip ${ind.state} lvl-${ind.level}` : 'wind-chip';
  }
  $('wind-text').textContent = ind.visible ? (ind.level === 3 ? 'STRONG WIND' : 'WIND') : '';
  if (gusts.update({ state: msg.wind, dir: msg.windDir })) navigator.vibrate?.(20 + 20 * ind.level);
}

function startCalibration() {
  calibStep = 'zero';
  $('calib-text').textContent = "Hold the phone the way you'll play, then tap.";
  $('btn-calib').textContent = 'Set level';
  show('screen-calibrate');
}

$('btn-calib').addEventListener('click', () => {
  if (calibStep === 'zero') {
    tilt.calibrateZero();
    const saved = loadSign();
    if (saved === 1 || saved === -1) {
      tilt.setSign(saved);
      enterPlay();
      return;
    }
    calibStep = 'right';
    $('calib-text').textContent = 'Now tilt the phone to the RIGHT and tap.';
    $('btn-calib').textContent = "I'm tilting right";
  } else if (tilt.calibrateRight()) {
    saveSign(tilt.sign);
    enterPlay();
  } else {
    $('calib-text').textContent = 'Tilt a bit further to the right, then tap.';
  }
});

function enterPlay() {
  show('screen-play');
  clearInterval(sender);
  sender = setInterval(() => {
    const v = tilt.value;
    net.send({ t: 'tilt', v });
    $('meter-needle').style.left = `${50 + 50 * v}%`;
  }, 33); // ~30 Hz is plenty and keeps Wi-Fi traffic tiny
}

// A button that is "on" while a finger is on it. Sends on every change, never twice in a row.
const releases = [];
function releaseAll() {
  for (const release of releases) release();
}
function holdButton(el, send) {
  let held = false;
  releases.push(() => set(false));
  function set(on) {
    if (held === on) return;
    held = on;
    el.classList.toggle('down', on);
    send(on);
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    set(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => set(false));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

holdButton($('btn-walk'), (on) => net?.send({ t: 'walk', on }));
holdButton($('btn-run'), (on) => net?.send({ t: 'run', on }));

const jumpBtn = $('btn-jump');
jumpBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jumpBtn.classList.add('down');
  navigator.vibrate?.(30); // Android only; harmless on iOS
  net?.send({ t: 'jump' });
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  jumpBtn.addEventListener(ev, () => jumpBtn.classList.remove('down'));
}
jumpBtn.addEventListener('contextmenu', (e) => e.preventDefault());
// The Wind Master's buttons: a tap sends a gust, left (-1) or right (+1). The TV refuses one during the cooldown.
for (const [id, dir] of [['btn-gust-left', -1], ['btn-gust-right', 1]]) {
  const btn = $(id);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.classList.add('down');
    navigator.vibrate?.(30);
    net?.send({ t: 'gust', dir });
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => btn.classList.remove('down'));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
// Lobby: pick solo, race or Wind Master. The TV only acts on it between rounds, and its next state says what it chose.
for (const btn of document.querySelectorAll('.mode')) {
  btn.addEventListener('click', () => net?.send({ t: 'mode', mode: btn.dataset.mode }));
}
$('btn-start').addEventListener('click', () => net?.send({ t: 'start' }));
$('btn-camera').addEventListener('click', () => net?.send({ t: 'camera' })); // the TV cycles chase → POV → cinematic
$('btn-pause').addEventListener('click', () => net?.send({ t: 'pause' })); // a toggle; the TV's state says which

// Music (the TV's ambience) and effects volume, 0..1, remembered on this phone.
const VOLUME_KEY = 'bridge.volume';
let volume = loadVolume();
function loadVolume() {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY));
    if (v && Number.isFinite(v.music) && Number.isFinite(v.sfx)) return v;
  } catch {}
  return { music: 1, sfx: 1 };
}
function sendVolume() {
  net?.send({ t: 'volume', music: volume.music, sfx: volume.sfx });
}
for (const [id, key] of [['vol-music', 'music'], ['vol-sfx', 'sfx']]) {
  $(id).value = String(Math.round(volume[key] * 100));
  $(id).addEventListener('input', (e) => {
    volume = { ...volume, [key]: Number(e.target.value) / 100 };
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
    } catch {}
    sendVolume();
  });
}
// The sheet floats over the top of the middle column, so on a short phone it can cover the Sound button: Done closes it.
function setSoundSheet(open) {
  $('sound-sheet').hidden = !open;
  $('btn-sound').setAttribute('aria-expanded', String(open));
  if (open) $('btn-sound-done').focus({ preventScroll: true });
}
$('btn-sound').addEventListener('click', () => setSoundSheet($('sound-sheet').hidden));
$('btn-sound-done').addEventListener('click', () => {
  setSoundSheet(false);
  $('btn-sound').focus({ preventScroll: true });
});
$('btn-recalibrate').addEventListener('click', () => {
  clearSign();
  startCalibration();
});
