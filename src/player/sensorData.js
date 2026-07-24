import { BLOCKS, AIR, LAVA, GAS, isOre } from '../world/blocks.js';

/**
 * The sampling layer behind the sensor suite.
 *
 * Every module here is doing the same thing — reading the voxel grid the player
 * cannot see — so the scans live together and share one budget. Nothing samples on
 * every frame: each scan carries its own interval, because a 37-metre cube is
 * 50,000 lookups and no instrument on a 1990s mining pod updates at 120 Hz anyway.
 * The staleness is free character.
 */

/**
 * Ore returns within `radius` metres, in pod-relative coordinates.
 * Stride 2 on purpose: an ore vein is several voxels across, so sampling every
 * other cell finds every seam that matters for an eighth of the work.
 */
export function scanOre(world, position, radius = 18, stride = 2) {
  const cx = Math.floor(position.x);
  const cy = Math.floor(-position.y);
  const cz = Math.floor(position.z);
  const hits = [];
  const r = Math.ceil(radius);

  for (let dy = -r; dy <= r; dy += stride) {
    for (let dz = -r; dz <= r; dz += stride) {
      for (let dx = -r; dx <= r; dx += stride) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > radius * radius) continue;
        const id = world.get(cx + dx, cy + dy, cz + dz);
        if (!isOre(id)) continue;
        hits.push({
          dx, dy: -dy, dz, id,
          distance: Math.sqrt(d2),
          value: BLOCKS[id].value,
          color: BLOCKS[id].color,
        });
      }
    }
  }
  return hits;
}

/** Lava and gas within range, same conventions as scanOre. */
export function scanHazards(world, position, radius = 18, stride = 2) {
  const cx = Math.floor(position.x);
  const cy = Math.floor(-position.y);
  const cz = Math.floor(position.z);
  const hits = [];
  const r = Math.ceil(radius);

  for (let dy = -r; dy <= r; dy += stride) {
    for (let dz = -r; dz <= r; dz += stride) {
      for (let dx = -r; dx <= r; dx += stride) {
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > radius * radius) continue;
        const id = world.get(cx + dx, cy + dy, cz + dz);
        if (id !== LAVA && id !== GAS) continue;
        hits.push({ dx, dy: -dy, dz, id, distance: Math.sqrt(d2) });
      }
    }
  }
  return hits;
}

/** The single most valuable ore voxel within range, for the Providence Engine. */
export function richestWithin(world, position, radius = 40) {
  const hits = scanOre(world, position, radius, 2);
  let best = null;
  for (const h of hits) {
    // Value first, then proximity, so it never sends you past a diamond to a ruby.
    if (!best || h.value > best.value || (h.value === best.value && h.distance < best.distance)) {
      best = h;
    }
  }
  return best;
}

/** A vertical core sample straight down from the pod. */
export function columnBelow(world, position, depth = 26) {
  const cx = Math.floor(position.x);
  const cz = Math.floor(position.z);
  const top = Math.floor(-position.y);
  const out = new Array(depth);
  for (let i = 0; i < depth; i++) {
    const id = world.get(cx, top + i + 1, cz);
    out[i] = { id, def: BLOCKS[id], depth: top + i + 1 };
  }
  return out;
}

/**
 * A vertical cross-section along the direction of travel, sampled into a grid.
 * Returns `{ w, h, cells }` where each cell is a block id — the thermal aperture
 * turns those into false colour.
 */
export function slice(world, position, yaw, { w = 56, h = 40, range = 22, height = 16 } = {}) {
  const cells = new Uint8Array(w * h);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);

  for (let j = 0; j < h; j++) {
    // Top row is above the pod, bottom row below.
    const oy = position.y + height / 2 - (j / (h - 1)) * height;
    for (let i = 0; i < w; i++) {
      // Left edge is behind the pod so you can see what you just came through.
      const t = (i / (w - 1)) * range - range * 0.28;
      const x = position.x + fx * t;
      const z = position.z + fz * t;
      cells[j * w + i] = world.get(Math.floor(x), Math.floor(-oy), Math.floor(z));
    }
  }
  return { w, h, cells, range, height };
}

/** Composition and predicted cut time for whatever is under the bit. */
export function bitReading(target, drillPower) {
  if (!target) return null;
  const def = BLOCKS[target.id];
  const cuttable = def.mineable && Number.isFinite(def.hardness);
  return {
    id: target.id,
    name: def.name,
    hardness: cuttable ? def.hardness : Infinity,
    eta: cuttable ? def.hardness / Math.max(0.001, drillPower) : Infinity,
    value: def.value,
    ore: def.value > 0,
    color: def.color,
    distance: target.distance,
    cuttable,
  };
}

export { AIR, LAVA, GAS };
