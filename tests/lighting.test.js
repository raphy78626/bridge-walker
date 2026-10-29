import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createLighting } from '../src/tv/lighting.js';
import { THEMES } from '../src/tv/themes.js';

function setup(isTV = false, theme = THEMES[0]) {
  const scene = new THREE.Scene();
  const renderer = { toneMappingExposure: 0 };
  const lighting = createLighting(scene, renderer, { isTV, theme });
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const sun = scene.children.find((o) => o.isDirectionalLight && o.target.parent === scene);
  const fill = scene.children.find((o) => o.isDirectionalLight && o !== sun);
  return { scene, renderer, lighting, hemi, sun, fill };
}

describe('lighting', () => {
  it('adds a hemisphere light, a fill and the sun with its target', () => {
    const { scene, hemi, sun, fill } = setup();
    expect(hemi).toBeTruthy();
    expect(fill).toBeTruthy();
    expect(sun.target.parent).toBe(scene);
  });

  it('takes the first look from the theme it is built with', () => {
    const { renderer, sun } = setup(false, THEMES[2]);
    expect(sun.intensity).toBe(THEMES[2].sun.intensity);
    expect(renderer.toneMappingExposure).toBe(THEMES[2].exposure);
  });

  it('re-lights for any theme', () => {
    const { lighting, renderer, hemi, fill, sun } = setup();
    for (const t of THEMES) {
      lighting.apply(t);
      expect(hemi.intensity).toBe(t.hemi.intensity);
      expect(hemi.color.getHex()).toBe(new THREE.Color(t.hemi.sky).getHex());
      expect(fill.intensity).toBe(t.fill.intensity);
      expect(sun.color.getHex()).toBe(new THREE.Color(t.sun.color).getHex());
      expect(renderer.toneMappingExposure).toBe(t.exposure);
    }
  });

  it('keeps the sun 100 m out along the theme direction, riding with the walker', () => {
    const { lighting, sun } = setup();
    const dir = new THREE.Vector3(...THEMES[0].sun.dir).normalize().multiplyScalar(100);
    lighting.follow(-25);
    expect(sun.position.x).toBeCloseTo(dir.x);
    expect(sun.position.y).toBeCloseTo(dir.y);
    expect(sun.position.z).toBeCloseTo(-25 + dir.z);
    expect(sun.target.position.toArray()).toEqual([0, 0, -25]);
  });

  it('casts shadows on a desktop only until told otherwise, and never on a TV to begin with', () => {
    const desktop = setup(false);
    expect(desktop.sun.castShadow).toBe(true);
    desktop.lighting.setShadows(false);
    expect(desktop.sun.castShadow).toBe(false);
    expect(setup(true).sun.castShadow).toBe(false);
  });
});
