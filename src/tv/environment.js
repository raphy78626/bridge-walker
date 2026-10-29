import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGE_LENGTH } from '../game/session.js';
import { mulberry32 } from '../game/rng.js';
import { applyWindSway, createWindUniforms } from './windSway.js';

const PLANK_STEP = 0.45;
const PLANK_DEPTH = 0.32; // along the bridge
const TEX_M = 9; // metres of rock covered by one tile of the rock texture
const noise = new ImprovedNoise();

// Sky, rock, bridge, clouds, waterfalls and birds. `update(t, camera)` (t in game seconds: the scene's clock, which stands still in a pause) drifts the clouds, scrolls the water,
// flies the birds and keeps the stars centred on the camera.
// `theme` (themes.js) gives the first look; `setTheme(theme)` swaps it later (sky, fog, rock lighting, clouds, water, extras).
// lite: a cheaper variant for TV GPUs, from profiling on an LG TV (PowerVR BXE-4-32): unlit rock with
// baked lighting, Lambert planks, no anisotropic filtering, and fewer cloud cards.
export function buildEnvironment(scene, renderer, { theme, lite = false }) {
  const aniso = lite ? 1 : Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);

  const skyBaker = createSkyBaker(scene, renderer);
  const rock = rockMaterial(aniso, lite);
  const { mesh: cliffs, hosts } = buildCliffs(rock);
  // The unlit vertex colours (crevice shading, depth, tint) are kept so every re-bake starts from them and never compounds.
  const rockBase = lite ? cliffs.geometry.attributes.color.array.slice() : null;
  const falls = buildWaterfalls(hosts);
  const clouds = buildClouds(scene.fog, lite ? 60 : 300);
  const birds = buildBirds();
  const stars = buildStars();
  const windU = createWindUniforms(); // shared by the ropes and the cloth markers (windSway.js)
  const bridge = buildBridge(aniso, lite, windU);
  const parts = { cliffs, bridge: bridge.group, gate: buildGate(rock), clouds: clouds.mesh, falls: falls.group, birds: birds.points, stars: stars.points };
  for (const [name, obj] of Object.entries(parts)) obj.name = name; // names make remote profiling on the TV readable
  scene.add(...Object.values(parts));

  // Everything a theme changes that lives here. Cheap except the sky bake (6 cube faces + PMREM) and, in lite mode,
  // the per-vertex rock lighting.
  function setTheme(next) {
    scene.fog.color.set(next.fog.color);
    scene.fog.near = next.fog.near;
    scene.fog.far = next.fog.far;
    skyBaker.bake(next);
    scene.environmentIntensity = next.envIntensity;
    if (lite) bakeRockLighting(cliffs.geometry, rockBase, next);
    else rock.color.setRGB(...next.rock.tint);
    clouds.setTheme(next, scene.fog);
    falls.setTint(next.falls.tint);
    birds.points.visible = next.birds;
    stars.points.visible = next.stars;
  }
  setTheme(theme);

  return {
    // sway: -1..1, signed like the wind's dir (+1 sways toward screen right). One uniform, no rebuild.
    setWind(sway) {
      windU.uWindSway.value = sway;
    },
    update(t, camera) {
      windU.uWindTime.value = t;
      clouds.update(t);
      falls.update(t);
      if (birds.points.visible) birds.update(t);
      if (stars.points.visible && camera) stars.points.position.copy(camera.position);
    },
    // gaps: [{ start, end }] in metres along the bridge. Rebuilds the planks without the boards over them.
    setGaps: bridge.setGaps,
    setTheme,
  };
}

