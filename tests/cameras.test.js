import { describe, it, expect } from 'vitest';
import {
  CAMERA_MODES, nextCamera, loadCameraMode, saveCameraMode, povCamera, stepRate, dampStep, createCinematic, POV, CINEMA,
} from '../src/tv/cameras.js';

const walker = (o = {}) => ({ z: 10, y: 0, vy: 0, airborne: false, speed: 0, lean: 0, leanVel: 0, fallen: false, ...o });

describe('camera cycle', () => {
  it('steps chase -> pov -> cinematic -> chase', () => {
    expect(CAMERA_MODES).toEqual(['chase', 'pov', 'cinematic']);
    expect(nextCamera('chase')).toBe('pov');
    expect(nextCamera('pov')).toBe('cinematic');
    expect(nextCamera('cinematic')).toBe('chase');
  });
  it('treats an unknown mode as chase', () => {
    expect(nextCamera('???')).toBe('pov');
    expect(nextCamera(undefined)).toBe('pov');
  });
});

describe('camera persistence', () => {
  const store = (init) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  };
  it('round-trips the mode', () => {
    const s = store({});
    saveCameraMode('cinematic', s);
    expect(loadCameraMode(s)).toBe('cinematic');
  });
  it('falls back to chase for missing or bad values', () => {
    expect(loadCameraMode(store({}))).toBe('chase');
    expect(loadCameraMode(store({ 'bridge.camera': 'banana' }))).toBe('chase');
    expect(loadCameraMode(undefined)).toBe('chase');
  });
  it('never throws when storage does', () => {
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(loadCameraMode(bad)).toBe('chase');
    expect(() => saveCameraMode('pov', bad)).not.toThrow();
  });
});

describe('povCamera', () => {
  it('puts the eye 1.65 m above the planks, straight ahead along the bridge', () => {
    const c = povCamera(walker({ z: 12 }));
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(POV.eye);
    expect(c.z).toBe(-12);
    expect(c.roll).toBeCloseTo(0);
    expect(c.pitch).toBeCloseTo(POV.pitch); // looks a little down
    expect(c.pitch).toBeLessThan(0);
  });

  it('rolls with the lean by 0.8, against it in sign (a lean right tilts the horizon left)', () => {
    const c = povCamera(walker({ lean: 0.5 }));
    expect(c.roll).toBeCloseTo(-0.5 * 0.8);
    expect(povCamera(walker({ lean: -0.5 })).roll).toBeCloseTo(0.4);
    // and the head swings out to the leaning side, and sinks
    expect(c.x).toBeCloseTo(POV.eye * Math.sin(0.5));
    expect(c.y).toBeCloseTo(POV.eye * Math.cos(0.5));
  });

  it('bobs 0.03 to 0.05 m while moving, and not at all standing or in the air', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let p = 0; p < Math.PI * 4; p += 0.05) {
      const y = povCamera(walker({ speed: 2.8 }), p).y - POV.eye;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    expect(hi).toBeGreaterThan(0.03);
    expect(hi).toBeLessThanOrEqual(0.05);
    expect(lo).toBeCloseTo(-hi, 2);
    for (const w of [walker({ speed: 0 }), walker({ speed: 2.8, airborne: true })]) {
      expect(povCamera(w, 1.3).y).toBeCloseTo(POV.eye);
    }
  });

  it('rises with the jump, looks up on take-off and down on the way back', () => {
    expect(povCamera(walker({ y: 0.4, airborne: true })).y).toBeCloseTo(POV.eye + 0.4);
    const up = povCamera(walker({ airborne: true, vy: 3.2 })).pitch;
    const down = povCamera(walker({ airborne: true, vy: -3.2 })).pitch;
    expect(up).toBeGreaterThan(POV.pitch);
    expect(down).toBeLessThan(POV.pitch);
  });

  it('nods down and dips on the landing squat', () => {
    const c = povCamera(walker(), 0, { pivotY: -0.12, pitch: 0 });
    expect(c.y).toBeCloseTo(POV.eye - 0.12);
    expect(c.pitch).toBeLessThan(POV.pitch);
  });

  it('steps at the gait rate', () => {
    expect(stepRate(0)).toBe(0);
    expect(stepRate(1.4)).toBeGreaterThan(1.5);
    expect(stepRate(2.8)).toBeGreaterThan(stepRate(1.4));
  });
});

