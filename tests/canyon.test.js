import { describe, it, expect, vi } from 'vitest';
import { BRIDGE_LENGTH } from '../src/game/session.js';
import { CLASSIC_SEED, buildRockGeometry, cliffSpecs } from '../src/tv/canyon.js';
import { MAX_TREES, buildTreeGeometry, treeSpots } from '../src/tv/trees.js';
import { buildCanyon, canyonTransfers, createCanyonBuilder, geometryFrom, canyonSource } from '../src/tv/canyonBuild.js';

const SEEDS = [1, 7, 8, 123, 31337, 99999, 555555, 1e6, 2 ** 31 - 5, 1234567];
const PLAIN_CANYON_TRIS = 169884; // the plain-cylinder canyon; rockStyle.test.js holds the classic one to +15%

describe('a canyon per seed', () => {
  it('the same seed always builds the same canyon, and the default is the classic one', () => {
    expect(cliffSpecs(777)).toEqual(cliffSpecs(777));
    expect(cliffSpecs()).toEqual(cliffSpecs(CLASSIC_SEED));
  });

  it('different seeds put the rocks in different places and shape them differently', () => {
    const a = cliffSpecs(1);
    const b = cliffSpecs(2);
    const walls = (specs) => specs.filter((s) => s.tier === 'wall').map((s) => [s.x.toFixed(2), s.z.toFixed(2), s.arch].join());
    expect(walls(a)).not.toEqual(walls(b));
    const same = walls(a).filter((w) => walls(b).includes(w));
    expect(same).toHaveLength(0);
  });

  it('every canyon keeps what the game needs: two flat bridge ledges, the waterfall cliffs, an open gap', () => {
    for (const seed of SEEDS) {
      const specs = cliffSpecs(seed);
      const shelves = specs.filter((s) => s.ledge);
      expect(shelves.map((s) => [s.x, s.z])).toEqual([[0, 3], [0, -BRIDGE_LENGTH - 3]]);
      for (const s of shelves) expect(s.flat).toBe(true);
      expect(specs.filter((s) => s.backdrop)).toHaveLength(3);
      // nothing but the ledges and their boulders stands near the bridge's line
      const near = specs.filter((s) => !s.ledge && s.base < -40 && s.z < 10 && s.z > -BRIDGE_LENGTH - 10);
      for (const s of near) expect(Math.abs(s.x), `seed ${seed}`).toBeGreaterThan(20);
    }
  });

  it('stays within the triangle budget whatever the seed (the TV draws every one)', () => {
    for (const seed of SEEDS) {
      let tris = 0;
      for (const spec of cliffSpecs(seed)) tris += buildRockGeometry(spec).index.count / 3;
      expect(tris, `seed ${seed}`).toBeLessThan(PLAIN_CANYON_TRIS * 1.15);
      expect(tris, `seed ${seed}`).toBeGreaterThan(PLAIN_CANYON_TRIS * 0.95);
    }
  });
});

describe('the valley\'s pines', () => {
  const specs = cliffSpecs(4321);
  const spots = treeSpots(specs, 4321);

  it('are placed the same way for the same canyon, and differently for another', () => {
    expect(treeSpots(specs, 4321)).toEqual(spots);
    expect(treeSpots(cliffSpecs(99), 99)).not.toEqual(spots);
  });

  it('a few hundred at most, on every canyon', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const n = treeSpots(cliffSpecs(seed), seed).length;
      expect(n, `seed ${seed}`).toBeGreaterThan(60);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(MAX_TREES);
    }
  });

  it('on the bridge ledges, stand well clear of the bridge, the gate and the boulders, and on the ledge', () => {
    const shelves = specs.filter((s) => s.ledge);
    const boulders = specs.filter((s) => s.tier === 'boulder' && s.base > -2);
    // anything near the bridge's two ends at deck height
    const onShelf = spots.filter((p) => Math.abs(p.y) < 1 && Math.abs(p.x) < 14 && shelves.some((s) => Math.abs(p.z - s.z) < 8));
    expect(onShelf.length).toBeGreaterThanOrEqual(5);
    for (const p of onShelf) {
      expect(Math.abs(p.x)).toBeGreaterThanOrEqual(5.5); // race bridges and the gate posts end inside 3 m
      expect(shelves.some((s) => Math.abs(p.z - s.z) <= 4.5)).toBe(true);
      for (const b of boulders) expect(Math.hypot(b.x - p.x, b.z - p.z)).toBeGreaterThan(b.r);
    }
  });

  it('build one small, finite mesh: pine greens and a brown trunk, lit by its own face normals', () => {
    const geo = buildTreeGeometry(spots, 4321);
    const n = geo.attributes.position.count;
    expect(geo.index).toBeNull();
    expect(n / 3).toBeLessThan(MAX_TREES * 60); // about 40-55 triangles a tree
    for (const name of ['position', 'normal', 'color']) {
      expect(geo.attributes[name].count).toBe(n);
      for (const v of geo.attributes[name].array) expect(Number.isFinite(v)).toBe(true);
    }
    const c = geo.attributes.color.array;
    let green = 0;
    for (let i = 0; i < c.length; i += 3) if (c[i + 1] > c[i] && c[i + 1] > c[i + 2]) green++;
    expect(green / (c.length / 3)).toBeGreaterThan(0.7);
  });

  it('no spots: an empty mesh rather than an error', () => {
    const geo = buildTreeGeometry([], 1);
    expect(geo.attributes.position.count).toBe(0);
    expect(geo.attributes.color.count).toBe(0);
  });
});

