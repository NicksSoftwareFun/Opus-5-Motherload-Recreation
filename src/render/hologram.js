import * as THREE from 'three';
import { WORLD } from '../config.js';
import { BLOCKS, LAVA } from '../world/blocks.js';
import { scanOre, scanHazards } from '../player/sensorData.js';

/**
 * The volumetric mine map.
 *
 * Carrier Command 2's holographic command table, shrunk to fit a one-seat pod: a
 * projector on the dash throws up a translucent column of the claim showing every
 * metre you have cut, with your own pod as a bright mote inside it. It is the
 * clearest possible answer to "where am I and how do I get out", and it is a
 * physical object in the cabin rather than a map screen.
 *
 * The tunnel data is free — ChunkManager already records every voxel the player has
 * changed for the save system, so the hologram is a view onto that same map.
 *
 * It stows by default and rises when the MAP switch is thrown, because a glowing
 * column in the middle of the dash is the last thing you want while threading a
 * shaft.
 */

const MAX_POINTS = 7000;
const SIZE_XZ = 0.19;
const SIZE_Y = 0.28;

export function createHologram(world) {
  const group = new THREE.Group();
  group.name = 'hologram';

  const sx = SIZE_XZ / WORLD.W;
  const sy = SIZE_Y / WORLD.H;
  const sz = SIZE_XZ / WORLD.D;

  /** World voxel coords -> local hologram coords, origin at the volume's base. */
  const mapPoint = (vx, vy, vz, out) => out.set(
    (vx - WORLD.W / 2) * sx,
    SIZE_Y - vy * sy,
    (vz - WORLD.D / 2) * sz,
  );

  // --- Projector head on the dash -----------------------------------------
  const emitter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.030, 0.045, 0.022, 12),
    new THREE.MeshStandardMaterial({ color: 0x2c2f28, roughness: 0.6, metalness: 0.7 }),
  );
  emitter.position.y = 0.011;
  group.add(emitter);

  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.026, 16),
    new THREE.MeshBasicMaterial({ color: 0x7ce8ff, toneMapped: false, transparent: true, opacity: 0.8 }),
  );
  lens.rotation.x = -Math.PI / 2;
  lens.position.y = 0.023;
  group.add(lens);

  // The projection cone. Additive, so it reads as light rather than plastic.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(SIZE_XZ * 0.8, SIZE_Y, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x2ea8c8, transparent: true, opacity: 0.055, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  beam.position.y = 0.023 + SIZE_Y / 2;
  beam.rotation.x = Math.PI;
  group.add(beam);

  // --- Rotating contents ---------------------------------------------------
  const spin = new THREE.Group();
  spin.position.y = 0.023;
  group.add(spin);

  // Claim boundary wireframe.
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(SIZE_XZ, SIZE_Y, SIZE_XZ)),
    new THREE.LineBasicMaterial({
      color: 0x3fd0e8, transparent: true, opacity: 0.35, toneMapped: false,
    }),
  );
  cage.position.y = SIZE_Y / 2;
  spin.add(cage);

  // Depth graticule every 50 m, so the column reads as a scale and not a blob.
  const ruleVerts = [];
  for (let d = 50; d < WORLD.H; d += 50) {
    const y = SIZE_Y - d * sy;
    const h = SIZE_XZ / 2;
    ruleVerts.push(-h, y, -h, h, y, -h, h, y, -h, h, y, h, h, y, h, -h, y, h, -h, y, h, -h, y, -h);
  }
  const rules = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      'position', new THREE.Float32BufferAttribute(ruleVerts, 3),
    ),
    new THREE.LineBasicMaterial({
      color: 0x2a8ea8, transparent: true, opacity: 0.22, toneMapped: false,
    }),
  );
  spin.add(rules);

  // Excavated voxels.
  const positions = new Float32Array(MAX_POINTS * 3);
  const voidGeo = new THREE.BufferGeometry();
  voidGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  voidGeo.setDrawRange(0, 0);
  const voids = new THREE.Points(
    voidGeo,
    new THREE.PointsMaterial({
      // Dim cyan and small: additive blending stacks, and at full brightness a
      // dense tunnel network turns into a solid white bar with no readable shape.
      color: 0x3fbcd8, size: 0.0022, sizeAttenuation: true, transparent: true,
      opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  voids.frustumCulled = false;
  spin.add(voids);

  // Tomographic lattice returns: ore and hazards fused into the projection. Empty
  // and hidden until that module is fitted.
  const LATTICE_MAX = 2200;
  const latticePos = new Float32Array(LATTICE_MAX * 3);
  const latticeCol = new Float32Array(LATTICE_MAX * 3);
  const latticeGeo = new THREE.BufferGeometry();
  latticeGeo.setAttribute('position', new THREE.BufferAttribute(latticePos, 3));
  latticeGeo.setAttribute('color', new THREE.BufferAttribute(latticeCol, 3));
  latticeGeo.setDrawRange(0, 0);
  const lattice = new THREE.Points(
    latticeGeo,
    new THREE.PointsMaterial({
      size: 0.0042, sizeAttenuation: true, vertexColors: true, transparent: true,
      opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  lattice.frustumCulled = false;
  lattice.visible = false;
  spin.add(lattice);

  // The pod itself.
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.008),
    new THREE.MeshBasicMaterial({ color: 0xffd76a, toneMapped: false }),
  );
  spin.add(marker);
  const markerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.016, 0.0016, 6, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffd76a, transparent: true, opacity: 0.7, toneMapped: false,
    }),
  );
  markerRing.rotation.x = Math.PI / 2;
  spin.add(markerRing);

  // A plumb line from the pod to the surface: your way home, at a glance.
  const tether = new THREE.Line(
    new THREE.BufferGeometry().setAttribute(
      'position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    ),
    new THREE.LineBasicMaterial({
      color: 0xffd76a, transparent: true, opacity: 0.35, toneMapped: false,
    }),
  );
  spin.add(tether);

  const tmp = new THREE.Vector3();
  const col = new THREE.Color();
  let latticeTimer = 0;
  let deployed = 0;
  let lastCount = -1;
  let rebuildTimer = 0;
  let t = 0;

  /** Sample the modification map into the point cloud. */
  function rebuild(modified) {
    const total = modified.size;
    const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
    let n = 0;
    let i = 0;
    for (const [index, id] of modified) {
      if (i++ % stride !== 0) continue;
      if (id !== 0) continue; // only the voids are tunnel
      if (n >= MAX_POINTS) break;
      const vy = Math.floor(index / (world.w * world.d));
      const rem = index - vy * world.w * world.d;
      const vz = Math.floor(rem / world.w);
      const vx = rem - vz * world.w;
      mapPoint(vx, vy, vz, tmp);
      positions[n * 3] = tmp.x;
      positions[n * 3 + 1] = tmp.y;
      positions[n * 3 + 2] = tmp.z;
      n++;
    }
    voidGeo.setDrawRange(0, n);
    voidGeo.attributes.position.needsUpdate = true;
    lastCount = total;
  }

  return {
    group,

    /**
     * @param {boolean} on   MAP switch state
     * @param {object} podPosition world-space pod position
     */
    update(dt, { on, podPosition, modified, lattice: latticeOn = false }) {
      t += dt;
      // Deploy/stow: the whole assembly sinks into the dash when switched off.
      deployed += ((on ? 1 : 0) - deployed) * Math.min(1, dt * 5);
      group.visible = deployed > 0.02;
      if (!group.visible) return;

      group.scale.set(1, deployed, 1);
      spin.rotation.y = t * 0.22;
      // Flicker: a real projector is never quite steady.
      const flicker = 0.86 + Math.sin(t * 37) * 0.05 + Math.sin(t * 13.3) * 0.09;
      voids.material.opacity = 0.7 * deployed * flicker;
      cage.material.opacity = 0.35 * deployed * flicker;
      beam.material.opacity = 0.055 * deployed * flicker;

      rebuildTimer += dt;
      if (modified.size !== lastCount && rebuildTimer > 0.4) {
        rebuildTimer = 0;
        rebuild(modified);
      }

      // Tomographic returns, refreshed on their own slow clock.
      lattice.visible = latticeOn;
      if (latticeOn) {
        latticeTimer += dt;
        if (latticeTimer > 1.2) {
          latticeTimer = 0;
          let n = 0;
          const write = (hx, hy, hz, hex) => {
            if (n >= LATTICE_MAX) return;
            mapPoint(
              Math.floor(podPosition.x) + hx,
              Math.floor(-podPosition.y) - hy,
              Math.floor(podPosition.z) + hz,
              tmp,
            );
            latticePos[n * 3] = tmp.x;
            latticePos[n * 3 + 1] = tmp.y;
            latticePos[n * 3 + 2] = tmp.z;
            col.setHex(hex);
            latticeCol[n * 3] = col.r;
            latticeCol[n * 3 + 1] = col.g;
            latticeCol[n * 3 + 2] = col.b;
            n++;
          };
          for (const h of scanOre(world, podPosition, 30, 2)) {
            write(h.dx, h.dy, h.dz, BLOCKS[h.id].glow || h.color);
          }
          for (const h of scanHazards(world, podPosition, 30, 3)) {
            write(h.dx, h.dy, h.dz, h.id === LAVA ? 0xff4a1e : 0x88ff4a);
          }
          latticeGeo.setDrawRange(0, n);
          latticeGeo.attributes.position.needsUpdate = true;
          latticeGeo.attributes.color.needsUpdate = true;
        }
        lattice.material.opacity = 0.95 * deployed * flicker;
      }

      // Pod marker, with a tether up to the surface.
      mapPoint(podPosition.x, -podPosition.y, podPosition.z, tmp);
      marker.position.copy(tmp);
      markerRing.position.copy(tmp);
      markerRing.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
      const tp = tether.geometry.attributes.position;
      tp.setXYZ(0, tmp.x, tmp.y, tmp.z);
      tp.setXYZ(1, tmp.x, SIZE_Y, tmp.z);
      tp.needsUpdate = true;
    },
  };
}
