import { WORLD } from '../config.js';
import { AIR, BEDROCK, BLOCKS, isSolid } from './blocks.js';

/**
 * Flat Uint8Array voxel storage for the claim.
 *
 * Out-of-bounds reads are deliberately opinionated, because both the mesher and the
 * physics rely on them:
 *   - above the world  -> AIR   (open Martian sky)
 *   - below the world  -> BEDROCK
 *   - outside the claim -> BEDROCK
 * That last one is what stops the pod leaving the claim underground, and it means
 * no faces are generated on the outward-facing walls of the block, which would
 * never be visible anyway.
 */
export class VoxelWorld {
  constructor({ w = WORLD.W, h = WORLD.H, d = WORLD.D } = {}) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.data = new Uint8Array(w * h * d);
    /** Per-chunk count of non-air voxels, used to skip meshing solid interiors. */
    this.chunkSize = WORLD.CHUNK;
    this.cw = Math.ceil(w / this.chunkSize);
    this.ch = Math.ceil(h / this.chunkSize);
    this.cd = Math.ceil(d / this.chunkSize);
    this.chunkSolid = new Uint16Array(this.cw * this.ch * this.cd);
  }

  index(x, y, z) {
    return (y * this.d + z) * this.w + x;
  }

  chunkIndex(cx, cy, cz) {
    return (cy * this.cd + cz) * this.cw + cx;
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h && z >= 0 && z < this.d;
  }

  /** Read a voxel, with the out-of-bounds conventions described above. */
  get(x, y, z) {
    if (y < 0) return AIR;
    if (y >= this.h) return BEDROCK;
    if (x < 0 || x >= this.w || z < 0 || z >= this.d) return BEDROCK;
    return this.data[(y * this.d + z) * this.w + x];
  }

  /** Write a voxel. Returns the previous id, or -1 if out of bounds. */
  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return -1;
    const i = (y * this.d + z) * this.w + x;
    const prev = this.data[i];
    if (prev === id) return prev;
    this.data[i] = id;

    const ci = this.chunkIndex(
      (x / this.chunkSize) | 0,
      (y / this.chunkSize) | 0,
      (z / this.chunkSize) | 0,
    );
    if (prev === AIR && id !== AIR) this.chunkSolid[ci]++;
    else if (prev !== AIR && id === AIR) this.chunkSolid[ci]--;
    return prev;
  }

  /** True when every voxel in the chunk is non-air (so its interior can be skipped). */
  isChunkFull(cx, cy, cz) {
    if (cx < 0 || cx >= this.cw || cz < 0 || cz >= this.cd) return true; // bedrock walls
    if (cy >= this.ch) return true;
    if (cy < 0) return false; // open sky
    const n = this.chunkSize;
    return this.chunkSolid[this.chunkIndex(cx, cy, cz)] === n * n * n;
  }

  isChunkEmpty(cx, cy, cz) {
    if (cx < 0 || cx >= this.cw || cy < 0 || cy >= this.ch || cz < 0 || cz >= this.cd) return false;
    return this.chunkSolid[this.chunkIndex(cx, cy, cz)] === 0;
  }

  /** Recompute chunkSolid from scratch (after bulk generation or a save load). */
  recountChunks() {
    this.chunkSolid.fill(0);
    for (let y = 0; y < this.h; y++) {
      const cy = (y / this.chunkSize) | 0;
      for (let z = 0; z < this.d; z++) {
        const cz = (z / this.chunkSize) | 0;
        const row = (y * this.d + z) * this.w;
        for (let x = 0; x < this.w; x++) {
          if (this.data[row + x] !== AIR) {
            this.chunkSolid[this.chunkIndex((x / this.chunkSize) | 0, cy, cz)]++;
          }
        }
      }
    }
  }

  // --- World-space helpers -------------------------------------------------
  // World Y = 0 is the surface, and voxel layer vy fills y in [-(vy+1), -vy].

  static voxelYFromWorld(y) {
    return Math.floor(-y);
  }

  /** Top surface (in world Y) of voxel layer vy. */
  static worldYFromVoxel(vy) {
    return -vy;
  }

  getAtWorld(x, y, z) {
    return this.get(Math.floor(x), Math.floor(-y), Math.floor(z));
  }

  isSolidAtWorld(x, y, z) {
    return isSolid(this.getAtWorld(x, y, z));
  }

  blockAtWorld(x, y, z) {
    return BLOCKS[this.getAtWorld(x, y, z)];
  }
}
