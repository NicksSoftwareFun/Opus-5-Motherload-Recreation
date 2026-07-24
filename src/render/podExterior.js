import * as THREE from 'three';
import { panelTexture, hazardTexture, toTexture } from './texlib.js';

/**
 * The pod as seen from outside.
 *
 * It exists only for the cockpit's camera feeds — the pilot never leaves the seat,
 * so this is the one and only way to find out what you are actually flying. It is
 * hidden during the main render pass and revealed only while a feed is being drawn
 * into its render target.
 *
 * Kept deliberately snug: the collision box is 0.68 m across and tunnels are one
 * metre, so an exterior any chunkier than this would be visibly buried in rock on
 * the chase feed.
 */
export function createPodExterior() {
  const group = new THREE.Group();
  group.name = 'podExterior';
  group.visible = false;

  const hullMat = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#6a6d63', seed: 71, bolts: 5, grime: 0.9 })),
    roughness: 0.8, metalness: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.9, metalness: 0.2 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa09a, roughness: 0.4, metalness: 0.9 });
  const hazardMat = new THREE.MeshStandardMaterial({
    map: toTexture(hazardTexture(), { repeat: [4, 1] }), color: 0x8a8a8a, roughness: 0.85,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x10201e, roughness: 0.15, metalness: 0.5, emissive: 0x0d2a24, emissiveIntensity: 0.8,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff0d0, emissive: 0xffe0a8, emissiveIntensity: 2.5, roughness: 0.3,
  });

  const add = (geo, mat, x, y, z, rot = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rot.rx ?? 0, rot.ry ?? 0, rot.rz ?? 0);
    group.add(m);
    return m;
  };

  // Main hull: a tapered body, wider at the back where the engines are.
  add(new THREE.BoxGeometry(0.84, 0.66, 1.05), hullMat, 0, 0.02, 0.05);
  add(new THREE.BoxGeometry(0.70, 0.52, 0.30), hullMat, 0, 0.03, -0.60);
  add(new THREE.BoxGeometry(0.90, 0.20, 0.34), darkMat, 0, -0.24, 0.42);

  // Canopy: the window the pilot is sitting behind.
  add(new THREE.BoxGeometry(0.62, 0.34, 0.08), glassMat, 0, 0.10, -0.74);
  add(new THREE.BoxGeometry(0.70, 0.06, 0.10), hazardMat, 0, -0.10, -0.75);

  // No drill here: the boom is its own world-space object that articulates with the
  // pilot's aim, so modelling a second one on the hull would show two drills on the
  // chase feed. Just the mount it swings from.
  add(new THREE.BoxGeometry(0.22, 0.16, 0.14), steelMat, 0, -0.14, -0.80);

  // Headlight housings.
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 10), darkMat, side * 0.30, 0.04, -0.78, { rx: Math.PI / 2 });
    add(new THREE.CircleGeometry(0.062, 10), lampMat, side * 0.30, 0.04, -0.825);
  }

  // Thruster nozzles: one down, two aft.
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.11, 0.15, 0.16, 8), steelMat, side * 0.24, -0.30, 0.20);
    add(new THREE.CylinderGeometry(0.09, 0.12, 0.14, 8), steelMat, side * 0.26, 0.06, 0.68, { rx: Math.PI / 2 });
  }

  // Skids, so it can sit on a landing pad without looking like it is hovering.
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.07, 0.07, 0.90), steelMat, side * 0.38, -0.40, 0.05);
    add(new THREE.BoxGeometry(0.06, 0.16, 0.06), steelMat, side * 0.38, -0.32, -0.32);
    add(new THREE.BoxGeometry(0.06, 0.16, 0.06), steelMat, side * 0.38, -0.32, 0.40);
  }

  // Roof beacon and a cargo pod on the spine.
  add(new THREE.BoxGeometry(0.44, 0.14, 0.52), darkMat, 0, 0.40, 0.18);
  const beacon = add(new THREE.SphereGeometry(0.055, 8, 6), lampMat, 0, 0.50, 0.18);

  // Fill light for the feeds. The headlights are mounted on this very pod and point
  // away from it, so on the chase feed the hull was a black silhouette against its
  // own light pool. Parenting the fill to the exterior means three.js skips it
  // whenever the group is hidden, so it costs nothing during the main pass and can
  // never brighten the mine for the pilot's own eyes.
  const fill = new THREE.PointLight(0xbfd4e0, 5.5, 7, 1.1);
  fill.position.set(0.4, 1.3, 0.5);
  group.add(fill);

  let t = 0;
  return {
    group,
    /** Track the pod's body and heading; called every frame. */
    sync(position, yaw, dt) {
      group.position.copy(position);
      group.rotation.set(0, yaw, 0);
      t += dt;
      beacon.scale.setScalar(0.9 + Math.sin(t * 5) * 0.25);
    },
  };
}