function loadSet(name, aniso, repeat, { mapOnly = false } = {}) {
  const loader = new THREE.TextureLoader();
  const get = (kind, srgb) => {
    const tex = loader.load(`/textures/${name}/${name}_${kind}_1k.jpg`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = aniso;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace; // colour data only; normal and roughness stay linear
    if (repeat) tex.repeat.copy(repeat);
    return tex;
  };
  if (mapOnly) return { map: get('diff', true) };
  return { map: get('diff', true), normalMap: get('nor_gl', false), roughnessMap: get('rough', false) };
}

// The Preetham sky shader is far too costly to run per pixel every frame on a TV GPU, and the sky only changes
// between levels, so render it once per theme: into a cube map for the background, and (without the sun disc) for
// lighting. The grade patch below (warm horizon, deep zenith) reads its colours from uniforms, so every theme can
// reuse the one compiled shader. Night swaps in a plain dark gradient with a moon disc instead of Preetham.
function createSkyBaker(scene, renderer) {
  const grade = {
    uWarm: { value: new THREE.Vector4() },
    uHue: { value: 0 },
    uGradeTop: { value: new THREE.Vector3() },
    uGradeLow: { value: new THREE.Vector3() },
  };
  const sky = new Sky();
  sky.scale.setScalar(500);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  const u = sky.material.uniforms;
  u.cloudCoverage.value = 0; // the cloud sea lives below; the sky stays clean
  u.showSunDisc.value = 0; // its radiance overflows half float (it baked as a black dot); the haze glow around it stays
  sky.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, grade);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec4 uWarm;\nuniform float uHue;\nuniform vec3 uGradeTop;\nuniform vec3 uGradeLow;\nvoid main() {')
      // The Preetham sky is cool and pale at low sun: push the horizon and the sun side towards the theme's
      // low colour, keep the zenith at its top colour.
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `float warm = clamp((1.0 - direction.y * uWarm.x) * uWarm.y + pow(max(cosTheta, 0.0), uWarm.w) * uWarm.z, 0.0, 1.0);
        // hue 0: the grade multiplies Preetham's colour. hue 1: only its brightness is kept, painted in the grade's colours.
        texColor = mix(texColor, vec3(dot(texColor, vec3(0.3, 0.59, 0.11))), uHue) * mix(uGradeTop, uGradeLow, warm);
        texColor = min(texColor, vec3(30.0)); // a low sun's glow overflows half float (inf, then NaN in the PMREM blur): keep it finite
        gl_FragColor = vec4( texColor, 1.0 );`,
      );
  };

  const night = nightSky();
  const envScene = new THREE.Scene();
  envScene.add(sky, night.mesh);
  const background = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType }); // half float keeps the bright sun side
  const cubeCamera = new THREE.CubeCamera(0.1, 1000, background);
  scene.background = background.texture;
  const pmrem = new THREE.PMREMGenerator(renderer); // kept: its blur shaders compile once
  let envTarget = null;

  return {
    bake(theme) {
      const s = theme.sky;
      sky.visible = s.kind === 'preetham';
      night.mesh.visible = s.kind === 'night';
      if (sky.visible) {
        u.turbidity.value = s.turbidity;
        u.rayleigh.value = s.rayleigh;
        u.mieCoefficient.value = s.mie;
        u.mieDirectionalG.value = s.mieG;
        u.sunPosition.value.set(...theme.sun.dir).normalize();
        grade.uWarm.value.set(...s.warm);
        grade.uHue.value = s.hue ?? 0;
        grade.uGradeTop.value.set(...s.top);
        grade.uGradeLow.value.set(...s.low);
      } else {
        night.set(s, theme.sun.dir);
      }
      cubeCamera.update(renderer, envScene);
      // Image-based lighting from the same sky.
      const previous = envTarget;
      envTarget = pmrem.fromScene(envScene, 0, 0.1, 1000);
      scene.environment = envTarget.texture;
      previous?.dispose();
    },
  };
}

