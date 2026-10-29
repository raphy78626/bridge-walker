import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createCameraRig } from '../src/tv/cameraRig.js';
import { CAMERA_FOV, CINEMA, POV } from '../src/tv/cameras.js';

const rigWithCamera = () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  return { camera, rig: createCameraRig(camera, 60) };
};
// What walker.js hands over: the session's walker, his bridge offset, his pivot, and what he is doing.
const focusOf = (o = {}) => ({
  w: { z: 10, y: 0, vy: 0, lean: 0, speed: 0, airborne: false },
  x: 0,
  position: new THREE.Vector3(0, 0, -10),
  quaternion: new THREE.Quaternion(),
  pose: null,
  speed: 0,
  falling: false,
  gapFall: false,
  phaseTime: 0,
  ...o,
});
const aim = (camera) => {
  const spy = vi.spyOn(camera, 'lookAt');
  return () => spy.mock.calls.at(-1);
};

describe('camera rig modes', () => {
  it('starts on the chase view and ignores an unknown one', () => {
    const { rig } = rigWithCamera();
    expect(rig.mode).toBe('chase');
    expect(rig.setMode('banana')).toBe('chase');
    expect(rig.setMode('pov')).toBe('pov');
    expect(rig.setMode(undefined)).toBe('pov');
  });

  it('cycles chase -> pov -> cinematic -> chase and returns the new view', () => {
    const { rig } = rigWithCamera();
    expect([rig.cycle(), rig.cycle(), rig.cycle()]).toEqual(['pov', 'cinematic', 'chase']);
    expect(rig.mode).toBe('chase');
  });

  it('sets the field of view when a view is first used and when it changes, not every frame', () => {
    const { camera, rig } = rigWithCamera();
    const projection = vi.spyOn(camera, 'updateProjectionMatrix');
    rig.update(focusOf(), 0, 0.016, 0);
    expect(camera.fov).toBe(CAMERA_FOV.chase);
    rig.update(focusOf(), 0, 0.016, 0.016);
    expect(projection).toHaveBeenCalledTimes(1);
    rig.setMode('pov');
    rig.update(focusOf(), 0, 0.016, 0.032);
    expect(camera.fov).toBe(CAMERA_FOV.pov);
    expect(projection).toHaveBeenCalledTimes(2);
  });

  it('starts the cinematic where it should be after a switch, not gliding in from the last view', () => {
    const { camera, rig } = rigWithCamera();
    const at = (z) => focusOf({ w: { z, y: 0, vy: 0, lean: 0 }, position: new THREE.Vector3(0, 0, -z) });
    rig.setMode('cinematic');
    rig.update(at(10), 0, 0.016, 0);
    rig.setMode('chase');
    rig.update(at(12), 0, 0.016, 0.016);
    rig.setMode('cinematic');
    rig.update(at(12), 0, 0.016, 0.032);
    expect(camera.position.z).toBeCloseTo(-12 - CINEMA.ahead); // exactly the target, no smoothing lag
  });
});

