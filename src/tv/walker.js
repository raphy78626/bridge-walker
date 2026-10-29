import * as THREE from 'three';
import { FALL_ANGLE, WALK_SPEED } from '../game/balance.js';
import { blobLook } from './blobShadow.js';
import { buildBlob } from './blobMesh.js';
import { WALK_ABOVE } from './gait.js';
import { loadSoldier } from './soldierAsset.js';

// One soldier on the bridge: the pivot group (origin at his feet), the placeholder figure until the Soldier model has
// loaded, the animation rig, the footstep bob, the fall, and on a TV the blob shadow under him.
//   createWalker(scene, { isTV, x, tint, name, load })
//     x     the lateral offset of his bridge (world x), 0 for the usual single bridge
//     tint  a colour (hex, string or THREE.Color) multiplied into his materials; null leaves them as they are
//     load  how the model is fetched: () => Promise<{ model, rig }>; a test passes a fake
//   .update(w, phase, phaseTime, fallCause, input, dt, t)   puts him where the session says and animates him
//   .setVisible(bool)
//   .focus   what a camera needs to follow him; the same object every frame, so reading it allocates nothing
//   .pivot   the group in the scene
// World layout: he starts at z = 0 and walks toward -z. x is right, y is up.
export function createWalker(scene, { isTV = false, x = 0, tint = null, name = 'walker', load = loadSoldier } = {}) {
  const pivot = buildPlaceholder(tint);
  pivot.name = name;
  // On a TV the soldier's shadow is a blob on the planks (one draw call) instead of a shadow map.
  const blob = isTV ? buildBlob() : null;
  if (blob) {
    blob.position.x = x;
    scene.add(blob);
  }
  scene.add(pivot);
  const blobState = { opacity: 0, scale: 1 }; // reused every frame
  const rigState = { speed: 0, falling: false, airborne: false, vy: 0, fallTime: 0 }; // reused every frame
  const focus = { w: null, x, position: pivot.position, quaternion: pivot.quaternion, pose: null, speed: 0, falling: false, gapFall: false, phaseTime: 0 };
  let rig = null; // set once the Soldier model has loaded

  load().then(
    ({ model, rig: r }) => {
      if (tint !== null) tintMaterials(model, tint);
      swapModel(pivot, model);
      rig = r;
    },
    (err) => console.warn('Soldier model failed to load, keeping the placeholder figure', err),
  );

  // w: the session's walker { z, y, vy, lean, speed, airborne }; input: { walking }; t: the scene's own clock
  // (which stands still in a pause); dt is 0 while paused.
  function update(w, phase, phaseTime, fallCause, input, dt, t) {
    const z = -w.z;
    const lift = w.y ?? 0; // height above the planks (a jump)
    pivot.position.set(x, lift, z);
    pivot.rotation.set(0, 0, -w.lean); // positive lean = leaning right
    const playing = phase === 'playing';
    const falling = phase === 'falling';
    const speed = playing ? w.speed ?? (input.walking ? WALK_SPEED : 0) : 0;
    const airborne = playing && !!w.airborne;
    if (speed > WALK_ABOVE && !rig && !airborne) {
      pivot.position.y = lift + 0.06 * Math.abs(Math.sin(t * 9)); // footstep bob (the real clip moves the body itself)
    }
    if (rig) {
      rigState.speed = speed;
      rigState.falling = falling;
      rigState.airborne = airborne;
      rigState.vy = w.vy ?? 0;
      rigState.fallTime = phaseTime;
      rig.update(rigState, dt);
      // The jump's lean forward and the landing dip, both from the pose so they move with the bones.
      pivot.position.y += rig.pose.pivotY;
      pivot.rotation.x = -rig.pose.pitch;
    }
    const gapFall = falling && fallCause === 'gap';
    if (falling) {
      const p = phaseTime;
      pivot.position.y = lift - 4.9 * p * p;
      if (gapFall) {
        // straight down through the gap, tipping a little forward
        pivot.rotation.x = -Math.min(0.4, p * 0.5);
      } else {
        const dir = Math.sign(w.lean) || 1;
        pivot.position.x = x + dir * p * 1.8;
        pivot.rotation.z = -dir * (FALL_ANGLE + p * 2.5);
      }
    }
    if (blob) {
      // Follows his feet; fades as he jumps up and as he falls (no shadow for something that has left the bridge).
      const on = pivot.visible && blobLook(lift, falling ? phaseTime : 0, blobState);
      blob.visible = on;
      if (on) {
        blob.position.z = z;
        blob.scale.setScalar(blobState.scale);
        blob.material.opacity = blobState.opacity;
      }
    }
    focus.w = w;
    focus.pose = rig ? rig.pose : null;
    focus.speed = speed;
    focus.falling = falling;
    focus.gapFall = gapFall;
    focus.phaseTime = phaseTime;
  }

  function setVisible(visible) {
    pivot.visible = visible;
    if (!visible && blob) blob.visible = false;
  }

  return { pivot, focus, update, setVisible };
}

// Simple figure with arms out for balance. The group's origin is at the feet so it pivots there.
function buildPlaceholder(tint) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x4a5560 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9946b });
  const packCloth = new THREE.MeshStandardMaterial({ color: 0x4f5a3a });
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.7, 4, 8), cloth);
  legs.position.y = 0.55;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 8), cloth);
  torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
  head.position.y = 1.78;
  const arms = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.5, 4, 6), skin);
  arms.rotation.z = Math.PI / 2;
  arms.position.y = 1.45;
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.22), packCloth);
  backpack.position.set(0, 1.3, 0.24); // +z faces the camera, so the pack is visible from behind
  g.add(legs, torso, head, arms, backpack);
  g.traverse((o) => (o.castShadow = true));
  if (tint !== null) tintMaterials(g, tint);
  return g;
}

// Gives every mesh under `root` its own copy of its material with the colour multiplied by `tint`. Copies, because the
// Soldier's materials are shared with the cached model and with every other walker.
function tintMaterials(root, tint) {
  const color = new THREE.Color(tint);
  const copies = new Map(); // a material used by several meshes is copied once
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!copies.has(o.material)) {
      const copy = o.material.clone();
      copy.color.multiply(color);
      copies.set(o.material, copy);
    }
    o.material = copies.get(o.material);
  });
}

// Swaps the Soldier into the pivot, replacing the placeholder figure.
function swapModel(pivot, model) {
  pivot.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  pivot.clear();
  pivot.add(model);
}