// A dark gradient sky with a moon disc and its halo, drawn on the inside of a big sphere. Colours are given in
// sRGB hex like the fog's, so the horizon blends into the fog exactly.
function nightSky() {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uMoon: { value: new THREE.Vector3() },
    uMoonColor: { value: new THREE.Color() },
    uMoonCos: { value: 0.999 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uMoon;
        uniform vec3 uMoonColor;
        uniform float uMoonCos;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = mix(uHorizon, uTop, pow(clamp(d.y, 0.0, 1.0), 0.5));
          float c = dot(d, uMoon);
          float disc = smoothstep(uMoonCos, uMoonCos + 0.0006, c);
          // faint maria: a darker patchwork across the disc, so it reads as a moon rather than a lamp
          float maria = 0.86 + 0.14 * sin(d.x * 260.0 + 1.3) * sin(d.y * 310.0 + 0.4) * sin(d.z * 240.0);
          float halo = pow(max(c, 0.0), 120.0) * 0.45 + pow(max(c, 0.0), 24.0) * 0.05;
          col += uMoonColor * disc * maria + vec3(0.2, 0.34, 0.8) * halo;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  mesh.scale.setScalar(500);
  mesh.frustumCulled = false;
  return {
    mesh,
    set(s, moonDir) {
      uniforms.uTop.value.set(s.top);
      uniforms.uHorizon.value.set(s.horizon);
      uniforms.uMoon.value.set(...moonDir).normalize();
      uniforms.uMoonColor.value.setRGB(...s.moon);
      uniforms.uMoonCos.value = Math.cos(s.moonRadius);
    },
  };
}

// One Points draw of about sixteen hundred stars on a big sphere, shown only on the night theme. The sphere is
// centred on the camera every frame (environment.update), so the stars never parallax; the rock and the clouds
// draw over them. Square-ish 2 px dots are too harsh, so they use a soft round sprite.
function buildStars() {
  const rand = mulberry32(99);
  const N = 1600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = 0.03 + 0.97 * rand(); // upper sky only: below the horizon is rock and cloud
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(a) * r * 400, y * 400, Math.sin(a) * r * 400], i * 3);
    const b = 0.45 + 0.55 * Math.pow(rand(), 2); // most are dim, a few bright
    const warm = rand();
    col.set([b * (0.85 + 0.15 * warm), b * 0.92, b * (1.05 - 0.15 * warm)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(canvas),
      vertexColors: true,
      size: 4,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 0; // before the cloud sea (2) and the waterfalls (1)
  points.visible = false;
  return { points };
}

// ---------- rock ----------

// The rock walls fill most of the screen. On the LG TV, per-pixel PBR on them ran at 11 fps at 1280x720;
// unlit with lighting baked into the vertex colours (bakeRockLighting) ran at 38 fps at 0.75 scale.
function rockMaterial(aniso, lite) {
  if (lite) return new THREE.MeshBasicMaterial({ ...loadSet('rock_face_03', aniso, null, { mapOnly: true }), vertexColors: true });
  const mat = new THREE.MeshStandardMaterial({ ...loadSet('rock_face_03', aniso), vertexColors: true, roughness: 1 });
  mat.normalScale.set(1.4, 1.4);
  return mat;
}

function fbm(x, y, z, octaves) {
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

// Radial scale of the surface at an undisplaced point (x, z) at height y above the rock's base:
// big bulges, vertical flutes, and strata that swell outward then step back in (ledges and overhangs).
function rockScale(spec, px, py, pz) {
  const o = spec.o;
  const k = spec.fq ?? 1; // noise frequency: small boulders need finer features
  const x = px * k;
  const y = py * k;
  const z = pz * k;
  const big = fbm(x * 0.06 + o[0], y * 0.035 + o[1], z * 0.06 + o[2], 4);
  const flute = 1 - Math.abs(noise.noise(x * 0.32 + o[2], y * 0.02, z * 0.32 + o[0]));
  const s = y / (spec.bandH) + 0.9 * noise.noise(x * 0.05 + o[1], y * 0.015, z * 0.05);
  const f = s - Math.floor(s);
  const strata = THREE.MathUtils.smoothstep(f, 0, 0.8) * (1 - THREE.MathUtils.smoothstep(f, 0.8, 0.86));
  const fine = fbm(x * 0.3 + o[1], y * 0.3 + o[0], z * 0.3 + o[2], 2);
  const sc = 1 + spec.bulge * big + 0.14 * (flute - 0.5) + 0.2 * (strata - 0.4) + 0.035 * fine;
  return Math.max(sc, 0.35);
}

// Columns lean and shift with height instead of standing as straight pipes.
function rockSway(spec, y) {
  if (spec.flat) return [0, 0];
  const t = y / spec.h;
  return [
    (Math.sin(y * 0.045 + spec.o[0]) * 0.28 + fbm(0, y * 0.02 + spec.o[1], spec.o[2], 2) * 0.5) * spec.r * t,
    Math.cos(y * 0.037 + spec.o[2]) * 0.28 * spec.r * t,
  ];
}

function cliffSpec(rand, p) {
  return { ...p, o: [rand() * 200, rand() * 200, rand() * 200], bandH: 6 + rand() * 6 };
}

function buildRockGeometry(spec) {
  const { r, rTop, h, radial, rows, flat } = spec;
  const sx = spec.sx ?? 1;
  const geo = new THREE.CylinderGeometry(rTop, r, h, radial, rows);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const torso = (radial + 1) * (rows + 1);
  const reps = Math.max(1, Math.round((Math.PI * (r + rTop)) / TEX_M)); // whole tiles around, so the seam matches
  const colors = new Float32Array(pos.count * 3);
  const { smoothstep } = THREE.MathUtils;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i) + h / 2; // metres above the base
    const t = y / h;
    let sc = rockScale(spec, x, y, z);
    if (flat) sc = 1 + (sc - 1) * (1 - 0.5 * smoothstep(t, 0.85, 0.98)); // level top, but the rim stays a little ragged
    let yy = y;
    if (!flat && t > 0.9) {
      const rad = Math.hypot(x, z);
      yy += (fbm(x * 0.25 + spec.o[0], 0, z * 0.25 + spec.o[2], 2) * 0.05 * smoothstep(t, 0.9, 1) + 0.04 * (1 - Math.min(1, rad / rTop))) * h;
    }
    // lean and sway: columns bend and shift with height instead of standing as straight pipes
    const sway = rockSway(spec, y);
    pos.setXYZ(i, (x * sc + sway[0]) * sx, yy - h / 2, z * sc + sway[1]);
    if (i < torso) uv.setXY(i, uv.getX(i) * reps, y / TEX_M);
    else uv.setXY(i, x / TEX_M, z / TEX_M);

    // baked crevice darkening, a little warm/cool variation, and deeper = darker (cloud shadow)
    const ao = THREE.MathUtils.clamp(0.82 + (sc - 1) * 1.3, 0.45, 1.1);
    const depth = 0.55 + 0.45 * smoothstep(y + spec.base, -40, -2);
    const tint = 0.04 * noise.noise(x * 0.02 + spec.o[0], y * 0.03, z * 0.02);
    colors.set([ao * depth * 0.8, ao * depth * (0.85 + tint), ao * depth * (0.95 + tint * 1.5)], i * 3);
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
function rockSurface(spec, ang, y) {
  const r0 = spec.r + (spec.rTop - spec.r) * (y / spec.h);
  const x = Math.cos(ang) * r0;
  const z = Math.sin(ang) * r0;
  const sc = rockScale(spec, x, y, z);
  const sway = rockSway(spec, y);
  return { x: spec.x + x * sc + sway[0], y: spec.base + y, z: spec.z + z * sc + sway[1] };
}

function cliffLayout(rand) {
  const specs = [];
  // is a point in the wedge of sky the sun sits in? keep it clear so the sun glows through the haze
  const inSunGap = (x, z) => Math.abs(Math.atan2(x, -(z + 30)) - Math.atan2(-0.2, 0.97)) < 0.2;
  for (const side of [-1, 1]) {
    for (let z = 14; z > -105; z -= 9 + rand() * 4) {
      const r = 7 + rand() * 3;
      const h = 58 + rand() * 22;
      specs.push(cliffSpec(rand, { wall: side, x: side * (r + 17 + rand() * 5), z: z - rand() * 4, base: -46, h, r, rTop: r * (0.62 + rand() * 0.2), radial: 34, rows: 52, bulge: 0.42 }));
    }
  }
  for (let i = 0; i < 30; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (30 + rand() * 40);
    const z = 10 - rand() * 190;
    const r = 3.5 + rand() * 3.5;
    if (inSunGap(x, z)) continue;
    specs.push(cliffSpec(rand, { x, z, base: -46, h: 75 + rand() * 55, r, rTop: r * (0.22 + rand() * 0.2), radial: 22, rows: 38, bulge: 0.45 }));
  }
  for (let i = 0; i < 22; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (14 + rand() * 80);
    const z = -110 - rand() * 130;
    const r = 10 + rand() * 10;
    if (inSunGap(x, z)) continue;
    specs.push(cliffSpec(rand, { x, z, base: -46, h: 110 + rand() * 60, r, rTop: r * (0.35 + rand() * 0.3), radial: 18, rows: 30, bulge: 0.4 }));
  }
  // big cliffs closing the canyon far ahead: they carry the waterfalls, seen head-on past the gate
  for (const [x, z, r, h] of [[19, -130, 15, 150], [48, -112, 12, 130], [-62, -130, 14, 140]]) {
    specs.push(cliffSpec(rand, { backdrop: true, x, z, base: -46, h, r, rTop: r * 0.5, radial: 34, rows: 60, bulge: 0.35 }));
  }
  // the bridge ledges: level, round tops at the bridge's height
  for (const z of [3, -BRIDGE_LENGTH - 3]) {
    specs.push(cliffSpec(rand, { ledge: true, flat: true, sx: 1.9, x: 0, z, base: -40.05, h: 40, r: 6.4, rTop: 6, radial: 40, rows: 24, bulge: 0.25 }));
    for (let k = 0; k < 7; k++) {
      // boulders on the shelf, kept off the bridge path and the gate
      const side = k % 2 ? 1 : -1;
      const rr = 0.7 + rand() * 1.1;
      specs.push(cliffSpec(rand, { x: side * (4 + rand() * 6.5), z: z + (rand() - 0.5) * 7, base: -0.6, h: 1.4 + rand() * 1.8, r: rr, rTop: rr * 0.3, radial: 14, rows: 8, bulge: 0.5, fq: 7 }));
    }
  }
  return specs;
}

// Light the rock per vertex, roughly as the scene's lights would (see scene.js): the sun, the fill from behind
// the camera, and a sky/ground ambient standing in for the image-based light. Physically based diffuse is
// albedo * intensity * N.L / PI, so the factors are each light's intensity / PI. Run once per theme, always from
// `base` (the unlit colours), so re-baking never compounds.
const FILL_DIR = new THREE.Vector3(3, 8, 12).normalize();
const bakeColor = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function bakeRockLighting(geo, base, theme) {
  const n = geo.attributes.normal;
  const c = geo.attributes.color;
  const out = c.array;
  const sunDir = new THREE.Vector3(...theme.sun.dir).normalize();
  const { rock } = theme;
  const sunC = bakeColor(theme.sun.color, theme.sun.intensity / Math.PI);
  const fillC = bakeColor(...rock.fill);
  const skyC = bakeColor(...rock.sky);
  const groundC = bakeColor(...rock.ground);
  const [tr, tg, tb] = rock.tint;
  const desat = rock.desat;
  const wrap = rock.wrap ?? 0; // wrapped diffuse: low sun light that spills round onto sideways-facing rock
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i);
    const ny = n.getY(i);
    const nz = n.getZ(i);
    const sun = Math.max(0, (nx * sunDir.x + ny * sunDir.y + nz * sunDir.z + wrap) / (1 + wrap));
    const fill = Math.max(0, nx * FILL_DIR.x + ny * FILL_DIR.y + nz * FILL_DIR.z);
    const up = ny * 0.5 + 0.5;
    const lr = groundC.r + (skyC.r - groundC.r) * up + sunC.r * sun + fillC.r * fill;
    const lg = groundC.g + (skyC.g - groundC.g) * up + sunC.g * sun + fillC.g * fill;
    const lb = groundC.b + (skyC.b - groundC.b) * up + sunC.b * sun + fillC.b * fill;
    let r = base[i * 3] * lr * tr;
    let g = base[i * 3 + 1] * lg * tg;
    let b = base[i * 3 + 2] * lb * tb;
    if (desat > 0) {
      const grey = 0.3 * r + 0.59 * g + 0.11 * b;
      r += (grey - r) * desat;
      g += (grey - g) * desat;
      b += (grey - b) * desat;
    }
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  c.needsUpdate = true;
}

function buildCliffs(material) {
  const rand = mulberry32(42);
  const specs = cliffLayout(rand);
  const mesh = new THREE.Mesh(mergeGeometries(specs.map(buildRockGeometry)), material);
  mesh.frustumCulled = false; // one big merged mesh, always on screen
  return { mesh, hosts: specs.filter((s) => s.backdrop) };
}

// Boxes with world-scaled UVs (axis picked by each vertex's normal) so stone doesn't stretch.
function worldBox(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    if (ax > 0.5) uv.setXY(i, pos.getZ(i) / TEX_M, pos.getY(i) / TEX_M);
    else if (ay > 0.5) uv.setXY(i, pos.getX(i) / TEX_M, pos.getZ(i) / TEX_M);
    else uv.setXY(i, pos.getX(i) / TEX_M, pos.getY(i) / TEX_M);
  }
  g.translate(x, y, z);
  return g;
}

