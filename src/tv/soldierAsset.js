import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { buildRig } from './soldierRig.js';

const SOLDIER_URL = '/models/Soldier.glb';

let download = null; // the one download every walker shares: the file is fetched and parsed once

function fetchSoldier() {
  if (!download) download = new Promise((resolve, reject) => new GLTFLoader().load(SOLDIER_URL, resolve, undefined, reject));
  return download;
}

// A private copy of the Soldier (skinned, animated) with its own rig, ready to swap into a walker's pivot.
// Resolves { model, rig }; rejects if the file is missing or the rig cannot be built.
export function loadSoldier() {
  return fetchSoldier().then((gltf) => {
    const model = clone(gltf.scene); // SkeletonUtils: a plain clone would leave the copy skinned to the original's bones
    // The Mixamo Soldier already faces -z (away from our camera), so no turn is needed.
    model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    return { model, rig: buildRig(model, gltf.animations) };
  });
}
