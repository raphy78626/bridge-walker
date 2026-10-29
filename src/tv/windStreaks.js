import * as THREE from 'three';

// Wind streaks: faint tapered lines drifting across the view in the gust's direction. All of it is ONE draw call
// (a single indexed mesh of quads) and the motion is in the vertex shader, so a frame costs a handful of uniform
// writes and nothing is allocated. The mesh is a child of the camera, so it follows chase, first-person and
// cinematic alike. Its quads are tiny and the fragment shader is three multiplies: no overdraw to speak of on a TV.
//
// Each streak has a seed (x position, y position, depth, speed factor). The shader places it in the view frustum at
// its own depth, slides it along x by the shared phase, wraps it just off screen, and fades it from a bright head to
// a pointed tail, so the direction reads at a glance even in a still frame.

export const STREAK_COUNT = 48;

const VERTEX = /* glsl */ `
  uniform float uPhase;   // distance travelled, in screen widths (signed: negative moves left)
  uniform float uDir;     // +1 blowing left to right, -1 right to left
  uniform vec2 uHalf;     // tan(fov / 2) * aspect, tan(fov / 2)
  attribute vec4 aSeed;   // x, y, depth, speed factor: all 0..1
  varying float vAlong;
  varying float vAcross;
  varying float vShade;
  void main() {
    float near = 1.0 - aSeed.z;
    float depth = mix(2.5, 15.0, aSeed.z);
    float len = mix(0.35, 0.95, 0.35 + 0.65 * aSeed.w) * (0.7 + 0.5 * near); // in half-screen widths
    float span = 1.0 + len;                                  // the wrap happens fully off screen
    float u = fract(aSeed.x + uPhase * (0.7 + 0.6 * aSeed.w) * (0.8 + 0.4 * near));
    float head = (u * 2.0 - 1.0) * span;
    float x = head - uDir * len * (1.0 - position.x);        // position.x: 0 tail, 1 head
    float y = (aSeed.y * 2.0 - 1.0) * 0.95 + uDir * 0.025 * len * (1.0 - position.x); // a slight downdraught
    float thick = (0.0065 + 0.0075 * near) * mix(0.15, 1.0, position.x);
    vec3 view = vec3(x * uHalf.x * depth, (y + position.y * thick) * uHalf.y * depth, -depth);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(view, 1.0);
    vAlong = position.x;
    vAcross = position.y;
    vShade = 0.55 + 0.45 * aSeed.w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uColor;
  varying float vAlong;
  varying float vAcross;
  varying float vShade;
  void main() {
    float a = uOpacity * vShade * vAlong * vAlong * (1.0 - vAcross * vAcross);
    gl_FragColor = vec4(uColor, a);
  }
`;

// Deterministic, so a screenshot is repeatable and no two streaks line up.
function seeds(count) {
  let s = 1234567;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < count; i++) {
    // x and y are stratified, so the streaks spread over the view instead of clumping
    out.push([(i + rand()) / count, ((i * 7) % count + rand()) / count, rand(), rand()]);
  }
  return out;
}

export function createWindStreaks(count = STREAK_COUNT) {
  const positions = new Float32Array(count * 4 * 3);
  const seedAttr = new Float32Array(count * 4 * 4);
  const index = new Uint16Array(count * 6);
  const corners = [[0, -1], [0, 1], [1, -1], [1, 1]]; // [along, across]
  const list = seeds(count);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      positions.set([corners[c][0], corners[c][1], 0], v * 3);
      seedAttr.set(list[i], v * 4);
    }
    index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seedAttr, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const uniforms = {
    uPhase: { value: 0 },
    uDir: { value: 1 },
    uHalf: { value: new THREE.Vector2(1, 1) },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'windStreaks';
  mesh.frustumCulled = false; // positions are computed in the shader, so the bounds mean nothing
  mesh.renderOrder = 10; // after the opaque scene and the clouds
  mesh.visible = false;

  let phase = 0;
  return {
    mesh,
    // opacity 0..1 (0 hides the mesh: no draw call at all), speed in screen widths per second, dir +1 / -1
    update(dt, opacity, speed, dir, camera) {
      const on = opacity > 0.004;
      mesh.visible = on;
      if (!on) return;
      phase += dt * speed * dir;
      if (phase > 1000 || phase < -1000) phase %= 1; // keeps float precision; the streaks wrap every unit anyway
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      uniforms.uPhase.value = phase;
      uniforms.uDir.value = dir;
      uniforms.uHalf.value.set(tan * camera.aspect, tan);
      uniforms.uOpacity.value = opacity;
    },
    setColor(hex) {
      uniforms.uColor.value.set(hex);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
