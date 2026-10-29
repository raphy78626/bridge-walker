import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { BRIDGE_LENGTH } from '../game/session.js';
import { mulberry32 } from '../game/rng.js';
import { STREAK_KINDS, bandHardness, bandTone, crackMask, crossSection, crown, envelope, sstep, streakAt, styleSpec, tierIndex, undercut, warpT } from './rockStyle.js';

// The canyon's rock: where each rock stands (the layout), how it is shaped and coloured (rockStyle.js), and its geometry.
// No DOM and no renderer here, so the same code runs on the page and in the canyon worker (canyonWorker.js), and in the
// tests. The whole canyon comes from one seed: cliffSpecs(seed). CLASSIC_SEED is the canyon the game had before every
// level got its own.

export const TEX_M = 9; // metres of rock covered by one tile of the rock texture
export const CLASSIC_SEED = 42;
export const noise = new ImprovedNoise();

export function fbm(x, y, z, octaves) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise.noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// Radial scale of the surface at an undisplaced point (px, pz) at height py above the rock's base: big bulges,
// vertical flutes, and strata. The strata are layers that swell outward then step back in (ledges and overhangs); each
// layer has its own hardness (how far it stands out) and the layers dip a little and wave with the noise, so their
// edges are never level. `band` (optional) receives the layer's id, for the colour.
function rockScale(spec, px, py, pz, band) {
  const o = spec.o;
  const k = spec.fq ?? 1; // noise frequency: small boulders need finer features
  const x = px * k;
  const y = py * k;
  const z = pz * k;
  const big = fbm(x * 0.06 + o[0], y * 0.035 + o[1], z * 0.06 + o[2], 4);
  const flute = 1 - Math.abs(noise.noise(x * 0.32 + o[2], y * 0.02, z * 0.32 + o[0]));
  const dip = ((spec.dip ?? 0) * (px * Math.cos(spec.dipDir ?? 0) + pz * Math.sin(spec.dipDir ?? 0))) / spec.bandH;
  const s = y / spec.bandH + 0.9 * noise.noise(x * 0.05 + o[1], y * 0.015, z * 0.05) + dip;
  const id = Math.floor(s);
  const f = s - id;
  const strata = sstep(f, 0, 0.8) * (1 - sstep(f, 0.8, 0.86));
  const fine = fbm(x * 0.3 + o[1], y * 0.3 + o[0], z * 0.3 + o[2], 2);
  if (band) band.id = id;
  const push = (spec.strataAmp ?? 0.2) * bandHardness(spec.seed ?? 0, id);
  const sc = 1 + spec.bulge * big + 0.14 * (flute - 0.5) + push * (strata - 0.4) + 0.035 * fine;
  return Math.max(sc, 0.35);
}

// Columns lean and shift with height instead of standing as straight pipes. Writes [x, z] into out.
function rockSway(spec, y, out) {
  if (spec.flat) {
    out[0] = out[1] = 0;
    return out;
  }
  const t = y / spec.h;
  const m = (spec.swayMul ?? 1) * spec.r * t;
  out[0] = (Math.sin(y * 0.045 + spec.o[0]) * 0.28 + fbm(0, y * 0.02 + spec.o[1], spec.o[2], 2) * 0.5) * m;
  out[1] = Math.cos(y * 0.037 + spec.o[2]) * 0.28 * m;
  return out;
}

function cliffSpec(rand, p) {
  return { ...p, o: [rand() * 200, rand() * 200, rand() * 200], bandH: 6 + rand() * 6 };
}

const SWAY = [0, 0];
const BAND = { id: 0 };
const TONE = [1, 1, 1];
const STREAK = { mask: 0, kind: 'varnish' };

