import { PHYSICS, WORLD } from '../config.js';
import { isSolid } from '../world/blocks.js';

/**
 * Pod physics: an axis-aligned box swept through the voxel grid, one axis at a time.
 *
 * A convenient consequence of the coordinate convention is that voxel layer vy spans
 * world Y from -(vy+1) to -vy — both integers — so in world space the mine is a plain
 * unit grid on all three axes and collision needs no scaling anywhere.
 */

const EPS = 1e-4;

/** Solid test in world-space integer cell coordinates. */
export function solidAtCell(world, ix, iy, iz) {
  return isSolid(world.get(ix, -iy - 1, iz));
}

/** Is any solid voxel overlapping this box? */
export function boxIntersectsSolid(world, cx, cy, cz, hx, hy, hz) {
  const x0 = Math.floor(cx - hx + EPS);
  const x1 = Math.floor(cx + hx - EPS);
  const y0 = Math.floor(cy - hy + EPS);
  const y1 = Math.floor(cy + hy - EPS);
  const z0 = Math.floor(cz - hz + EPS);
  const z1 = Math.floor(cz + hz - EPS);
  for (let iy = y0; iy <= y1; iy++) {
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        if (solidAtCell(world, ix, iy, iz)) return true;
      }
    }
  }
  return false;
}

/** True when the pod's footprint is outside the surveyed claim. */
function outsideClaim(x, z) {
  return x < 0 || x > WORLD.W || z < 0 || z > WORLD.D;
}

/**
 * Advance one body by dt.
 *
 * `body` is mutated in place: `{ position, velocity, onGround, impactSpeed }`.
 * `impactSpeed` is the largest speed any axis lost to a collision this step — floor,
 * wall, ceiling or building alike — and is read by the damage model. Everything
 * about what an impact *costs* lives on the caller's side.
 *
 * `solids` is a list of world-space boxes `{x, z, hx, hz, top}` standing on the
 * ground: the surface installations, which are meshes rather than voxels and would
 * otherwise be scenery you fly straight through.
 */
