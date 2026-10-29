// The look-and-sound themes the levels cycle through. Each theme is a plain object keyed by `id`; other
// modules add their own fields to it (the sound for each id lives in THEME_SOUNDS in audio.js, keyed by
// the same id). The visual fields below are plain data (hex numbers and arrays), read by scene.js and
// environment.js; this file imports nothing, so audio.js and the tests can use it freely.
//
//   sun       the key light (the moon at night): dir points TOWARDS it, x right, y up, -z down the bridge
//   fill      the cool/warm bounce from behind the camera
//   hemi      the hemisphere light that lifts the shadows
//   exposure, envIntensity   tone-mapping exposure, and the strength of the baked sky's image-based light
//   fog       { color, near, far }: the haze the distant cliffs fade into (the sky's horizon matches it)
//   sky       'preetham' themes: Sky uniforms plus a colour grade. warm = [slope, base, sun, sunPower] says how
//             far the grade goes from `top` (overhead) to `low` (horizon and sun side); the grade multiplies the
//             Preetham colour. 'night' themes: a dark gradient (top/horizon in sRGB hex) with a moon disc.
//   rock      what the lite rock's baked vertex lighting adds besides the sun: fill, sky ambient and ground
//             ambient as [hex, strength], a per-channel tint, and desat (0..1, towards grey)
//   clouds    tint: per-channel colour of the cloud sea; lift: metres the whole sea is raised
//   falls     per-channel tint of the waterfalls
//   birds / stars   which extras are drawn

export const THEMES = [
  {
    id: 'golden',
    name: 'Golden Afternoon',
    sun: { dir: [-0.2, 0.14, -0.97], color: 0xffd0a0, intensity: 3.2 },
    fill: { color: 0xc4d2ff, intensity: 0.95 },
    hemi: { sky: 0xffe6c0, ground: 0x2e3b4a, intensity: 0.3 },
    exposure: 0.5,
    envIntensity: 0.45,
    fog: { color: 0xe9b88f, near: 12, far: 210 },
    sky: { kind: 'preetham', turbidity: 8, rayleigh: 1.8, mie: 0.004, mieG: 0.95, warm: [2.4, 0.75, 0.6, 4], top: [0.5, 0.62, 0.95], low: [1.0, 0.56, 0.28] },
    rock: { fill: [0xffe2c8, 0.8], sky: [0xffc88c, 1.05], ground: [0x8a6040, 0.4], tint: [1, 1, 1], desat: 0 },
    clouds: { tint: [1.0, 0.88, 0.74], lift: 0 },
    falls: { tint: [2.4, 2.4, 2.3] },
    birds: true,
    stars: false,
  },
  {
    id: 'morning',
    name: 'Misty Morning',
    sun: { dir: [0.82, 0.26, -0.5], color: 0xfff0dc, intensity: 2.5 },
    fill: { color: 0xcfe0ff, intensity: 1.0 },
    hemi: { sky: 0xdce8ff, ground: 0x4a5868, intensity: 0.42 },
    exposure: 0.55,
    envIntensity: 0.6,
    fog: { color: 0xdfe8ef, near: 4, far: 105 },
    sky: { kind: 'preetham', turbidity: 4, rayleigh: 1.4, mie: 0.006, mieG: 0.85, hue: 0.7, warm: [1.8, 0.55, 0.45, 3], top: [0.8, 0.92, 1.15], low: [1.0, 0.92, 0.76] },
    rock: { fill: [0xdbe6ff, 0.7], sky: [0xc8d8f0, 1.0], ground: [0x6a7480, 0.45], tint: [0.92, 0.97, 1.04], desat: 0.35 },
    clouds: { tint: [1.25, 1.25, 1.3], lift: 8 },
    falls: { tint: [2.6, 2.7, 2.8] },
    birds: true,
    stars: false,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    sun: { dir: [-0.2, 0.05, -0.98], color: 0xff6a2c, intensity: 3.4 },
    fill: { color: 0xff9a78, intensity: 1.5 },
    hemi: { sky: 0xff9a70, ground: 0x4a2a44, intensity: 0.6 },
    exposure: 0.5,
    envIntensity: 0.5,
    fog: { color: 0xd2694a, near: 10, far: 230 },
    sky: { kind: 'preetham', turbidity: 10, rayleigh: 3, mie: 0.008, mieG: 0.97, hue: 1, warm: [2.2, 0.9, 0.9, 3], top: [0.75, 0.22, 1.5], low: [1.0, 0.3, 0.09] },
    rock: { fill: [0xff8a60, 0.9], sky: [0xe0705a, 1.2], ground: [0x60283c, 0.45], tint: [1, 0.9, 0.9], desat: 0, wrap: 0.6 },
    clouds: { tint: [1.15, 0.62, 0.5], lift: 2 },
    falls: { tint: [2.2, 1.5, 1.2] },
    birds: true,
    stars: false,
  },
  {
    id: 'night',
    name: 'Moonlit Night',
    sun: { dir: [-0.18, 0.3, -0.94], color: 0xaec4ff, intensity: 1.6 },
    fill: { color: 0x7f9be0, intensity: 1.7 },
    hemi: { sky: 0x8aa0d8, ground: 0x28324c, intensity: 1.0 },
    exposure: 1.0,
    envIntensity: 1.0,
    fog: { color: 0x0b1424, near: 10, far: 170 },
    sky: { kind: 'night', top: 0x030814, horizon: 0x0f1c33, moon: [2.4, 2.6, 3.0], moonRadius: 0.05 },
    rock: { fill: [0x7a96d8, 0.9], sky: [0x6a86c0, 1.1], ground: [0x1a2438, 0.5], tint: [0.8, 0.95, 1.35], desat: 0.15 },
    clouds: { tint: [0.32, 0.38, 0.5], lift: 0 },
    falls: { tint: [0.9, 1.05, 1.4] },
    birds: false,
    stars: true,
  },
];

// Level 1 is the first theme, level 5 comes round to it again. Anything that is not a level number
// (0, NaN, a negative) counts as level 1.
export function themeForLevel(level) {
  const n = Math.floor(Number(level));
  const i = Number.isFinite(n) && n >= 1 ? n - 1 : 0;
  return THEMES[i % THEMES.length];
}
