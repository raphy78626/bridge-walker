import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createWalker } from '../src/tv/walker.js';
import { FALL_ANGLE, WALK_SPEED } from '../src/game/balance.js';

const never = () => new Promise(() => {}); // the model never arrives: the placeholder stays
const walk = (o = {}) => ({ z: 10, y: 0, vy: 0, lean: 0, speed: 1.4, airborne: false, ...o });
const IN = { walking: true };
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeRig() {
  return { pose: { pivotY: 0, pitch: 0 }, update: vi.fn() };
}
// A walker whose model has "loaded": the rig is a fake that records what it is fed.
async function withRig(opts = {}) {
  const rig = fakeRig();
  const model = new THREE.Group();
  const scene = new THREE.Scene();
  const walker = createWalker(scene, { load: () => Promise.resolve({ model, rig }), ...opts });
  await settle();
  return { walker, rig, model, scene };
}

describe('walker placement', () => {
  it('stands at z = -session z, leaning with the session, on the planks', () => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    walker.update(walk({ lean: 0.2 }), 'playing', 0, null, IN, 0.016, 0);
    expect(walker.pivot.position.x).toBe(0);
    expect(walker.pivot.position.y).toBe(0); // t = 0: the footstep bob is at its lowest
    expect(walker.pivot.position.z).toBe(-10);
    expect(walker.pivot.rotation.z).toBeCloseTo(-0.2);
  });

  it('is named, and added to the scene once', () => {
    const scene = new THREE.Scene();
    const walker = createWalker(scene, { name: 'p2', load: never });
    expect(walker.pivot.name).toBe('p2');
    expect(scene.children).toEqual([walker.pivot]);
    expect(createWalker(new THREE.Scene(), { load: never }).pivot.name).toBe('walker');
  });

  it('stands on its own bridge when given a lateral offset', () => {
    const walker = createWalker(new THREE.Scene(), { x: 3.5, load: never });
    walker.update(walk(), 'playing', 0, null, IN, 0.016, 0);
    expect(walker.pivot.position.x).toBe(3.5);
    expect(walker.focus.x).toBe(3.5);
  });

  it('bobs with each footstep only while walking on the planks and without the model', () => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    walker.update(walk(), 'playing', 0, null, IN, 0.016, 0.1);
    expect(walker.pivot.position.y).toBeCloseTo(0.06 * Math.abs(Math.sin(0.9)));
    walker.update(walk({ speed: 0 }), 'playing', 0, null, IN, 0.016, 0.1);
    expect(walker.pivot.position.y).toBe(0);
    walker.update(walk({ y: 0.5, airborne: true }), 'playing', 0, null, IN, 0.016, 0.1);
    expect(walker.pivot.position.y).toBe(0.5); // a jump is not a footstep
  });

  it('can be hidden and shown', () => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    expect(walker.pivot.visible).toBe(true);
    walker.setVisible(false);
    expect(walker.pivot.visible).toBe(false);
    walker.setVisible(true);
    expect(walker.pivot.visible).toBe(true);
  });
});

describe('walker speed', () => {
  const speedOf = (w, phase, input) => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    walker.update(w, phase, 0, null, input, 0.016, 0);
    return walker.focus.speed;
  };
  it('uses the session speed while playing, and the walking flag when the session has none', () => {
    expect(speedOf(walk({ speed: 2.8 }), 'playing', IN)).toBe(2.8);
    expect(speedOf(walk({ speed: undefined }), 'playing', { walking: true })).toBe(WALK_SPEED);
    expect(speedOf(walk({ speed: undefined }), 'playing', { walking: false })).toBe(0);
  });
  it('is zero in every other phase', () => {
    for (const phase of ['falling', 'gameover', 'won']) expect(speedOf(walk(), phase, IN)).toBe(0);
  });
});

