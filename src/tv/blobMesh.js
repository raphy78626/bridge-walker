import * as THREE from 'three';

// A soft dark disc (a radial gradient on a canvas) lying just above the planks, the TV's stand-in for his shadow.
// Transparent and depthWrite off, so it blends over the planks; MeshBasic, so no lights are involved at all.
// How dark and how big it is each frame is blobShadow.js.
export function buildBlob() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g2 = canvas.getContext('2d');
  const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g2.fillStyle = grad;
  g2.fillRect(0, 0, size, size);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    polygonOffset: true, // the planks are slightly uneven; this keeps the disc from z-fighting them
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), material);
  mesh.rotation.x = -Math.PI / 2; // lies flat, facing up
  mesh.position.y = 0.035; // the plank tops are at y = 0 (a little uneven)
  mesh.renderOrder = 1; // after the opaque planks
  mesh.visible = false;
  mesh.name = 'blob-shadow';
  return mesh;
}