describe('dampStep', () => {
  it('settles on the target without overshooting', () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 400; i++) {
      [x, v] = dampStep(x, v, 5, 3, 1 / 60);
      expect(x).toBeLessThanOrEqual(5 + 1e-9);
    }
    expect(x).toBeCloseTo(5, 3);
  });
  it('is the same however the time is sliced', () => {
    let [a, av] = [0, 0];
    let [b, bv] = [0, 0];
    [a, av] = dampStep(a, av, 2, 3, 0.5);
    for (let i = 0; i < 5; i++) [b, bv] = dampStep(b, bv, 2, 3, 0.1);
    expect(b).toBeCloseTo(a, 9);
    expect(bv).toBeCloseTo(av, 9);
  });
  it('does not move when already there', () => {
    expect(dampStep(3, 0, 3, 4, 0.016)).toEqual([3, 0]);
  });
});

describe('cinematic camera', () => {
  it('sits behind, to the side and above the deck, looking ahead along the bridge', () => {
    const c = createCinematic();
    const o = c.update({ z: 30, y: 0 }, 0, false, 0.016);
    expect(o.x).toBe(CINEMA.side);
    expect(o.y).toBeGreaterThan(2);
    expect(o.z).toBeGreaterThan(-30); // behind him (he walks towards -z)
    expect(o.lz).toBeLessThan(-30); // aiming ahead of him
  });

  it('rides above the rock ledges at the two ends of the bridge', () => {
    const c = createCinematic();
    expect(c.update({ z: 0.5, y: 0 }, 0, false, 0.016).y).toBeGreaterThan(2);
    c.reset();
    expect(c.update({ z: 59, y: 0 }, 0, false, 0.016).y).toBeGreaterThan(2);
  });

  it('pans smoothly: lags a walker who moves, never snaps, and catches up', () => {
    const c = createCinematic();
    c.update({ z: 20, y: 0 }, 0, false, 0.016);
    const zs = [];
    for (let i = 0; i < 30; i++) zs.push(c.update({ z: 20 + (i + 1) * 0.05, y: 0 }, 0, false, 1 / 60).z);
    const target = -(20 + 30 * 0.05) - CINEMA.ahead;
    expect(zs[29]).toBeGreaterThan(target); // still behind him (z decreases as he walks)
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThanOrEqual(zs[i - 1] + 1e-9);
    for (let i = 0; i < 600; i++) c.update({ z: 21.5, y: 0 }, 0, false, 1 / 60);
    expect(c.update({ z: 21.5, y: 0 }, 0, false, 1 / 60).z).toBeCloseTo(-21.5 - CINEMA.ahead, 2);
  });

  it('cuts instead of gliding across the whole bridge (a new level)', () => {
    const c = createCinematic();
    c.update({ z: 59, y: 0 }, 0, false, 0.016);
    const o = c.update({ z: 0, y: 0 }, 0, false, 0.016);
    expect(o.z).toBeCloseTo(-CINEMA.ahead);
  });

  it('follows a fall down, and the aim point goes with him', () => {
    const c = createCinematic();
    c.update({ z: 20, y: 0 }, 0, false, 0.016);
    let o;
    for (let i = 0; i < 60; i++) o = c.update({ z: 20, y: 0 }, -4.9 * (i / 60) ** 2, true, 1 / 60);
    expect(o.ly).toBeLessThan(-1);
    expect(o.y).toBeLessThan(CINEMA.deck);
  });
});