// Where the cylinder's point (x, z) at row fraction t0 ends up, in the rock's own frame (metres from its axis and
// above its base): the profile (taper, ledges, top shape), the cross-section, the noise and strata, the fissures, the
// lean and the sway. Results in `out`: x, y, z, plus sc (the noise's own scale, for crevice shading), t (the row after
// the ledge pull), ang (cylinder angle), rr (radius reached, for the texture's v), crack and under (0..1 shading).
const DISPLACED = { x: 0, y: 0, z: 0, sc: 1, t: 0, ang: 0, rr: 0, crack: 0, under: 0 };
export function displace(spec, x, z, t0, out) {
  const { r, rTop, h } = spec;
  const t = warpT(spec, t0);
  const y = t * h;
  const lin = r + (rTop - r) * t0;
  const ratio = (r * envelope(spec, t)) / lin;
  const bx = x * ratio;
  const bz = z * ratio;
  const ang = Math.atan2(bx, bz); // the cylinder's own convention: x = sin, z = cos
  const tier = tierIndex(spec, t);
  const xs = crossSection(spec.squareness, ang - spec.rot0 - spec.tierTwist * tier);
  let sc = rockScale(spec, bx, y, bz, BAND);
  if (spec.flat) sc = 1 + (sc - 1) * (1 - 0.5 * sstep(t, 0.85, 0.98)); // level top, but the rim stays a little ragged
  const crack = crackMask(spec, ang, t);
  const f = xs * sc * (1 - spec.crackDepth * crack);
  const sway = rockSway(spec, y, SWAY);
  const shift = spec.tierShift * r * tier;
  const ox = bx * f + sway[0] + spec.lean[0] * h * t + shift * Math.sin(spec.seed + tier * 2.3);
  const oz = bz * f + sway[1] + spec.lean[1] * h * t + shift * Math.cos(spec.seed + tier * 1.7);
  let yy = y;
  if (!spec.flat && t > 0.8) {
    const k = sstep(t, 0.85, 1);
    if (spec.crown) yy += crown(spec, ang) * k;
    if (spec.tilt) yy += spec.tilt * h * (bx / r) * k;
    if (x === 0 && z === 0) yy += spec.capLift * h; // the cap's centre: a low pyramid on a crown
    if (t > 0.9) {
      const flatTop = spec.top === 'mesa' || spec.top === 'slant';
      const rough = fbm(x * 0.25 + spec.o[0], 0, z * 0.25 + spec.o[2], 2) * 0.05 * sstep(t, 0.9, 1) * (flatTop ? 0.25 : 1);
      const dome = flatTop ? 0 : 0.04 * (1 - Math.min(1, Math.hypot(x, z) / rTop));
      yy += (rough + dome) * h;
    }
  }
  out.x = ox * (spec.sx ?? 1) * spec.ax;
  out.z = oz * spec.az;
  out.y = yy;
  out.sc = sc;
  out.t = t;
  out.ang = ang;
  out.rr = Math.hypot(bx * f, bz * f);
  out.crack = crack;
  out.under = undercut(spec, t);
  return out;
}

