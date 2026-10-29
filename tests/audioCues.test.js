import { describe, it, expect, vi } from 'vitest';
import {
  stepCue,
  createStepTracker,
  createCueTracker,
  playCues,
  WALK_STRIDE,
  RUN_STRIDE,
} from '../src/tv/audioCues.js';

const walker = (over = {}) => ({ z: 0, y: 0, airborne: false, speed: 1.4, lean: 0, fallen: false, ...over });
const session = (w, phase = 'playing', fallCause = null) => ({ phase, walker: w, fallCause });

// Walk the tracker forward at a constant speed (m/s, 60 fps); returns the z of every step it reports.
function stepsAlong(tracker, { from = 0, meters, speed, phase = 'playing', dt = 1 / 60 }) {
  const hits = [];
  let z = from;
  const end = from + meters;
  while (z < end) {
    z += speed * dt;
    if (tracker.update(walker({ z, speed }), phase)) hits.push(z);
  }
  return hits;
}

// The k-th step lands on the first frame at or past (start + k * stride): never early, at most one frame late.
function expectStrides(hits, frameDist, stride) {
  hits.forEach((z, i) => {
    const due = frameDist + (i + 1) * stride;
    expect(z).toBeGreaterThanOrEqual(due - 1e-9);
    expect(z).toBeLessThan(due + frameDist + 1e-9);
  });
}

describe('stepCue', () => {
  it('fires once a full stride has been covered, walking and running', () => {
    expect(stepCue('playing', 0, walker({ z: 0.69 }), 'playing')).toBe(false);
    expect(stepCue('playing', 0, walker({ z: 0.7 }), 'playing')).toBe(true);
    expect(stepCue('playing', 0, walker({ z: 1.09, speed: 2.8 }), 'playing')).toBe(false);
    expect(stepCue('playing', 0, walker({ z: 1.1, speed: 2.8 }), 'playing')).toBe(true);
  });

  it('treats anything over 2 m/s as running', () => {
    expect(stepCue('playing', 0, walker({ z: 0.8, speed: 2 }), 'playing')).toBe(true); // 2 is still a walk
    expect(stepCue('playing', 0, walker({ z: 0.8, speed: 2.01 }), 'playing')).toBe(false);
  });

  it('stays quiet in the air, when fallen, when standing, and outside the playing phase', () => {
    expect(stepCue('playing', 0, walker({ z: 5, airborne: true }), 'playing')).toBe(false);
    expect(stepCue('playing', 0, walker({ z: 5, fallen: true }), 'playing')).toBe(false);
    expect(stepCue('playing', 0, walker({ z: 5, speed: 0 }), 'playing')).toBe(false);
    expect(stepCue('playing', 0, walker({ z: 5 }), 'lobby')).toBe(false);
    expect(stepCue('playing', 0, walker({ z: 5 }), 'falling')).toBe(false);
    expect(stepCue('lobby', 0, walker({ z: 5 }), 'playing')).toBe(false); // just started: distance is stale
    expect(stepCue('playing', null, walker({ z: 5 }), 'playing')).toBe(false);
  });
});

