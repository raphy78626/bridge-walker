// Variety for the canyon walls, as plain data and pure maths: no three.js and no noise here, so the tests can run it.
// environment.js asks for a style per rock once at load (styleSpec), then reads it while it displaces and colours the
// vertices of each rock's cylinder. Nothing here costs anything while the game runs: it all ends up in the one merged
// rock mesh's positions and vertex colours, with the same triangle count as plain cylinders.
//
// A rock is a cylinder (r at the base, rTop at the top, h tall). Its style says how that cylinder is reshaped:
//   arch       column | spire | buttress | slab | terrace | mesa | boulder | shelf (the bridge's own ledge)
//   env        [base, top, power] radius multipliers along the height, before ledges and the top shape
//   ledges     [{ t, depth, w, lip }] steps in the profile at height fraction t: the radius drops by `depth` (a negative
//              depth is a cap that juts out) over a narrow `w`, and `lip` swells the rock just under the step (overhang)
//   top        point | round | jagged | mesa | slant
//   squareness cross-section exponent: 2 round, 3-4 blocky
//   cracks, crackDepth, streaks, pal   fissures, mineral streaks and the rock's own colour family

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const sstep = (x, a, b) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A small integer hash to [0, 1): the same value for the same (n, seed), on any engine.
export function hash01(n, seed) {
  let h = (Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(seed * 4096) | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const ARCHETYPES = ['column', 'spire', 'buttress', 'slab', 'terrace', 'mesa', 'boulder', 'shelf'];

// How likely each archetype is in each tier of the layout. The near walls favour broad, ledged shapes (a wall of spires
// would let the sky through); the far ones favour spires and mesas.
export const TIER_WEIGHTS = {
  wall: { column: 0.12, spire: 0.14, buttress: 0.3, slab: 0.18, terrace: 0.26 },
  mid: { column: 0.1, spire: 0.32, buttress: 0.18, slab: 0.22, terrace: 0.18 },
  far: { column: 0.08, spire: 0.17, buttress: 0.2, slab: 0.1, terrace: 0.25, mesa: 0.2 },
  backdrop: { buttress: 0.5, terrace: 0.35, mesa: 0.15 },
  shelf: { shelf: 1 },
  boulder: { boulder: 1 },
};

export function pickArchetype(rand, tier) {
  const weights = TIER_WEIGHTS[tier] ?? TIER_WEIGHTS.mid;
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let u = rand() * total;
  for (const [name, w] of entries) {
    u -= w;
    if (u < 0) return name;
  }
  return entries[entries.length - 1][0];
}

// Warm canyon colour families. The tints multiply the rock's neutral base colour (and the theme's baked lighting after
// that), so they stay near 1: they shift hue and brightness a little, they do not repaint the rock.
export const PALETTES = [
  { name: 'sandstone', tint: [1.03, 1.0, 0.95] },
  { name: 'rust', tint: [1.07, 0.97, 0.87] },
  { name: 'ochre', tint: [1.06, 1.03, 0.86] },
  { name: 'rose', tint: [1.02, 0.95, 0.94] },
  { name: 'umber', tint: [0.97, 0.94, 0.91] },
  { name: 'ash', tint: [0.95, 0.96, 0.99] },
];

export function rockPalette(rand) {
  const p = PALETTES[Math.min(PALETTES.length - 1, Math.floor(rand() * PALETTES.length))];
  const k = 0.84 + rand() * 0.32; // overall brightness of this rock
  const tint = p.tint.map((c) => c * (1 + (rand() - 0.5) * 0.1) * k);
  return { name: p.name, tint };
}

// Mineral streak colours, multiplied in where a streak runs.
export const STREAK_KINDS = {
  varnish: [0.55, 0.56, 0.6], // dark desert varnish
  iron: [1.12, 0.7, 0.5], // rusty iron stain
  bleach: [1.3, 1.22, 1.1], // pale mineral deposit
};

// Each strata band has its own tone: a little lighter or darker, a little warmer or cooler.
export function bandTone(seed, id, out = [1, 1, 1]) {
  const l = 1 + (hash01(id, seed) - 0.5) * 0.38;
  const w = (hash01(id + 977, seed) - 0.5) * 0.24;
  out[0] = l * (1 + w);
  out[1] = l;
  out[2] = l * (1 - w);
  return out;
}

// Hard bands stand proud and soft ones erode back: 0.55 .. 1.45 times the strata's push.
export const bandHardness = (seed, id) => 0.55 + 0.9 * hash01(id + 31, seed);

// ---------- the shape of one rock ----------

// Row spacing: the cylinder's rows are even, so a ledge would be a long slope. Pull the rows in towards each ledge's
// height (a smooth, monotone remap that leaves the ends alone) and the step comes out nearly flat.
const WARP_WIDTH = 0.04;
const WARP_PULL = 0.85;
export function warpT(spec, t) {
  let out = t;
  for (const L of spec.ledges) {
    const u = (t - L.t) / WARP_WIDTH;
    out -= WARP_PULL * (t - L.t) * Math.exp(-u * u);
  }
  return out;
}

function topMul(top, t) {
  switch (top) {
    case 'point':
      return 1 - 0.9 * Math.pow(clamp01((t - 0.86) / 0.14), 1.4);
    case 'round':
      return 0.1 + 0.9 * Math.sqrt(Math.max(0, 1 - Math.pow(clamp01((t - 0.84) / 0.16), 2)));
    case 'jagged':
      return 1 - 0.22 * clamp01((t - 0.9) / 0.1);
    default:
      return 1;
  }
}

// Radius at height fraction t as a multiple of the rock's base radius r: the envelope, the ledges and the top.
export function envelope(spec, t) {
  if (spec.arch === 'boulder') {
    // a wide foot sunk into the ground (or the ledge), then a dome: it sits there instead of balancing on a point
    const dome = Math.sqrt(Math.max(0, 1 - Math.pow(clamp01((t - 0.3) / 0.7), 2.2)));
    return spec.rMul * Math.max(0.08, dome * (0.84 + 0.16 * sstep(t, 0, 0.3)));
  }
  const [a0, a1, power] = spec.env;
  let m = a0 + (a1 - a0) * Math.pow(clamp01(t), power);
  for (const L of spec.ledges) {
    const step = sstep(t, L.t - L.w / 2, L.t + L.w / 2);
    m -= L.depth * step;
    if (L.lip > 0) m += L.lip * sstep(t, L.t - 0.06, L.t - L.w / 2) * (1 - step);
  }
  return Math.max(m * topMul(spec.top, t), 0.06) * spec.rMul;
}

// How many ledges deep we are (smooth, 0 at the foot): drives the twist and the sideways shift of stacked blocks.
export function tierIndex(spec, t) {
  let n = 0;
  for (const L of spec.ledges) n += sstep(t, L.t - L.w / 2, L.t + L.w / 2);
  return n;
}

// 0..1: the shadow tucked under an overhanging lip or a jutting cap.
export function undercut(spec, t) {
  let m = 0;
  for (const L of spec.ledges) {
    if (L.lip > 0.015 || L.depth < 0) m = Math.max(m, 1 - Math.min(1, Math.abs(t - (L.t - 0.035)) / 0.035));
  }
  return m;
}

// Height of the jagged crown at an angle (metres as a fraction of h), from a few sines: the same teeth every run.
export function crown(spec, ang) {
  const c = spec.crown;
  if (!c) return 0;
  let v = 0;
  for (const [f, p, a] of c.waves) v += a * Math.sin(f * ang + p);
  return v * c.amp;
}

// Superellipse cross-section: 1 for a circle, a rounded square for exponent ~4.
export function crossSection(n, phi) {
  if (n < 2.05) return 1;
  const c = Math.abs(Math.cos(phi));
  const s = Math.abs(Math.sin(phi));
  return 0.93 * Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
}

const angDist = (a, b) => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

// How deep into a fissure is the point at angle `ang` (cylinder convention: x = sin, z = cos), height fraction t: 0..1.
// A fissure is a V one column wide that wanders a little with height and comes and goes along its length.
export function crackMask(spec, ang, t) {
  let m = 0;
  const col = TAU / spec.radial;
  for (const c of spec.cracks) {
    const along = sstep(t, c.t0, c.t0 + 0.06) * (1 - sstep(t, c.t1 - 0.08, c.t1)) * (0.7 + 0.3 * Math.sin(t * 41 + c.phase));
    if (along <= 0) continue;
    const a = c.ang + c.wander * Math.sin(t * 9 + c.phase);
    m = Math.max(m, along * clamp01(1 - angDist(ang, a) / col));
  }
  return m;
}

// Mineral streak at the point: { mask 0..1, kind } for the strongest streak there.
export function streakAt(spec, ang, t, out) {
  out.mask = 0;
  out.kind = 'varnish';
  const col = (TAU / spec.radial) * 0.9;
  for (const s of spec.streaks) {
    const along = sstep(t, s.t0, s.t0 + 0.03) * (1 - sstep(t, s.t0 + (s.t1 - s.t0) * 0.15, s.t1)); // starts sharp at the top, fades down
    const m = along * clamp01(1 - angDist(ang, s.ang) / col) * s.strength;
    if (m > out.mask) {
      out.mask = m;
      out.kind = s.kind;
    }
  }
  return out;
}

// The rock's whole style, from its layout spec (which has a `tier`) and its own random stream.
export function styleSpec(spec, rand) {
  const U = (a, b) => a + (b - a) * rand();
  const arch = pickArchetype(rand, spec.tier);
  const side = spec.wall ?? (Math.sign(spec.x) || 1);
  const style = {
    arch,
    seed: rand() * 1000,
    rMul: U(0.86, 1.18),
    env: [1, spec.rTop / spec.r, 1],
    ledges: [],
    top: 'round',
    squareness: 2,
    ax: 1,
    az: 1,
    lean: [0, 0],
    swayMul: 1,
    rot0: rand() * TAU,
    tierTwist: 0,
    tierShift: 0,
    crown: null,
    tilt: 0,
    capLift: 0,
    strataAmp: 0.2,
    dip: U(-0.18, 0.18),
    dipDir: rand() * TAU,
    bulge: spec.bulge * U(0.8, 1.3),
    cracks: [],
    crackDepth: U(0.14, 0.26), // how far a fissure cuts in, as a fraction of the rock's radius
    streaks: [],
    pal: rockPalette(rand),
  };
  const aspect = (a, alongWall = true) => {
    // a > 1 stretches the rock: along the wall (z) for the walls, in a random horizontal direction for the rest
    const s = Math.sqrt(a);
    const alongZ = alongWall && spec.tier === 'wall' ? true : rand() < 0.5;
    style.ax = alongZ ? 1 / s : s;
    style.az = alongZ ? s : 1 / s;
  };
  const ledges = (count, lo, hi, depth, lip, w = 0.008) => {
    // spread over [lo, hi] with some jitter, kept apart so their row pulls hardly overlap
    for (let k = 0; k < count; k++) {
      const t = lo + ((k + 0.5) / count) * (hi - lo) + U(-0.2, 0.2) * ((hi - lo) / count);
      style.ledges.push({ t, depth: U(depth[0], depth[1]), w, lip: rand() < 0.6 ? U(lip[0], lip[1]) : 0 });
    }
    style.ledges.sort((p, q) => p.t - q.t);
  };
  const lean = (outward, inward) => {
    // mostly away from the canyon; toward it only a little, so the gap the bridge crosses stays open
    const out = rand() < 0.8;
    style.lean[0] = out ? side * U(0, outward) : -side * U(0, inward);
    style.lean[1] = U(-0.5, 0.5) * outward;
  };
  switch (arch) {
    case 'column':
      style.top = rand() < 0.5 ? 'round' : 'jagged';
      break;
    case 'spire':
      style.env = [U(1, 1.15), U(0.12, 0.24), 0.85];
      style.top = 'point';
      style.strataAmp = 0.12;
      style.swayMul = 0.8;
      lean(0.1, 0.04);
      if (rand() < 0.5) ledges(1, 0.3, 0.7, [0.03, 0.06], [0, 0.03]);
      break;
    case 'buttress':
      style.env = [U(1.15, 1.3), U(0.85, 1), 1];
      style.top = rand() < 0.55 ? 'mesa' : 'jagged';
      style.strataAmp = 0.26;
      aspect(U(1, 1.6));
      ledges(2 + (rand() < 0.4 ? 1 : 0), 0.25, 0.82, [0.1, 0.19], [0, 0.07]);
      if (style.top === 'mesa') style.ledges.push({ t: U(0.9, 0.93), depth: -U(0.05, 0.1), w: 0.012, lip: 0 });
      style.ledges.sort((p, q) => p.t - q.t);
      break;
    case 'slab':
      style.env = [1.1, U(0.7, 0.9), 1];
      style.top = 'slant';
      style.tilt = U(-0.07, 0.07);
      style.squareness = U(2.4, 3);
      style.strataAmp = 0.22;
      style.swayMul = 0.5;
      aspect(U(1.9, 2.8));
      lean(0.16, 0.05);
      if (rand() < 0.6) ledges(1, 0.3, 0.75, [0.06, 0.12], [0, 0.05]);
      break;
    case 'terrace':
      style.env = [1.05, U(0.9, 1), 1];
      style.top = 'mesa';
      style.squareness = U(3, 4.5);
      style.strataAmp = 0.15;
      style.swayMul = 0.35;
      style.tierTwist = U(0.15, 0.5) * (rand() < 0.5 ? -1 : 1);
      style.tierShift = U(0.04, 0.12);
      aspect(U(1, 1.3));
      ledges(3 + Math.floor(rand() * 3), 0.16, 0.86, [0.07, 0.13], [0, 0.04]);
      break;
    case 'mesa':
      style.env = [1.1, U(0.9, 1), 1];
      style.top = 'mesa';
      style.squareness = U(2, 3);
      style.strataAmp = 0.18;
      aspect(U(1, 1.4), false);
      ledges(1 + Math.floor(rand() * 2), 0.3, 0.8, [0.06, 0.12], [0, 0.04]);
      style.ledges.push({ t: U(0.9, 0.93), depth: -U(0.05, 0.09), w: 0.012, lip: 0 });
      style.ledges.sort((p, q) => p.t - q.t);
      break;
    case 'boulder':
      style.rMul = 1; // its size comes from the layout
      style.strataAmp = 0.1;
      style.swayMul = 0;
      style.dip = 0;
      break;
    default: // shelf: keeps its flat round top (environment.js), only the colour varies
      style.rMul = 1;
      style.top = 'mesa'; // its top is level, at the bridge's height
      style.swayMul = 0;
      style.dip = 0;
      style.strataAmp = 0.12;
      break;
  }
  if (style.top === 'jagged' || style.top === 'slant') {
    style.crown = {
      amp: spec.h * (style.top === 'jagged' ? U(0.045, 0.085) : U(0.02, 0.04)),
      waves: [[3, rand() * TAU, 0.5], [5, rand() * TAU, 0.35], [9, rand() * TAU, 0.25], [14, rand() * TAU, 0.18]],
    };
    style.capLift = style.top === 'jagged' ? U(0.02, 0.05) : 0;
  }
  // fissures and streaks on the face the camera sees (turned towards the canyon and the walker)
  const face = -side * (Math.PI / 4);
  const crackN = arch === 'boulder' || arch === 'shelf' ? 0 : arch === 'spire' ? Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
  for (let k = 0; k < crackN; k++) {
    const colStep = TAU / spec.radial;
    const t0 = U(0.05, 0.45);
    style.cracks.push({
      ang: Math.round((face + U(-1.1, 1.1)) / colStep) * colStep, // on a vertex column, so the V is one column wide
      t0,
      t1: Math.min(0.96, t0 + U(0.25, 0.5)),
      wander: colStep * U(0.2, 0.6),
      phase: rand() * TAU,
    });
  }
  if (arch !== 'boulder' && rand() < 0.65) {
    const kinds = ['varnish', 'varnish', 'iron', 'bleach'];
    const n = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const t1 = U(0.5, 0.95);
      style.streaks.push({ ang: face + U(-1.2, 1.2), t0: Math.max(0.05, t1 - U(0.2, 0.5)), t1, kind: kinds[Math.floor(rand() * kinds.length)], strength: U(0.7, 1) });
    }
  }
  return { ...spec, ...style };
}