export function buildRockGeometry(spec) {
  const { r, rTop, h, radial, rows } = spec;
  const geo = new THREE.CylinderGeometry(rTop, r, h, radial, rows);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const torso = (radial + 1) * (rows + 1);
  const reps = Math.max(1, Math.round((Math.PI * (r + rTop)) / TEX_M)); // whole tiles around, so the seam matches
  const colors = new Float32Array(pos.count * 3);
  const { clamp } = THREE.MathUtils;
  const [pr, pg, pb] = spec.pal.tint;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t0 = (pos.getY(i) + h / 2) / h;
    const d = displace(spec, x, z, t0, DISPLACED);
    pos.setXYZ(i, d.x, d.y - h / 2, d.z);
    // texture: u around, v up the rock; v also follows how far a face steps in or out, so a ledge's top is not smeared
    const v = (d.y + 0.8 * (r + (rTop - r) * d.t - d.rr)) / TEX_M;
    if (i < torso) uv.setXY(i, uv.getX(i) * reps, v);
    else uv.setXY(i, x / TEX_M, z / TEX_M);

    // Baked colour, before the theme's lighting multiplies it: crevice darkening (noise, fissures, the shadow under a
    // lip), deeper = darker (cloud shadow), darker at the foot and lighter at the top, the rock's own colour family,
    // its strata band's tone, and the occasional mineral streak.
    const ao = clamp(0.82 + (d.sc - 1) * 1.3, 0.45, 1.1) * (1 - 0.35 * d.under) * (1 - 0.55 * d.crack);
    const depth = 0.55 + 0.45 * sstep(d.y + spec.base, -40, -2);
    const tint = 0.04 * noise.noise(x * 0.02 + spec.o[0], d.y * 0.03, z * 0.02);
    const grad = 0.84 + 0.26 * sstep(d.t, 0.05, 1);
    const tone = bandTone(spec.seed, BAND.id, TONE);
    const k = ao * depth * grad;
    let cr = k * 0.8 * pr * tone[0];
    // the neutral base (0.8, 0.85, 0.95) times the palettes' average, kept so the walls' overall colour stays where it was
    let cg = k * (0.895 + tint) * pg * tone[1];
    let cb = k * (1.05 + tint * 1.5) * pb * tone[2];
    const st = streakAt(spec, d.ang, d.t, STREAK);
    if (st.mask > 0) {
      const m = STREAK_KINDS[st.kind];
      cr *= 1 + (m[0] - 1) * st.mask;
      cg *= 1 + (m[1] - 1) * st.mask;
      cb *= 1 + (m[2] - 1) * st.mask;
    }
    colors.set([cr, cg, cb], i * 3);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal; // the cylinder seam duplicates vertices: average their normals
  for (let j = 0; j <= rows; j++) {
    const a = j * (radial + 1);
    const b = a + radial;
    const nx = nrm.getX(a) + nrm.getX(b);
    const ny = nrm.getY(a) + nrm.getY(b);
    const nz = nrm.getZ(a) + nrm.getZ(b);
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / len, ny / len, nz / len);
    nrm.setXYZ(b, nx / len, ny / len, nz / len);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.translate(spec.x, spec.base + h / 2, spec.z);
  return geo;
}

// Point on a rock's surface at angle `ang` (0 = +x) and height `y` above its base, in world space.
export function rockSurface(spec, ang, y) {
  const t0 = y / spec.h;
  const lin = spec.r + (spec.rTop - spec.r) * t0;
  const d = displace(spec, Math.cos(ang) * lin, Math.sin(ang) * lin, t0, DISPLACED);
  return { x: spec.x + d.x, y: spec.base + y, z: spec.z + d.z };
}

function cliffLayout(rand) {
  const specs = [];
  // is a point in the wedge of sky the sun sits in? keep it clear so the sun glows through the haze
  const inSunGap = (x, z) => Math.abs(Math.atan2(x, -(z + 30)) - Math.atan2(-0.2, 0.97)) < 0.2;
  for (const side of [-1, 1]) {
    for (let z = 14; z > -105; z -= 9 + rand() * 4) {
      const r = 7 + rand() * 3;
      const h = 58 + rand() * 22;
      specs.push(cliffSpec(rand, { tier: 'wall', wall: side, x: side * (r + 17 + rand() * 5), z: z - rand() * 4, base: -46, h, r, rTop: r * (0.62 + rand() * 0.2), radial: 34, rows: 52, bulge: 0.42 }));
    }
  }
  for (let i = 0; i < 30; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (30 + rand() * 40);
    const z = 10 - rand() * 190;
    const r = 3.5 + rand() * 3.5;
    if (inSunGap(x, z)) continue;
    specs.push(cliffSpec(rand, { tier: 'mid', x, z, base: -46, h: 75 + rand() * 55, r, rTop: r * (0.22 + rand() * 0.2), radial: 22, rows: 38, bulge: 0.45 }));
  }
  for (let i = 0; i < 22; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (14 + rand() * 80);
    const z = -110 - rand() * 130;
    const r = 10 + rand() * 10;
    if (inSunGap(x, z)) continue;
    specs.push(cliffSpec(rand, { tier: 'far', x, z, base: -46, h: 110 + rand() * 60, r, rTop: r * (0.35 + rand() * 0.3), radial: 18, rows: 30, bulge: 0.4 }));
  }
  // big cliffs closing the canyon far ahead: they carry the waterfalls, seen head-on past the gate
  for (const [x, z, r, h] of [[19, -130, 15, 150], [48, -112, 12, 130], [-62, -130, 14, 140]]) {
    specs.push(cliffSpec(rand, { tier: 'backdrop', backdrop: true, x, z, base: -46, h, r, rTop: r * 0.5, radial: 34, rows: 60, bulge: 0.35 }));
  }
  // the bridge ledges: level, round tops at the bridge's height
  for (const z of [3, -BRIDGE_LENGTH - 3]) {
    specs.push(cliffSpec(rand, { tier: 'shelf', ledge: true, flat: true, sx: 1.9, x: 0, z, base: -40.05, h: 40, r: 6.4, rTop: 6, radial: 40, rows: 24, bulge: 0.25 }));
    for (let k = 0; k < 7; k++) {
      // boulders on the shelf, kept off the bridge path and the gate
      const side = k % 2 ? 1 : -1;
      const rr = 0.7 + rand() * 1.1;
      specs.push(cliffSpec(rand, { tier: 'boulder', x: side * (4 + rand() * 6.5), z: z + (rand() - 0.5) * 7, base: -0.6, h: 1.4 + rand() * 1.8, r: rr, rTop: rr * 0.3, radial: 14, rows: 8, bulge: 0.5, fq: 7 }));
    }
  }
  return specs;
}