function buildGate(rock) {
  const mat = rock.clone(); // same textures, no baked vertex colours on the boxes
  mat.vertexColors = false;
  mat.color.set(0xd8c4ac);
  const geo = mergeGeometries([
    worldBox(0.8, 5, 0.8, -1.6, 2.5, 0),
    worldBox(0.8, 5, 0.8, 1.6, 2.5, 0),
    worldBox(4.4, 0.9, 1, 0, 5.2, 0),
  ]);
  const gate = new THREE.Mesh(geo, mat);
  gate.position.z = -BRIDGE_LENGTH - 3;
  return gate;
}

// ---------- bridge ----------

// Each plank: a box whose UVs pick its own board of the 13-board texture, grain running across the bridge.
function plankBox(rand, w, d) {
  const g = new THREE.BoxGeometry(w, 0.06, d);
  const uv = g.attributes.uv;
  const u0 = rand();
  const v0 = Math.floor(rand() * 13) / 13 + 0.004;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.4, v0 + uv.getY(k) * 0.066);
  return g;
}

// A plank's span along the bridge, in metres from the start: [i * step - depth / 2, i * step + depth / 2].
export function plankOverlapsGap(i, gaps) {
  const lo = i * PLANK_STEP - PLANK_DEPTH / 2;
  const hi = i * PLANK_STEP + PLANK_DEPTH / 2;
  return gaps.some((g) => hi > g.start && lo < g.end);
}

