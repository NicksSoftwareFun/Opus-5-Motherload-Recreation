import { noise2, noise3, hash3 } from '../core/rng.js';
import { WORLD } from '../config.js';
import {
  AIR, DIRT, ROCK, HARDROCK, BEDROCK, LAVA, GAS, ORE_TABLE,
} from './blocks.js';

/**
 * World generation.
 *
 * Speed matters here — this runs once at startup over ~1M voxels — so the noise
 * budget is spent carefully:
 *   - the dirt/rock/deep-rock boundaries vary per *column*, so they cost one 2D
 *     noise lookup per (x,z) rather than one per voxel;
 *   - ore *type* is chosen from a per-depth-layer cumulative distribution table
 *     computed up front, so adding ores does not add per-voxel noise calls;
 *   - a single 3D clump field gates all ore placement, which is why veins come out
 *     as mixed pockets of whatever is plausible at that depth rather than salt;
 *   - lava and gas are read from opposite tails of one shared hazard field, so they
 *     cost one lookup between them and can never occupy the same voxel.
 */

const CAVE_START = 30; // metres — no caves above this, the topsoil stays honest

/** Bell curve describing how likely an ore is at a given depth. */
function bandWeight(depth, peak, spread) {
  const t = (depth - peak) / spread;
  return Math.exp(-t * t);
}

/**
 * Precompute, for every depth layer, the total ore probability and the cumulative
 * distribution used to pick which ore lands in a given voxel.
 */
function buildOreTable(h) {
  const layers = new Array(h);
  for (let vy = 0; vy < h; vy++) {
    const depth = vy + 0.5;
    const weights = ORE_TABLE.map((o) => o.abundance * bandWeight(depth, o.peak, o.spread));
    const total = weights.reduce((a, b) => a + b, 0);
    const cumulative = [];
    let acc = 0;
    for (const w of weights) {
      acc += w;
      cumulative.push(total > 0 ? acc / total : 0);
    }
    layers[vy] = { total, cumulative };
  }
  return layers;
}

export function generateWorld(world, seed = 1337) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { w, h, d, data } = world;
  const oreLayers = buildOreTable(h);
  const oreIds = ORE_TABLE.map((o) => o.id);

  const sMat = seed ^ 0x1111;
  const sCave = seed ^ 0x2222;
  const sHaz = seed ^ 0x3333;
  const sOre = seed ^ 0x4444;
  const sClump = seed ^ 0x5555;

  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      // Per-column strata boundaries: undulating, so the transitions read as
      // geology rather than as three flat slabs stacked on each other.
      const dirtDepth = 16 + noise2(x * 0.06, z * 0.06, sMat) * 12;
      const rockDepth = 92 + noise2(x * 0.04 + 11, z * 0.04 + 7, sMat) * 30;
      const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;

      for (let vy = 0; vy < h; vy++) {
        const i = (vy * d + z) * w + x;

        // The claim is a sealed box: bedrock walls and floor. You are not leaving.
        if (edge || vy >= h - 3) {
          data[i] = BEDROCK;
          continue;
        }

        const depth = vy + 0.5;
        let id = depth < dirtDepth ? DIRT : depth < rockDepth ? ROCK : HARDROCK;

        // The first two metres are always plain regolith: the landing plaza should
        // read as clean ground, not as a scattering of exposed ore and gas.
        if (vy < 2) {
          data[i] = DIRT;
          continue;
        }

        if (depth > CAVE_START) {
          // Two octaves by hand — cheaper than a generic fbm call in this hot loop.
          const cave =
            noise3(x * 0.055, vy * 0.055, z * 0.055, sCave) * 0.65 +
            noise3(x * 0.13, vy * 0.13, z * 0.13, sCave + 1) * 0.35;
          // Caves ease in over the first 20 m below CAVE_START and grow with depth.
          // Thresholds are quantiles of the field, measured — ~2% of the deep rock.
          const ease = Math.min(1, (depth - CAVE_START) / 20);
          if (cave > 0.795 - 0.028 * ease - 0.022 * (depth / h)) {
            data[i] = AIR;
            continue;
          }
        }

        if (depth > 30) {
          const hazard = noise3(x * 0.09, vy * 0.09, z * 0.09, sHaz);
          // Opposite tails of one field: lava and gas can never share a voxel, and
          // together they occupy about 1% of the mine. Rare enough to be a shock.
          if (depth > 45 && hazard > 0.918) {
            data[i] = LAVA;
            continue;
          }
          if (hazard < 0.058) {
            data[i] = GAS;
            continue;
          }
        }

        const layer = oreLayers[vy];
        if (layer.total > 0) {
          // One clump field gates every ore, which is what turns scattered rolls
          // into veins worth tunnelling toward.
          const clump = noise3(x * 0.3, vy * 0.3, z * 0.3, sClump);
          if (clump > 0.55) {
            const gate = Math.min(1, (clump - 0.55) * 4.4);
            if (hash3(x, vy, z, sOre) < layer.total * gate * 1.6) {
              const pick = hash3(x, vy, z, sOre + 991);
              let k = 0;
              while (k < layer.cumulative.length - 1 && pick > layer.cumulative[k]) k++;
              id = oreIds[k];
            }
          }
        }

        data[i] = id;
      }
    }
  }

  world.recountChunks();
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { seed, ms };
}

/**
 * Carve the landing pad: a shallow flat bowl of open air over the plaza so the pod
 * has somewhere to sit, and the surface base has a floor to stand on.
 */
export function clearLandingPad(world, radius = 9) {
  const cx = Math.floor(WORLD.CENTER_X);
  const cz = Math.floor(WORLD.CENTER_Z);
  for (let z = cz - radius; z <= cz + radius; z++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dist = Math.hypot(x - cx, z - cz);
      if (dist > radius) continue;
      world.set(x, 0, z, DIRT);
    }
  }
}
