import { describe, it, expect } from 'vitest';
import { jumpPose, createPose, phaseOf, POSE_BONES, PUSH_TIME, LAND_TIME, FLAIL_HZ } from '../src/tv/jumpPose.js';
import { createWalker, stepWalker, JUMP_VY } from '../src/game/balance.js';

const DT = 1 / 60;
const GROUND = { airborne: false, vy: 0, tAir: 0, tLand: Infinity, falling: false, tFall: 0, lead: 1 };
const flat = (pose) => POSE_BONES.flatMap((n) => pose.bones[n].slice(0, 3)).concat(pose.pivotY, pose.pitch);
const weights = (pose) => POSE_BONES.map((n) => pose.bones[n][3]);
const copy = (pose) => ({ ...pose, bones: Object.fromEntries(POSE_BONES.map((n) => [n, pose.bones[n].slice()])) });

// A whole jump from the real physics: take-off, flight, landing, and half a second on the planks.
function jumpStates() {
  const states = [];
  let w = { ...createWalker(), z: 3 };
  let tAir = 0;
  let tLand = Infinity;
  const input = { tilt: 0, wind: 0, walking: true, running: false, jump: true };
  let wasAir = false;
  for (let i = 0; i < 90; i++) {
    w = stepWalker(w, { ...input, jump: i === 0 }, DT);
    if (w.airborne && !wasAir) tAir = 0;
    if (!w.airborne && wasAir) tLand = 0;
    wasAir = w.airborne;
    states.push({ airborne: w.airborne, vy: w.vy, tAir, tLand, falling: false, tFall: 0, lead: 1 });
    tAir += DT;
    tLand += DT;
  }
  return states;
}

