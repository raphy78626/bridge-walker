import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createAudio,
  createEagleScheduler,
  createAmbientCallScheduler,
  ALL_AUDIO_FILES,
  AUDIO_FILES,
  THEME_SOUNDS,
  THEME_CROSSFADE_S,
  AMBIENCE_LEVEL,
  GUST_LEVEL,
} from '../src/tv/audio.js';
import { THEMES } from '../src/tv/themes.js';

// A just-enough fake of the Web Audio API: records what gets created and started.
function fakeWebAudio({ state = 'running' } = {}) {
  const log = { gains: [], sources: [], oscillators: 0, stopped: 0, suspends: 0, resumes: 0 };
  const param = () => ({
    value: 0,
    target: undefined,
    ramps: [], // [value, time] of every linear ramp
    setValueAtTime() {},
    linearRampToValueAtTime(v, t) {
      this.ramps.push([v, t]);
    },
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
    setTargetAtTime(v) {
      this.target = v;
    },
  });
  const node = (extra = {}) => ({
    connect: (n) => n,
    gain: param(),
    frequency: param(),
    Q: param(),
    pan: param(),
    delayTime: param(),
    threshold: param(),
    knee: param(),
    ratio: param(),
    attack: param(),
    release: param(),
    ...extra,
  });
  class FakeContext {
    constructor() {
      this.state = state;
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    createDynamicsCompressor() {
      return node();
    }
    createGain() {
      const g = node();
      log.gains.push(g);
      return g;
    }
    createBiquadFilter() {
      return node();
    }
    createDelay() {
      return node();
    }
    createStereoPanner() {
      return node();
    }
    createOscillator() {
      log.oscillators++;
      return node({ start() {}, stop() { log.stopped++; } });
    }
    createBuffer(ch, len, rate) {
      return { duration: len / rate, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      const s = node({
        playbackRate: param(),
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
          log.stopped++;
        },
      });
      log.sources.push(s);
      return s;
    }
    decodeAudioData(data, ok) {
      const buf = { duration: 1.5, id: Math.random(), file: data && data.file };
      if (ok) ok(buf);
      return Promise.resolve(buf);
    }
    resume() {
      log.resumes++;
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      log.suspends++;
      this.state = 'suspended';
      return Promise.resolve();
    }
  }
  return { FakeContext, log };
}

const okFetch = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

function setup(over = {}, ctxOpts) {
  const { FakeContext, log } = fakeWebAudio(ctxOpts);
  const audio = createAudio({
    baseUrl: '/',
    AudioContextClass: FakeContext,
    fetchFn: okFetch(),
    ...over,
  });
  return { audio, log };
}

afterEach(() => vi.restoreAllMocks());

describe('createAudio without Web Audio', () => {
  it('never throws and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = createAudio({ baseUrl: '/', AudioContextClass: undefined, fetchFn: undefined });
    expect(await audio.unlock()).toBe(false);
    audio.startAmbience();
    audio.stopAmbience();
    audio.footstep(1.4);
    audio.jump();
    audio.land();
    audio.fallScream();
    audio.gust({ dir: 1, strength: 1 });
    audio.eagle();
    audio.setMasterVolume(0.5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await audio.preload()).toEqual({ loaded: [], failed: ALL_AUDIO_FILES });
  });
});

