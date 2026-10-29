import { describe, it, expect } from 'vitest';
import {
  createWalker,
  stepWalker,
  FALL_ANGLE,
  WALK_SPEED,
  RUN_SPEED,
  JUMP_VY,
  GRAVITY_ACCEL,
  JUMP_FORWARD,
} from '../src/game/balance.js';

const DT = 1 / 60;
// A steady "player": tilt against the lean, a bit ahead of where it's heading.
const steady = (w) => Math.max(-1, Math.min(1, -2 * w.lean - 0.5 * w.leanVel));

function run(w, { walking = false, running = false, wind = 0, tilt = 0 }, seconds, controller) {
  for (let t = 0; t < seconds; t += DT) {
    w = stepWalker(w, { tilt: controller ? controller(w) : tilt, walking, running, wind }, DT);
  }
  return w;
}

describe('balance', () => {
  it('stays upright when perfectly balanced and nothing pushes', () => {
    const w = run(createWalker(), {}, 5);
    expect(w.lean).toBe(0);
    expect(w.fallen).toBe(false);
  });

  it('falls when a small lean is left uncorrected', () => {
    const w = run({ ...createWalker(), lean: 0.2 }, {}, 20);
    expect(w.fallen).toBe(true);
    expect(Math.abs(w.lean)).toBeGreaterThan(FALL_ANGLE);
  });

  it('recovers a right lean when the phone tilts left', () => {
    const w = run({ ...createWalker(), lean: 0.2 }, { tilt: -1 }, 0.4);
    expect(w.lean).toBeLessThan(0.2);
    expect(w.fallen).toBe(false);
  });

  it('a steady player survives a constant side wind while walking', () => {
    const w = run(createWalker(), { walking: true, wind: 0.5 }, 30, steady);
    expect(w.fallen).toBe(false);
    expect(Math.abs(w.lean)).toBeLessThan(FALL_ANGLE / 2);
  });

  it('moves forward only while walking', () => {
    expect(run(createWalker(), { walking: true }, 2, steady).z).toBeCloseTo(2 * WALK_SPEED, 1);
    expect(run(createWalker(), { walking: false }, 2, steady).z).toBe(0);
  });

  it('stays fallen once fallen', () => {
    const fallen = stepWalker({ ...createWalker(), lean: FALL_ANGLE + 0.1 }, { tilt: 0, walking: false, wind: 0 }, DT);
    expect(fallen.fallen).toBe(true);
    expect(stepWalker(fallen, { tilt: -1, walking: true, wind: 0 }, DT)).toBe(fallen);
  });

  it('exports the movement constants', () => {
    expect(WALK_SPEED).toBe(1.4);
    expect(RUN_SPEED).toBe(2.8);
    expect(JUMP_VY).toBe(3.2);
    expect(GRAVITY_ACCEL).toBe(9.8);
    expect(JUMP_FORWARD).toBe(3.0);
  });

  it('a fresh walker is on the ground and standing', () => {
    expect(createWalker()).toMatchObject({ y: 0, vy: 0, airborne: false, speed: 0 });
  });

  it('reports its forward speed: 0 standing, walk, run (running overrides walking)', () => {
    const step = (input) => stepWalker(createWalker(), { tilt: 0, wind: 0, ...input }, DT);
    expect(step({}).speed).toBe(0);
    expect(step({ walking: true }).speed).toBe(WALK_SPEED);
    expect(step({ running: true }).speed).toBe(RUN_SPEED);
    expect(step({ walking: true, running: true }).speed).toBe(RUN_SPEED);
  });

  it('instability multiplies how fast a lean grows, and 1 (or omitted) is the unchanged feel', () => {
    const lean = (instability) => {
      let w = { ...createWalker(), lean: 0.05 };
      for (let i = 0; i < 120; i++) w = stepWalker(w, { tilt: 0, walking: true, wind: 0, instability }, DT);
      return w.lean;
    };
    let plain = { ...createWalker(), lean: 0.05 };
    for (let i = 0; i < 120; i++) plain = stepWalker(plain, { tilt: 0, walking: true, wind: 0 }, DT);
    expect(lean(1)).toBe(plain.lean);
    expect(lean(1.4)).toBeGreaterThan(lean(1.2));
    expect(lean(1.2)).toBeGreaterThan(lean(1));
  });

  it('runs twice as fast as it walks', () => {
    expect(run(createWalker(), { running: true }, 2, steady).z).toBeCloseTo(2 * RUN_SPEED, 1);
  });

  it('running wobbles more than walking, which wobbles more than standing', () => {
    const lean1 = (input) => stepWalker({ ...createWalker(), lean: 0.3 }, { tilt: 0, wind: 0, ...input }, DT).leanVel;
    const stand = lean1({});
    const walk = lean1({ walking: true });
    const runv = lean1({ running: true });
    expect(walk / stand).toBeCloseTo(1.2, 6);
    expect(runv / stand).toBeCloseTo(1.6, 6);
  });

  describe('jump', () => {
    const FINE = 1 / 1000;
    // Jump once, then fly until landing. Returns airtime, peak height and distance covered.
    function arc(input) {
      let w = stepWalker(createWalker(), { tilt: 0, wind: 0, jump: true, ...input }, FINE);
      let t = FINE;
      let peak = w.y;
      while (w.airborne && t < 3) {
        w = stepWalker(w, { tilt: 0, wind: 0, ...input }, FINE);
        peak = Math.max(peak, w.y);
        t += FINE;
      }
      return { w, t, peak };
    }

    it('lifts off the planks', () => {
      const w = stepWalker(createWalker(), { tilt: 0, wind: 0, jump: true }, DT);
      expect(w.airborne).toBe(true);
      expect(w.y).toBeGreaterThan(0);
      expect(w.vy).toBeLessThan(JUMP_VY);
    });

    it('hangs in the air for about 0.65 s and peaks about 0.52 m up', () => {
      const { t, peak } = arc({});
      expect(t).toBeCloseTo(0.653, 1);
      expect(peak).toBeCloseTo(0.522, 2);
    });

    it('a standing or walking jump travels about 1.96 m', () => {
      expect(arc({}).w.z).toBeCloseTo(1.959, 2);
      expect(arc({ walking: true }).w.z).toBeCloseTo(1.959, 2); // 1.4 * 1.15 is below JUMP_FORWARD
    });

    it('a running jump carries 15% more speed and travels about 2.10 m', () => {
      expect(arc({ running: true }).w.z).toBeCloseTo(2.103, 2);
    });

    it('keeps its take-off speed in the air, even if the player lets go', () => {
      let w = stepWalker(createWalker(), { tilt: 0, wind: 0, running: true, jump: true }, DT);
      expect(w.speed).toBeCloseTo(RUN_SPEED * 1.15, 9);
      w = stepWalker(w, { tilt: 0, wind: 0 }, DT); // buttons released mid-air
      expect(w.speed).toBeCloseTo(RUN_SPEED * 1.15, 9);
      const stand = stepWalker(createWalker(), { tilt: 0, wind: 0, jump: true }, DT);
      expect(stand.speed).toBe(JUMP_FORWARD);
      const walk = stepWalker(createWalker(), { tilt: 0, wind: 0, walking: true, jump: true }, DT);
      expect(walk.speed).toBe(JUMP_FORWARD);
    });

    it('lands back on the ground and the speed follows the input again', () => {
      const { w } = arc({ running: true }); // lands at the ground speed, not the boosted air speed
      expect(w.airborne).toBe(false);
      expect(w.y).toBe(0);
      expect(w.vy).toBe(0);
      expect(w.speed).toBe(RUN_SPEED);
      const idle = arc({}).w;
      expect(idle.speed).toBe(0);
    });

    it('cannot jump again in mid-air', () => {
      let w = stepWalker(createWalker(), { tilt: 0, wind: 0, jump: true }, DT);
      for (let i = 0; i < 10; i++) w = stepWalker(w, { tilt: 0, wind: 0 }, DT);
      const vy = w.vy;
      const again = stepWalker(w, { tilt: 0, wind: 0, jump: true }, DT);
      expect(again.vy).toBeLessThan(vy); // still falling under gravity, not re-launched
      expect(again.vy).toBeCloseTo(vy - GRAVITY_ACCEL * DT, 9);
    });

    it('cannot jump once fallen', () => {
      const fallen = { ...createWalker(), fallen: true };
      expect(stepWalker(fallen, { tilt: 0, wind: 0, jump: true }, DT)).toBe(fallen);
    });

    it('lean keeps evolving in the air with the standing instability, not the running one', () => {
      const airborne = { ...createWalker(), lean: 0.3, airborne: true, y: 0.3, vy: 0, speed: RUN_SPEED * 1.15 };
      const inAir = stepWalker(airborne, { tilt: 0, wind: 0, running: true }, DT);
      const standing = stepWalker({ ...createWalker(), lean: 0.3 }, { tilt: 0, wind: 0 }, DT);
      expect(inAir.leanVel).toBeCloseTo(standing.leanVel, 12);
      expect(inAir.lean).toBeCloseTo(standing.lean, 12);
    });

    it('can jump again after landing', () => {
      const { w } = arc({});
      expect(stepWalker(w, { tilt: 0, wind: 0, jump: true }, DT).airborne).toBe(true);
    });

    it('a balance fall in mid-air puts the walker on the ground, not hovering', () => {
      const w = stepWalker(
        { ...createWalker(), lean: FALL_ANGLE - 0.0001, leanVel: 2, airborne: true, y: 0.4, vy: 1, speed: 2.4 },
        { tilt: 0, wind: 0 },
        DT,
      );
      expect(w.fallen).toBe(true);
      expect(w).toMatchObject({ y: 0, vy: 0, airborne: false, speed: 0 });
    });
  });
});