describe('jumpPose phases', () => {
  it('picks the phase from the state', () => {
    expect(phaseOf(GROUND)).toBe('ground');
    expect(phaseOf({ airborne: true, vy: 3, tAir: 0.03 })).toBe('pushoff');
    expect(phaseOf({ airborne: true, vy: 1.5, tAir: 0.2 })).toBe('rise');
    expect(phaseOf({ airborne: true, vy: 2.5, tAir: PUSH_TIME + 0.01 })).toBe('rise'); // past the push window, still rising
    expect(phaseOf({ airborne: true, vy: -1, tAir: 0.45 })).toBe('descent');
    expect(phaseOf({ airborne: false, tLand: 0.1 })).toBe('landing');
    expect(phaseOf({ airborne: false, tLand: LAND_TIME + 0.01 })).toBe('ground');
    expect(phaseOf({ falling: true, airborne: false, tFall: 0.3 })).toBe('falling');
    expect(phaseOf({ falling: true, airborne: true, vy: 1 })).toBe('falling');
  });

  it('walks through every phase in order on a real physics jump', () => {
    const seen = [];
    for (const s of jumpStates()) {
      const p = jumpPose(s).phase;
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual(['pushoff', 'rise', 'descent', 'landing', 'ground']);
  });
});

describe('jumpPose output', () => {
  it('is all zero when grounded and idle, so the animation is untouched', () => {
    const pose = jumpPose(GROUND);
    expect(weights(pose).every((w) => w === 0)).toBe(true);
    expect(flat(pose).every((x) => x === 0)).toBe(true);
    for (const state of [{}, { tLand: LAND_TIME + 1 }, { airborne: false, tAir: 5, vy: 0 }]) {
      expect(flat(jumpPose(state)).every((x) => x === 0)).toBe(true);
    }
  });

  it('writes into the pose it is given and returns it', () => {
    const out = createPose();
    expect(jumpPose({ airborne: true, vy: 2, tAir: 0.2 }, out)).toBe(out);
    expect(out.bones.LeftUpLeg[3]).toBeGreaterThan(0);
  });

  it('tucks at the apex: thighs come up 60-75 deg, knees bend 90-110 deg, bent forwards, one leg leading', () => {
    const pose = jumpPose({ airborne: true, vy: 0, tAir: 0.33, lead: 1 });
    const angle = (name, axis) => pose.bones[name][axis] / pose.bones[name][3];
    const deg = (r) => (r * 180) / Math.PI;
    for (const side of ['Left', 'Right']) {
      const thigh = -angle(`${side}UpLeg`, 0); // negative x is the thigh forward
      const knee = angle(`${side}Leg`, 0); // positive x bends the knee, and it must never go negative
      expect(deg(thigh)).toBeGreaterThan(57);
      expect(deg(thigh)).toBeLessThan(80);
      expect(deg(knee)).toBeGreaterThan(88);
      expect(deg(knee)).toBeLessThan(112);
    }
    expect(-angle('RightUpLeg', 0)).toBeGreaterThan(-angle('LeftUpLeg', 0)); // lead = +1: the right leg is higher
    const flipped = jumpPose({ airborne: true, vy: 0, tAir: 0.33, lead: -1 });
    expect(-flipped.bones.LeftUpLeg[0]).toBeGreaterThan(-flipped.bones.RightUpLeg[0]);
  });

  it('extends the legs forward and down on the way down', () => {
    const apex = jumpPose({ airborne: true, vy: 0, tAir: 0.33 });
    const down = jumpPose({ airborne: true, vy: -3, tAir: 0.64 });
    expect(down.bones.LeftLeg[0]).toBeLessThan(apex.bones.LeftLeg[0] / 2); // knees straighten
    expect(-down.bones.LeftUpLeg[0]).toBeGreaterThan(0.3); // thighs still forward to meet the planks
  });

  it('never bends a knee backwards in any phase', () => {
    const states = [...jumpStates(), ...Array.from({ length: 80 }, (_, i) => ({ falling: true, tFall: i * DT }))];
    for (const s of states) {
      const pose = jumpPose(s);
      for (const n of ['LeftLeg', 'RightLeg']) expect(pose.bones[n][0]).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('squats on landing, dips the pivot about 0.12 m, then decays to nothing by LAND_TIME', () => {
    const at = (tLand) => jumpPose({ airborne: false, tLand });
    const deep = at(0.1);
    const knee = deep.bones.LeftLeg[0] / deep.bones.LeftLeg[3];
    const thigh = -deep.bones.LeftUpLeg[0] / deep.bones.LeftUpLeg[3];
    expect((knee * 180) / Math.PI).toBeGreaterThan(60);
    expect((knee * 180) / Math.PI).toBeLessThan(80);
    expect((thigh * 180) / Math.PI).toBeGreaterThan(33);
    expect((thigh * 180) / Math.PI).toBeLessThan(48);
    expect(deep.pivotY).toBeLessThan(-0.1);
    expect(deep.pivotY).toBeGreaterThan(-0.14);
    expect(deep.pitch).toBeGreaterThan(0.03); // hips pitch forward
    expect(deep.bones.Hips[0] / deep.bones.Hips[3]).toBeGreaterThan(0.05);
    // strictly easing out after the deepest point
    let prev = Infinity;
    for (let t = 0.12; t < LAND_TIME; t += 0.02) {
      const w = at(t).bones.LeftLeg[3];
      expect(w).toBeLessThan(prev);
      prev = w;
    }
    const done = at(LAND_TIME);
    expect(flat(done).every((x) => x === 0)).toBe(true);
    expect(weights(done).every((w) => w === 0)).toBe(true);
  });

  it('flails while falling, on a 2.5 Hz beat that repeats exactly', () => {
    const period = 1 / FLAIL_HZ;
    for (const t0 of [0.5, 0.63, 1.1]) {
      const a = jumpPose({ falling: true, tFall: t0 });
      const b = jumpPose({ falling: true, tFall: t0 + period });
      const c = jumpPose({ falling: true, tFall: t0 + 2 * period });
      expect(flat(a).map((x) => +x.toFixed(9))).toEqual(flat(b).map((x) => +x.toFixed(9)));
      expect(flat(a).map((x) => +x.toFixed(9))).toEqual(flat(c).map((x) => +x.toFixed(9)));
    }
    // it actually moves within a beat: arms and legs swing by more than half a radian
    for (const bone of ['LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'LeftForeArm']) {
      const xs = Array.from({ length: 40 }, (_, i) => jumpPose({ falling: true, tFall: 1 + (i * period) / 40 }).bones[bone][0]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
    }
    // the two arms (and the two legs) are out of phase with each other
    const p = jumpPose({ falling: true, tFall: 1.03 });
    expect(p.bones.LeftArm[0]).not.toBeCloseTo(-p.bones.RightArm[0], 2);
    expect(p.bones.LeftUpLeg[0]).not.toBeCloseTo(p.bones.RightUpLeg[0], 2);
  });

  it('starts the flail from the current pose and eases in without a pop', () => {
    expect(weights(jumpPose({ falling: true, tFall: 0 })).every((w) => w === 0)).toBe(true);
    let prev = copy(jumpPose({ falling: true, tFall: 0 }));
    for (let i = 1; i <= 12; i++) {
      const next = copy(jumpPose({ falling: true, tFall: i * DT }));
      const a = flat(prev);
      const b = flat(next);
      for (let k = 0; k < a.length; k++) expect(Math.abs(b[k] - a[k])).toBeLessThan(0.3);
      prev = next;
    }
    expect(Math.min(...weights(jumpPose({ falling: true, tFall: 0.3 })))).toBe(1);
  });

  it('does not move the pivot while falling (the scene owns the roll and drop)', () => {
    const p = jumpPose({ falling: true, tFall: 0.5, tLand: 0.05 });
    expect(p.pivotY).toBe(0);
    expect(p.pitch).toBe(0);
  });
});

describe('jumpPose smoothness', () => {
  it('moves no bone more than 0.2 rad (or 0.2 of a blend weight) between 1/60 s steps across a whole jump', () => {
    const states = jumpStates();
    expect(states.some((s) => s.airborne)).toBe(true);
    expect(JUMP_VY).toBeGreaterThan(0);
    let prev = copy(jumpPose(states[0]));
    let worst = 0;
    for (const s of states.slice(1)) {
      const next = copy(jumpPose(s));
      const a = flat(prev);
      const b = flat(next);
      for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(b[k] - a[k]));
      const wa = weights(prev);
      const wb = weights(next);
      for (let k = 0; k < wa.length; k++) worst = Math.max(worst, Math.abs(wb[k] - wa[k]));
      prev = next;
    }
    expect(worst).toBeLessThan(0.2);
  });

  it('stays smooth when he jumps again while the last landing squat is still easing out', () => {
    // landing at t = 0 then a fresh take-off 0.08 s later (jump button mashed)
    let prev = null;
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const t = i * DT;
      const airborne = t >= 0.08;
      const s = { airborne, vy: airborne ? JUMP_VY - 9.8 * (t - 0.08) : 0, tAir: Math.max(0, t - 0.08), tLand: t, lead: -1 };
      const next = copy(jumpPose(s));
      if (prev) {
        const a = flat(prev);
        const b = flat(next);
        for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(b[k] - a[k]));
      }
      prev = next;
    }
    expect(worst).toBeLessThan(0.25); // a squat has to give way to a take-off within 0.14 s, so a little looser
  });

  it('keeps every blend weight inside 0..1', () => {
    for (const s of [...jumpStates(), ...Array.from({ length: 80 }, (_, i) => ({ falling: true, tFall: i * DT, tLand: 0.05 }))]) {
      for (const w of weights(jumpPose(s))) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