describe('loading', () => {
  it('fetches and decodes every file from baseUrl/audio/', async () => {
    const fetchFn = okFetch();
    const { audio } = setup({ baseUrl: '/game/', fetchFn });
    const result = await audio.preload();
    expect(result.failed).toEqual([]);
    expect(result.loaded.length).toBe(ALL_AUDIO_FILES.length);
    expect(fetchFn).toHaveBeenCalledWith('/game/audio/step_1.ogg');
    expect(Object.keys(audio.info().buffers).length).toBe(ALL_AUDIO_FILES.length);
  });

  it('accepts a base without a trailing slash and fetches each file once', async () => {
    const fetchFn = okFetch();
    const { audio } = setup({ baseUrl: './app', fetchFn });
    await audio.preload();
    await audio.preload();
    await audio.unlock();
    expect(fetchFn).toHaveBeenCalledWith('./app/audio/scream.ogg');
    expect(fetchFn).toHaveBeenCalledTimes(ALL_AUDIO_FILES.length);
  });

  it('logs each failed file once and keeps the game running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn(async (url) => {
      if (url.endsWith('step_2.ogg')) return { ok: false, status: 404 };
      if (url.endsWith('land_1.ogg')) throw new Error('network down');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    const { audio } = setup({ fetchFn });
    const result = await audio.preload();
    expect(result.failed.sort()).toEqual(['land_1.ogg', 'step_2.ogg']);
    await audio.unlock();
    await audio.unlock();
    for (let i = 0; i < 20; i++) {
      audio.footstep(1.4);
      audio.land();
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('plays synthesised stand-ins for the scream and the eagle when every file is missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const { audio, log } = setup({ fetchFn });
    await audio.unlock();
    expect(() => {
      audio.startAmbience();
      audio.footstep(2.8);
      audio.jump();
      audio.land();
      audio.fallScream();
      audio.eagle({ pan: 0.4 });
    }).not.toThrow();
    expect(log.oscillators).toBe(4); // scream voice + vibrato, two eagle notes
  });

  it('survives a decoder that rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    class BadDecode extends fakeWebAudio().FakeContext {
      decodeAudioData(data, ok, bad) {
        if (bad) bad(new Error('EncodingError'));
        return Promise.reject(new Error('EncodingError'));
      }
    }
    const audio = createAudio({ baseUrl: '/', AudioContextClass: BadDecode, fetchFn: okFetch() });
    const result = await audio.preload();
    expect(result.loaded).toEqual([]);
    expect(() => audio.footstep(1)).not.toThrow();
  });
});