describe('walker with a rig', () => {
  it('feeds the rig the speed, airborne state, vertical speed and fall time, reusing one object', async () => {
    const { walker, rig } = await withRig();
    walker.update(walk({ y: 0.3, vy: 2, airborne: true }), 'playing', 0, null, IN, 0.02, 1);
    walker.update(walk({ speed: 2.8 }), 'falling', 0.4, 'lean', IN, 0.03, 2);
    expect(rig.update).toHaveBeenCalledTimes(2);
    const [first, second] = rig.update.mock.calls;
    expect(first[0]).toBe(second[0]); // no per-frame allocation
    expect(second[0]).toEqual({ speed: 0, falling: true, airborne: false, vy: 0, fallTime: 0.4 });
    expect(second[1]).toBe(0.03);
    expect(first[1]).toBe(0.02);
  });

  it('adds the jump pose to the pivot, and has no footstep bob of its own', async () => {
    const { walker, rig } = await withRig();
    rig.pose.pivotY = -0.1;
    rig.pose.pitch = 0.25;
    walker.update(walk({ y: 0.4 }), 'playing', 0, null, IN, 0.016, 0.1);
    expect(walker.pivot.position.y).toBeCloseTo(0.3);
    expect(walker.pivot.rotation.x).toBeCloseTo(-0.25);
    expect(walker.focus.pose).toBe(rig.pose);
  });

  it('puts the Soldier in place of the placeholder figure', async () => {
    const { walker, model } = await withRig();
    expect(walker.pivot.children).toEqual([model]);
  });
});

describe('walker falling', () => {
  it('tips sideways and drops when the lean is too much', () => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    walker.update(walk({ y: 0.5, lean: -0.8 }), 'falling', 0.5, 'lean', IN, 0.016, 0);
    expect(walker.pivot.position.y).toBeCloseTo(0.5 - 4.9 * 0.25);
    expect(walker.pivot.position.x).toBeCloseTo(-0.9); // toward the side he leans
    expect(walker.pivot.rotation.z).toBeCloseTo(FALL_ANGLE + 0.5 * 2.5); // dir -1: -dir * angle
    expect(walker.focus.gapFall).toBe(false);
    expect(walker.focus.falling).toBe(true);
  });

  it('falls to the right when upright (the lean is zero)', () => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    walker.update(walk(), 'falling', 0.5, 'lean', IN, 0.016, 0);
    expect(walker.pivot.position.x).toBeCloseTo(0.9);
  });

  it('drops straight down through a gap, tipping a little forward', () => {
    const walker = createWalker(new THREE.Scene(), { load: never });
    walker.update(walk({ lean: 0.3 }), 'falling', 0.4, 'gap', IN, 0.016, 0);
    expect(walker.pivot.position.x).toBe(0);
    expect(walker.pivot.rotation.x).toBeCloseTo(-0.2);
    expect(walker.focus.gapFall).toBe(true);
    walker.update(walk(), 'falling', 2, 'gap', IN, 0.016, 0);
    expect(walker.pivot.rotation.x).toBeCloseTo(-0.4); // the tip stops at 0.4
  });

  it('falls away from its own bridge, not from the world origin', () => {
    const walker = createWalker(new THREE.Scene(), { x: 3, load: never });
    walker.update(walk({ lean: -0.5 }), 'falling', 1, 'lean', IN, 0.016, 0);
    expect(walker.pivot.position.x).toBeCloseTo(3 - 1.8);
  });
});

describe('walker model loading', () => {
  it('keeps the placeholder and warns when the model fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new THREE.Scene();
    const walker = createWalker(scene, { load: () => Promise.reject(new Error('404')) });
    const parts = walker.pivot.children.length;
    await settle();
    expect(warn).toHaveBeenCalledOnce();
    expect(walker.pivot.children).toHaveLength(parts);
    walker.update(walk(), 'playing', 0, null, IN, 0.016, 0.1); // still animates, with the bob
    expect(walker.pivot.position.y).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it('tints a copy of the materials, leaving the shared ones alone', async () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const model = (m) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
      return g;
    };
    const load = () => Promise.resolve({ model: model(shared), rig: fakeRig() });
    const scene = new THREE.Scene();
    const plain = createWalker(scene, { load });
    const blue = createWalker(scene, { tint: 0x0000ff, load });
    await settle();
    const colorOf = (walker) => walker.pivot.children[0].children[0].material.color.getHex();
    expect(colorOf(plain)).toBe(0xffffff);
    expect(colorOf(blue)).toBe(0x0000ff);
    expect(shared.color.getHex()).toBe(0xffffff);
  });

  it('tints the placeholder figure too', () => {
    const plain = createWalker(new THREE.Scene(), { load: never });
    const red = createWalker(new THREE.Scene(), { tint: 0xff0000, load: never });
    const first = (walker) => walker.pivot.children[0].material.color;
    expect(first(red).g).toBe(0);
    expect(first(red).b).toBe(0);
    expect(first(plain).g).toBeGreaterThan(0);
  });
});

