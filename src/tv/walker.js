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
//   .setLane(x)           moves him (and his shadow) to another bridge; the camera focus follows
//   .setTint(color|null)  re-colours him, or back to the Soldier's own colours with null
//   .setTag(label|null, color)   a name tag floating over his head ("P1"): one sprite, one draw call
//   .focus   what a camera needs to follow him; the same object every frame, so reading it allocates nothing
//   .pivot   the group in the scene
// World layout: he starts at z = 0 and walks toward -z. x is right, y is up.
export function createWalker(scene, { isTV = false, x: startX = 0, tint: startTint = null, name = 'walker', load = loadSoldier } = {}) {
  let x = startX;
  let tint = startTint;
  const pivot = buildPlaceholder();
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
  let tag = null; // the name tag's sprite, made on first use
  let tagOn = false; // whether he should wear it (it is also hidden whenever he is)
  const focus = { w: null, x, position: pivot.position, quaternion: pivot.quaternion, pose: null, speed: 0, falling: false, gapFall: false, phaseTime: 0 };
  let rig = null; // set once the Soldier model has loaded
  const paint = createPainter();
  paint(pivot, tint);

  load().then(
    ({ model, rig: r }) => {
      swapModel(pivot, model);
      paint(pivot, tint); // repaint with the CURRENT tint: it may have changed while the model was loading
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
    if (tag) {
      tag.visible = tagOn && pivot.visible;
      tag.position.set(pivot.position.x, pivot.position.y + TAG_HEIGHT, z);
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
    if (tag) tag.visible = tagOn && visible;
  }

  function setLane(next) {
    x = next;
    focus.x = next;
    if (blob) blob.position.x = next;
  }

  function setTint(next) {
    if (next === tint) return;
    tint = next;
    paint(pivot, tint);
  }

  function setTag(label, color) {
    tagOn = !!label;
    if (!label) {
      if (tag) tag.visible = false;
      return;
    }
    if (!tag) {
      tag = buildTag();
      scene.add(tag);
    }
    paintTag(tag, label, color);
    tag.visible = pivot.visible;
  }

  return { pivot, focus, update, setVisible, setLane, setTint, setTag };
}

const TINT_GLOW = 0.07; // how much of the tint colour a tinted soldier gives off on his own
const TAG_HEIGHT = 2.2; // m above his feet (the pivot): over his head, clear of the arms-out balance pose
const TAG_SIZE = 0.085; // of the screen's height, whatever his distance: it must read from the sofa for the far soldier too

// A "P1" disc over a soldier's head: a camera-facing sprite (one draw call, no lights, no fog). Its canvas texture is
// redrawn only when the label or colour changes.
function buildTag() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false, toneMapped: false, transparent: true, sizeAttenuation: false, depthTest: false }));
  sprite.scale.set(TAG_SIZE, TAG_SIZE, 1);
  sprite.renderOrder = 10;
  sprite.userData = { canvas, texture, label: null, color: null };
  return sprite;
}

function paintTag(sprite, label, color) {
  const u = sprite.userData;
  if (u.label === label && u.color === color) return;
  u.label = label;
  u.color = color;
  const ctx = u.canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 62px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.fillText(label, 64, 70);
  u.texture.needsUpdate = true;
}

// Simple figure with arms out for balance. The group's origin is at the feet so it pivots there.
function buildPlaceholder() {
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
  return g;
}

// Paints every mesh under `root` with its material multiplied by a colour, and back to the plain material with null.
// The Soldier's materials are shared with the cached model and with every other walker, so a tint goes on COPIES (one per
// original material, made on demand), and the original is kept on the mesh (userData.baseMaterial) to restore. Calling the
// painter again with another colour throws the old copies away.
function createPainter() {
  let copies = new Map(); // a material used by several meshes is copied once
  let current;
  return (root, tint) => {
    if (tint !== current) {
      for (const copy of copies.values()) copy.dispose();
      copies = new Map();
      current = tint;
    }
    const color = tint === null ? null : new THREE.Color(tint);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const base = (o.userData.baseMaterial ??= o.material);
      if (color === null) {
        o.material = base;
        return;
      }
      if (!copies.has(base)) {
        const copy = base.clone();
        copy.color.multiply(color);
        // The Soldier's camouflage is dark, and a multiply only makes it darker: a little light of the player's own colour
        // keeps teal and orange readable in the shade too.
        if (copy.emissive) copy.emissive.copy(color).multiplyScalar(TINT_GLOW);
        copies.set(base, copy);
      }
      o.material = copies.get(base);
    });
  };
}

// Swaps the Soldier into the pivot, replacing the placeholder figure.
function swapModel(pivot, model) {
  pivot.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
    o.userData.baseMaterial?.dispose();
  });
  pivot.clear();
  pivot.add(model);
}