describe('one-shots', () => {
  it('footsteps get louder with speed and always stay within +-6% pitch', async () => {
    const { audio, log } = setup({ random: () => 0.5 });
    await audio.unlock();
    await audio.preload();
    const gains = [];
    for (const speed of [0, 1.4, 2.8, 3.5]) {
      log.sources.length = 0;
      audio.footstep(speed);
      expect(log.sources.length).toBe(1);
      gains.push(log.gains[log.gains.length - 1].gain.value);
    }
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeGreaterThan(gains[i - 1]);

    const rates = new Set();
    const { audio: a2, log: l2 } = setup();
    await a2.unlock();
    await a2.preload();
    for (let i = 0; i < 300; i++) {
      l2.sources.length = 0;
      a2.footstep(1.4);
      const rate = l2.sources[0].playbackRate.value;
      expect(rate).toBeGreaterThanOrEqual(0.94);
      expect(rate).toBeLessThanOrEqual(1.06);
      rates.add(rate);
    }
    expect(rates.size).toBeGreaterThan(50);
  });

  it('never repeats the same footstep sample twice in a row', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    await audio.preload();
    let prev = null;
    const used = new Set();
    for (let i = 0; i < 200; i++) {
      log.sources.length = 0;
      audio.footstep(1.4);
      const buf = log.sources[0].buffer;
      expect(buf).not.toBe(prev);
      prev = buf;
      used.add(buf);
    }
    expect(used.size).toBe(AUDIO_FILES.steps.length);
  });

  it('plays jump, land, scream and eagle', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    await audio.preload();
    log.sources.length = 0;
    audio.jump();
    expect(log.sources.length).toBe(2); // wooden push-off + synthesised whoosh
    log.sources.length = 0;
    audio.land();
    expect(log.sources.length).toBe(1);
    log.sources.length = 0;
    audio.fallScream();
    expect(log.sources.length).toBe(1);
    log.sources.length = 0;
    audio.eagle({ pan: -0.5 });
    expect(log.sources.length).toBe(1);
  });

  it('plays one looping noise whoosh per gust, stops it, and never throws', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    await audio.preload();
    log.sources.length = 0;
    audio.gust({ dir: 1, strength: 0.8 });
    expect(log.sources.length).toBe(1);
    expect(log.sources[0].started).toBe(true);
    expect(log.sources[0].loop).toBe(true); // the noise buffer is shorter than the gust
    expect(log.sources[0].stopped).toBe(true); // scheduled to end by itself
    audio.gust({ dir: -1, strength: 0.2 });
    audio.gust({ dir: 0 });
    audio.gust();
    audio.gust({ dir: 1, strength: NaN });
    expect(log.sources.length).toBe(5);
  });

  it('keeps the gust whoosh moderate, and quieter for a weaker gust', async () => {
    const peak = async (o) => {
      const { audio, log } = setup();
      await audio.unlock();
      await audio.preload();
      const before = log.gains.length;
      audio.gust(o);
      const env = log.gains[before + 0]; // the gust's own gain is the first one created by it
      return Math.max(...env.gain.ramps.map(([v]) => v));
    };
    const strong = await peak({ dir: 1, strength: 1 });
    const weak = await peak({ dir: 1, strength: 0.2 });
    expect(strong).toBeLessThanOrEqual(GUST_LEVEL);
    expect(strong).toBeLessThanOrEqual(0.35);
    expect(weak).toBeLessThan(strong);
    expect(weak).toBeGreaterThan(0);
  });

  it('plays nothing while the context is suspended, then works after unlock()', async () => {
    const { audio, log } = setup({ random: () => 0.5 }, { state: 'suspended' }); // no random plank creak
    await audio.preload();
    audio.footstep(1.4);
    audio.land();
    expect(log.sources.length).toBe(0);
    expect(await audio.unlock()).toBe(true);
    expect(await audio.unlock()).toBe(true); // safe to repeat
    audio.footstep(1.4);
    expect(log.sources.length).toBe(1);
  });
});

describe('ambience', () => {
  it('starts two seamless loops once loaded, and fades them out on stop', async () => {
    const { audio, log } = setup();
    audio.startAmbience(); // before anything has loaded
    await audio.preload();
    const loops = log.sources.filter((s) => s.loop);
    expect(loops.length).toBe(2);
    expect(loops.every((s) => s.started)).toBe(true);
    audio.startAmbience(); // idempotent
    expect(log.sources.filter((s) => s.loop).length).toBe(2);
    audio.stopAmbience();
    expect(loops.every((s) => s.stopped)).toBe(true);
    audio.startAmbience(); // can come back
    expect(log.sources.filter((s) => s.loop).length).toBe(4);
  });

  it('waits for unlock() when the context starts suspended', async () => {
    const { audio, log } = setup({}, { state: 'suspended' });
    audio.startAmbience();
    await audio.preload();
    expect(log.sources.filter((s) => s.loop).length).toBe(0);
    await audio.unlock();
    // The real context fires statechange; the fake does not, so unlock then startAmbience again is enough.
    audio.startAmbience();
    expect(log.sources.filter((s) => s.loop).length).toBe(2);
  });
});

describe('setMasterVolume', () => {
  it('clamps to 0..1', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    const master = log.gains[0];
    audio.setMasterVolume(0.4);
    expect(master.gain.target).toBe(0.4);
    audio.setMasterVolume(7);
    expect(master.gain.target).toBe(1);
    audio.setMasterVolume(-2);
    expect(master.gain.target).toBe(0);
  });
});

