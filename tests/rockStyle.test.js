import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/game/rng.js';
import { ARCHETYPES, PALETTES, TIER_WEIGHTS, bandHardness, bandTone, crackMask, crossSection, envelope, hash01, pickArchetype, rockPalette, streakAt, styleSpec, tierIndex, warpT } from '../src/tv/rockStyle.js';
import { buildRockGeometry, cliffSpecs } from '../src/tv/environment.js';

const baseSpec = (tier, extra = {}) => ({ tier, x: 30, z: -20, base: -46, h: 70, r: 8, rTop: 5.5, radial: 34, rows: 52, bulge: 0.42, o: [1, 2, 3], bandH: 8, ...extra });

describe('archetype selection', () => {
  it('is deterministic for a seed', () => {
    const a = Array.from({ length: 40 }, (_, i) => pickArchetype(mulberry32(i), 'wall'));
    const b = Array.from({ length: 40 }, (_, i) => pickArchetype(mulberry32(i), 'wall'));
    expect(a).toEqual(b);
  });

  it('only returns archetypes its tier allows, and reaches all of them', () => {
    for (const tier of Object.keys(TIER_WEIGHTS)) {
      const rand = mulberry32(5);
      const seen = new Set();
      for (let i = 0; i < 600; i++) seen.add(pickArchetype(rand, tier));
      expect([...seen].sort()).toEqual(Object.keys(TIER_WEIGHTS[tier]).sort());
      for (const name of seen) expect(ARCHETYPES).toContain(name);
    }
  });

  it('follows the weights roughly: the near walls are mostly buttresses and terraces, not spires', () => {
    const rand = mulberry32(9);
    const n = { buttress: 0, terrace: 0, spire: 0 };
    for (let i = 0; i < 2000; i++) {
      const a = pickArchetype(rand, 'wall');
      if (a in n) n[a]++;
    }
    expect(n.buttress + n.terrace).toBeGreaterThan(n.spire * 3);
  });
});

describe('colour variation', () => {
  it('keeps every rock palette in the warm, near-neutral range', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const { tint } = rockPalette(rand);
      for (const c of tint) {
        expect(c).toBeGreaterThan(0.7);
        expect(c).toBeLessThan(1.3);
      }
      const lum = 0.3 * tint[0] + 0.59 * tint[1] + 0.11 * tint[2];
      expect(lum).toBeGreaterThan(0.78);
      expect(lum).toBeLessThan(1.25);
      expect(tint[0]).toBeGreaterThanOrEqual(tint[2] * 0.85); // never cooler than a warm grey
    }
  });

  it('palettes average out near neutral, so the walls keep their overall colour', () => {
    const mean = [0, 1, 2].map((k) => PALETTES.reduce((s, p) => s + p.tint[k], 0) / PALETTES.length);
    expect(mean[0]).toBeGreaterThan(0.97);
    expect(mean[0]).toBeLessThan(1.05);
    expect(mean[2]).toBeGreaterThan(0.88);
  });

  it('strata band tones and hardness stay bounded and repeat for the same band', () => {
    for (let id = -20; id < 20; id++) {
      const tone = bandTone(12.5, id);
      for (const c of tone) {
        expect(c).toBeGreaterThan(0.65);
        expect(c).toBeLessThan(1.4);
      }
      expect(bandTone(12.5, id)).toEqual(tone);
      const hard = bandHardness(12.5, id);
      expect(hard).toBeGreaterThanOrEqual(0.55);
      expect(hard).toBeLessThanOrEqual(1.45);
    }
    expect(hash01(4, 1.5)).toBe(hash01(4, 1.5));
    expect(hash01(4, 1.5)).not.toBe(hash01(5, 1.5));
  });
});

