import * as THREE from 'three';
import { buildChunkGeometryData } from './chunkMesher.js';
import { AIR } from './blocks.js';

/**
 * Owns the chunk meshes: what is built, when it is rebuilt, and what gets thrown
 * away.
 *
 * Two budgets keep this interactive. Chunks are only meshed within `viewRadius`
 * of the pod — fog means you cannot see further than that anyway, and the deep
 * world is riddled with natural voids that would otherwise cost geometry nobody
 * ever looks at. And only a couple of chunks are (re)built per frame, nearest
 * first, so drilling through a chunk boundary never drops a frame.
 */
export class ChunkManager {
  constructor(world, atlas, materials, { viewRadius = 56, budget = 2 } = {}) {
    this.world = world;
    this.atlas = atlas;
    this.materials = materials;
    this.viewRadius = viewRadius;
    this.budget = budget;

    this.group = new THREE.Group();
    this.group.name = 'chunks';

    /** key -> { cx, cy, cz, opaque, translucent, built } */
    this.chunks = new Map();
    this.dirty = new Set();
    this.stats = { built: 0, meshMs: 0, live: 0 };
  }

  key(cx, cy, cz) {
    return (cy * this.world.cd + cz) * this.world.cw + cx;
  }

  /** Flag the chunk containing this voxel — and its neighbours if we are on a seam. */
  markDirty(x, vy, z) {
    const s = this.world.chunkSize;
    const cx = (x / s) | 0;
    const cy = (vy / s) | 0;
    const cz = (z / s) | 0;
    this.dirty.add(this.key(cx, cy, cz));

    const lx = x % s;
    const ly = vy % s;
    const lz = z % s;
    if (lx === 0) this._markChunk(cx - 1, cy, cz);
    if (lx === s - 1) this._markChunk(cx + 1, cy, cz);
    if (ly === 0) this._markChunk(cx, cy - 1, cz);
    if (ly === s - 1) this._markChunk(cx, cy + 1, cz);
    if (lz === 0) this._markChunk(cx, cy, cz - 1);
    if (lz === s - 1) this._markChunk(cx, cy, cz + 1);
  }

  _markChunk(cx, cy, cz) {
    if (cx < 0 || cx >= this.world.cw || cy < 0 || cy >= this.world.ch || cz < 0 || cz >= this.world.cd) return;
    this.dirty.add(this.key(cx, cy, cz));
  }

  /** Write a voxel and schedule the affected chunks for a rebuild. */
  setBlock(x, vy, z, id) {
    const prev = this.world.set(x, vy, z, id);
    if (prev === -1 || prev === id) return prev;
    this.markDirty(x, vy, z);
    return prev;
  }

  removeBlock(x, vy, z) {
    return this.setBlock(x, vy, z, AIR);
  }

  _buildGeometry(data) {
    if (data.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    g.setIndex(data.indices);
    g.computeBoundingSphere();
    return g;
  }

  _mesh(cx, cy, cz) {
    const k = this.key(cx, cy, cz);
    const t0 = performance.now();
    const { opaque, translucent } = buildChunkGeometryData(this.world, cx, cy, cz, this.atlas.uvFor);
    this.stats.meshMs = performance.now() - t0;
    this.stats.built++;

    let record = this.chunks.get(k);
    if (!record) {
      record = { cx, cy, cz, opaque: null, translucent: null };
      this.chunks.set(k, record);
    }

    const swap = (slot, data, material) => {
      const geo = this._buildGeometry(data);
      if (record[slot]) {
        record[slot].geometry.dispose();
        this.group.remove(record[slot]);
        record[slot] = null;
      }
      if (geo) {
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = `chunk_${cx}_${cy}_${cz}_${slot}`;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        record[slot] = mesh;
      }
    };

    swap('opaque', opaque, this.materials.opaque);
    swap('translucent', translucent, this.materials.translucent);
    this.dirty.delete(k);
  }

  _unload(k) {
    const record = this.chunks.get(k);
    if (!record) return;
    for (const slot of ['opaque', 'translucent']) {
      if (record[slot]) {
        record[slot].geometry.dispose();
        this.group.remove(record[slot]);
      }
    }
    this.chunks.delete(k);
  }

  /** Rebuild what is near, dirty and visible; drop what has fallen out of range. */
  update(cameraPos, budgetOverride) {
    const s = this.world.chunkSize;
    const r = this.viewRadius;
    const pcx = (cameraPos.x / s) | 0;
    const pcy = (-cameraPos.y / s) | 0;
    const pcz = (cameraPos.z / s) | 0;
    const span = Math.ceil(r / s);

    // Anything already built but now out of range goes away, and is re-queued so
    // it comes back correctly if the pod turns around.
    for (const [k, rec] of this.chunks) {
      if (
        Math.abs(rec.cx - pcx) > span + 1 ||
        Math.abs(rec.cy - pcy) > span + 1 ||
        Math.abs(rec.cz - pcz) > span + 1
      ) {
        this._unload(k);
        this.dirty.add(k);
      }
    }

    // Collect candidates in range: never built, or built and since invalidated.
    const candidates = [];
    for (let cy = pcy - span; cy <= pcy + span; cy++) {
      if (cy < 0 || cy >= this.world.ch) continue;
      for (let cz = pcz - span; cz <= pcz + span; cz++) {
        if (cz < 0 || cz >= this.world.cd) continue;
        for (let cx = pcx - span; cx <= pcx + span; cx++) {
          if (cx < 0 || cx >= this.world.cw) continue;
          const k = this.key(cx, cy, cz);
          if (this.chunks.has(k) && !this.dirty.has(k)) continue;
          const dx = (cx + 0.5) * s - cameraPos.x;
          const dy = (cy + 0.5) * s + cameraPos.y;
          const dz = (cz + 0.5) * s - cameraPos.z;
          candidates.push({ cx, cy, cz, d: dx * dx + dy * dy + dz * dz });
        }
      }
    }

    if (candidates.length) {
      candidates.sort((a, b) => a.d - b.d);
      const budget = budgetOverride ?? this.budget;
      for (let i = 0; i < Math.min(budget, candidates.length); i++) {
        const c = candidates[i];
        this._mesh(c.cx, c.cy, c.cz);
      }
    }

    this.stats.live = this.chunks.size;
    return candidates.length;
  }

  /** Build everything currently in range in one go (used at spawn and after a load). */
  prime(cameraPos, maxPasses = 400) {
    for (let i = 0; i < maxPasses; i++) {
      if (this.update(cameraPos, 8) === 0) break;
    }
  }
}