describe('setVolumes (the phone settings sheet)', () => {
  it('sets the ambience (music) and effects buses separately, clamped to 0..1', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    const [, sfx, amb] = log.gains; // created in order: master, sfx, ambience
    audio.setVolumes({ music: 0.3, sfx: 0.6 });
    expect(amb.gain.target).toBe(0.3);
    expect(sfx.gain.target).toBe(0.6);
    audio.setVolumes({ music: 5, sfx: -1 });
    expect(amb.gain.target).toBe(1);
    expect(sfx.gain.target).toBe(0);
  });

  it('remembers volumes chosen before the context exists', async () => {
    const { audio, log } = setup();
    audio.setVolumes({ music: 0.2, sfx: 0.7 });
    await audio.unlock();
    const [, sfx, amb] = log.gains;
    expect(amb.gain.value).toBe(0.2);
    expect(sfx.gain.value).toBe(0.7);
  });
});

describe('setPaused (the game pause)', () => {
  it('suspends the context so the ambience and a whoosh mid-sweep freeze, and resumes it', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    const resumes = log.resumes;
    audio.setPaused(true);
    expect(log.suspends).toBe(1);
    expect(audio.info().state).toBe('suspended');
    audio.setPaused(false);
    expect(log.resumes).toBe(resumes + 1);
    expect(audio.info().state).toBe('running');
  });

  it('does nothing when the state has not changed', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    audio.setPaused(false);
    expect(log.suspends).toBe(0);
    audio.setPaused(true);
    audio.setPaused(true);
    expect(log.suspends).toBe(1);
    audio.setPaused(false);
    audio.setPaused(false);
    expect(log.suspends).toBe(1);
  });

  it('plays no one-shots while paused, and an unlock() does not undo the pause', async () => {
    const { audio, log } = setup();
    await audio.unlock();
    audio.setPaused(true);
    const sources = log.sources.length;
    audio.gust({ dir: 1, strength: 1 });
    expect(log.sources.length).toBe(sources);
    const resumes = log.resumes;
    expect(await audio.unlock()).toBe(false); // e.g. a keypress while paused
    expect(log.resumes).toBe(resumes);
    audio.setPaused(false);
    expect(audio.info().state).toBe('running');
  });

  it('is a no-op without a context, and the pause is still remembered for when one exists', async () => {
    const { audio, log } = setup();
    audio.setPaused(true);
    audio.setPaused(false);
    expect(log.suspends).toBe(0);
    const none = createAudio({ baseUrl: '/', AudioContextClass: undefined, fetchFn: undefined });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => none.setPaused(true)).not.toThrow();
    expect(() => none.setPaused(false)).not.toThrow();
  });

  it('never throws when the context refuses to suspend', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { FakeContext } = fakeWebAudio();
    FakeContext.prototype.suspend = () => Promise.reject(new Error('nope'));
    const audio = createAudio({ baseUrl: '/', AudioContextClass: FakeContext, fetchFn: okFetch() });
    await audio.unlock();
    expect(() => audio.setPaused(true)).not.toThrow();
    await Promise.resolve();
  });
});

