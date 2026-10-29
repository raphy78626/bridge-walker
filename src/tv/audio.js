// Web Audio engine for the TV: one AudioContext, decoded buffers cached, a light compressor on the master
// output. No Three.js, no per-frame work (the ambience wobble is an LFO node, not JS). Sound files live in
// public/audio/ (see CREDITS.md). A missing or broken file is logged once and never throws into the game;
// the jump whoosh is synthesised, and the scream and the occasional calls fall back to a synthesised voice.
//
// Each level theme (themes.js) has its own ambience bed and its own occasional calls (THEME_SOUNDS below).
// setTheme(id) loads that theme's files on demand, crossfades the bed over THEME_CROSSFADE_S, and warms up
// the next theme in the background; buffers that neither the current nor the next theme needs are dropped.

import { THEMES } from './themes.js';
import { WIND_WARNING_S } from '../game/forecast.js';

export const AUDIO_FILES = {
  ambienceWater: 'ambience_water.ogg',
  ambienceWind: 'ambience_wind.ogg',
  ambienceBirds: 'ambience_birds.ogg',
  ambienceStream: 'ambience_stream.ogg',
  ambienceCicadas: 'ambience_cicadas.ogg',
  ambienceCrickets: 'ambience_crickets.ogg',
  steps: ['step_1.ogg', 'step_2.ogg', 'step_3.ogg', 'step_4.ogg'],
  lands: ['land_1.ogg', 'land_2.ogg'],
  creak: 'creak.ogg',
  scream: 'scream.ogg',
  eagles: ['eagle_1.ogg', 'eagle_2.ogg'],
  birds: ['bird_1.ogg', 'bird_2.ogg', 'bird_3.ogg', 'bird_4.ogg'],
  owls: ['owl_1.ogg', 'owl_2.ogg'],
};

// What preload() fetches up front: the first theme's bed, the footsteps and the other one-shots. The other
// themes' files come with setTheme().
export const ALL_AUDIO_FILES = [
  AUDIO_FILES.ambienceWater,
  AUDIO_FILES.ambienceWind,
  ...AUDIO_FILES.steps,
  ...AUDIO_FILES.lands,
  AUDIO_FILES.creak,
  AUDIO_FILES.scream,
  ...AUDIO_FILES.eagles,
];

export const DEFAULT_THEME = 'golden';
export const THEME_CROSSFADE_S = 3;

// The sound of each theme, keyed by theme id.
//  layers: looped ambience files, mixed relative to each other. { file, gain, highpass?, lowpass?, gust? }.
//          `gust` is the depth of a slow gain LFO (wind swelling); `lowpass`/`highpass` are in Hz and make a
//          layer duller (further away) or thinner.
//  calls:  the occasional one-shots the scheduler plays. { kind, files, gain, lowpass, send, rateJitter }.
//          `kind` picks the synthesised stand-in if no file loaded: 'hawk' | 'bird' | 'owl'.
// The layer gains are tuned so every theme's bed has the same loudness (about -23 LUFS before the
// AMBIENCE_LEVEL bus, the level of the original waterfall + wind): no theme jumps out when the level changes.
export const THEME_SOUNDS = {
  // A golden afternoon: waterfall and wind, a hawk now and then.
  golden: {
    layers: [
      { file: AUDIO_FILES.ambienceWater, gain: 0.5 },
      { file: AUDIO_FILES.ambienceWind, gain: 0.55, gust: 0.2 },
    ],
    calls: { kind: 'hawk', files: AUDIO_FILES.eagles, gain: 0.3, lowpass: 3800, send: 0.55, rateJitter: 0.04 },
  },
  // A misty morning: songbirds in the trees, a trickling stream, hardly any wind, a lone bird now and then.
  morning: {
    layers: [
      { file: AUDIO_FILES.ambienceBirds, gain: 0.58 },
      { file: AUDIO_FILES.ambienceStream, gain: 0.53 },
      { file: AUDIO_FILES.ambienceWind, gain: 0.32, lowpass: 700, gust: 0.1 },
    ],
    calls: { kind: 'bird', files: AUDIO_FILES.birds, gain: 0.28, lowpass: 6500, send: 0.35, rateJitter: 0.06 },
  },
  // Sunset: cicadas, a warm soft breeze, the waterfall far away, a far-off eagle.
  sunset: {
    layers: [
      { file: AUDIO_FILES.ambienceCicadas, gain: 0.4 },
      { file: AUDIO_FILES.ambienceWind, gain: 0.6, lowpass: 900, gust: 0.2 },
      { file: AUDIO_FILES.ambienceWater, gain: 0.4, lowpass: 1500 },
    ],
    calls: { kind: 'hawk', files: AUDIO_FILES.eagles, gain: 0.18, lowpass: 2600, send: 0.75, rateJitter: 0.04 },
  },
  // Night: crickets, a soft night wind, an owl far off.
  night: {
    layers: [
      { file: AUDIO_FILES.ambienceCrickets, gain: 0.58 },
      { file: AUDIO_FILES.ambienceWind, gain: 0.8, lowpass: 380, gust: 0.25 },
    ],
    calls: { kind: 'owl', files: AUDIO_FILES.owls, gain: 0.32, lowpass: 2200, send: 0.7, rateJitter: 0.03 },
  },
};

