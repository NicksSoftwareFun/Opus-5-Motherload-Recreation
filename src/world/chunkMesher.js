import { BLOCKS, AIR, RENDER_NONE, RENDER_OPAQUE, RENDER_TRANSLUCENT, isOpaque } from './blocks.js';
import { hash3 } from '../core/rng.js';

/**
 * Chunk meshing: emit only the faces that touch open space.
 *
 * The mine starts as solid rock, so at boot almost no geometry exists — faces come
 * into being as the player carves them out. That is what makes a 64x64x256 world
 * cheap enough to keep entirely in memory and remesh interactively.
 *
 * Each vertex carries a colour that bakes in face shading and ambient occlusion.
 * The AO is the standard four-corner-per-face scheme: with the pod's headlights as
 * the only light source underground, contact shadows in the corners of a tunnel do
 * most of the work of making it read as a space rather than a painted box.
 */

// Local-space face table in a conventional Y-up frame. Voxel layers run downward,
// so a face's neighbour voxel is (dir.x, -dir.y, dir.z) away — see NEIGHBOUR below.
const FACES = [
  {
    // -X
    dir: [-1, 0, 0], shade: 0.72,
    corners: [
      { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] },
    ],
  },
  {
    // +X
    dir: [1, 0, 0], shade: 0.78,
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  {
    // -Y (floor of the block, seen from below)
    dir: [0, -1, 0], shade: 0.46,
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  {
    // +Y (ceiling of the tunnel below it)
    dir: [0, 1, 0], shade: 1.0,
    corners: [
      { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] },
    ],
  },
  {
    // -Z
    dir: [0, 0, -1], shade: 0.84,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  {
    // +Z
    dir: [0, 0, 1], shade: 0.9,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

/** World-local offset -> voxel-space offset (voxel Y counts downward). */
const toVoxel = (o) => [o[0], -o[1], o[2]];

const AO_LEVELS = [0.40, 0.61, 0.80, 1.0];

/**
 * Per-face UV rotation. A tunnel wall is dozens of copies of one 128px tile; without
 * rotating them the repeat is glaring and the mine looks wallpapered. Four rotations
 * chosen by position hash cost nothing and break the pattern up completely.
 */
const UV_ROTATIONS = [
  (u, v) => [u, v],
  (u, v) => [v, 1 - u],
  (u, v) => [1 - u, 1 - v],
  (u, v) => [1 - v, u],
];

function aoLevel(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

/** Precompute, per face and per corner, the three voxel offsets AO samples. */
const AO_OFFSETS = FACES.map((face) => {
  const axis = face.dir.findIndex((v) => v !== 0);
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  return face.corners.map((corner) => {
    const su = corner.pos[u] * 2 - 1;
    const sv = corner.pos[v] * 2 - 1;
    const mk = (du, dv) => {
      const o = [face.dir[0], face.dir[1], face.dir[2]];
      if (du) o[u] += su;
      if (dv) o[v] += sv;
      return toVoxel(o);
    };
    return { side1: mk(true, false), side2: mk(false, true), corner: mk(true, true) };
  });
});

function emptyBuffers() {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

/**
 * Build raw vertex arrays for one chunk.
 * Returns `{ opaque, translucent }`, either of which may be empty.
 */
export function buildChunkGeometryData(world, cx, cy, cz, uvFor) {
  const size = world.chunkSize;
  const x0 = cx * size;
  const y0 = cy * size;
  const z0 = cz * size;

  const opaque = emptyBuffers();
  const translucent = emptyBuffers();

  // A chunk fully enclosed by solid chunks can never show a face. Skipping these
  // is what keeps startup cheap when the whole world is still untouched rock.
  if (
    world.isChunkFull(cx, cy, cz) &&
    world.isChunkFull(cx - 1, cy, cz) && world.isChunkFull(cx + 1, cy, cz) &&
    world.isChunkFull(cx, cy - 1, cz) && world.isChunkFull(cx, cy + 1, cz) &&
    world.isChunkFull(cx, cy, cz - 1) && world.isChunkFull(cx, cy, cz + 1)
  ) {
    return { opaque, translucent };
  }
  if (world.isChunkEmpty(cx, cy, cz)) return { opaque, translucent };

  for (let ly = 0; ly < size; ly++) {
    const vy = y0 + ly;
    if (vy >= world.h) break;
    for (let lz = 0; lz < size; lz++) {
      const z = z0 + lz;
      for (let lx = 0; lx < size; lx++) {
        const x = x0 + lx;
        const id = world.get(x, vy, z);
        if (id === AIR) continue;
        const def = BLOCKS[id];
        if (def.render === RENDER_NONE) continue;

        const target = def.render === RENDER_OPAQUE ? opaque : translucent;
        const uv = uvFor(def.tile);
        // A small per-block brightness jitter breaks up big flat walls of one tile.
        const jitter = 0.93 + hash3(x, vy, z, 7717) * 0.14;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nd = toVoxel(face.dir);
          const nx = x + nd[0];
          const nvy = vy + nd[1];
          const nz = z + nd[2];
          const nId = world.get(nx, nvy, nz);
          const nDef = BLOCKS[nId];
          if (nDef.render === RENDER_OPAQUE) continue;
          if (def.render === RENDER_TRANSLUCENT && nId === id) continue;

          const base = target.positions.length / 3;
          const ao = [0, 0, 0, 0];
          const rotate = UV_ROTATIONS[(hash3(x, vy, z, 313 + f) * 4) | 0];

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            const off = AO_OFFSETS[f][c];
            const s1 = isOpaque(world.get(x + off.side1[0], vy + off.side1[1], z + off.side1[2])) ? 1 : 0;
            const s2 = isOpaque(world.get(x + off.side2[0], vy + off.side2[1], z + off.side2[2])) ? 1 : 0;
            const cc = isOpaque(world.get(x + off.corner[0], vy + off.corner[1], z + off.corner[2])) ? 1 : 0;
            const level = AO_LEVELS[aoLevel(s1, s2, cc)];
            ao[c] = level;

            // Voxel layer vy occupies world Y in [-(vy+1), -vy].
            target.positions.push(
              x + corner.pos[0],
              -(vy + 1) + corner.pos[1],
              z + corner.pos[2],
            );
            target.normals.push(face.dir[0], face.dir[1], face.dir[2]);
            const [tu, tv] = rotate(corner.uv[0], corner.uv[1]);
            target.uvs.push(uv.u0 + (uv.u1 - uv.u0) * tu, uv.v0 + (uv.v1 - uv.v0) * tv);
            const b = face.shade * level * jitter;
            target.colors.push(b, b, b);
          }

          // Flip the quad's diagonal when AO is lopsided, otherwise the shading
          // develops a visible seam across corner blocks.
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            target.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
          } else {
            target.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }
  }

  return { opaque, translucent };
}