describe('createEagleScheduler', () => {
  const makeAudio = () => ({ eagle: vi.fn() });

  it('plays one cry every 15-40 s', () => {
    const audio = makeAudio();
    let r = 0;
    const s = createEagleScheduler({ audio, random: () => r });
    // random = 0 -> the shortest gap: 15 s.
    expect(s.tick(1000)).toBe(false); // first tick only schedules
    expect(s.tick(15999)).toBe(false);
    expect(s.tick(16000)).toBe(true);
    expect(audio.eagle).toHaveBeenCalledTimes(1);
    expect(s.tick(16001)).toBe(false);
    // random = 1 -> the longest gap: 40 s.
    r = 1;
    expect(s.tick(31000)).toBe(true);
    expect(s.tick(70999)).toBe(false);
    expect(s.tick(71000)).toBe(true);
    expect(audio.eagle).toHaveBeenCalledTimes(3);
  });

  it('pans each cry a little off-centre', () => {
    const audio = makeAudio();
    const values = [0.5, 1, 0.5, 0, 0.5, 0.5];
    let i = 0;
    const s = createEagleScheduler({ audio, random: () => values[i++ % values.length] });
    for (let t = 0; t < 400000; t += 1000) s.tick(t);
    const pans = audio.eagle.mock.calls.map(([o]) => o.pan);
    expect(pans.length).toBeGreaterThan(3);
    for (const p of pans) {
      expect(p).toBeGreaterThanOrEqual(-0.6);
      expect(p).toBeLessThanOrEqual(0.6);
    }
  });

  it('with real randomness a 10-minute run stays within 15-40 s between cries', () => {
    const audio = makeAudio();
    const times = [];
    audio.eagle.mockImplementation(() => times.push(now));
    let now = 0;
    const s = createEagleScheduler({ audio });
    for (now = 0; now < 600000; now += 16) s.tick(now);
    expect(times.length).toBeGreaterThanOrEqual(15);
    expect(times.length).toBeLessThanOrEqual(40);
    for (let k = 1; k < times.length; k++) {
      expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(15000);
      expect(times[k] - times[k - 1]).toBeLessThanOrEqual(40000 + 16);
    }
  });

  it('reset() starts a fresh countdown', () => {
    const audio = makeAudio();
    const s = createEagleScheduler({ audio, random: () => 0 });
    s.tick(0);
    s.reset();
    expect(s.tick(100000)).toBe(false); // re-armed, not fired
    expect(s.tick(115000)).toBe(true);
  });
});

// ---------- level themes ----------

// A fetch whose "decoded" buffers remember which file they came from (buffer.file), for the whole of audio/.
const namedFetch = (missing = []) =>
  vi.fn(async (url) => {
    const file = url.split('/').pop();
    if (missing.includes(file)) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => ({ file }) };
  });
const flush = () => new Promise((r) => setTimeout(r, 0));
const loops = (log) => log.sources.filter((s) => s.loop);
const loopFiles = (list) => list.map((s) => s.buffer.file).sort();
const layerFiles = (id) => THEME_SOUNDS[id].layers.map((l) => l.file).sort();
// The bed buses: gain nodes that were ramped up to the ambience level.
const buses = (log) => log.gains.filter((g) => g.gain.ramps.some(([v]) => v === AMBIENCE_LEVEL));

describe('THEME_SOUNDS', () => {
  it('has sounds for every theme, with quiet layers and at least one call file', () => {
    for (const { id } of THEMES) {
      const t = THEME_SOUNDS[id];
      expect(t, id).toBeTruthy();
      expect(t.layers.length).toBeGreaterThan(0);
      for (const l of t.layers) {
        expect(l.gain).toBeGreaterThan(0);
        expect(l.gain).toBeLessThanOrEqual(1); // the bus sits at AMBIENCE_LEVEL; layers are only trimmed down
      }
      expect(t.calls.files.length).toBeGreaterThan(0);
      expect(['hawk', 'bird', 'owl']).toContain(t.calls.kind);
    }
    expect(AMBIENCE_LEVEL).toBeLessThanOrEqual(0.3);
  });
});

