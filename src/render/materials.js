import * as THREE from 'three';
import { BLOCKS, ORE_TABLE, LAVA, GAS } from '../world/blocks.js';
import { fbm2, mulberry32 } from '../core/rng.js';

/**
 * The block texture atlas, generated at boot.
 *
 * One 4x4 atlas holds every block surface, and a matching emissive atlas holds the
 * glow. The emissive channel is what makes the mine worth exploring: ore crystals
 * are the only things down there that emit light, so a seam of goldium reads as a
 * warm smear at the edge of the headlights long before you can make out its shape.
 */

const TILE = 128;
const COLS = 4;
const ROWS = 4;
const ATLAS = TILE * COLS;

function tileOrigin(tile) {
  return { x: (tile % COLS) * TILE, y: Math.floor(tile / COLS) * TILE };
}

/** Rough stone base: fbm mottling plus a few darker fracture lines. */
function paintStone(ctx, tile, hex, { contrast = 0.55, freq = 0.055, seed = 1, cracks = 0.5 } = {}) {
  const { x: ox, y: oy } = tileOrigin(tile);
  const img = ctx.createImageData(TILE, TILE);
  const base = new THREE.Color(hex);
  const d = img.data;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = fbm2(x * freq, y * freq, { octaves: 4, seed });
      const grain = fbm2(x * 0.42, y * 0.42, { octaves: 1, seed: seed + 5 });
      let b = 1 + (n - 0.5) * contrast + (grain - 0.5) * 0.14;

      // Fracture lines: the ridge of a low-frequency field, thin and dark.
      const r = Math.abs(fbm2(x * 0.03, y * 0.03, { octaves: 2, seed: seed + 31 }) - 0.5);
      if (r < 0.006 * cracks) b *= 0.82;

      // Bevel the tile edge hard. Without this a tunnel wall is a single flat sheet
      // of colour; with it you can count the blocks, which is what makes drilling
      // feel like it is making measurable progress.
      const edge = Math.min(x, y, TILE - 1 - x, TILE - 1 - y);
      if (edge < 4) b *= 0.58 + edge * 0.105;

      const i = (y * TILE + x) * 4;
      d[i] = Math.min(255, base.r * 255 * b);
      d[i + 1] = Math.min(255, base.g * 255 * b);
      d[i + 2] = Math.min(255, base.b * 255 * b);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, ox, oy);
}

/** Draw an angular crystal cluster. Returns the paths so the emissive pass matches. */
function crystalPaths(seed, count) {
  const rand = mulberry32(seed);
  const shapes = [];
  for (let i = 0; i < count; i++) {
    const cx = 18 + rand() * (TILE - 36);
    const cy = 18 + rand() * (TILE - 36);
    const r = 8 + rand() * 15;
    const sides = 5 + Math.floor(rand() * 3);
    const rot = rand() * Math.PI;
    const pts = [];
    for (let s = 0; s < sides; s++) {
      const a = rot + (s / sides) * Math.PI * 2;
      const rr = r * (0.55 + rand() * 0.65);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    shapes.push({ pts, cx, cy, r });
  }
  return shapes;
}

function strokeCrystals(ctx, tile, shapes, fill, edge, glowPass) {
  const { x: ox, y: oy } = tileOrigin(tile);
  ctx.save();
  ctx.translate(ox, oy);
  for (const s of shapes) {
    ctx.beginPath();
    ctx.moveTo(s.pts[0][0], s.pts[0][1]);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
    ctx.closePath();

    const g = ctx.createLinearGradient(s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r);
    g.addColorStop(0, fill);
    g.addColorStop(1, glowPass ? fill : edge);
    ctx.fillStyle = g;
    ctx.fill();

    if (!glowPass) {
      // A faint facet edge sells the crystal as faceted. Any stronger and it reads
      // as a sticker pasted onto the rock rather than something grown inside it.
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintLava(ctx, emCtx, tile) {
  const { x: ox, y: oy } = tileOrigin(tile);
  const img = ctx.createImageData(TILE, TILE);
  const em = emCtx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = fbm2(x * 0.035, y * 0.035, { octaves: 4, seed: 700 });
      // Crust over melt: the hot channels are the low-lying parts of the field.
      const heat = Math.pow(1 - n, 2.2);
      const i = (y * TILE + x) * 4;
      const r = 40 + heat * 215;
      const g = 12 + heat * 150;
      const b = 8 + heat * 30;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      em.data[i] = r * heat; em.data[i + 1] = g * heat * 0.8; em.data[i + 2] = b * heat; em.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, ox, oy);
  emCtx.putImageData(em, ox, oy);
}

function paintGas(ctx, emCtx, tile) {
  const { x: ox, y: oy } = tileOrigin(tile);
  const img = ctx.createImageData(TILE, TILE);
  const em = emCtx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = fbm2(x * 0.05, y * 0.05, { octaves: 3, seed: 812 });
      const i = (y * TILE + x) * 4;
      img.data[i] = 90 + n * 70;
      img.data[i + 1] = 180 + n * 60;
      img.data[i + 2] = 60 + n * 50;
      img.data[i + 3] = 255;
      em.data[i] = 20 * n; em.data[i + 1] = 70 * n; em.data[i + 2] = 16 * n; em.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, ox, oy);
  emCtx.putImageData(em, ox, oy);
}

/**
 * Build the mip chain by hand, downsampling every tile from its own pixels only.
 *
 * A texture atlas cannot use automatic mipmaps: each level halves the image and
 * averages across the tile boundaries, so by level three a gas pocket is wearing
 * the ruby tile next door. Downsampling per tile keeps every level clean, which
 * means the mine can have proper minification and the plaza stops shimmering.
 */
function buildTileMipmaps(source) {
  const levels = [];
  const tiles = COLS; // square atlas, COLS === ROWS
  for (let level = 0; ; level++) {
    const size = source.width >> level;
    const tileSize = size / tiles;
    if (tileSize < 1) break;

    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    const srcTile = source.width / tiles;
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        g.drawImage(
          source,
          tx * srcTile, ty * srcTile, srcTile, srcTile,
          tx * tileSize, ty * tileSize, tileSize, tileSize,
        );
      }
    }
    levels.push(c);
    if (size === 1) break;
  }
  return levels;
}