describe('createStepTracker', () => {
  it('steps every 0.7 m when walking', () => {
    const hits = stepsAlong(createStepTracker(), { meters: 14, speed: 1.4 });
    expect(hits.length).toBe(19); // 20 strides fit in 14 m; the one landing on the very edge is not reached
    expectStrides(hits, 1.4 / 60, WALK_STRIDE); // the first frame (z = 1.4/60) starts the first stride
  });

  it('steps every 1.1 m when running', () => {
    const hits = stepsAlong(createStepTracker(), { meters: 11, speed: 2.8 });
    expect(hits.length).toBe(9);
    expectStrides(hits, 2.8 / 60, RUN_STRIDE);
  });

  it('does not drift: the cadence over a long walk matches the stride', () => {
    const hits = stepsAlong(createStepTracker(), { meters: 70, speed: 1.4 });
    expect(hits.length).toBeGreaterThanOrEqual(99);
    expect(hits.length).toBeLessThanOrEqual(100);
  });

  it('switches stride when he starts to run', () => {
    const t = createStepTracker();
    const walk = stepsAlong(t, { meters: 3.5, speed: 1.4 });
    const run = stepsAlong(t, { from: 3.5, meters: 5.5, speed: 2.8 });
    expect(walk.length).toBe(4);
    expect(run.length).toBe(5);
    const frame = 2.8 / 60;
    run.slice(1).forEach((z, i) => {
      expect(z - run[i]).toBeGreaterThan(RUN_STRIDE - frame - 1e-9); // cadence is drift-free, so a gap can be a frame short
      expect(z - run[i]).toBeLessThan(RUN_STRIDE + frame + 1e-9);
    });
  });

  it('makes no steps while airborne, and the first one after landing is a full stride later', () => {
    const t = createStepTracker();
    stepsAlong(t, { meters: 2, speed: 1.4 });
    let z = 2;
    for (let i = 0; i < 40; i++) {
      z += 3 / 60;
      expect(t.update(walker({ z, speed: 3, airborne: true }), 'playing')).toBeNull();
    }
    // Landed: nothing for the first stride, then a step.
    const hits = stepsAlong(t, { from: z, meters: 1.5, speed: 1.4 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0] - z).toBeGreaterThanOrEqual(WALK_STRIDE - 1e-9);
  });

  it('makes no steps while stopped, in the lobby, or while falling', () => {
    const t = createStepTracker();
    for (let i = 0; i < 120; i++) expect(t.update(walker({ z: 3, speed: 0 }), 'playing')).toBeNull();
    expect(stepsAlong(t, { meters: 5, speed: 1.4, phase: 'lobby' })).toEqual([]);
    expect(stepsAlong(t, { meters: 5, speed: 1.4, phase: 'falling' })).toEqual([]);
    expect(stepsAlong(t, { meters: 5, speed: 1.4, phase: 'gameover' })).toEqual([]);
  });

  it('resumes cleanly after a pause: no burst of steps for the distance he did not walk', () => {
    const t = createStepTracker();
    stepsAlong(t, { meters: 3, speed: 1.4 });
    stepsAlong(t, { from: 3, meters: 10, speed: 1.4, phase: 'lobby' });
    expect(t.update(walker({ z: 13.02 }), 'playing')).toBeNull();
    expect(t.update(walker({ z: 13.04 }), 'playing')).toBeNull();
  });

  it('does not fire a stale step when a new game restarts at z = 0', () => {
    const t = createStepTracker();
    stepsAlong(t, { from: 30, meters: 2, speed: 1.4 });
    t.update(walker({ z: 32, fallen: true, speed: 0 }), 'falling');
    t.update(walker({ z: 32, fallen: true, speed: 0 }), 'gameover');
    t.update(walker({ z: 0, speed: 0 }), 'lobby');
    expect(t.update(walker({ z: 0.02 }), 'playing')).toBeNull();
    expect(t.update(walker({ z: 0.04 }), 'playing')).toBeNull();
    expect(t.update(walker({ z: 0.06 }), 'playing')).toBeNull();
  });

  it('reports at most one step per frame, even after a long stall', () => {
    const t = createStepTracker();
    t.update(walker({ z: 0 }), 'playing');
    expect(t.update(walker({ z: 1.4 }), 'playing')).toBe('step'); // a whole second in one frame
    expect(t.update(walker({ z: 1.42 }), 'playing')).toBeNull();
  });

  it('picks up a baseline when created mid-walk', () => {
    const t = createStepTracker();
    const hits = stepsAlong(t, { from: 10, meters: 3, speed: 1.4 });
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });
});