describe('setTheme', () => {
  it('loads only that theme and the next one, and drops what no theme in reach uses', async () => {
    const fetchFn = namedFetch();
    const { audio } = setup({ fetchFn });
    await audio.unlock();
    audio.setTheme('morning');
    await flush();
    const have = Object.keys(audio.info().buffers);
    expect(have).toEqual(expect.arrayContaining(['ambience_birds.ogg', 'ambience_stream.ogg', 'bird_1.ogg']));
    expect(have).toContain('ambience_cicadas.ogg'); // sunset, the next theme, was warmed up
    expect(have).not.toContain('ambience_crickets.ogg'); // night is two themes away
    expect(have).not.toContain('owl_1.ogg');
    expect(audio.getTheme()).toBe('morning');
    audio.setTheme('night', 'golden');
    await flush();
    const later = Object.keys(audio.info().buffers);
    expect(later).toEqual(expect.arrayContaining(['ambience_crickets.ogg', 'owl_2.ogg', 'ambience_water.ogg'])); // night + golden
    expect(later).not.toContain('ambience_birds.ogg');
    expect(later).not.toContain('ambience_stream.ogg');
    expect(later).not.toContain('ambience_cicadas.ogg');
    expect(later).toContain('step_1.ogg'); // one-shots stay
  });

  it('warms up the next level\'s theme when it is given (looks.js picks it at random)', async () => {
    const { audio } = setup({ fetchFn: namedFetch() });
    await audio.unlock();
    audio.setTheme('night', 'valley');
    await flush();
    const have = Object.keys(audio.info().buffers);
    expect(have).toEqual(expect.arrayContaining(['ambience_crickets.ogg', 'ambience_stream.ogg', 'ambience_birds.ogg', 'bird_1.ogg']));
    expect(have).not.toContain('ambience_cicadas.ogg'); // sunset is not coming
    audio.setTheme('valley', 'sunset');
    await flush();
    const later = Object.keys(audio.info().buffers);
    expect(later).toEqual(expect.arrayContaining(['ambience_stream.ogg', 'ambience_cicadas.ogg']));
    expect(later).not.toContain('ambience_crickets.ogg');
    expect(later).not.toContain('owl_1.ogg');
  });

  it('fetches each file only once while the themes cycle', async () => {
    const fetchFn = namedFetch();
    const { audio } = setup({ fetchFn });
    await audio.unlock();
    audio.setTheme('golden');
    audio.setTheme('golden');
    await flush();
    const urls = fetchFn.mock.calls.map(([u]) => u);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('crossfades the bed: the new layers fade in over 3 s while the old ones fade out and stop', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    audio.startAmbience();
    await audio.preload();
    const golden = loops(log);
    expect(loopFiles(golden)).toEqual(layerFiles('golden'));
    audio.setTheme('morning');
    await flush();
    const all = loops(log);
    const morning = all.filter((s) => !golden.includes(s));
    expect(loopFiles(morning)).toEqual(layerFiles('morning'));
    expect(morning.every((s) => s.started && !s.stopped)).toBe(true);
    expect(golden.every((s) => s.stopped)).toBe(true);
    const [oldBus, newBus] = buses(log);
    expect(newBus.gain.ramps).toEqual([[AMBIENCE_LEVEL, THEME_CROSSFADE_S]]);
    expect(oldBus.gain.ramps.at(-1)).toEqual([0, THEME_CROSSFADE_S]);
    expect(THEME_CROSSFADE_S).toBe(3);
    expect(audio.info().theme).toBe('morning');
  });

  it('does nothing when the theme is unchanged, and only the last of several quick changes keeps playing', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    audio.startAmbience();
    await audio.preload();
    audio.setTheme('golden');
    await flush();
    expect(loops(log).length).toBe(2);
    audio.setTheme('morning');
    audio.setTheme('sunset');
    audio.setTheme('night');
    await flush();
    const playing = loops(log).filter((s) => !s.stopped);
    expect(loopFiles(playing)).toEqual(layerFiles('night'));
    expect(audio.getTheme()).toBe('night');
    audio.stopAmbience();
    expect(loops(log).every((s) => s.stopped)).toBe(true);
  });

  it('starts the ambience with the theme that was set first', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    audio.setTheme('night');
    audio.startAmbience();
    await flush();
    expect(loopFiles(loops(log))).toEqual(layerFiles('night'));
  });

  it('waits for a suspended context, then plays the theme', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() }, { state: 'suspended' });
    audio.setTheme('sunset');
    audio.startAmbience();
    await flush();
    expect(loops(log).length).toBe(0);
    await audio.unlock();
    audio.startAmbience();
    expect(loopFiles(loops(log))).toEqual(layerFiles('sunset'));
  });

  it('filters the layers that ask for it and gives the gust LFO to the wind', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    audio.setTheme('night');
    audio.startAmbience();
    await flush();
    expect(log.oscillators).toBe(THEME_SOUNDS.night.layers.filter((l) => l.gust).length);
  });

  it('an unknown theme id uses the default sound and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { audio, log } = setup({ fetchFn: namedFetch() });
    audio.startAmbience();
    audio.setTheme('volcano');
    audio.setTheme('volcano');
    await flush();
    expect(audio.getTheme()).toBe('golden');
    expect(loopFiles(loops(log))).toEqual(layerFiles('golden'));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws without Web Audio', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const audio = createAudio({ baseUrl: '/', AudioContextClass: undefined, fetchFn: undefined });
    expect(() => {
      audio.setTheme('morning');
      audio.ambientCall({ pan: 0.2 });
    }).not.toThrow();
  });
});

