import { BRIDGE_LENGTH, distanceToNextGap } from '../game/session.js';
import { FALL_ANGLE } from '../game/balance.js';
import { WIND_OFF, windIndicator } from './windFx.js';
import { formatPar, formatScore, underPar } from './results.js';

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const levelText = (level) => `Level ${level}`;
const distText = (metres) => `${metres} / ${BRIDGE_LENGTH} m`;
const livesText = (lives) => `❤ ${lives}`;
const scoreText = (runScore) => (Number.isFinite(runScore) ? `${formatScore(runScore)} pts` : '');

export function messageFor(s) {
  if (s.paused && s.phase === 'playing') return 'PAUSED — tap ▶ on your phone to resume';
  switch (s.phase) {
    case 'lobby':
      return 'Press START on your phone';
    case 'falling':
      return s.lives > 0 ? `You fell! ${s.lives} ${s.lives === 1 ? 'life' : 'lives'} left` : 'You fell!';
    case 'gameover':
      return 'GAME OVER — press START to try again';
    case 'won':
      return `You crossed! Press START for level ${s.level + 1}`;
    default:
      return '';
  }
}

const GAP_WARN_METRES = 4; // the banner shows from this far ahead of a gap
const GAP_BANNER = 'GAP AHEAD — JUMP!';

// The warning banner's text while a gap is close ahead of the walker, else ''.
export function gapHint(s) {
  if (s.phase !== 'playing' || !s.gaps) return '';
  const d = distanceToNextGap(s.gaps, s.walker.z);
  return d > 0 && d < GAP_WARN_METRES ? GAP_BANNER : '';
}

// The parts of the pairing panel that only make sense while a room exists.
const PAIRING_DETAILS = ['qr', 'pairing-hint', 'pairing-code', 'pairing-controls', 'phone-url'];

export const BANNER_MS = 3000; // "Level 2 — Misty Morning" when a level starts
export const TOAST_MS = 1500; // the camera view's name

// A line of text that shows for a while and then hides itself; showing it again restarts the clock.
function timedText(el, ms, timers) {
  let timer = null;
  return (text) => {
    el.textContent = text;
    el.hidden = false;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      el.hidden = true;
    }, ms);
  };
}

// The wind indicator's class list for a windIndicator() result: "wind warning from-left lvl-2".
export function windClass(ind) {
  return `wind ${ind.state} from-${ind.from} lvl-${ind.level}`;
}

export function createHud(doc = document, timers = globalThis) {
  const $ = (id) => doc.getElementById(id);
  let shownHint = ''; // the DOM is touched only when the hint changes; the pulse is a CSS animation
  let shownWind = WIND_OFF; // likewise the wind arrow: windIndicator() returns shared objects, so === says "unchanged"
  let underParShown = false;
  let banner = null; // created on first use, so a page without these elements still works
  let toast = null;
  const shown = {}; // id -> the text last written, so a frame that changes nothing writes nothing
  const setText = (id, text) => {
    if (shown[id] === text) return;
    shown[id] = text;
    $(id).textContent = text;
  };
  // Every frame calls render(), and building a string (a template, a regex replace) costs a weak TV's CPU. So the
  // raw value is compared to the last one first and the text is made only when it changed. `key` is a number or
  // a string (never a fresh object); a NaN key rebuilds each frame, which still writes nothing while the text is same.
  // `fmt` is a module-level function of the key, so the frame allocates no closure either.
  const keys = {}; // id -> the raw value the text was last made from
  const setFrom = (id, key, fmt) => {
    if (id in keys && keys[id] === key) return;
    keys[id] = key;
    setText(id, fmt(key));
  };
  return {
    showBanner(text) {
      banner ??= timedText($('level-banner'), BANNER_MS, timers);
      banner(text);
    },
    showToast(text) {
      toast ??= timedText($('cam-toast'), TOAST_MS, timers);
      toast(text);
    },
    showPairing(url, code) {
      if (url) {
        $('phone-url').textContent = url;
        $('room-code').textContent = code;
        $('pairing-status').hidden = true;
        for (const id of PAIRING_DETAILS) $(id).hidden = false;
      }
      $('pairing').hidden = false;
    },
    // The server went away: the old QR code is dead, so replace it with a status line until a new one arrives.
    showReconnecting() {
      $('pairing-status').textContent = 'Reconnecting…';
      $('pairing-status').hidden = false;
      for (const id of PAIRING_DETAILS) $(id).hidden = true;
      $('pairing').hidden = false;
    },
    hidePairing() {
      $('pairing').hidden = true;
    },
    // The end-of-level or end-of-run panel. v comes from resultView() (results.js); the stars animate in one by
    // one with CSS, which restarts each time the panel goes from hidden to shown.
    showResults(v) {
      if (!v) return;
      const level = v.kind === 'level';
      $('results').className = `results ${v.kind}`;
      $('res-title').textContent = v.title;
      $('res-next').textContent = v.next;
      if (level) {
        for (let i = 0; i < 3; i++) $(`res-star-${i}`).className = i < v.stars ? 'star on' : 'star';
        $('res-time').textContent = v.time;
        $('res-par').textContent = v.par;
        $('res-falls').textContent = v.falls;
        $('res-score').textContent = v.score;
        $('res-total').textContent = v.runScore;
        $('res-new').textContent = v.newLabel; // which record was beaten: score, time or both
        $('res-new').hidden = !v.isNew;
        $('res-best').textContent = v.bestLine;
      } else {
        $('run-level').textContent = v.level;
        $('run-score').textContent = v.runScore;
        $('run-best').textContent = `BEST RUN  ${v.bestRun} pts`;
        $('run-new').hidden = !v.isNew;
      }
      $('results').hidden = false;
    },
    hideResults() {
      $('results').hidden = true;
    },
    render(s) {
      const balance = Math.max(-1, Math.min(1, s.walker.lean / FALL_ANGLE));
      setFrom('timer', Math.floor(s.time), formatTime); // the text changes once a second
      const gold = underPar(s.time, s.parTime);
      if (gold !== underParShown) {
        underParShown = gold;
        $('timer').classList?.toggle('under-par', gold); // gold while under par, normal once over it
      }
      setFrom('par', s.parTime, formatPar);
      setFrom('level', s.level, levelText);
      setFrom('dist', Math.min(BRIDGE_LENGTH, Math.floor(s.walker.z)), distText);
      setFrom('lives', s.lives, livesText);
      setFrom('score', s.runScore, scoreText);
      $('balance-needle').style.left = `${50 + 50 * balance}%`;
      $('balance').classList.toggle('danger', Math.abs(balance) > 0.7);
      setText('message', s.result ? '' : messageFor(s)); // the results panel says it all
      const hint = gapHint(s);
      if (hint !== shownHint) {
        shownHint = hint;
        $('gap-hint').textContent = hint;
        $('gap-hint').hidden = !hint;
      }
      const wind = windIndicator(s.forecast);
      if (wind !== shownWind) {
        shownWind = wind;
        const el = $('wind');
        if (wind.visible) el.className = windClass(wind);
        el.hidden = !wind.visible;
      }
    },
  };
}
