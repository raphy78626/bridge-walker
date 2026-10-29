import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRockGeometry, cliffSpecs } from './canyon.js';
import { buildTreeGeometry, treeSpots } from './trees.js';

// Every level has its own canyon (a seed, see looks.js), and building one is the heaviest thing the game does on the CPU:
// about 150 ms on a laptop, seconds on a TV. So the next level's canyon is built ahead, in a worker (canyonWorker.js),
// while the current level is played, and handed over as plain arrays when the win screen swaps the look.
//
// buildCanyon(seed) is that work: { seed, rock, trees, hosts }, where rock and trees are geometry data
// ({ attributes: { name: typed array }, index }) and hosts are the rock specs that carry the waterfalls.

function geometryData(geo) {
  const attributes = {};
  for (const [name, attr] of Object.entries(geo.attributes)) attributes[name] = attr.array;
  return { attributes, index: geo.index ? geo.index.array : null };
}

export function buildCanyon(seed) {
  const specs = cliffSpecs(seed);
  const rock = mergeGeometries(specs.map(buildRockGeometry));
  const trees = buildTreeGeometry(treeSpots(specs, seed), seed);
  return { seed, rock: geometryData(rock), trees: geometryData(trees), hosts: specs.filter((s) => s.backdrop) };
}

const ITEM_SIZE = { position: 3, normal: 3, color: 3, uv: 2 };

// A BufferGeometry over geometry data's arrays (not copies: the caller owns them from here on).
export function geometryFrom(data) {
  const geo = new THREE.BufferGeometry();
  for (const [name, array] of Object.entries(data.attributes)) geo.setAttribute(name, new THREE.BufferAttribute(array, ITEM_SIZE[name] ?? 3));
  if (data.index) geo.setIndex(new THREE.BufferAttribute(data.index, 1));
  return geo;
}

// The arrays a worker can hand over without copying.
export function canyonTransfers(canyon) {
  const out = [];
  for (const g of [canyon.rock, canyon.trees]) {
    for (const a of Object.values(g.attributes)) out.push(a.buffer);
    if (g.index) out.push(g.index.buffer);
  }
  return [...new Set(out)];
}

// Where a look change's canyon comes from: 'same' (no new seed), 'worker' (handed over, ready), 'page' (build it here) or
// 'kept' (keep the canyon on screen). Mid-game (waitForWorker) a canyon is never built here: that is seconds on a TV's CPU,
// so the canyon stays and only the theme changes. With no canyon yet (the first one) it must be built.
export function canyonSource({ seedChanged, handedOver, hasCanyon, waitForWorker }) {
  if (!seedChanged) return 'same';
  if (handedOver) return 'worker';
  return waitForWorker && hasCanyon ? 'kept' : 'page';
}

// The page's side: prepare(seed) asks the worker to build that canyon in the background; take(seed) returns it, or, if
// the worker has not sent it yet (or there is no worker, or it failed), builds it on the spot. Only the latest prepared
// canyon is kept. createWorker() returns a Worker running canyonWorker.js; without one everything is built on the spot.
export function createCanyonBuilder({ createWorker = null, build = buildCanyon, warn = console.warn } = {}) {
  let worker = null;
  let failed = !createWorker;
  let wanted = null; // the seed prepared last
  let ready = null; // its canyon, once the worker has sent it

  function fail(err) {
    failed = true;
    warn('[canyon] worker unavailable, building on the page', err?.message ?? err ?? '');
    worker?.terminate?.();
    worker = null;
  }

  function ensureWorker() {
    if (worker || failed) return worker;
    try {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (data.error) fail(data.error);
        else if (data.seed === wanted) ready = data;
      };
      worker.onerror = (e) => {
        e?.preventDefault?.();
        fail(e?.message ?? e);
      };
    } catch (err) {
      fail(err);
    }
    return worker;
  }

  return {
    prepare(seed) {
      if (seed === wanted) return;
      wanted = seed;
      ready = null;
      ensureWorker()?.postMessage({ seed });
    },
    take(seed) {
      if (ready && ready.seed === seed) {
        const canyon = ready;
        ready = null;
        wanted = null;
        return canyon;
      }
      if (seed === wanted) wanted = null; // the worker's copy, if it still comes, is not needed any more
      return build(seed);
    },
    // diagnostics: the seed being prepared, and whether it is ready
    get pending() {
      return wanted;
    },
    get ready() {
      return !!ready;
    },
  };
}
