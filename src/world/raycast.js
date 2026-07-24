import { AIR } from './blocks.js';

/**
 * Voxel ray traversal (Amanatides & Woo).
 *
 * Steps cell by cell along the ray instead of sampling at intervals, so it can
 * never tunnel through a one-metre block no matter how oblique the angle. Used by
 * the drill for targeting and, later, by the sensor suite for line-of-sight work.
 *
 * Works in world-space integer cells, where cell (ix, iy, iz) holds voxel
 * (ix, -iy - 1, iz) — see player/physics.js for why the two grids line up.
 */
export function raycastVoxels(world, origin, direction, maxDistance = 4, predicate = null) {
  const dx = direction.x;
  const dy = direction.y;
  const dz = direction.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;

  let ix = Math.floor(origin.x);
  let iy = Math.floor(origin.y);
  let iz = Math.floor(origin.z);

  const stepX = nx > 0 ? 1 : -1;
  const stepY = ny > 0 ? 1 : -1;
  const stepZ = nz > 0 ? 1 : -1;

  const tDeltaX = nx !== 0 ? Math.abs(1 / nx) : Infinity;
  const tDeltaY = ny !== 0 ? Math.abs(1 / ny) : Infinity;
  const tDeltaZ = nz !== 0 ? Math.abs(1 / nz) : Infinity;

  const boundary = (o, i, step) => (step > 0 ? i + 1 - o : o - i);
  let tMaxX = nx !== 0 ? boundary(origin.x, ix, stepX) * tDeltaX : Infinity;
  let tMaxY = ny !== 0 ? boundary(origin.y, iy, stepY) * tDeltaY : Infinity;
  let tMaxZ = nz !== 0 ? boundary(origin.z, iz, stepZ) * tDeltaZ : Infinity;

  let t = 0;
  let normal = { x: 0, y: 0, z: 0 };

  // The origin cell itself counts: you can be standing inside the block you drill.
  for (let guard = 0; guard < 512; guard++) {
    const id = world.get(ix, -iy - 1, iz);
    if (id !== AIR && (!predicate || predicate(id))) {
      return { ix, iy, iz, vx: ix, vy: -iy - 1, vz: iz, id, distance: t, normal };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      if (t > maxDistance) break;
      ix += stepX;
      tMaxX += tDeltaX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      if (t > maxDistance) break;
      iy += stepY;
      tMaxY += tDeltaY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      t = tMaxZ;
      if (t > maxDistance) break;
      iz += stepZ;
      tMaxZ += tDeltaZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }
  }

  return null;
}