export function integrate(world, body, dt, {
  terrainHeightAt = null, gravityScale = 1, solids = null,
} = {}) {
  const pos = body.position;
  const vel = body.velocity;
  const hx = PHYSICS.POD_HALF_W;
  const hy = PHYSICS.POD_HALF_H;
  const hz = PHYSICS.POD_HALF_W;

  vel.y -= PHYSICS.GRAVITY * gravityScale * dt;
  if (vel.y < -PHYSICS.TERMINAL_VELOCITY) vel.y = -PHYSICS.TERMINAL_VELOCITY;

  // Damping. Horizontal is heavy so the pod settles instead of skating; vertical is
  // light so falls stay committal.
  const dampH = Math.exp(-PHYSICS.DRAG_H * dt);
  vel.x *= dampH;
  vel.z *= dampH;
  vel.y *= Math.exp(-PHYSICS.DRAG_V * dt);

  body.impactSpeed = 0;
  body.hitWall = false;

  // --- X ---
  if (vel.x !== 0) {
    pos.x += vel.x * dt;
    const y0 = Math.floor(pos.y - hy + EPS);
    const y1 = Math.floor(pos.y + hy - EPS);
    const z0 = Math.floor(pos.z - hz + EPS);
    const z1 = Math.floor(pos.z + hz - EPS);
    const forward = vel.x > 0;
    const ix = forward ? Math.floor(pos.x + hx - EPS) : Math.floor(pos.x - hx + EPS);
    let hit = false;
    for (let iy = y0; iy <= y1 && !hit; iy++) {
      for (let iz = z0; iz <= z1 && !hit; iz++) {
        if (solidAtCell(world, ix, iy, iz)) hit = true;
      }
    }
    if (hit) {
      pos.x = forward ? ix - hx - EPS : ix + 1 + hx + EPS;
      body.hitWall = Math.abs(vel.x) > 4;
      // Every axis reports its impact, not just the floor. Flying a loaded pod into
      // a wall at thirty metres a second and walking away from it because the rock
      // happened to be vertical is not a rule anyone would defend out loud.
      body.impactSpeed = Math.max(body.impactSpeed, Math.abs(vel.x));
      vel.x = 0;
    }
  }

  // --- Z ---
  if (vel.z !== 0) {
    pos.z += vel.z * dt;
    const y0 = Math.floor(pos.y - hy + EPS);
    const y1 = Math.floor(pos.y + hy - EPS);
    const x0 = Math.floor(pos.x - hx + EPS);
    const x1 = Math.floor(pos.x + hx - EPS);
    const forward = vel.z > 0;
    const iz = forward ? Math.floor(pos.z + hz - EPS) : Math.floor(pos.z - hz + EPS);
    let hit = false;
    for (let iy = y0; iy <= y1 && !hit; iy++) {
      for (let ix = x0; ix <= x1 && !hit; ix++) {
        if (solidAtCell(world, ix, iy, iz)) hit = true;
      }
    }
    if (hit) {
      pos.z = forward ? iz - hz - EPS : iz + 1 + hz + EPS;
      body.hitWall = body.hitWall || Math.abs(vel.z) > 4;
      body.impactSpeed = Math.max(body.impactSpeed, Math.abs(vel.z));
      vel.z = 0;
    }
  }

  // --- Y ---
  body.onGround = false;
  if (vel.y !== 0) {
    pos.y += vel.y * dt;
    const x0 = Math.floor(pos.x - hx + EPS);
    const x1 = Math.floor(pos.x + hx - EPS);
    const z0 = Math.floor(pos.z - hz + EPS);
    const z1 = Math.floor(pos.z + hz - EPS);
    const rising = vel.y > 0;
    const iy = rising ? Math.floor(pos.y + hy - EPS) : Math.floor(pos.y - hy + EPS);
    let hit = false;
    for (let ix = x0; ix <= x1 && !hit; ix++) {
      for (let iz = z0; iz <= z1 && !hit; iz++) {
        if (solidAtCell(world, ix, iy, iz)) hit = true;
      }
    }
    if (hit) {
      if (rising) {
        pos.y = iy - hy - EPS;
        // Hitting the roof of a chamber counts too — that is the same tonnage
        // arriving at the same speed, only upside down.
        body.impactSpeed = Math.max(body.impactSpeed, vel.y);
      } else {
        pos.y = iy + 1 + hy + EPS;
        body.impactSpeed = -vel.y;
        body.onGround = true;
      }
      vel.y = 0;
    }
  }

  // Outside the claim there is no voxel data, so fall back to the terrain surface.
  if (terrainHeightAt && outsideClaim(pos.x, pos.z)) {
    const floor = terrainHeightAt(pos.x, pos.z) + hy;
    if (pos.y < floor) {
      if (vel.y < 0) body.impactSpeed = Math.max(body.impactSpeed, -vel.y);
      pos.y = floor;
      vel.y = Math.max(0, vel.y);
      body.onGround = true;
    }
  }

  // Surface installations. Resolved after the voxel passes and along whichever axis
  // is least penetrated, which for a box you have just flown into is the face you
  // hit. Landing on a roof is a landing; clipping a tank at speed is a crash.
  if (solids) {
    for (const s of solids) {
      if (pos.y - hy >= s.top) continue;
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      const px = s.hx + hx - Math.abs(dx);
      const pz = s.hz + hz - Math.abs(dz);
      if (px <= 0 || pz <= 0) continue;
      const py = s.top + hy - (pos.y - hy) - hy;    // overlap up through the roof
      if (py <= 0) continue;

      if (py <= px && py <= pz) {
        pos.y = s.top + hy + EPS;
        if (vel.y < 0) {
          body.impactSpeed = Math.max(body.impactSpeed, -vel.y);
          vel.y = 0;
        }
        body.onGround = true;
      } else if (px <= pz) {
        pos.x += dx >= 0 ? px : -px;
        body.impactSpeed = Math.max(body.impactSpeed, Math.abs(vel.x));
        body.hitWall = body.hitWall || Math.abs(vel.x) > 4;
        vel.x = 0;
      } else {
        pos.z += dz >= 0 ? pz : -pz;
        body.impactSpeed = Math.max(body.impactSpeed, Math.abs(vel.z));
        body.hitWall = body.hitWall || Math.abs(vel.z) > 4;
        vel.z = 0;
      }
    }
  }

  // Standing check: a shallow probe under the box, so resting on a ledge counts even
  // on the frames where vertical velocity is exactly zero.
  if (!body.onGround && Math.abs(vel.y) < 0.6) {
    body.onGround = boxIntersectsSolid(world, pos.x, pos.y - 0.06, pos.z, hx, hy, hz);
  }

  return body;
}

/** Depth below the Martian surface, in metres. Negative above ground. */
export const depthOf = (position) => -position.y;

/**
 * Height of the ground directly under a point, or null if there is none within
 * `reach`.
 *
 * Depth and altitude are not the same instrument. Below ground the useful number is
 * how far down you have cut; above it, it is how far you would fall — and over a
 * mesa or the lip of your own shaft those differ by a lot. This walks down the
 * column looking for the first solid voxel, then falls back to the terrain surface
 * outside the claim where there is no voxel data at all.
 */
export function groundBelow(world, x, y, z, { terrainHeightAt = null, reach = 60 } = {}) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const start = Math.floor(y);
  for (let iy = start; iy > start - reach; iy--) {
    if (solidAtCell(world, ix, iy, iz)) return iy + 1;
  }
  if (terrainHeightAt && outsideClaim(x, z)) {
    const h = terrainHeightAt(x, z);
    return y - h < reach ? h : null;
  }
  return null;
}