export function createBlockAtlas() {
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = ATLAS;
  const ctx = albedo.getContext('2d');

  const emissive = document.createElement('canvas');
  emissive.width = emissive.height = ATLAS;
  const emCtx = emissive.getContext('2d');
  emCtx.fillStyle = '#000';
  emCtx.fillRect(0, 0, ATLAS, ATLAS);

  // Plain strata.
  paintStone(ctx, 0, 0x9c5230, { contrast: 0.62, freq: 0.07, seed: 11, cracks: 0.25 });
  paintStone(ctx, 1, 0x6a5a52, { contrast: 0.5, freq: 0.05, seed: 23, cracks: 1.0 });
  paintStone(ctx, 2, 0x45403f, { contrast: 0.42, freq: 0.04, seed: 37, cracks: 1.4 });
  paintStone(ctx, 3, 0x24211f, { contrast: 0.3, freq: 0.09, seed: 53, cracks: 0.2 });

  // Ores: the host rock for the band they appear in, with crystals grown into it.
  for (const ore of ORE_TABLE) {
    const host = ore.peak < 24 ? 0x8a5233 : ore.peak < 100 ? 0x6a5a52 : 0x45403f;
    paintStone(ctx, ore.tile, host, { contrast: 0.45, freq: 0.05, seed: 100 + ore.tile, cracks: 0.8 });

    const c = new THREE.Color(ore.color);
    const glow = new THREE.Color(ore.glow);
    const shapes = crystalPaths(900 + ore.tile * 17, 5 + Math.round(4 * (1 - ore.tile / 14)));
    strokeCrystals(
      ctx, ore.tile, shapes,
      `#${c.getHexString()}`,
      `#${c.clone().multiplyScalar(0.45).getHexString()}`,
      false,
    );
    // Rarer ore burns brighter — a diamond seam should be visible across a cavern.
    const strength = 0.35 + 0.65 * (ore.tile - 4) / 9;
    strokeCrystals(
      emCtx, ore.tile, shapes,
      `#${glow.clone().multiplyScalar(strength).getHexString()}`,
      '#000000',
      true,
    );
  }

  paintLava(ctx, emCtx, BLOCKS[LAVA].tile);
  paintGas(ctx, emCtx, BLOCKS[GAS].tile);

  const map = new THREE.CanvasTexture(albedo);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(emissive);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  for (const t of [map, emissiveMap]) {
    // Nearest magnification keeps the chunky, readable look up close.
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    // Hand-built mip chain, see buildTileMipmaps: automatic mipmapping averages
    // across tile borders and smears ruby into the gas pockets at distance, while
    // turning it off entirely makes the plaza shimmer at grazing angles.
    t.generateMipmaps = false;
    t.mipmaps = buildTileMipmaps(t.image);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }

  /** UV rect for a tile, inset slightly so mip levels cannot sample a neighbour. */
  const INSET = 1.5 / ATLAS;
  function uvFor(tile) {
    const cx = tile % COLS;
    const cy = Math.floor(tile / COLS);
    const u0 = cx / COLS + INSET;
    const u1 = (cx + 1) / COLS - INSET;
    // Canvas Y grows downward, texture V grows upward.
    const v1 = 1 - cy / ROWS - INSET;
    const v0 = 1 - (cy + 1) / ROWS + INSET;
    return { u0, v0, u1, v1 };
  }

  return { map, emissiveMap, uvFor, canvas: albedo, emissiveCanvas: emissive };
}

/** Materials shared by every chunk mesh. */
export function createBlockMaterials(atlas) {
  const opaque = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 1.0,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02,
  });

  const translucent = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0.8,
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  return { opaque, translucent };
}