describe('two walkers', () => {
  it('move independently, each on its own bridge', async () => {
    const scene = new THREE.Scene();
    const a = createWalker(scene, { x: -2, name: 'a', load: never });
    const b = createWalker(scene, { x: 2, name: 'b', load: never });
    a.update(walk({ z: 5, lean: 0.1 }), 'playing', 0, null, IN, 0.016, 0);
    b.update(walk({ z: 20, lean: -0.3 }), 'falling', 0.2, 'lean', IN, 0.016, 0);
    expect(a.pivot.position.x).toBe(-2);
    expect(a.pivot.position.z).toBe(-5);
    expect(b.pivot.position.z).toBe(-20);
    expect(a.focus.falling).toBe(false);
    expect(b.focus.falling).toBe(true);
    expect(a.focus).not.toBe(b.focus);
  });
});

// A canvas that draws nothing: the blob shadow and the name tag paint into one.
const ctx = new Proxy({}, { get: (_, key) => (key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
const withDocument = (fn) => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  try {
    fn();
  } finally {
    vi.unstubAllGlobals();
  }
};

describe('changing a walker between rounds', () => {
  it('setLane moves him, his shadow and his camera focus to another bridge', () => {
    withDocument(() => {
      const scene = new THREE.Scene();
      const walker = createWalker(scene, { isTV: true, load: never });
      walker.setLane(-1.2);
      walker.update(walk(), 'playing', 0, null, IN, 0.016, 0);
      expect(walker.pivot.position.x).toBe(-1.2);
      expect(walker.focus.x).toBe(-1.2);
      const blob = scene.children.find((o) => o !== walker.pivot);
      expect(blob.position.x).toBe(-1.2);
      walker.setLane(0);
      walker.update(walk(), 'playing', 0, null, IN, 0.016, 0);
      expect(walker.pivot.position.x).toBe(0);
    });
  });

  it('setTint paints him, and null gives the Soldier\'s own colours back, on the model as well as the placeholder', async () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    const walker = createWalker(new THREE.Scene(), { load: () => Promise.resolve({ model, rig: fakeRig() }) });
    const firstColor = () => {
      let c = null;
      walker.pivot.traverse((o) => {
        if (o.isMesh && c === null) c = o.material.color.getHex();
      });
      return c;
    };
    await settle();
    expect(firstColor()).toBe(0xffffff);
    walker.setTint(0x00ff00);
    expect(firstColor()).toBe(0x00ff00);
    walker.setTint(0xff8000);
    expect(firstColor()).toBe(0xff8000);
    walker.setTint(null);
    expect(firstColor()).toBe(0xffffff);
    expect(shared.color.getHex()).toBe(0xffffff);
  });

  it('a tint chosen while the model is still loading is the one it gets', async () => {
    let arrive;
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff })));
    const walker = createWalker(new THREE.Scene(), { tint: 0xff0000, load: () => new Promise((r) => (arrive = r)) });
    walker.setTint(0x0000ff);
    arrive({ model, rig: fakeRig() });
    await settle();
    expect(walker.pivot.children[0].children[0].material.color.getHex()).toBe(0x0000ff);
  });
});

describe('the name tag', () => {
  it('is one sprite in the scene, floating over his head and following him', () => {
    withDocument(() => {
      const scene = new THREE.Scene();
      const walker = createWalker(scene, { x: 1.2, load: never });
      const before = scene.children.length;
      walker.setTag('P2', '#f5882f');
      expect(scene.children.length).toBe(before + 1);
      walker.setTag('P2', '#f5882f'); // again: still one
      expect(scene.children.length).toBe(before + 1);
      walker.update(walk({ z: 12 }), 'playing', 0, null, IN, 0.016, 0);
      const tag = scene.children.find((o) => o.isSprite);
      expect(tag.position.x).toBe(1.2);
      expect(tag.position.z).toBe(-12);
      expect(tag.position.y).toBeGreaterThan(walker.pivot.position.y + 2);
      expect(tag.visible).toBe(true);
    });
  });

  it('hides with the walker and when cleared', () => {
    withDocument(() => {
      const scene = new THREE.Scene();
      const walker = createWalker(scene, { load: never });
      walker.setTag('P1', '#19b5a5');
      const tag = scene.children.find((o) => o.isSprite);
      walker.setVisible(false);
      expect(tag.visible).toBe(false);
      walker.setVisible(true);
      expect(tag.visible).toBe(true);
      walker.setTag(null);
      expect(tag.visible).toBe(false);
      walker.setTag(null); // clearing a walker that never had one is fine
      expect(() => createWalker(scene, { load: never }).setTag(null)).not.toThrow();
    });
  });
});