describe('chase view', () => {
  it('sits behind and above him, looking down the bridge', () => {
    const { camera, rig } = rigWithCamera();
    const lookAt = aim(camera);
    rig.update(focusOf({ w: { z: 10, y: 1, lean: 0.5 } }), 0, 0.016, 0);
    expect(camera.position.x).toBeCloseTo(0.3);
    expect(camera.position.y).toBeCloseTo(2.4 + 0.3);
    expect(camera.position.z).toBeCloseTo(-10 + 5);
    expect(lookAt()).toEqual([0, 1.1 + 0.3, -10 - 8]);
  });

  it('follows the walker to his own bridge', () => {
    const { camera, rig } = rigWithCamera();
    const lookAt = aim(camera);
    rig.update(focusOf({ x: 4, w: { z: 10, y: 0, lean: 0.5 } }), 0, 0.016, 0);
    expect(camera.position.x).toBeCloseTo(4.3);
    expect(lookAt()[0]).toBe(4);
  });

  it('watches him drop in an edge fall', () => {
    const { camera, rig } = rigWithCamera();
    const lookAt = aim(camera);
    rig.update(focusOf({ falling: true, phaseTime: 0.5, position: new THREE.Vector3(0.9, -1.2, -10) }), 0, 0.016, 0);
    expect(lookAt()).toEqual([0.9, -1.2 + 1, -10 - 1]);
  });

  it('swings up over a gap and looks down through it', () => {
    const { camera, rig } = rigWithCamera();
    const lookAt = aim(camera);
    const fall = (phaseTime) => focusOf({ falling: true, gapFall: true, phaseTime, position: new THREE.Vector3(0, -3, -10) });
    rig.update(fall(0), 0, 0.016, 0);
    expect(camera.position.toArray()).toEqual([0, 2.4, -10 + 5]);
    rig.update(fall(2), 0, 0.016, 0.016); // the swing is done after 0.7 s
    expect(camera.position.y).toBeCloseTo(4.4);
    expect(camera.position.z).toBeCloseTo(-10 + 5 - 4.2);
    expect(lookAt()[1]).toBe(-3 + 1);
  });

  it('is buffeted only by a strong gust, and not in a fall', () => {
    const { camera, rig } = rigWithCamera();
    rig.update(focusOf(), 0.4, 0.016, 1);
    expect(camera.position.x).toBe(0);
    rig.update(focusOf(), 1, 0.016, 1);
    expect(camera.position.x).toBeCloseTo(Math.sin(37) * 0.03);
    expect(camera.position.y).toBeCloseTo(2.4 + Math.sin(30) * 0.03 * 0.6);
    rig.update(focusOf({ falling: true, position: new THREE.Vector3(0, -1, -10) }), 1, 0.016, 1);
    expect(camera.position.x).toBe(0);
  });
});

describe('first person view', () => {
  it('puts the eye at his head and hides nothing of the bridge ahead', () => {
    const { camera, rig } = rigWithCamera();
    rig.setMode('pov');
    rig.update(focusOf({ x: 2 }), 0, 0.016, 0);
    expect(camera.position.x).toBeCloseTo(2);
    expect(camera.position.y).toBeCloseTo(POV.eye);
    expect(camera.position.z).toBeCloseTo(-10);
  });

  it('hands over to his tumble in a fall: the camera ends up at his head wherever he is', () => {
    const { camera, rig } = rigWithCamera();
    rig.setMode('pov');
    const position = new THREE.Vector3(1, -4, -10);
    rig.update(focusOf({ falling: true, phaseTime: 0.5, position }), 0, 0.016, 0);
    expect(camera.position.x).toBeCloseTo(1);
    expect(camera.position.y).toBeCloseTo(-4 + 1.65);
    expect(camera.position.z).toBeCloseTo(-10);
  });
});

describe('cinematic view', () => {
  it('stands to the side of the bridge and aims at him, shifted with his bridge', () => {
    const { camera, rig } = rigWithCamera();
    const lookAt = aim(camera);
    rig.setMode('cinematic');
    rig.update(focusOf({ x: 5 }), 0, 0.016, 0);
    expect(camera.position.x).toBeCloseTo(5 + CINEMA.side);
    expect(lookAt()[0]).toBeCloseTo(5);
  });
});

describe('chase view with a shared focus', () => {
  it('uses the usual spot without the extras, and the focus\'s own back / up / aim with them', () => {
    const { camera, rig } = rigWithCamera();
    const lookAt = aim(camera);
    rig.update(focusOf(), 0, 0.016, 0);
    expect(camera.position.toArray()).toEqual([0, 2.4, -10 + 5]);
    expect(lookAt()).toEqual([0, 1.1, -10 - 8]);
    rig.update(focusOf({ back: 12, up: 5, aim: 6, aimY: 0.5 }), 0, 0.016, 0.016);
    expect(camera.position.toArray()).toEqual([0, 5, -10 + 12]);
    expect(lookAt()).toEqual([0, 0.5, -10 - 6]);
  });
});