const soundKey = (id) => (THEME_SOUNDS[id] ? id : DEFAULT_THEME);
const themeFiles = (key) => {
  const s = THEME_SOUNDS[key];
  return [...new Set([...s.layers.map((l) => l.file), ...s.calls.files])];
};
// The theme that follows `key` in the level cycle (only themes that have sounds).
function nextThemeKey(key) {
  const ids = THEMES.map((t) => t.id).filter((id) => THEME_SOUNDS[id]);
  const at = ids.indexOf(key);
  return at < 0 ? DEFAULT_THEME : ids[(at + 1) % ids.length];
}
// Files that stay decoded for the whole session: the one-shots and the raptor cries (tiny). Everything
// else (the ambience beds and the other calls) is dropped when no theme in reach uses it.
const RESIDENT = new Set(ALL_AUDIO_FILES.filter((f) => f !== AUDIO_FILES.ambienceWater && f !== AUDIO_FILES.ambienceWind));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Waterfall and wind sit quietly under the action: the player found 1.0 too loud on the TV (~-10 dB now).
export const AMBIENCE_LEVEL = 0.3;
export const GUST_LEVEL = 0.3; // peak gain of a full-strength gust's whoosh: about twice the ambience bed, then gone
const withSlash = (base) => (base ? (base.endsWith('/') ? base : base + '/') : '/');