function buildBridge(aniso, lite, windU) {
  const group = new THREE.Group();
  const rand = mulberry32(7);
  const count = Math.ceil(BRIDGE_LENGTH / PLANK_STEP);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(1, 1, 1);
  const boards = []; // kept, so the planks can be merged again without the ones over a gap
  for (let i = 0; i < count; i++) {
    const g = plankBox(rand, 1, PLANK_DEPTH);
    euler.set(0, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.06); // slightly uneven planks
    matrix.compose(new THREE.Vector3((rand() - 0.5) * 0.06, -0.03, -i * PLANK_STEP), quat.setFromEuler(euler), scale);
    boards.push(g.applyMatrix4(matrix));
  }
  const plankMaterial = lite
    ? new THREE.MeshLambertMaterial(loadSet('weathered_brown_planks', aniso, null, { mapOnly: true }))
    : new THREE.MeshStandardMaterial({ ...loadSet('weathered_brown_planks', aniso), roughness: 1 });
  const planks = new THREE.Mesh(mergeGeometries(boards), plankMaterial);
  planks.receiveShadow = true;
  group.add(planks, buildRopes(windU));

  // Splintered stubs hang off the nearest planks beside each gap, so the missing boards read from a distance.
  function stubs(gaps) {
    const r = mulberry32(21);
    const out = [];
    const d = 0.3;
    const edge = (attach, sign) => {
      // sign +1: off the near edge, reaching on into the gap; -1: off the far edge, reaching back toward the walker
      const w = 0.5 + r() * 0.3;
      const g = plankBox(r, w, d);
      g.translate(0, -0.03, -sign * (d / 2));
      g.rotateX(-sign * 0.55); // droops down into the gap, hinged on the attached edge
      g.rotateY((r() - 0.5) * 0.3);
      g.translate((r() < 0.5 ? -1 : 1) * (0.5 - w / 2), 0, -attach);
      out.push(g);
    };
    for (const { start, end } of gaps) {
      const near = Math.max(0, Math.floor((start - PLANK_DEPTH / 2) / PLANK_STEP + 1e-6));
      const far = Math.min(count - 1, Math.ceil((end + PLANK_DEPTH / 2) / PLANK_STEP - 1e-6));
      edge(near * PLANK_STEP + PLANK_DEPTH / 2, 1);
      edge(far * PLANK_STEP - PLANK_DEPTH / 2, -1);
    }
    return out;
  }

  // The camera sits behind the walker, who hides the planks just ahead of him, but the handrails stay
  // in view on both sides: a strip of red cloth tied to each rope marks both edges of a gap.
  const markers = new THREE.Mesh(
    new THREE.BufferGeometry(),
    applyWindSway(new THREE.MeshBasicMaterial({ color: 0xc9301f, side: THREE.DoubleSide }), windU, 'cloth', BRIDGE_LENGTH),
  );
  markers.name = 'gapMarkers';
  group.add(markers);
  function markerGeometry(gaps) {
    const out = [];
    for (const { start, end } of gaps) {
      for (const d of [start - 0.05, end + 0.05]) {
        for (const x of [-0.65, 0.65]) {
          const g = new THREE.PlaneGeometry(0.16, 0.6);
          g.translate(x, ropeSag(d) - 0.3, -d);
          out.push(g);
        }
      }
    }
    return out.length ? mergeGeometries(out) : new THREE.BufferGeometry();
  }

  let applied = null;
  return {
    group,
    setGaps(gaps) {
      if (gaps === applied) return;
      applied = gaps;
      const keep = boards.filter((_, i) => !plankOverlapsGap(i, gaps));
      const next = mergeGeometries([...keep, ...stubs(gaps)]);
      planks.geometry.dispose();
      planks.geometry = next;
      markers.geometry.dispose();
      markers.geometry = markerGeometry(gaps);
    },
  };
}

function ropeTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rand = mulberry32(11);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const f = (3 * (py / S) + px / S) % 1; // three strands wound around the rope
      const strand = Math.pow(Math.sin(Math.PI * f), 0.7);
      const fibre = 0.78 + 0.22 * noise.noise(px * 0.35, py * 0.05 + px * 0.12, 3.1) + (rand() - 0.5) * 0.18;
      const v = (0.35 + 0.65 * strand) * fibre;
      const i = (py * S + px) * 4;
      img.data.set([150 * v, 112 * v, 72 * v, 255], i);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const ropeSag = (d) => 1.0 - 0.15 * Math.sin((Math.PI * d) / BRIDGE_LENGTH); // hand-rope height at d metres along

function buildRopes(windU) {
  const sag = ropeSag;
  const tube = (x, y0, dy, radius) => {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const d = (i / 40) * BRIDGE_LENGTH;
      points.push(new THREE.Vector3(x, y0 + dy(d), -d));
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 120, radius, 8);
    const uv = g.attributes.uv; // u runs along the rope, v around it: tile the twist
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 300, uv.getY(k));
    return g;
  };
  const parts = [];
  for (const x of [-0.65, 0.65]) {
    parts.push(tube(x, 0, sag, 0.045)); // hand rope
    parts.push(tube(x * 0.97, -0.14, () => 0, 0.04)); // bearer rope under the planks
    for (let d = 1.35; d < BRIDGE_LENGTH; d += 2.7) {
      const top = sag(d);
      const g = new THREE.CylinderGeometry(0.016, 0.016, top + 0.14, 5, 1, true);
      g.translate(x * 0.985, (top - 0.14) / 2, -d);
      parts.push(g);
    }
  }
  const tex = ropeTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2, roughness: 0.95 });
  return new THREE.Mesh(mergeGeometries(parts), applyWindSway(mat, windU, 'rope'));
}

// ---------- clouds ----------

