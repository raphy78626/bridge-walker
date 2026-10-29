// Ropes and the red gap cloths sway sideways in the wind. The offset is added in the vertex shader of the existing
// materials, from two shared uniforms, so nothing is rebuilt or re-uploaded per frame: one float for the sway and one
// for the clock. The bearer rope under the planks stays put, so the hand ropes and posts lean from it and the
// cloths, hanging off the rope, swing out further and flutter. +x is screen right: a gust with dir +1 moves them right.

export function createWindUniforms() {
  return { uWindSway: { value: 0 }, uWindTime: { value: 0 } };
}

const DECLARE = /* glsl */ `
  uniform float uWindSway;
  uniform float uWindTime;
`;

const ROPE = /* glsl */ `
  #include <begin_vertex>
  float windRipple = 0.78 + 0.22 * sin(uWindTime * 3.2 + transformed.z * 0.55); // a wave runs down the bridge
  transformed.x += uWindSway * windRipple * 0.22 * max(transformed.y + 0.14, 0.0);
`;

const cloth = (bridgeLength) => /* glsl */ `
  #include <begin_vertex>
  float windTop = 1.0 - 0.15 * sin(3.14159265 * (-transformed.z) / ${bridgeLength.toFixed(1)}); // where the cloth is tied
  float windHang = clamp((windTop - transformed.y) / 0.6, 0.0, 1.0);                           // 0 at the knot, 1 at the hem
  float windRipple = 0.78 + 0.22 * sin(uWindTime * 3.2 + transformed.z * 0.55);
  float windFlutter = sin(uWindTime * 17.0 + transformed.z * 4.0 + transformed.y * 6.0);
  transformed.x += uWindSway * windRipple * (0.22 * (windTop + 0.14) + 0.2 * windHang)
    + abs(uWindSway) * 0.06 * windHang * windFlutter;
`;

// kind: 'rope' (hand ropes and posts) or 'cloth' (the red gap markers).
export function applyWindSway(material, uniforms, kind, bridgeLength = 60) {
  const chunk = kind === 'cloth' ? cloth(bridgeLength) : ROPE;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = DECLARE + shader.vertexShader.replace('#include <begin_vertex>', chunk);
  };
  material.customProgramCacheKey = () => `windSway:${kind}`;
  return material;
}
