import { describe, it, expect } from 'vitest';
import { createFixedStep, STEP, MAX_STEPS } from '../src/game/fixedStep.js';
import { createSession } from '../src/game/session.js';
import { createMatch } from '../src/game/match.js';
import { onBridge } from './helpers/onBridge.js';

const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));

// Plays `seconds` of a session at a frame rate, through the fixed step, with a steady player who presses `each(t, s)`.
function playAt(fps, seconds, each) {
  const s = createSession({ seed: 11 });
  s.start();
  onBridge(s);
  s.gaps = [];
  const steps = createFixedStep();
  let t = 0;
  for (let frame = 0; frame < seconds * fps; frame++) {
    const dt = 1 / fps;
    t += dt;
    s.input.tilt = steady(s.walker);
    each?.(t, s);
    steps.advance(dt, (step) => s.update(step));
  }
  return s;
}

describe('createFixedStep', () => {
  it('runs whole steps and carries the remainder to the next frame', () => {
    const steps = createFixedStep();
    let ran = 0;
    expect(steps.advance(STEP * 2.5, () => (ran += 1))).toBe(2);
    expect(steps.advance(STEP * 0.5, () => (ran += 1))).toBe(1); // the carried half plus this half
    expect(ran).toBe(3);
  });

  it('counts a step that floating point leaves a hair short', () => {
    const steps = createFixedStep();
    let ran = 0;
    for (let i = 0; i < 120; i++) steps.advance(1 / 120, () => (ran += 1));
    expect(ran).toBe(120);
  });

  it('after a stall runs at most MAX_STEPS and drops the rest instead of catching up', () => {
    const steps = createFixedStep();
    expect(steps.advance(2, () => {})).toBe(MAX_STEPS);
    expect(steps.advance(STEP / 2, () => {})).toBe(0); // nothing owed from the stall
  });

  it('reset() forgets time that passed while the game was not updated', () => {
    const steps = createFixedStep();
    steps.advance(STEP * 0.9, () => {});
    steps.reset();
    expect(steps.advance(STEP * 0.5, () => {})).toBe(0);
  });

  it('ignores a negative dt (a clock that stepped back)', () => {
    const steps = createFixedStep();
    expect(steps.advance(-1, () => {})).toBe(0);
    expect(steps.advance(STEP, () => {})).toBe(1);
  });
});

describe('the game plays the same at any frame rate', () => {
  it('a walk of 10 s ends in the same place at 30, 40, 50 and 60 fps', () => {
    const at = [30, 40, 50, 60].map((fps) => playAt(fps, 10, (t, s) => (s.input.walking = true)).walker.z);
    for (const z of at) expect(z).toBeCloseTo(at[0], 1);
  });

  it('the balance under the same wind comes out the same at 30 and 50 fps', () => {
    const a = playAt(30, 12, (t, s) => (s.input.walking = true));
    const b = playAt(50, 12, (t, s) => (s.input.walking = true));
    expect(a.levelFalls).toBe(b.levelFalls);
    expect(a.walker.lean).toBeCloseTo(b.walker.lean, 2);
  });

  it('a jump pressed at the same moment clears the same distance at 30, 40 and 50 fps', () => {
    const landings = [30, 40, 50].map((fps) => {
      let pressed = false;
      let takeoff = null;
      let landed = null;
      playAt(fps, 4, (t, s) => {
        s.input.walking = true;
        if (!pressed && t >= 1) { s.input.jump = true; pressed = true; }
        if (s.walker.airborne && takeoff === null) takeoff = s.walker.z;
        if (takeoff !== null && !s.walker.airborne && landed === null) landed = s.walker.z;
      });
      return landed - takeoff;
    });
    for (const d of landings) {
      expect(d).toBeGreaterThan(1.5);
      expect(d).toBeCloseTo(landings[0], 0);
    }
  });

  it('a jump pressed between two steps is not lost: the next step takes it', () => {
    const s = createSession({ seed: 11 });
    s.start();
    onBridge(s);
    const steps = createFixedStep();
    steps.advance(STEP * 0.4, (step) => s.update(step)); // no whole step yet
    s.input.jump = true;
    expect(steps.advance(STEP * 0.4, (step) => s.update(step))).toBe(0);
    expect(s.input.jump).toBe(true); // still waiting
    steps.advance(STEP * 0.4, (step) => s.update(step));
    expect(s.walker.airborne).toBe(true);
  });

  it('pause freezes the clock and the wind, and resuming does not jump ahead', () => {
    const m = createMatch({ mode: 'solo', seed: 4 });
    m.start();
    onBridge(m);
    const steps = createFixedStep();
    const run = (seconds, fps = 40) => { for (let i = 0; i < seconds * fps; i++) steps.advance(1 / fps, (step) => m.update(step)); };
    run(2);
    const before = { time: m.sessions[1].time, z: m.sessions[1].walker.z };
    m.togglePause();
    run(5);
    expect(m.sessions[1].time).toBe(before.time);
    expect(m.sessions[1].walker.z).toBe(before.z);
    m.togglePause();
    run(0.1);
    expect(m.sessions[1].time - before.time).toBeLessThan(0.12);
  });
});