function cloudAtlas() {
  const N = 2; // 2x2 cells: three cloud shapes and one thin mist
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (let v = 0; v < 4; v++) {
    const ox = (v % N) * S;
    const oy = Math.floor(v / N) * S;
    const rand = mulberry32(100 + v);
    const mist = v === 3;
    const puffs = mist ? 14 : 34;
    for (let k = 0; k < puffs; k++) {
      const ax = (rand() - 0.5) * (mist ? 1.1 : 0.78);
      const dome = Math.max(0, 1 - Math.abs(ax) * 1.5);
      const rad = S * (mist ? 0.2 + rand() * 0.14 : (0.08 + rand() * 0.1) * (0.55 + dome));
      const cx = ox + S * (0.5 + ax * 0.5);
      const cy = oy + S * (mist ? 0.52 + (rand() - 0.5) * 0.1 : 0.66 - rand() * 0.3 * dome);
      const a = mist ? 0.35 : 0.55;
      const g = ctx.createRadialGradient(cx - rad * 0.15, cy - rad * 0.35, rad * 0.05, cx, cy, rad);
      g.addColorStop(0, `rgba(255,240,214,${a})`); // sunlit top
      g.addColorStop(0.55, `rgba(250,214,186,${a * 0.7})`);
      g.addColorStop(1, 'rgba(206,176,176,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    // erode with noise, then light it: pixels whose upward neighbour is empty are sunlit tops, the rest fall into
    // blue-grey shadow. Fade to nothing at the cell border so atlas cells never bleed into each other.
    const img = ctx.getImageData(ox, oy, S, S);
    const alpha = new Float32Array(S * S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const n = 0.55 + 0.65 * fbm(px * 0.04 + v * 17, py * 0.04, 1.7, 4);
        const d = Math.hypot((px - S / 2) / (S / 2), (py - S / 2) / (S / 2));
        const edge = 1 - THREE.MathUtils.smoothstep(d, 0.55, 1);
        alpha[py * S + px] = Math.min(1, (img.data[(py * S + px) * 4 + 3] / 255) * n * edge * 1.25);
      }
    }
    const L = mist ? 2 : 9; // how far towards the light to look
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const i = (py * S + px) * 4;
        const a = alpha[py * S + px];
        const qx = Math.max(0, px - Math.round(L * 0.4));
        const qy = Math.max(0, py - L);
        const lit = THREE.MathUtils.clamp(0.45 + 1.7 * (a - alpha[qy * S + qx]), 0, 1);
        const low = THREE.MathUtils.smoothstep(py / S, 0.5, 0.85) * 0.35; // flat, shaded underside
        const k = lit * (1 - low);
        img.data[i] = 176 + (255 - 176) * k;
        img.data[i + 1] = 150 + (234 - 150) * k;
        img.data[i + 2] = 152 + (200 - 152) * k;
        img.data[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, ox, oy);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  return tex;
}

// One instanced draw: camera-facing quads, painted far-to-near, slowly drifting, fading into the fog.
function buildClouds(fog, count) {
  const rand = mulberry32(2024);
  const items = [];
  for (let i = 0; i < count; i++) {
    const layer = rand();
    const z = 24 - Math.pow(rand(), 1.25) * 250;
    const spread = 14 + Math.abs(z + 30) * 0.28;
    const w = 20 + rand() * 24;
    items.push({
      x: (rand() + rand() + rand() - 1.5) * 2 * spread,
      y: -21 - layer * 13 + (rand() - 0.5) * 3,
      z,
      w,
      h: w * (0.28 + rand() * 0.18),
      cell: Math.floor(rand() * 3),
      tone: 1.5 + rand() * 0.35 + (1 - layer) * 0.35, // the upper layer catches more light
      phase: rand(),
      alpha: 0.75 + rand() * 0.25,
    });
  }
  for (let i = 0; i < 16; i++) {
    // thin mist hugging the far end of the canyon
    items.push({ x: (rand() - 0.5) * 50, y: -7 + rand() * 8, z: -72 - rand() * 70, w: 50 + rand() * 40, h: 12 + rand() * 8, cell: 3, tone: 1.7, phase: rand(), alpha: 0.5 });
  }
  items.sort((a, b) => a.z - b.z); // farthest first, so blending composites in the right order

  const geo = new THREE.PlaneGeometry(1, 1);
  const attr = new Float32Array(items.length * 4);
  const mesh = new THREE.InstancedMesh(geo, null, items.length);
  const m = new THREE.Matrix4();
  items.forEach((c, i) => {
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion(), new THREE.Vector3(c.w, c.h, 1)));
    attr.set([c.cell, c.tone, c.phase, c.alpha], i * 4);
  });
  geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(attr, 4));

  const uniforms = {
    uMap: { value: cloudAtlas() },
    uTime: { value: 0 },
    uFogColor: { value: fog.color },
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
    uSun: { value: new THREE.Vector3(0, 0, -1) },
    uTint: { value: new THREE.Vector3(1, 0.88, 0.74) },
  };
  mesh.material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aCloud; // cell, tone, drift phase, alpha
      uniform float uTime;
      uniform vec3 uSun;
      varying vec2 vUv;
      varying vec3 vData; // tone, alpha, depth
      void main() {
        vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), 1.0);
        vec4 wp = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        wp.x += sin(uTime * 0.045 + aCloud.z * 6.2831) * 4.0;
        wp.z += cos(uTime * 0.03 + aCloud.z * 9.0) * 2.0;
        vec4 mv = viewMatrix * wp;
        mv.xy += position.xy * size.xy;
        float glow = pow(max(dot(normalize(wp.xyz - cameraPosition), uSun), 0.0), 6.0);
        vData = vec3(aCloud.y + glow * 0.7, aCloud.w, -mv.z);
        vec2 cell = vec2(mod(aCloud.x, 2.0) * 0.5, 0.5 - floor(aCloud.x / 2.0) * 0.5);
        vUv = uv * 0.5 + cell;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform vec3 uTint;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec2 vUv;
      varying vec3 vData;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float fog = smoothstep(uFogNear, uFogFar, vData.z);
        vec3 c = mix(t.rgb * uTint * vData.x, uFogColor, fog * 0.9);
        gl_FragColor = vec4(c, t.a * vData.y * smoothstep(3.0, 14.0, vData.z));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    update(t) {
      uniforms.uTime.value = t;
    },
    // fog.color is shared live; the range and sun direction are copies, and the whole sea can be raised or lowered.
    setTheme(theme, fogNow) {
      uniforms.uFogNear.value = fogNow.near;
      uniforms.uFogFar.value = fogNow.far;
      uniforms.uSun.value.set(...theme.sun.dir).normalize();
      uniforms.uTint.value.set(...theme.clouds.tint);
      mesh.position.y = theme.clouds.lift;
    },
  };
}