describe('building a canyon off the page', () => {
  const canyon = buildCanyon(2024);

  it('is plain data a worker can send: arrays for the rock and the trees, and the waterfall cliffs', () => {
    expect(canyon.seed).toBe(2024);
    expect(canyon.hosts).toHaveLength(3);
    expect(structuredClone(canyon.hosts)).toEqual(canyon.hosts);
    const rock = geometryFrom(canyon.rock);
    expect(rock.attributes.position.count).toBe(rock.attributes.color.count);
    expect(rock.attributes.uv.itemSize).toBe(2);
    expect(rock.index.count % 3).toBe(0);
    expect(geometryFrom(canyon.trees).attributes.normal.count).toBe(canyon.trees.attributes.position.length / 3);
    const transfers = canyonTransfers(canyon);
    expect(new Set(transfers).size).toBe(transfers.length);
    expect(transfers.every((b) => b instanceof ArrayBuffer)).toBe(true);
  });

  it('builds the same canyon as the specs it comes from', () => {
    const tris = cliffSpecs(2024).reduce((n, s) => n + buildRockGeometry(s).index.count / 3, 0);
    expect(canyon.rock.index.length / 3).toBe(tris);
  });
});

// A stand-in Worker: records what it is asked, and replies when told to.
function fakeWorker() {
  const w = {
    posted: [],
    terminated: false,
    postMessage(msg) {
      w.posted.push(msg);
    },
    terminate() {
      w.terminated = true;
    },
    reply(data) {
      w.onmessage({ data });
    },
  };
  return w;
}

describe('createCanyonBuilder', () => {
  const build = (seed) => ({ seed, built: 'here' });

  it('without a worker, builds on the spot', () => {
    const canyons = createCanyonBuilder({ build });
    canyons.prepare(5);
    expect(canyons.take(5)).toEqual({ seed: 5, built: 'here' });
  });

  it('hands over the worker\'s canyon when it is ready, once', () => {
    const worker = fakeWorker();
    const spy = vi.fn(build);
    const canyons = createCanyonBuilder({ createWorker: () => worker, build: spy });
    canyons.prepare(9);
    expect(worker.posted).toEqual([{ seed: 9 }]);
    canyons.prepare(9); // asked again: not built twice
    expect(worker.posted).toHaveLength(1);
    expect(canyons.ready).toBe(false);
    worker.reply({ seed: 9, built: 'worker' });
    expect(canyons.ready).toBe(true);
    expect(canyons.take(9)).toEqual({ seed: 9, built: 'worker' });
    expect(spy).not.toHaveBeenCalled();
    expect(canyons.take(9)).toEqual({ seed: 9, built: 'here' }); // handed over already: built again if asked again
  });

  it('builds on the spot when the worker is not done yet, or was asked for another canyon, and ignores a stale reply', () => {
    const worker = fakeWorker();
    const canyons = createCanyonBuilder({ createWorker: () => worker, build });
    canyons.prepare(1);
    expect(canyons.take(1)).toEqual({ seed: 1, built: 'here' }); // not back yet
    worker.reply({ seed: 1, built: 'worker' }); // too late: dropped
    expect(canyons.ready).toBe(false);
    canyons.prepare(2);
    canyons.prepare(3); // the newer one wins
    worker.reply({ seed: 2, built: 'worker' });
    expect(canyons.ready).toBe(false);
    worker.reply({ seed: 3, built: 'worker' });
    expect(canyons.take(2)).toEqual({ seed: 2, built: 'here' });
  });

  it('falls back to building on the page when the worker fails or cannot start, and says so once', () => {
    const warn = vi.fn();
    const worker = fakeWorker();
    const canyons = createCanyonBuilder({ createWorker: () => worker, build, warn });
    canyons.prepare(4);
    worker.onerror({ message: 'SyntaxError', preventDefault() {} });
    expect(worker.terminated).toBe(true);
    canyons.prepare(5);
    expect(worker.posted).toHaveLength(1);
    expect(canyons.take(5)).toEqual({ seed: 5, built: 'here' });
    expect(warn).toHaveBeenCalledTimes(1);

    const warn2 = vi.fn();
    const broken = createCanyonBuilder({ createWorker: () => { throw new Error('no workers here'); }, build, warn: warn2 });
    broken.prepare(6);
    expect(broken.take(6)).toEqual({ seed: 6, built: 'here' });
    expect(warn2).toHaveBeenCalledTimes(1);
  });

  it('a build error reported by the worker also falls back', () => {
    const warn = vi.fn();
    const worker = fakeWorker();
    const canyons = createCanyonBuilder({ createWorker: () => worker, build, warn });
    canyons.prepare(8);
    worker.reply({ seed: 8, error: 'boom' });
    expect(canyons.take(8)).toEqual({ seed: 8, built: 'here' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('canyonSource: where a look change gets its canyon', () => {
  it('the same seed needs no canyon', () => {
    expect(canyonSource({ seedChanged: false, handedOver: false, hasCanyon: true, waitForWorker: true })).toBe('same');
  });
  it('a canyon the worker handed over is used', () => {
    expect(canyonSource({ seedChanged: true, handedOver: true, hasCanyon: true, waitForWorker: true })).toBe('worker');
  });
  it('mid-game, a canyon the worker has not sent is never built here: the one on screen is kept', () => {
    expect(canyonSource({ seedChanged: true, handedOver: false, hasCanyon: true, waitForWorker: true })).toBe('kept');
  });
  it('the first canyon, or a caller that does not wait for the worker, is built here', () => {
    expect(canyonSource({ seedChanged: true, handedOver: false, hasCanyon: false, waitForWorker: true })).toBe('page');
    expect(canyonSource({ seedChanged: true, handedOver: false, hasCanyon: true, waitForWorker: false })).toBe('page');
  });
});