describe('rock profile', () => {
  const styled = Array.from({ length: 80 }, (_, i) => styleSpec(baseSpec(['wall', 'mid', 'far'][i % 3], { wall: i % 3 === 0 ? (i % 2 ? 1 : -1) : undefined }), mulberry32(100 + i)));

  it('has a positive radius from the foot to the top, for every archetype', () => {
    for (const spec of styled) {
      for (let k = 0; k <= 100; k++) {
        const e = envelope(spec, k / 100);
        expect(Number.isFinite(e)).toBe(true);
        expect(e).toBeGreaterThan(0);
        expect(e).toBeLessThan(2);
      }
    }
  });

  it('pulls rows towards ledges without reordering or moving the ends', () => {
    for (const spec of styled) {
      let prev = -1;
      for (let k = 0; k <= 200; k++) {
        const w = warpT(spec, k / 200);
        expect(w).toBeGreaterThan(prev);
        prev = w;
      }
      expect(Math.abs(warpT(spec, 0))).toBeLessThan(5e-3);
      expect(Math.abs(warpT(spec, 1) - 1)).toBeLessThan(5e-3);
    }
  });

  it('puts ledges inside the rock and apart from each other', () => {
    for (const spec of styled) {
      const ts = spec.ledges.map((l) => l.t);
      for (const t of ts) {
        expect(t).toBeGreaterThan(0.1);
        expect(t).toBeLessThan(0.95);
      }
      for (let k = 1; k < ts.length; k++) expect(ts[k] - ts[k - 1]).toBeGreaterThan(0.03);
      expect(tierIndex(spec, 1)).toBeCloseTo(spec.ledges.length, 1);
    }
  });

  it('is deterministic: the same seed styles a rock the same way', () => {
    const a = styleSpec(baseSpec('wall', { wall: 1 }), mulberry32(77));
    const b = styleSpec(baseSpec('wall', { wall: 1 }), mulberry32(77));
    expect(a).toEqual(b);
  });

  it('gives different rocks different shapes and colours', () => {
    expect(new Set(styled.map((s) => s.arch)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(styled.map((s) => s.pal.name)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(styled.map((s) => s.top)).size).toBeGreaterThanOrEqual(4);
  });

  it('leans away from the canyon far more than into it', () => {
    for (let i = 0; i < 60; i++) {
      const side = i % 2 ? 1 : -1;
      const spec = styleSpec(baseSpec('wall', { wall: side }), mulberry32(500 + i));
      expect(-side * spec.lean[0]).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});

describe('fissures and streaks', () => {
  const spec = styleSpec(baseSpec('wall', { wall: 1, x: 28 }), mulberry32(1));
  it('only cut inside their height range, and stay within 0..1', () => {
    const ang = spec.cracks[0]?.ang ?? 0;
    for (let k = 0; k <= 100; k++) {
      const m = crackMask(spec, ang, k / 100);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
    for (const c of spec.cracks) {
      expect(c.t1).toBeLessThanOrEqual(0.96);
      expect(crackMask(spec, c.ang, 0.995)).toBe(0);
    }
    expect(spec.crackDepth).toBeGreaterThan(0.1);
    expect(spec.crackDepth).toBeLessThan(0.3);
  });

  it('are narrow: a fissure is gone a column away', () => {
    const c = spec.cracks[0];
    const col = (Math.PI * 2) / spec.radial;
    const t = (c.t0 + c.t1) / 2;
    expect(crackMask(spec, c.ang + col * 1.5 + c.wander, t)).toBe(0);
  });

  it('streak masks stay in 0..1 and name a known mineral', () => {
    const out = { mask: 0, kind: '' };
    for (let i = 0; i < 40; i++) {
      const s = styleSpec(baseSpec('mid', { x: -40 }), mulberry32(2000 + i));
      for (let a = 0; a < 12; a++) {
        for (let k = 0; k <= 20; k++) {
          streakAt(s, (a / 12) * Math.PI * 2, k / 20, out);
          expect(out.mask).toBeGreaterThanOrEqual(0);
          expect(out.mask).toBeLessThanOrEqual(1);
          expect(['varnish', 'iron', 'bleach']).toContain(out.kind);
        }
      }
    }
  });

  it('cross-sections are round by default and square-ish when asked, never degenerate', () => {
    expect(crossSection(2, 1.234)).toBe(1);
    for (let k = 0; k < 64; k++) {
      const v = crossSection(4, (k / 64) * Math.PI * 2);
      expect(v).toBeGreaterThan(0.85);
      expect(v).toBeLessThan(1.2);
    }
  });
});

describe('the canyon', () => {
  const specs = cliffSpecs();

  it('mixes archetypes on the near walls', () => {
    const arch = new Set(specs.filter((s) => s.tier === 'wall').map((s) => s.arch));
    expect(arch.size).toBeGreaterThanOrEqual(4);
  });

  it('keeps the waterfalls hosts, and the bridge ledges flat-topped', () => {
    expect(specs.filter((s) => s.backdrop)).toHaveLength(3);
    const shelves = specs.filter((s) => s.ledge);
    expect(shelves).toHaveLength(2);
    for (const s of shelves) expect(s.flat).toBe(true);
  });

  it('builds finite geometry for every rock, with the cylinders triangle count', () => {
    let tris = 0;
    for (const spec of specs) {
      const g = buildRockGeometry(spec);
      for (const name of ['position', 'normal', 'uv', 'color']) {
        const a = g.attributes[name].array;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`${spec.arch} ${name}[${i}] is ${a[i]}`);
      }
      const c = g.attributes.color.array;
      for (let i = 0; i < c.length; i++) {
        if (c[i] < 0 || c[i] > 2) throw new Error(`${spec.arch} colour ${c[i]}`);
      }
      tris += g.index.count / 3;
    }
    expect(tris).toBeLessThan(169884 * 1.15); // the plain-cylinder canyon had 169,884; the budget is +15%
    expect(tris).toBeGreaterThan(169884 * 0.99);
  });
});