// ---------- waterfalls ----------

function streakTexture() {
  const W = 128;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(31);
  for (let i = 0; i < 120; i++) {
    const x = rand() * W;
    const w = 1 + rand() * 3.5;
    const len = 40 + rand() * 260;
    const y = rand() * H;
    const edge = 1 - Math.abs(x / W - 0.5) * 1.6; // thinner towards the sides
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, `rgba(255,250,240,${(0.35 + rand() * 0.55) * edge})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    for (const yy of [y, y - H]) ctx.fillRect(x - w / 2, yy, w, len); // wrap so the texture tiles vertically
  }
  const soft = ctx.createLinearGradient(0, 0, W, 0);
  soft.addColorStop(0, 'rgba(255,255,255,0)');
  soft.addColorStop(0.5, 'rgba(255,252,246,0.5)');
  soft.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = soft;
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Free-falling curtains of water that pour off a lip high on a few near cliffs, hang just clear of the rock
// and fade into the clouds. Flat sheets turned towards the camera, scrolled by texture offset.
function buildWaterfalls(hosts) {
  const tex = streakTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2.4, 2.4, 2.3) });
  const group = new THREE.Group();
  const picks = [
    [19, -130],
    [48, -112],
    [-62, -130],
  ];
  const rand = mulberry32(77);
  for (const [xWant, zWant] of picks) {
    const dist = (w) => Math.hypot(w.x - xWant, w.z - zWant);
    const spec = hosts.reduce((best, w) => (dist(w) < dist(best) ? w : best));
    const ang = Math.atan2(-20 - spec.z, -spec.x) + (rand() - 0.5) * 0.3; // the face turned towards the walker's end of the canyon
    const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang));
    const top = spec.h * 0.5; // local height of the lip
    const bottom = 12; // down into the clouds
    // how far the cliff juts out towards the camera anywhere along the drop: the curtain hangs just clear of it
    let out = 0;
    for (let y = bottom; y <= top; y += 1.5) {
      const p = rockSurface(spec, ang, y);
      out = Math.max(out, (p.x - spec.x) * dir.x + (p.z - spec.z) * dir.y);
    }
    const cx = spec.x + dir.x * (out + 0.5);
    const cz = spec.z + dir.y * (out + 0.5);
    const width = 7 + rand() * 3;
    const rowsN = 40;
    const verts = [];
    const colors = [];
    const uvs = [];
    const index = [];
    const v0 = rand() * 4;
    const cols = 2;
    for (let j = 0; j <= rowsN; j++) {
      const f = j / rowsN;
      const y = top + (bottom - top) * f;
      const fade = THREE.MathUtils.smoothstep(f, 0, 0.05) * (1 - THREE.MathUtils.smoothstep(f, 0.6, 0.98));
      const spread = 1 + f * 0.5; // the curtain widens as it falls
      for (let i = 0; i <= cols; i++) {
        const side = (i / cols - 0.5) * width * spread;
        verts.push(cx - dir.y * side, spec.base + y, cz + dir.x * side);
        colors.push(1, 1, 1, fade * (1 - Math.pow(Math.abs(i / cols - 0.5) * 2, 2)) * 0.95);
        uvs.push(i / cols, v0 + (top - y) / 14);
      }
    }
    for (let j = 0; j < rowsN; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        index.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  return {
    group,
    update(t) {
      tex.offset.y = t * 0.45; // streaks run down the ribbon
    },
    setTint(rgb) {
      mat.color.setRGB(...rgb, THREE.LinearSRGBColorSpace); // above 1: the water is brighter than the lit sky
    },
  };
}

// ---------- birds ----------

function birdTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(3, 11);
  ctx.quadraticCurveTo(10, 9, 16, 18);
  ctx.quadraticCurveTo(22, 9, 29, 11);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

// A dozen specks circling far off in the gap between the cliffs, where the golden sun sits.
const BIRD_CENTRE = { x: -0.2 * 150, z: -0.97 * 150 };
function buildBirds() {
  const rand = mulberry32(5);
  const flock = Array.from({ length: 12 }, () => ({
    cx: BIRD_CENTRE.x + (rand() - 0.5) * 70,
    cy: 18 + rand() * 26,
    cz: BIRD_CENTRE.z + (rand() - 0.5) * 50,
    radius: 6 + rand() * 12,
    speed: 0.18 + rand() * 0.22,
    phase: rand() * 6.28,
  }));
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(flock.length * 3), 3);
  geo.setAttribute('position', pos);
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ map: birdTexture(), color: 0x2a2018, size: 5, transparent: true, depthWrite: false, fog: false }),
  );
  points.frustumCulled = false;
  const update = (t) => {
    flock.forEach((b, i) => {
      const a = b.phase + t * b.speed;
      pos.setXYZ(i, b.cx + Math.cos(a) * b.radius, b.cy + Math.sin(a * 2.3) * 1.5, b.cz + Math.sin(a) * b.radius * 0.6);
    });
    pos.needsUpdate = true;
  };
  update(0);
  return { points, update };
}