describe('missing theme files', () => {
  it('keeps the old bed playing when none of the new theme loads, and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = [...layerFiles('night'), ...AUDIO_FILES.owls].filter((f) => f !== AUDIO_FILES.ambienceWind);
    const { audio, log } = setup({ fetchFn: namedFetch(missing) });
    audio.startAmbience();
    await audio.preload();
    expect(() => audio.setTheme('night')).not.toThrow();
    await flush();
    // night still has its wind, so it does switch; with the wind missing too nothing would change.
    expect(loopFiles(loops(log).filter((s) => !s.stopped))).toEqual([AUDIO_FILES.ambienceWind]);
    warn.mockClear();
    const { audio: a2, log: log2 } = setup({ fetchFn: namedFetch([...missing, AUDIO_FILES.ambienceWind]) });
    a2.startAmbience();
    await flush();
    const before = loops(log2);
    a2.setTheme('night');
    await flush();
    expect(loops(log2)).toEqual(before);
  });

  it('plays a bed from whichever layers did load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { audio, log } = setup({ fetchFn: namedFetch([AUDIO_FILES.ambienceStream]) });
    audio.setTheme('morning');
    audio.startAmbience();
    await flush();
    expect(loopFiles(loops(log))).toEqual([AUDIO_FILES.ambienceBirds, AUDIO_FILES.ambienceWind].sort());
  });

  it('plays a synthesised stand-in for each theme call when its files are missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const { audio, log } = setup({ fetchFn });
    await audio.unlock();
    for (const id of ['morning', 'night', 'golden', 'sunset', 'valley']) {
      audio.setTheme(id);
      await flush();
      const before = log.oscillators;
      expect(() => audio.ambientCall({ pan: -0.3 })).not.toThrow();
      expect(log.oscillators, id).toBeGreaterThan(before);
    }
  });
});

