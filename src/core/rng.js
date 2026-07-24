/**
 * Deterministic randomness. Every world in the game is reproducible from a single
 * integer seed, which keeps saves small (we store the seed plus the blocks you
 * actually removed) and makes the unit tests meaningful.
 */

/** Classic mulberry32 — small, fast, good enough for terrain and loot rolls. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless integer hash -> [0,1). Used by the noise functions below. */
export function hash2(x, y, seed = 0) {
  let h = (seed ^ Math.imul(x | 0, 0x1657f5) ^ Math.imul(y | 0, 0x2f5a7d)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x4bf2b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(x, y, z, seed = 0) {
  let h = (seed ^ Math.imul(x | 0, 0x1657f5) ^ Math.imul(y | 0, 0x2f5a7d) ^ Math.imul(z | 0, 0x6b4321)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x4bf2b1);
  h = Math.imul(h ^ (h >>> 9), 0x27d4eb);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** 2D value noise in [0,1). */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoother(x - xi);
  const yf = smoother(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

/** 3D value noise in [0,1). */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smoother(x - xi);
  const yf = smoother(y - yi);
  const zf = smoother(z - zi);
  const c000 = hash3(xi, yi, zi, seed);
  const c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed);
  const c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed);
  const c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = lerp(c000, c100, xf);
  const x10 = lerp(c010, c110, xf);
  const x01 = lerp(c001, c101, xf);
  const x11 = lerp(c011, c111, xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

/** Fractal Brownian motion over noise2, normalised to roughly [0,1). */
export function fbm2(x, y, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fractal Brownian motion over noise3, normalised to roughly [0,1). */
export function fbm3(x, y, z, { octaves = 4, lacunarity = 2, gain = 0.5, seed = 0 } = {}) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
export { lerp };