export function createAudio({
  baseUrl = import.meta.env.BASE_URL,
  random = Math.random,
  // Injectable for tests; in the browser these are the real thing.
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  fetchFn = globalThis.fetch && globalThis.fetch.bind(globalThis),
} = {}) {
  const base = withSlash(baseUrl);
  const buffers = new Map(); // file name -> AudioBuffer
  const settled = new Set(); // files whose load has finished, successfully or not
  const pending = new Map(); // file name -> the load promise (kept after a failure, so a missing file is tried once)
  const warned = new Set();
  const lastPick = {};

  let ctx = null;
  let unavailable = false;
  let master = null;
  let sfx = null;
  let ambBus = null;
  let echoIn = null;
  let noise = null;
  let volume = 0.85;
  let musicVolume = 1; // the ambience bed; set from the phone's settings sheet
  let sfxVolume = 1; // footsteps, jumps, gusts, the scream
  let loading = null;
  let wantAmbience = false;
  let amb = null; // the bed that is playing (or fading in): { theme, bus, sources, lfos }
  let theme = DEFAULT_THEME;
  let lastCreak = -Infinity;

  function warnOnce(key, message, err) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[audio] ${message}`, err && err.message ? err.message : err || '');
  }

  // Wrap a public method so a Web Audio hiccup can never reach the game loop.
  const safe = (name, fn, fallback) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      warnOnce(name, `${name} failed`, err);
      return fallback;
    }
  };

  function ensureContext() {
    if (ctx || unavailable) return ctx;
    if (!AudioContextClass) {
      unavailable = true;
      warnOnce('ctx', 'Web Audio is not available; the game will run silent');
      return null;
    }
    try {
      ctx = new AudioContextClass();
    } catch (err) {
      unavailable = true;
      warnOnce('ctx', 'could not create the AudioContext; the game will run silent', err);
      return null;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp);

    sfx = ctx.createGain();
    sfx.gain.value = sfxVolume;
    sfx.connect(master);
    ambBus = ctx.createGain();
    ambBus.gain.value = musicVolume;
    ambBus.connect(master);

    // A shared canyon echo for far-away sounds (eagle, the scream): delay with a darkening feedback loop.
    echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.34;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 2400;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    echoIn.connect(delay);
    delay.connect(dark);
    dark.connect(feedback);
    feedback.connect(delay);
    dark.connect(wet);
    wet.connect(master);

    ctx.onstatechange = () => {
      if (ctx.state === 'running') applyTheme();
    };
    return ctx;
  }

  const running = () => !!ctx && ctx.state === 'running';

  const decode = (data) =>
    new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject); // callback form works on old and new engines
      if (p && p.catch) p.catch(reject);
    });

  function loadOne(file) {
    if (buffers.has(file)) return Promise.resolve();
    if (pending.has(file)) return pending.get(file);
    const p = fetchOne(file).then(() => {
      settled.add(file);
    });
    pending.set(file, p);
    return p;
  }

  function fetchOne(file) {
    const url = base + 'audio/' + file;
    if (!fetchFn) {
      warnOnce(file, `fetch is not available, cannot load ${url}`);
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(() => fetchFn(url))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then(decode)
      .then((buf) => {
        buffers.set(file, buf);
      })
      .catch((err) => warnOnce(file, `could not load ${url}`, err));
  }

  // Fetch and decode every file once. Safe to call repeatedly; resolves (never rejects) with what worked.
  function preload() {
    if (loading) return loading;
    if (!ensureContext()) {
      loading = Promise.resolve({ loaded: [], failed: ALL_AUDIO_FILES.slice() });
      return loading;
    }
    loading = Promise.all(ALL_AUDIO_FILES.map(loadOne)).then(() => {
      applyTheme();
      return {
        loaded: ALL_AUDIO_FILES.filter((f) => buffers.has(f)),
        failed: ALL_AUDIO_FILES.filter((f) => !buffers.has(f)),
      };
    });
    return loading;
  }

  // Resume the context (browsers need a gesture; TV apps usually don't). Safe to call every time.
  function unlock() {
    if (!ensureContext()) return Promise.resolve(false);
    preload();
    if (ctx.state === 'running') return Promise.resolve(true);
    return Promise.resolve(ctx.resume())
      .then(() => ctx.state === 'running')
      .catch((err) => {
        warnOnce('resume', 'could not resume the AudioContext', err);
        return false;
      });
  }

  // ---------- helpers ----------

  // Pick a loaded file from the list, never the same one twice in a row.
  function pick(list, key) {
    const have = list.filter((f) => buffers.has(f));
    if (!have.length) return null;
    if (have.length === 1) return have[0];
    let i = Math.floor(random() * have.length);
    if (have[i] === lastPick[key]) i = (i + 1 + Math.floor(random() * (have.length - 1))) % have.length;
    lastPick[key] = have[i];
    return have[i];
  }

  const jitter = (amount) => 1 + (random() * 2 - 1) * amount;

  function noiseBuffer() {
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  // One-shot sample voice: source -> [lowpass] -> gain -> [pan] -> bus, with an optional echo send.
  function play(file, o = {}) {
    const buf = buffers.get(file);
    if (!buf || !running()) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.value = o.rate;
    let node = src;
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      node.connect(lp);
      node = lp;
    }
    const gain = ctx.createGain();
    gain.gain.value = o.gain === undefined ? 1 : o.gain;
    node.connect(gain);
    node = gain;
    if (o.pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(o.pan, -1, 1);
      node.connect(panner);
      node = panner;
    }
    node.connect(o.dest || sfx);
    if (o.send) {
      const send = ctx.createGain();
      send.gain.value = o.send;
      node.connect(send);
      send.connect(echoIn);
    }
    src.start(o.when || 0);
    return { src, gain };
  }

  // ---------- ambience ----------

  // One theme's bed: its loaded layers looping on a shared bus that fades in over `fadeIn` seconds.
  function buildBed(key, layers, fadeIn) {
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, t);
    bus.gain.linearRampToValueAtTime(AMBIENCE_LEVEL, t + fadeIn);
    bus.connect(ambBus);
    const sources = [];
    const lfos = [];
    for (const layer of layers) {
      const buf = buffers.get(layer.file);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      let node = src;
      for (const [type, hz] of [['highpass', layer.highpass], ['lowpass', layer.lowpass]]) {
        if (!hz) continue;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = hz;
        node.connect(f);
        node = f;
      }
      const g = ctx.createGain();
      g.gain.value = layer.gain;
      node.connect(g);
      g.connect(bus);
      src.start(0, random() * buf.duration); // a different loop point each session; the loops are seamless
      sources.push(src);
      if (layer.gust) {
        // Slow swelling: an LFO on the gain, so it costs nothing in JS.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.06;
        const depth = ctx.createGain();
        depth.gain.value = layer.gust;
        lfo.connect(depth);
        depth.connect(g.gain);
        lfo.start(t);
        lfos.push(lfo);
      }
    }
    return { theme: key, bus, sources, lfos };
  }

  function fadeOutBed(bed, seconds) {
    const t = ctx.currentTime;
    bed.bus.gain.cancelScheduledValues(t);
    bed.bus.gain.setValueAtTime(bed.bus.gain.value, t);
    bed.bus.gain.linearRampToValueAtTime(0, t + seconds);
    for (const s of bed.sources) s.stop(t + seconds + 0.05);
    for (const l of bed.lfos) l.stop(t + seconds + 0.05);
  }

  // Make the bed match the current theme: the first one fades in, a change crossfades. If none of the new
  // theme's files loaded (still downloading, or missing) the old bed keeps playing rather than leaving silence.
  function applyTheme() {
    if (!wantAmbience || !running()) return;
    if (amb && amb.theme === theme) return;
    // Wait until every layer has either loaded or failed, so the bed is never built from half the files.
    const all = THEME_SOUNDS[theme].layers;
    if (!all.every((l) => buffers.has(l.file) || settled.has(l.file))) return;
    const layers = all.filter((l) => buffers.has(l.file));
    if (!layers.length) return;
    const fade = amb ? THEME_CROSSFADE_S : 2.5;
    const next = buildBed(theme, layers, fade);
    if (amb) fadeOutBed(amb, fade);
    amb = next;
  }

  function loadTheme(key) {
    return Promise.all(themeFiles(key).map(loadOne)).then(() => {
      if (theme === key) applyTheme();
    });
  }

  // Warm up the theme after `key`, one file at a time so the weak CPU is never hit by several decodes at once.
  function preloadNext(key) {
    const next = nextThemeKey(key);
    return themeFiles(next).reduce(
      (p, file) => p.then(() => (theme === key ? loadOne(file) : undefined)),
      Promise.resolve()
    );
  }

  function startAmbience() {
    wantAmbience = true;
    ensureContext();
    preload();
    loadTheme(theme);
    applyTheme();
  }

  function stopAmbience() {
    wantAmbience = false;
    if (!amb) return;
    const bed = amb;
    amb = null;
    fadeOutBed(bed, 1);
  }

  // Switch the level's soundscape. An unknown id gets the default theme's sound. Safe to call before the
  // ambience has started (the theme is used when it does) and while another crossfade is running.
  function setTheme(id) {
    const key = soundKey(id);
    if (key !== id) warnOnce('theme:' + id, `no sounds for theme "${id}", using "${DEFAULT_THEME}"`);
    theme = key;
    if (!ensureContext()) return;
    // Drop what neither this theme nor the next one needs (a playing bed keeps its own buffers alive).
    const keep = new Set([...themeFiles(key), ...themeFiles(nextThemeKey(key))]);
    for (const file of [...buffers.keys()]) {
      if (!keep.has(file) && !RESIDENT.has(file)) {
        buffers.delete(file);
        pending.delete(file);
        settled.delete(file);
      }
    }
    loadTheme(key).then(() => preloadNext(key));
    applyTheme();
  }

  // ---------- one-shots ----------

  function creak(level) {
    const file = AUDIO_FILES.creak;
    play(file, { gain: level, rate: jitter(0.1), when: ctx.currentTime + 0.03 });
    lastCreak = ctx.currentTime;
  }

  // speed in m/s: walking is ~1.4, running ~2.8. Louder the faster you go.
  function footstep(speed) {
    ensureContext();
    if (!running()) return;
    const file = pick(AUDIO_FILES.steps, 'step');
    if (!file) return;
    const s = clamp(Number(speed) || 0, 0, 3.5);
    const level = 0.35 + 0.65 * clamp((s - 0.5) / 2.5, 0, 1);
    play(file, { gain: level * 0.9 * jitter(0.08), rate: jitter(0.06) });
    // Now and then the planks complain.
    if (ctx.currentTime - lastCreak > 7 && random() < 0.07) creak(0.45 * level);
  }

  // Filtered noise swept upwards: the air rushing past on take-off.
  function whoosh(level) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.22);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(bp);
    bp.connect(g);
    g.connect(sfx);
    src.start(t, random() * 0.5);
    src.stop(t + 0.5);
  }

  // A gust of wind, about 3 s: band-passed noise that swells through the warning, peaks as the gust arrives and dies
  // away. Moderate on purpose (the ambience was too loud once). o = { dir, strength }: dir +1 blows toward screen
  // right, so the sound starts at the left (where the wind comes from) and drifts across the way it blows.
  function gust(o = {}) {
    ensureContext();
    if (!running()) return;
    const dir = o.dir > 0 ? 1 : o.dir < 0 ? -1 : 0;
    const strength = clamp(Number.isFinite(o.strength) ? o.strength : 0.6, 0, 1);
    const peak = GUST_LEVEL * (0.55 + 0.45 * strength);
    const t = ctx.currentTime;
    const arrive = WIND_WARNING_S; // the gust itself arrives this long after the warning starts
    const end = arrive + 1.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true; // the buffer is 1.5 s
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(820, t + arrive);
    bp.frequency.exponentialRampToValueAtTime(380, t + end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak * 0.3, t + arrive * 0.5);
    g.gain.linearRampToValueAtTime(peak, t + arrive);
    g.gain.exponentialRampToValueAtTime(0.001, t + end);
    src.connect(bp);
    bp.connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(-dir * 0.75, t);
      p.pan.linearRampToValueAtTime(dir * 0.35, t + end);
      g.connect(p);
      out = p;
    }
    out.connect(sfx);
    src.start(t, random() * 0.5);
    src.stop(t + end + 0.05);
  }

  function jump() {
    ensureContext();
    if (!running()) return;
    const file = pick(AUDIO_FILES.steps, 'step');
    if (file) play(file, { gain: 0.75, rate: 0.8 }); // the push-off against the plank
    whoosh(0.28);
  }

  function land() {
    ensureContext();
    if (!running()) return;
    const file = pick(AUDIO_FILES.lands, 'land');
    if (file) play(file, { gain: 1, rate: jitter(0.05) });
  }

  // A vowel-ish voice: sawtooth through three formant filters, vibrato, breath noise, falling pitch.
  function synthScream(dest) {
    const t = ctx.currentTime;
    const dur = 2.1;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.linearRampToValueAtTime(640, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(200, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = 14;
    vib.connect(vibDepth);
    vibDepth.connect(osc.frequency);
    const mix = ctx.createGain();
    mix.gain.setValueAtTime(0, t);
    mix.gain.linearRampToValueAtTime(0.9, t + 0.05);
    mix.gain.setValueAtTime(0.7, t + dur * 0.55);
    mix.gain.linearRampToValueAtTime(0, t + dur);
    [[900, 500, 5], [1500, 1100, 7], [2700, 2400, 9]].forEach(([from, to, q], i) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(from, t);
      f.frequency.linearRampToValueAtTime(to, t + dur);
      const fg = ctx.createGain();
      fg.gain.value = [1, 0.7, 0.4][i];
      osc.connect(f);
      f.connect(fg);
      fg.connect(mix);
    });
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer();
    breath.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const bg = ctx.createGain();
    bg.gain.value = 0.1;
    breath.connect(hp);
    hp.connect(bg);
    bg.connect(mix);
    mix.connect(dest);
    osc.start(t);
    vib.start(t);
    breath.start(t);
    for (const n of [osc, vib, breath]) n.stop(t + dur + 0.05);
  }

  // A man yelling as he drops: pitch sliding down, the voice darkening with distance, echoing off the walls.
  function fallScream() {
    ensureContext();
    if (!running()) return;
    const t = ctx.currentTime;
    const buf = buffers.get(AUDIO_FILES.scream);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 2.2);
    const out = ctx.createGain();
    out.gain.value = 0.9;
    lp.connect(out);
    out.connect(sfx);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    out.connect(send);
    send.connect(echoIn);
    if (!buf) {
      synthScream(lp);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(1, t);
    src.playbackRate.linearRampToValueAtTime(0.8, t + 2);
    src.connect(lp);
    src.start(t);
  }

  // A thin, rising-then-falling "kee-yeeer", twice. Used only if the recordings failed to load.
  function synthEagle(o) {
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    lp.connect(out);
    let node = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      out.connect(p);
      node = p;
    }
    node.connect(sfx);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    node.connect(send);
    send.connect(echoIn);
    [0, 0.62].forEach((offset) => {
      const s = t + offset;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2600, s);
      osc.frequency.linearRampToValueAtTime(3500, s + 0.12);
      osc.frequency.exponentialRampToValueAtTime(1700, s + 0.55);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 4;
      bp.frequency.value = 2900;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, s);
      env.gain.linearRampToValueAtTime(1, s + 0.06);
      env.gain.exponentialRampToValueAtTime(0.001, s + 0.58);
      osc.connect(bp);
      bp.connect(env);
      env.connect(lp);
      osc.start(s);
      osc.stop(s + 0.6);
    });
  }

  // A distant raptor. o.pan is -1..1 (a StereoPannerNode), o.variant picks a recording by index.
  function eagle(o = {}) {
    ensureContext();
    if (!running()) return;
    const pan = typeof o.pan === 'number' ? o.pan : (random() * 2 - 1) * 0.6;
    const list = AUDIO_FILES.eagles;
    const file =
      typeof o.variant === 'number' && buffers.has(list[o.variant % list.length])
        ? list[o.variant % list.length]
        : pick(list, 'eagle');
    if (!file) {
      synthEagle({ pan });
      return;
    }
    play(file, { gain: 0.3 * jitter(0.15), rate: jitter(0.04), lowpass: 3800, pan, send: 0.55 });
  }

  // Output chain for a synthesised call: gain -> [pan] -> sfx, with an echo send.
  function callOutput(pan, level, send) {
    const out = ctx.createGain();
    out.gain.value = level;
    let node = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p);
      node = p;
    }
    node.connect(sfx);
    const sg = ctx.createGain();
    sg.gain.value = send;
    node.connect(sg);
    sg.connect(echoIn);
    return out;
  }

  // Stand-in for a songbird: three short rising chirps.
  function synthBird(pan) {
    const t = ctx.currentTime;
    const out = callOutput(pan, 0.1, 0.35);
    [0, 0.17, 0.34].forEach((offset, i) => {
      const s = t + offset;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(3000 + i * 300, s);
      osc.frequency.exponentialRampToValueAtTime(4300 + i * 300, s + 0.1);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, s);
      env.gain.linearRampToValueAtTime(1, s + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
      osc.connect(env);
      env.connect(out);
      osc.start(s);
      osc.stop(s + 0.14);
    });
  }

  // Stand-in for an owl: a soft low "hoo, hoo-hoo".
  function synthOwl(pan) {
    const t = ctx.currentTime;
    const out = callOutput(pan, 0.2, 0.7);
    [[0, 0.5], [0.8, 0.28], [1.15, 0.45]].forEach(([offset, len]) => {
      const s = t + offset;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(400, s);
      osc.frequency.linearRampToValueAtTime(340, s + len);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, s);
      env.gain.linearRampToValueAtTime(1, s + 0.1);
      env.gain.linearRampToValueAtTime(0, s + len);
      osc.connect(env);
      env.connect(out);
      osc.start(s);
      osc.stop(s + len + 0.02);
    });
  }

  // The current theme's occasional call: a hawk, a songbird, an eagle or an owl, far off. o.pan is -1..1.
  function ambientCall(o = {}) {
    ensureContext();
    if (!running()) return;
    const call = THEME_SOUNDS[theme].calls;
    const pan = typeof o.pan === 'number' ? o.pan : (random() * 2 - 1) * 0.6;
    const file = pick(call.files, 'call:' + theme);
    if (!file) {
      if (call.kind === 'owl') synthOwl(pan);
      else if (call.kind === 'bird') synthBird(pan);
      else synthEagle({ pan });
      return;
    }
    play(file, {
      gain: call.gain * jitter(0.15),
      rate: jitter(call.rateJitter),
      lowpass: call.lowpass,
      pan,
      send: call.send,
    });
  }

  function setMasterVolume(v) {
    volume = clamp(Number.isFinite(v) ? v : 0.85, 0, 1);
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
  }

  // The phone's settings sheet: music (the ambience bed) and sound effects, each 0..1. Safe before unlock().
  function setVolumes({ music, sfx: effects }) {
    musicVolume = clamp(Number.isFinite(music) ? music : musicVolume, 0, 1);
    sfxVolume = clamp(Number.isFinite(effects) ? effects : sfxVolume, 0, 1);
    if (ambBus) ambBus.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.05);
    if (sfx) sfx.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.05);
  }

  // Diagnostics: context state and each decoded file's duration in seconds.
  function info() {
    const durations = {};
    for (const [file, buf] of buffers) durations[file] = buf.duration;
    return { state: ctx ? ctx.state : unavailable ? 'unavailable' : 'idle', theme, buffers: durations };
  }

  return {
    unlock: safe('unlock', unlock, Promise.resolve(false)),
    preload: safe('preload', preload, Promise.resolve({ loaded: [], failed: ALL_AUDIO_FILES.slice() })),
    startAmbience: safe('startAmbience', startAmbience),
    stopAmbience: safe('stopAmbience', stopAmbience),
    footstep: safe('footstep', footstep),
    jump: safe('jump', jump),
    land: safe('land', land),
    fallScream: safe('fallScream', fallScream),
    gust: safe('gust', gust),
    eagle: safe('eagle', eagle),
    ambientCall: safe('ambientCall', ambientCall),
    setTheme: safe('setTheme', setTheme),
    getTheme: () => theme,
    setMasterVolume: safe('setMasterVolume', setMasterVolume),
    setVolumes: safe('setVolumes', setVolumes),
    info,
  };
}

// One far-off call at random, a little off-centre. Call tick(now) once per frame with a millisecond clock
// (the requestAnimationFrame timestamp, performance.now() or Date.now()). It only does work when a call is
// due, so it costs nothing on the other frames. Returns true on the frame a call plays.
function createCallScheduler({ play, random, minMs, maxMs }) {
  let next = null;
  const gap = () => minMs + random() * (maxMs - minMs);
  return {
    tick(now) {
      if (next === null) {
        next = now + gap();
        return false;
      }
      if (now < next) return false;
      next = now + gap();
      play({ pan: (random() * 2 - 1) * 0.6 });
      return true;
    },
    reset() {
      next = null;
    },
  };
}

// Plays the current theme's occasional call (hawk, songbird, eagle or owl; see THEME_SOUNDS) every 12-40 s.
// The audio engine decides which call, so the scheduler never needs to know the theme.
export function createAmbientCallScheduler({ audio, random = Math.random, minMs = 12000, maxMs = 40000 }) {
  return createCallScheduler({ play: (o) => audio.ambientCall(o), random, minMs, maxMs });
}

// The original name, kept so existing callers and tests work: the same scheduler with the original 15-40 s gap.
// Against the real engine it plays the theme's call; an audio object without ambientCall gets audio.eagle().
export function createEagleScheduler({ audio, random = Math.random, minMs = 15000, maxMs = 40000 }) {
  return createCallScheduler({
    play: (o) => (audio.ambientCall ? audio.ambientCall(o) : audio.eagle(o)),
    random,
    minMs,
    maxMs,
  });
}