describe('ambientCall', () => {
  it('plays the current theme\'s own call, slightly panned and far off', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    await audio.unlock();
    const expected = {
      golden: AUDIO_FILES.eagles,
      morning: AUDIO_FILES.birds,
      sunset: AUDIO_FILES.eagles,
      night: AUDIO_FILES.owls,
      valley: AUDIO_FILES.birds,
    };
    for (const id of Object.keys(expected)) {
      audio.setTheme(id);
      await flush();
      for (let i = 0; i < 6; i++) {
        const n = log.sources.length;
        audio.ambientCall({ pan: 0.4 });
        expect(log.sources.length, id).toBe(n + 1);
        expect(expected[id], id).toContain(log.sources[n].buffer.file);
        expect(log.sources[n].loop).toBe(false);
      }
    }
  });

  it('the valley\'s songbird is the blackbird sped up: a smaller, brighter bird than the morning\'s', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch(), random: () => 0.5 }); // 0.5: no jitter
    await audio.unlock();
    const rateOf = async (id) => {
      audio.setTheme(id);
      await flush();
      audio.ambientCall({ pan: 0 });
      return log.sources.at(-1).playbackRate.value;
    };
    expect(await rateOf('morning')).toBe(1);
    expect(await rateOf('valley')).toBeCloseTo(THEME_SOUNDS.valley.calls.rate);
    expect(THEME_SOUNDS.valley.calls.rate).toBeGreaterThan(1.1);
  });

  it('the valley\'s bed is a river and birds, without the canyon wind', () => {
    const files = layerFiles('valley');
    expect(files).toEqual([AUDIO_FILES.ambienceBirds, AUDIO_FILES.ambienceStream, AUDIO_FILES.ambienceWater].sort());
    expect(files).not.toContain(AUDIO_FILES.ambienceWind);
    expect(files).not.toEqual(layerFiles('morning'));
  });

  it('never plays the same call twice in a row', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    await audio.unlock();
    audio.setTheme('morning');
    await flush();
    const played = [];
    for (let i = 0; i < 30; i++) {
      audio.ambientCall();
      played.push(log.sources.at(-1).buffer.file);
    }
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
    expect(new Set(played).size).toBeGreaterThan(2);
  });

  it('plays nothing while the context is suspended', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() }, { state: 'suspended' });
    audio.setTheme('night');
    await flush();
    audio.ambientCall();
    expect(log.sources.length).toBe(0);
  });
});

describe('createAmbientCallScheduler', () => {
  it('plays one call every 12-40 s, panned a little off-centre', () => {
    const audio = { ambientCall: vi.fn() };
    let r = 0;
    const s = createAmbientCallScheduler({ audio, random: () => r });
    expect(s.tick(0)).toBe(false);
    expect(s.tick(11999)).toBe(false);
    r = 1; // the gap after the first call is the longest one
    expect(s.tick(12000)).toBe(true);
    expect(s.tick(12001)).toBe(false);
    expect(s.tick(12000 + 39999)).toBe(false);
    expect(s.tick(12000 + 40000)).toBe(true);
    expect(audio.ambientCall).toHaveBeenCalledTimes(2);
    for (const [o] of audio.ambientCall.mock.calls) expect(Math.abs(o.pan)).toBeLessThanOrEqual(0.6);
    s.reset();
    expect(s.tick(1e6)).toBe(false);
  });

  it('with real randomness a 10-minute run stays within 12-40 s between calls', () => {
    const times = [];
    let now = 0;
    const audio = { ambientCall: () => times.push(now) };
    const s = createAmbientCallScheduler({ audio });
    for (now = 0; now < 600000; now += 16) s.tick(now);
    expect(times.length).toBeGreaterThanOrEqual(15);
    for (let k = 1; k < times.length; k++) {
      expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(12000);
      expect(times[k] - times[k - 1]).toBeLessThanOrEqual(40000 + 16);
    }
  });

  it('plays whichever call the engine\'s current theme has', async () => {
    const { audio, log } = setup({ fetchFn: namedFetch() });
    await audio.unlock();
    const s = createAmbientCallScheduler({ audio, random: () => 0 });
    s.tick(0);
    audio.setTheme('night');
    await flush();
    expect(s.tick(12000)).toBe(true);
    expect(AUDIO_FILES.owls).toContain(log.sources.at(-1).buffer.file);
    audio.setTheme('morning');
    await flush();
    expect(s.tick(24000)).toBe(true);
    expect(AUDIO_FILES.birds).toContain(log.sources.at(-1).buffer.file);
  });

  it('createEagleScheduler follows the theme too when the engine has ambientCall', () => {
    const audio = { eagle: vi.fn(), ambientCall: vi.fn() };
    const s = createEagleScheduler({ audio, random: () => 0 });
    s.tick(0);
    expect(s.tick(15000)).toBe(true);
    expect(audio.ambientCall).toHaveBeenCalledTimes(1);
    expect(audio.eagle).not.toHaveBeenCalled();
  });
});
