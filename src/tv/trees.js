import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../game/rng.js';
import { displace, rockSurface } from './canyon.js';

// Low-poly pines for the green valley theme: where they stand on the canyon (treeSpots) and their geometry
// (buildTreeGeometry), from the canyon's own seed, so each level's canyon has its own woods. Pure geometry, no DOM, so it
// runs in the canyon worker. Every pine is a trunk and two or three faceted cones, about 40-55 triangles, and all of them
// merge into one opaque mesh with plain vertex colours: one draw call, no transparent foliage cards.
//
// They grow where a tree could: on the bridge's two ledges (clear of the bridge, the gate and the shelf boulders), on the
// ledges the near walls step back at, and on the flat tops of the rocks further off, where they read as woods.

export const MAX_TREES = 320;
const TAU = Math.PI * 2;
const FLAT_TOPS = new Set(['mesa', 'slant']);
const D = { x: 0, y: 0, z: 0 };

// A point on a rock's flat top, a fraction f of the way from the middle (0) to the rim (1) at angle a, in world space. The
// cap is a fan from its middle vertex to the rim, so the surface there is the straight line between the two.
function onTop(spec, a, f) {
  const c = displace(spec, 0, 0, 1, D);
  const cx = c.x;
  const cy = c.y;
  const cz = c.z;
  const rim = displace(spec, Math.sin(a) * spec.rTop, Math.cos(a) * spec.rTop, 1, D);
  return { x: spec.x + cx + (rim.x - cx) * f, y: spec.base + cy + (rim.y - cy) * f, z: spec.z + cz + (rim.z - cz) * f };
}

// [{ x, y, z, h, tiers }]: the foot of each pine (world space), its height in metres and its number of cones.
export function treeSpots(specs, seed) {
  const rand = mulberry32((seed ^ 0x7ee5) >>> 0);
  const U = (a, b) => a + (b - a) * rand();
  const spots = [];
  // the boulders on the bridge's ledges, which a tree must not grow through
  const shelfBoulders = specs.filter((s) => s.tier === 'boulder' && s.base > -2);
  const clearOfBoulders = (x, z) => shelfBoulders.every((b) => Math.hypot(b.x - x, b.z - z) > b.r * 1.2 + 0.9);
  for (const s of specs) {
    if (s.ledge) {
      // A few on each bridge ledge, well to the side: never on the walk, by the gate, or in a camera's way. The start's
      // ledge is where the cameras stand, so its trees keep further out, to the edges of the picture.
      const start = s.z > 0;
      for (let k = 0, tries = 0; k < (start ? 4 : 6) && tries < 60; tries++) {
        const side = k % 2 ? 1 : -1;
        const x = side * U(start ? 8 : 5.5, 9.5);
        const dz = U(-4, 4);
        if ((x / (s.rTop * (s.sx ?? 1))) ** 2 + (dz / s.rTop) ** 2 > 0.72) continue; // stay inside the rim
        if (!clearOfBoulders(x, s.z + dz)) continue;
        spots.push({ x, y: s.base + s.h - 0.1, z: s.z + dz, h: U(4, 6.5), tiers: 3 });
        k++;
      }
      continue;
    }
    if (s.tier === 'boulder') continue;
    const side = s.wall ?? (Math.sign(s.x) || 1);
    const face = Math.atan2(1, -side); // the way the camera sees the rock: towards the canyon and the walker
    // the ledges a wall steps back at, on the face the camera sees, like the boulders scattered there (canyon.js)
    for (const L of s.ledges) {
      if (L.depth < 0.07 || rand() < 0.35) continue;
      for (let n = 1 + Math.floor(rand() * 2); n > 0; n--) {
        const a = face + U(-0.7, 0.7);
        const p = rockSurface(s, a, L.t * s.h + 0.8);
        const out = L.depth * s.r * U(0.15, 0.4);
        spots.push({ x: p.x + Math.cos(a) * out, y: s.base + L.t * s.h - 0.4, z: p.z + Math.sin(a) * out, h: U(4, 8), tiers: 2 });
      }
    }
    // woods on the flat tops: more on a broad top, and taller further off so they still read
    if (FLAT_TOPS.has(s.top)) {
      const far = s.tier === 'far' || s.tier === 'backdrop';
      const n = Math.round(U(0.4, 1) * Math.min(9, s.rTop * 0.9));
      for (let k = 0; k < n; k++) {
        const p = onTop(s, rand() * TAU, 0.85 * Math.sqrt(rand()));
        spots.push({ x: p.x, y: p.y - 0.5, z: p.z, h: far ? U(7, 12) : U(5, 9), tiers: 2 });
      }
    }
  }
  // over budget: drop at random rather than from the end of the list (which would strip the far rocks bare)
  while (spots.length > MAX_TREES) spots.splice(Math.floor(rand() * spots.length), 1);
  return spots;
}

// Albedo (linear): dark pine greens, a little different on every tree, lighter towards the tip; a brown trunk.
const TRUNK = [0.13, 0.08, 0.05];
function needles(rand, tier, tiers) {
  const v = 0.85 + rand() * 0.3;
  const tip = 1 + 0.25 * (tier / Math.max(1, tiers - 1));
  const yellow = rand() * 0.03;
  return [(0.035 + yellow) * v * tip, 0.11 * v * tip, 0.03 * v * tip];
}

function painted(geo, rgb) {
  const g = geo.toNonIndexed(); // faceted: every face keeps its own normal
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  const c = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) c.set(rgb, i);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function pine({ x, y, z, h, tiers }, rand) {
  const parts = [];
  const w = h * (0.85 + rand() * 0.3); // stouter or slimmer
  const trunk = new THREE.CylinderGeometry(0.025 * w, 0.04 * w, 0.4 * h, 5, 1, true);
  trunk.translate(0, 0.2 * h, 0);
  parts.push(painted(trunk, TRUNK));
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const coneH = h * (0.62 - 0.22 * f) * (3 / (tiers + 1.6));
    const cone = new THREE.ConeGeometry(w * (0.24 - 0.12 * f), coneH, 7);
    cone.translate(0, h * (0.22 + 0.55 * f) + coneH / 2, 0);
    parts.push(painted(cone, needles(rand, i, tiers)));
  }
  const g = mergeGeometries(parts);
  g.rotateY(rand() * TAU);
  g.translate(x, y, z);
  return g;
}

// One merged, non-indexed geometry with position, normal and colour (the albedo; the scene lights it). Empty for no spots.
export function buildTreeGeometry(spots, seed) {
  const rand = mulberry32((seed ^ 0x9137) >>> 0);
  if (!spots.length) {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(0), 3));
    return g;
  }
  return mergeGeometries(spots.map((s) => pine(s, rand)));
}
