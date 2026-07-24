import { describe, it, expect } from 'vitest';
import { VoxelWorld } from '../src/world/voxelWorld.js';
import { generateWorld } from '../src/world/generator.js';
import { buildChunkGeometryData } from '../src/world/chunkMesher.js';
import { raycastVoxels } from '../src/world/raycast.js';
import { AIR, DIRT, ROCK, BEDROCK, LAVA, GAS, ORE_TABLE, isSolid } from '../src/world/blocks.js';

/** Trivial atlas stub: the mesher only needs UV rects, not a real texture. */
const uvFor = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

describe('VoxelWorld', () => {
  it('round-trips a voxel through index arithmetic', () => {
    const w = new VoxelWorld();
    w.set(5, 17, 23, ROCK);
    expect(w.get(5, 17, 23)).toBe(ROCK);
    expect(w.data[w.index(5, 17, 23)]).toBe(ROCK);
  });

  it('treats above-world as open sky and beyond-world as bedrock', () => {
    const w = new VoxelWorld();
    // These conventions are what seal the claim and what stop the mesher
    // generating faces on walls nobody can ever see.
    expect(w.get(10, -1, 10)).toBe(AIR);
    expect(w.get(10, w.h + 5, 10)).toBe(BEDROCK);
    expect(w.get(-1, 10, 10)).toBe(BEDROCK);
    expect(w.get(10, 10, w.d)).toBe(BEDROCK);
  });

  it('keeps the per-chunk solid count in step with writes', () => {
    const w = new VoxelWorld();
    w.data.fill(ROCK);
    w.recountChunks();
    expect(w.isChunkFull(0, 0, 0)).toBe(true);

    w.set(3, 3, 3, AIR);
    expect(w.isChunkFull(0, 0, 0)).toBe(false);

    w.set(3, 3, 3, ROCK);
    expect(w.isChunkFull(0, 0, 0)).toBe(true);
  });

  it('maps world Y onto voxel layers so the surface sits at zero', () => {
    // Layer vy spans world Y [-(vy+1), -vy]; a point just below the surface is
    // in layer 0. Physics and meshing both depend on this alignment.
    expect(VoxelWorld.voxelYFromWorld(-0.5)).toBe(0);
    expect(VoxelWorld.voxelYFromWorld(-1.5)).toBe(1);
    expect(VoxelWorld.worldYFromVoxel(0)).toBeCloseTo(0, 10);
    expect(VoxelWorld.worldYFromVoxel(7)).toBe(-7);
  });
});

describe('chunk mesher', () => {
  it('emits nothing for a chunk buried in solid rock', () => {
    const w = new VoxelWorld();
    w.data.fill(ROCK);
    w.recountChunks();
    const { opaque, translucent } = buildChunkGeometryData(w, 1, 1, 1, uvFor);
    expect(opaque.indices.length).toBe(0);
    expect(translucent.indices.length).toBe(0);
  });

  it('emits exactly six faces for one block alone in a chunk', () => {
    const w = new VoxelWorld();
    w.set(20, 20, 20, ROCK);
    const { opaque } = buildChunkGeometryData(w, 1, 1, 1, uvFor);
    // Six quads, two triangles each, three indices per triangle.
    expect(opaque.indices.length).toBe(6 * 6);
    expect(opaque.positions.length / 3).toBe(6 * 4);
  });

  it('culls the shared face between two adjacent blocks', () => {
    const w = new VoxelWorld();
    w.set(20, 20, 20, ROCK);
    w.set(21, 20, 20, ROCK);
    const { opaque } = buildChunkGeometryData(w, 1, 1, 1, uvFor);
    // Twelve faces minus the two that touch each other.
    expect(opaque.indices.length).toBe(10 * 6);
  });

  it('puts translucent blocks in their own buffer', () => {
    const w = new VoxelWorld();
    w.set(20, 20, 20, GAS);
    const { opaque, translucent } = buildChunkGeometryData(w, 1, 1, 1, uvFor);
    expect(opaque.indices.length).toBe(0);
    expect(translucent.indices.length).toBe(6 * 6);
  });

  it('hides an opaque face behind another opaque block but not behind gas', () => {
    const w = new VoxelWorld();
    w.set(20, 20, 20, ROCK);
    w.set(21, 20, 20, GAS);
    const { opaque } = buildChunkGeometryData(w, 1, 1, 1, uvFor);
    // Gas is not opaque, so the rock still shows all six of its faces.
    expect(opaque.indices.length).toBe(6 * 6);
  });
});

