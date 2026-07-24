import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, PALETTE } from '../config.js';
import { fbm2, mulberry32, clamp, smoothstep } from '../core/rng.js';

/**
 * The Martian surface surrounding the claim: faceted terrain, a ring of distant
 * mesas, and airborne dust.
 *
 * The mine's own top voxel layer sits flush at Y = 0, so this terrain is built with
 * a rectangular hole punched out for the claim footprint and its height driven to
 * zero as it approaches that edge. The result is a natural flat plaza around the
 * shaft mouth for the surface base to stand on.
 */

// CELL must divide both EXTENT and the claim width, so the terrain grid lines up
// exactly with the claim boundary. When it did not, cells straddling the edge were
// skipped and left a bright seam of open sky ringing the plaza.
const EXTENT = 336; // metres of terrain beyond the claim in every direction
const CELL = 8; // faceted cell size — big enough to read as low-poly
const BLEND = 26; // metres over which terrain height eases down to the claim plane

function terrainHeight(x, z, seed) {
  const broad = fbm2(x * 0.0042, z * 0.0042, { octaves: 4, seed });
  const detail = fbm2(x * 0.021, z * 0.021, { octaves: 3, seed: seed + 77 });
  // Ridged component gives the dunes a wind-carved crest rather than soft blobs.
  const ridge = 1 - Math.abs(fbm2(x * 0.009, z * 0.009, { octaves: 3, seed: seed + 913 }) * 2 - 1);
  return (broad - 0.5) * 46 + (detail - 0.5) * 3.4 + ridge * ridge * 9;
}

/** Distance from a point to the claim rectangle (0 when inside it). */
function distanceToClaim(x, z) {
  const dx = Math.max(0, Math.max(-x, x - WORLD.W));
  const dz = Math.max(0, Math.max(-z, z - WORLD.D));
  return Math.hypot(dx, dz);
}

function heightAt(x, z, seed) {
  const d = distanceToClaim(x, z);
  if (d <= 0) return 0;
  // Hold the first 16 m dead flat before the dunes start. Sloping terrain right at
  // the claim edge caught the low sun and drew a bright dashed line around the
  // plaza; a flat apron reads as graded ground and removes it.
  return terrainHeight(x, z, seed) * smoothstep(16, 16 + BLEND, d);
}

function buildTerrain(seed) {
  const x0 = -EXTENT;
  const x1 = WORLD.W + EXTENT;
  const z0 = -EXTENT;
  const z1 = WORLD.D + EXTENT;
  const nx = Math.ceil((x1 - x0) / CELL);
  const nz = Math.ceil((z1 - z0) / CELL);

  const positions = [];
  const colors = [];

  const cLow = new THREE.Color(PALETTE.groundDark);
  const cHigh = new THREE.Color(PALETTE.ground);
  const cRock = new THREE.Color(PALETTE.rock);
  const tmp = new THREE.Color();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();

  const pushTri = (p0, p1, p2) => {
    a.set(p0[0], p0[1], p0[2]);
    b.set(p1[0], p1[1], p1[2]);
    c.set(p2[0], p2[1], p2[2]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac).normalize();

    // Colour per facet: height picks the base tone, slope exposes bare rock, and a
    // little hashed jitter keeps large flats from banding.
    const my = (a.y + b.y + c.y) / 3;
    const slope = 1 - clamp(n.y, 0, 1);
    tmp.copy(cLow).lerp(cHigh, smoothstep(-14, 16, my));
    tmp.lerp(cRock, smoothstep(0.22, 0.62, slope));
    const jitter = 0.92 + 0.16 * fbm2(a.x * 0.5, a.z * 0.5, { octaves: 1, seed });
    tmp.multiplyScalar(jitter);

    positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    for (let i = 0; i < 3; i++) colors.push(tmp.r, tmp.g, tmp.b);
  };

  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const px = x0 + ix * CELL;
      const pz = z0 + iz * CELL;
      const qx = px + CELL;
      const qz = pz + CELL;

      // Skip cells that fall inside the claim — the voxel field renders that area.
      if (qx > 0 && px < WORLD.W && qz > 0 && pz < WORLD.D) continue;

      const p00 = [px, heightAt(px, pz, seed), pz];
      const p10 = [qx, heightAt(qx, pz, seed), pz];
      const p11 = [qx, heightAt(qx, qz, seed), qz];
      const p01 = [px, heightAt(px, qz, seed), qz];
      pushTri(p00, p01, p11);
      pushTri(p00, p11, p10);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function buildMesas(seed) {
  const rand = mulberry32(seed ^ 0x51a3);
  const parts = [];
  const count = 26;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rand() * 0.22;
    const dist = 165 + rand() * 190;
    const h = 22 + rand() * 74;
    const rTop = 12 + rand() * 30;
    const rBot = rTop * (1.25 + rand() * 0.7);
    const sides = 5 + Math.floor(rand() * 4);

    const g = new THREE.CylinderGeometry(rTop, rBot, h, sides, 1, false);
    g.translate(
      WORLD.CENTER_X + Math.cos(ang) * dist,
      h * 0.5 - 6 - rand() * 10,
      WORLD.CENTER_Z + Math.sin(ang) * dist,
    );
    g.rotateY(rand() * 0.6);

    // Bake a per-mesa tint straight into vertex colours; distance haze does the rest.
    const col = new THREE.Color(PALETTE.rock).lerp(new THREE.Color(PALETTE.ground), rand() * 0.7);
    col.multiplyScalar(0.75 + rand() * 0.4);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      arr[v * 3] = col.r;
      arr[v * 3 + 1] = col.g;
      arr[v * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts, false);
}

/** Soft round sprite — square points read as falling snow, which Mars does not have. */
function dustSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildDust() {
  const COUNT = 1100;
  const pos = new Float32Array(COUNT * 3);
  const rand = mulberry32(0x0dead);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (rand() - 0.5) * 190;
    // Keep the motes low: this is wind-lifted grit, not weather.
    pos[i * 3 + 1] = -5 + rand() * rand() * 22;
    pos[i * 3 + 2] = (rand() - 0.5) * 190;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: PALETTE.dust,
    map: dustSprite(),
    size: 0.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

export function createSurface(seed = 1337) {
  const group = new THREE.Group();
  group.name = 'surface';

  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const terrain = new THREE.Mesh(buildTerrain(seed), terrainMat);
  terrain.name = 'terrain';
  group.add(terrain);

  const mesas = new THREE.Mesh(buildMesas(seed), terrainMat);
  mesas.name = 'mesas';
  group.add(mesas);

  const dust = buildDust();
  group.add(dust);

  const dustOrigin = new THREE.Vector3();
  let t = 0;

  return {
    group,
    terrain,
    heightAt: (x, z) => heightAt(x, z, seed),

    /** Dust drifts on the wind and follows the camera so it never runs out. */
    update(dt, cameraPos) {
      t += dt;
      dustOrigin.set(
        Math.round(cameraPos.x / 40) * 40,
        Math.max(cameraPos.y, -4),
        Math.round(cameraPos.z / 40) * 40,
      );
      dust.position.set(dustOrigin.x + Math.sin(t * 0.07) * 12, dustOrigin.y, dustOrigin.z + ((t * 1.4) % 40));
      // Fade the dust out once we are underground — it belongs to the open air.
      dust.material.opacity = 0.22 * clamp(1 + cameraPos.y / 10, 0, 1);
      dust.visible = dust.material.opacity > 0.01;
    },
  };
}