describe('createCueTracker', () => {
  it('records a baseline on the first update and fires nothing', () => {
    const c = createCueTracker();
    expect(c.update(session(walker({ airborne: true }), 'falling'))).toEqual([]);
  });

  it("emits 'jump' when he leaves the ground and 'land' when he touches down", () => {
    const c = createCueTracker();
    c.update(session(walker({ z: 5 })));
    expect(c.update(session(walker({ z: 5.1, airborne: true, y: 0.1, speed: 3 })))).toEqual(['jump']);
    expect(c.update(session(walker({ z: 5.5, airborne: true, y: 0.5, speed: 3 })))).toEqual([]);
    expect(c.update(session(walker({ z: 5.52, airborne: false, speed: 1.4 })))).toEqual(['land']);
    expect(c.update(session(walker({ z: 5.54 })))).toEqual([]);
  });

  it("emits 'fall' once on entering the falling phase", () => {
    const c = createCueTracker();
    c.update(session(walker({ z: 20 })));
    const fallen = walker({ z: 20, fallen: true, speed: 0 });
    expect(c.update(session(fallen, 'falling', 'balance'))).toEqual(['fall']);
    for (let i = 0; i < 100; i++) expect(c.update(session(fallen, 'falling', 'balance'))).toEqual([]);
    expect(c.update(session(walker({ z: 0 }), 'lobby'))).toEqual([]);
  });

  it("fires 'fall' again on the next fall after a restart", () => {
    const c = createCueTracker();
    c.update(session(walker()));
    const fallen = walker({ fallen: true, speed: 0 });
    expect(c.update(session(fallen, 'falling', 'gap'))).toEqual(['fall']);
    c.update(session(walker({ z: 0 }), 'playing'));
    expect(c.update(session(fallen, 'falling', 'balance'))).toEqual(['fall']);
  });

  it("does not play a landing thud when the jump ends in a gap (the frame goes straight to 'falling')", () => {
    const c = createCueTracker();
    c.update(session(walker({ z: 10 })));
    c.update(session(walker({ z: 10.1, airborne: true, speed: 3 })));
    const cues = c.update(session(walker({ z: 11, airborne: false, fallen: true, speed: 0 }), 'falling', 'gap'));
    expect(cues).toEqual(['fall']);
  });

  it("does not play a landing thud when he topples in mid-air", () => {
    const c = createCueTracker();
    c.update(session(walker()));
    c.update(session(walker({ airborne: true, speed: 3 })));
    expect(c.update(session(walker({ fallen: true, speed: 0 }), 'falling', 'balance'))).toEqual(['fall']);
  });

  it("includes 'step' cues from the step tracker, none in the air", () => {
    const c = createCueTracker();
    const all = [];
    let z = 0;
    for (let i = 0; i < 125; i++) {
      z += 1.4 / 60;
      all.push(...c.update(session(walker({ z }))));
    }
    expect(all.every((n) => n === 'step')).toBe(true);
    expect(all.length).toBe(4); // 2.9 m of walking
    const air = [];
    for (let i = 0; i < 40; i++) {
      z += 3 / 60;
      air.push(...c.update(session(walker({ z, airborne: true, speed: 3 }))));
    }
    expect(air).toEqual(['jump']);
  });

  it('survives a session with no walker', () => {
    const c = createCueTracker();
    expect(c.update({ phase: 'lobby' })).toEqual([]);
    expect(c.update(null)).toEqual([]);
  });

  it('reset() forgets the previous frame', () => {
    const c = createCueTracker();
    c.update(session(walker({ airborne: true })));
    c.reset();
    expect(c.update(session(walker()))).toEqual([]); // baseline again: no spurious land
  });
});

describe('playCues', () => {
  it('maps cue names to engine calls', () => {
    const audio = { footstep: vi.fn(), jump: vi.fn(), land: vi.fn(), fallScream: vi.fn() };
    playCues(audio, ['step', 'jump', 'land', 'fall', 'bogus'], 2.8);
    expect(audio.footstep).toHaveBeenCalledWith(2.8);
    expect(audio.jump).toHaveBeenCalledTimes(1);
    expect(audio.land).toHaveBeenCalledTimes(1);
    expect(audio.fallScream).toHaveBeenCalledTimes(1);
  });
});
