import { BRIDGE_LENGTH, distanceToNextGap } from '../game/session.js';
import { FALL_ANGLE } from '../game/balance.js';
import { WIND_OFF, windIndicator } from './windFx.js';
import { formatPar, formatScore, underPar } from './results.js';
import { keepMovingOf } from './keepMoving.js';
import { GUST_RING_S, raceHudView, windmasterHudView, waitingOf, countdownText } from './matchHud.js';

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const levelText = (level) => `Level ${level}`;
const distText = (metres) => `${metres} / ${BRIDGE_LENGTH} m`;
const livesText = (lives) => `❤ ${lives}`;
const scoreText = (runScore) => (Number.isFinite(runScore) ? `${formatScore(runScore)} pts` : '');

// Paused shows its own panel (the scene dimmed behind a card), not a line of text across the soldier and the bridge.
export const pausedOf = (s) => !!s && !!s.paused && s.phase === 'playing';

export function messageFor(s) {
  if (pausedOf(s)) return '';
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

// The lobby's extras on the pairing panel: the player slots, the mode and what to do next.
const LOBBY_DETAILS = ['slots', 'mode-line', 'pick-hint'];

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
  // A warning that is shown or hidden as a flag changes; the pulse is a CSS animation.
  function syncKeepMoving(id, on) {
    if (shown[id] === on) return;
    shown[id] = on;
    $(id).hidden = !on;
  }
  // Each new number pops in: the animation restarts when the text changes.
  let shownCountdown = '';
  function syncCountdown(text) {
    if (text === shownCountdown) return;
    shownCountdown = text;
    const el = $('countdown');
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('go', text === 'GO!');
    el.classList.remove('pop');
    void el.offsetWidth; // restart the CSS animation
    if (text) el.classList.add('pop');
  }
  function syncPause(on) {
    syncKeepMoving('pause', on);
  }
  function syncWind(forecast) {
    const wind = windIndicator(forecast);
    if (wind !== shownWind) {
      shownWind = wind;
      const el = $('wind');
      if (wind.visible) el.className = windClass(wind);
      el.hidden = !wind.visible;
    }
  }
  const raceKeys = {}; // the numbers the race HUD was last written from
  const wmKeys = {};
  // The round or match panel of a two-player mode (matchResults.js): a winner line in the winner's colour, a two-column table
  // of the round (or the final), the tally and what to press.
  function showMatchResults(v) {
    $('results').className = `results mp ${v.variant}${v.over ? ' over' : ''}`;
    $('res-title').textContent = v.title;
    $('res-title').style.color = v.titleColor;
    setText('mp-sub', v.sub);
    v.rows.forEach((row, i) => {
      setText(`mp-l${i}`, row.label);
      setText(`mp-a${i}`, row.v1);
      setText(`mp-b${i}`, row.v2);
      $(`mp-a${i}`).className = row.win === 1 ? 'mp-cell mp-c1 win' : 'mp-cell mp-c1';
      $(`mp-b${i}`).className = row.win === 2 ? 'mp-cell mp-c2 win' : 'mp-cell mp-c2';
    });
    setText('mp-tally', v.tally);
    setText('mp-note', v.note);
    $('mp-note').hidden = !v.note;
    $('res-next').textContent = v.next;
    $('results').hidden = false;
  }
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
      for (const id of [...LOBBY_DETAILS, 'mode-warning']) $(id).hidden = true;
      $('pairing').hidden = false;
    },
    // The lobby's part of the pairing panel (matchHud.js lobbyView): both players' slots, the mode and what it needs, and
    // the hint. Written only when a string changes. Called every frame while the panel is up is fine.
    setLobby(v) {
      for (const slot of v.slots) {
        setText(`slot-${slot.player}`, slot.text);
        const el = $(`slot-${slot.player}`);
        if (shown[`slot-${slot.player}:on`] !== slot.connected) {
          shown[`slot-${slot.player}:on`] = slot.connected;
          el.className = slot.connected ? `slot on p${slot.player}` : `slot p${slot.player}`;
        }
      }
      setText('mode-label', v.modeLabel);
      setText('mode-blurb', v.blurb);
      setText('mode-warning', v.warning);
      setText('pick-hint', v.hint);
      $('mode-warning').hidden = !v.warning;
      for (const id of LOBBY_DETAILS) $(id).hidden = false;
    },
    // Which block of the HUD is drawn: solo's pills and balance bar, the race's two panels, or Wind Master's strip on top
    // of the pills (the walker still has a timer, lives and balance).
    setMode(mode) {
      if (shown.mode === mode) return;
      shown.mode = mode;
      $('hud').dataset.mode = mode;
      shownHint = ''; // solo's gap banner is not drawn in a race
      $('gap-hint').hidden = true;
      $('hud-race').hidden = mode !== 'race';
      $('hud-wm').hidden = mode !== 'windmaster';
    },
    // The pairing panel is up: the race and Wind Master blocks stay out from behind it.
    setPanelUp(up) {
      if (shown.panelUp === up) return;
      shown.panelUp = up;
      $('hud').dataset.panel = up ? 'up' : '';
    },
    // The race: both racers' metres, time and falls, the round line and the two dots on the track. The view is built only
    // when one of the numbers changed (twice a second at most), not every frame.
    renderRace(match) {
      const a = match.sessions[1];
      const b = match.sessions[2];
      const k = raceKeys;
      const d1 = Math.max(0, Math.floor(a.walker.z));
      const d2 = Math.max(0, Math.floor(b.walker.z));
      const t1 = Math.floor(match.elapsed);
      const t2 = t1; // one round clock for both lanes
      const dot1 = Math.round((Math.max(0, a.walker.z) * 200) / BRIDGE_LENGTH);
      const dot2 = Math.round((Math.max(0, b.walker.z) * 200) / BRIDGE_LENGTH);
      const tally = match.tally;
      const m1 = keepMovingOf(a);
      const m2 = keepMovingOf(b);
      const w1 = waitingOf(a);
      const w2 = waitingOf(b);
      if (m1 === k.m1 && m2 === k.m2 && w1 === k.wait1 && w2 === k.wait2 && d1 === k.d1 && d2 === k.d2 && t1 === k.t1 && t2 === k.t2 && dot1 === k.dot1 && dot2 === k.dot2 && a.levelFalls === k.f1 && b.levelFalls === k.f2 && match.round === k.round && tally[1] === k.w1 && tally[2] === k.w2) return;
      Object.assign(k, { m1, m2, wait1: w1, wait2: w2, d1, d2, t1, t2, dot1, dot2, f1: a.levelFalls, f2: b.levelFalls, round: match.round, w1: tally[1], w2: tally[2] });
      const v = raceHudView(match);
      for (const p of [1, 2]) {
        setText(`r${p}-dist`, v.players[p].dist);
        setText(`r${p}-time`, v.players[p].time);
        setText(`r${p}-falls`, v.players[p].falls);
        $(`track-${p}`).style.left = `${v.players[p].progress * 100}%`;
        $(`r${p}-keep`).hidden = !v.players[p].keepMoving;
        $(`r${p}-wait`).hidden = !v.players[p].waiting;
      }
      setText('race-round', v.roundLine);
    },
    // The race's pause panel and its 3-2-1-GO (the lobby and the results have their own panels).
    renderRaceMessage(match) {
      syncPause(pausedOf(match));
      syncCountdown(countdownText(match));
    },
    // Wind Master: the roles strip, the round line and the gust bar. `rounds` is the match's length.
    renderWindMaster(match, rounds) {
      const k = wmKeys;
      const walker = match.walkerOf();
      const fill = Math.round(Math.min(1, Math.max(0, match.gustReady ? 1 : 1 - match.gustIn / GUST_RING_S)) * 50);
      const scores = match.scores;
      const over = match.phase === 'roundOver' || match.phase === 'matchOver'; // the results panel speaks for the round
      if (over !== k.over) {
        k.over = over;
        $('hud-wm').hidden = over;
      }
      if (walker === k.walker && fill === k.fill && match.gustReady === k.ready && match.round === k.round && scores[1] === k.s1 && scores[2] === k.s2) return;
      Object.assign(k, { walker, fill, ready: match.gustReady, round: match.round, s1: scores[1], s2: scores[2] });
      const v = windmasterHudView(match, rounds);
      const el = $('hud-wm');
      el.style.setProperty('--walker', v.walkerColor);
      el.style.setProperty('--master', v.masterColor);
      $('hud').style.setProperty('--walker', v.walkerColor);
      setText('wm-walker', `P${v.walker} walking`);
      setText('wm-master', `P${v.windMaster} Wind Master`);
      setText('wm-round', v.roundLine);
      setText('wm-gust-label', v.gustLabel);
      $('wm-gust-fill').style.width = `${v.gustFill * 100}%`;
      $('wm-gust').classList.toggle('ready', v.gustReady);
    },
    hidePairing() {
      $('pairing').hidden = true;
    },
    // The end-of-level or end-of-run panel. v comes from resultView() (results.js); the stars animate in one by
    // one with CSS, which restarts each time the panel goes from hidden to shown.
    showResults(v) {
      if (!v) return;
      if (v.kind === 'mp') return showMatchResults(v);
      $('res-title').style.color = '';
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
      setFrom('dist', Math.min(BRIDGE_LENGTH, Math.max(0, Math.floor(s.walker.z))), distText); // z is negative on the ledge before the bridge
      setFrom('lives', s.lives, livesText);
      setFrom('score', s.runScore, scoreText);
      $('balance-needle').style.left = `${50 + 50 * balance}%`;
      $('balance').classList.toggle('danger', Math.abs(balance) > 0.7);
      setText('message', s.result ? '' : messageFor(s)); // the results panel says it all
      syncPause(pausedOf(s));
      const hint = gapHint(s);
      if (hint !== shownHint) {
        shownHint = hint;
        $('gap-hint').textContent = hint;
        $('gap-hint').hidden = !hint;
      }
      syncWind(s.forecast);
      syncKeepMoving('keep-moving', keepMovingOf(s));
    },
    // The wind arrow alone, for the race (whose HUD is not render()'s): the forecast of the session the wind follows.
    renderWind: (forecast) => syncWind(forecast),
  };
}