describe('voxel raycast', () => {
  it('finds the first solid cell along the ray', () => {
    const w = new VoxelWorld();
    w.set(32, 10, 32, ROCK);
    // Cell (32, 10, 32) occupies world Y [-11, -10]; start above it, look down.
    const hit = raycastVoxels(
      w,
      { x: 32.5, y: -5, z: 32.5 },
      { x: 0, y: -1, z: 0 },
      12,
    );
    expect(hit).not.toBeNull();
    expect(hit.vy).toBe(10);
    expect(hit.id).toBe(ROCK);
    expect(hit.normal.y).toBe(1);
  });

  it('cannot tunnel through a block on an oblique ray', () => {
    const w = new VoxelWorld();
    // A solid wall one block thick; a shallow diagonal must still stop at it.
    for (let vy = 0; vy < 40; vy++) {
      for (let vz = 0; vz < 40; vz++) w.set(20, vy, vz, ROCK);
    }
    const hit = raycastVoxels(
      w,
      { x: 10.5, y: -10.5, z: 10.5 },
      { x: 1, y: 0.04, z: 0.03 },
      30,
    );
    expect(hit).not.toBeNull();
    expect(hit.vx).toBe(20);
  });

  it('returns null when nothing is within range', () => {
    const w = new VoxelWorld();
    const hit = raycastVoxels(w, { x: 32.5, y: -5, z: 32.5 }, { x: 0, y: 1, z: 0 }, 3);
    expect(hit).toBeNull();
  });
});

describe('world generation', () => {
  const world = new VoxelWorld();
  generateWorld(world, 1337);

  const counts = new Map();
  for (const id of world.data) counts.set(id, (counts.get(id) ?? 0) + 1);
  const total = world.data.length;
  const share = (id) => (counts.get(id) ?? 0) / total;

  it('is deterministic for a given seed', () => {
    const again = new VoxelWorld();
    generateWorld(again, 1337);
    expect(again.data).toEqual(world.data);
  });

  it('produces a different world for a different seed', () => {
    const other = new VoxelWorld();
    generateWorld(other, 20260724);
    expect(other.data).not.toEqual(world.data);
  });

  it('seals the claim in bedrock on every wall and the floor', () => {
    for (const vy of [0, 100, 200]) {
      expect(world.get(0, vy, 30)).toBe(BEDROCK);
      expect(world.get(world.w - 1, vy, 30)).toBe(BEDROCK);
      expect(world.get(30, vy, 0)).toBe(BEDROCK);
      expect(world.get(30, vy, world.d - 1)).toBe(BEDROCK);
    }
    expect(world.get(30, world.h - 1, 30)).toBe(BEDROCK);
  });

  it('keeps the landing plaza as plain regolith', () => {
    for (let vy = 0; vy < 2; vy++) {
      for (const [x, z] of [[20, 20], [32, 32], [45, 12]]) {
        expect(world.get(x, vy, z)).toBe(DIRT);
      }
    }
  });

  it('keeps hazards rare enough to be a shock rather than a texture', () => {
    // Tuned against measured quantiles of the noise fields; these bounds are the
    // guard against a threshold change quietly filling the mine with magma.
    expect(share(LAVA)).toBeGreaterThan(0.002);
    expect(share(LAVA)).toBeLessThan(0.02);
    expect(share(GAS)).toBeGreaterThan(0.001);
    expect(share(GAS)).toBeLessThan(0.015);
    expect(share(AIR)).toBeLessThan(0.05);
  });

  it('orders ore rarity to match the price ladder', () => {
    // Every ore must be strictly rarer than the cheaper one below it, or the
    // economy inverts and the deep game pays worse than the shallow one.
    for (let i = 1; i < ORE_TABLE.length; i++) {
      const richer = counts.get(ORE_TABLE[i].id) ?? 0;
      const commoner = counts.get(ORE_TABLE[i - 1].id) ?? 0;
      expect(richer).toBeGreaterThan(0);
      expect(richer).toBeLessThan(commoner);
    }
  });

  it('places each ore inside its advertised depth band', () => {
    // One pass over the grid accumulating every ore at once. Scanning the world
    // separately per ore was ten million lookups and pushed the suite over its
    // time budget for no extra confidence.
    const sums = new Map(ORE_TABLE.map((o) => [o.id, { sum: 0, n: 0 }]));
    for (let vy = 0; vy < world.h; vy++) {
      for (let vz = 0; vz < world.d; vz++) {
        for (let vx = 0; vx < world.w; vx++) {
          const acc = sums.get(world.get(vx, vy, vz));
          if (acc) {
            acc.sum += vy;
            acc.n++;
          }
        }
      }
    }

    for (const ore of ORE_TABLE) {
      const { sum, n } = sums.get(ore.id);
      expect(n).toBeGreaterThan(0);
      // Mean depth should land near the band's stated peak.
      expect(Math.abs(sum / n - ore.peak)).toBeLessThan(ore.spread);
    }
  });

  it('agrees with isSolid about what you can stand on', () => {
    expect(isSolid(AIR)).toBe(false);
    expect(isSolid(LAVA)).toBe(false);
    expect(isSolid(GAS)).toBe(false);
    expect(isSolid(ROCK)).toBe(true);
    expect(isSolid(BEDROCK)).toBe(true);
  });
});