// Rounded boulders that make the walls look weathered: a few at the foot of each near wall, where it comes up out of
// the clouds, and a couple sitting on its ledges. Each is a small cylinder shaped like an egg, 192 triangles.
function scatterBoulders(styled, rand) {
  const out = [];
  const U = (a, b) => a + (b - a) * rand();
  const boulder = (x, z, base, rr) => {
    const h = rr * U(1.4, 2.2);
    const spec = cliffSpec(rand, { tier: 'boulder', x, z, base, h, r: rr, rTop: rr * 0.5, radial: 12, rows: 8, bulge: 0.35, fq: Math.min(7, Math.max(2.5, 8 / rr)) });
    spec.bandH = U(1.2, 2.4);
    out.push(styleSpec(spec, mulberry32(Math.floor(rand() * 1e9))));
  };
  for (const s of styled) {
    const near = s.tier === 'wall' || (s.tier === 'mid' && s.z > -70 && rand() < 0.5);
    if (!near) continue;
    const side = s.wall ?? (Math.sign(s.x) || 1);
    const face = Math.atan2(1, -side); // the way the camera sees the wall: towards the canyon and the walker
    for (let n = 1 + Math.floor(rand() * 2); n > 0; n--) {
      const y = U(-31, -21) - s.base; // where the wall comes up out of the cloud sea
      const a = face + U(-0.9, 0.9);
      const p = rockSurface(s, a, y);
      const rr = U(2.5, 5);
      boulder(p.x - Math.cos(a) * rr * 0.2, p.z - Math.sin(a) * rr * 0.2, p.y - rr * 0.6, rr);
    }
    // one or two on ledges that are wide enough to hold them
    for (const L of s.ledges) {
      if (L.depth < 0.07 || rand() < 0.45) continue;
      const a = face + U(-0.7, 0.7);
      const p = rockSurface(s, a, L.t * s.h + 0.8);
      const rr = U(0.7, 1.4);
      const out2 = L.depth * s.r * 0.3;
      boulder(p.x + Math.cos(a) * out2, p.z + Math.sin(a) * out2, s.base + L.t * s.h - rr * 0.5, rr);
    }
  }
  return out;
}

// Every rock of the canyon, styled: the layout (positions, sizes), each rock's own look (rockStyle.js) and the boulders.
// A seed is a whole canyon: the same seed always builds the same rocks. The classic seed keeps the streams it always had.
export function cliffSpecs(seed = CLASSIC_SEED) {
  const rand = mulberry32(seed);
  const shift = Math.imul(seed - CLASSIC_SEED, 0x9e3779b1); // 0 for the classic canyon
  // Each rock styles itself from its own random stream, so the layout keeps its positions.
  const styled = cliffLayout(rand).map((spec, i) => styleSpec(spec, mulberry32(0x5eed + i * 7919 + shift)));
  return styled.concat(scatterBoulders(styled, mulberry32(4242 + shift)));
}
