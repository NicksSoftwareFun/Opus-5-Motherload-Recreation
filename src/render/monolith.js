import * as THREE from 'three';
import { canvas2d, toTexture } from './texlib.js';
import { WORLD } from '../config.js';

/**
 * The Seal.
 *
 * At the bottom of the claim, behind two hundred and fifty metres of rock, there is
 * a chamber that nobody excavated and a door that nobody built. It is the only
 * object in the game that is not machinery, not geology, and not for sale.
 *
 * It is rendered rather than voxelised on purpose: everything else down here is
 * made of one-metre cubes, so the one thing that is not reads immediately as
 * something that does not belong to the mine.
 */

export const VAULT = {
  /** Chamber interior, in voxel coordinates. */
  x0: 25, x1: 39,
  z0: 25, z1: 39,
  y0: 238, y1: 252,
  get centre() {
    return {
      x: (this.x0 + this.x1 + 1) / 2,
      y: -(this.y1 + 1) + 0.02,
      z: (this.z0 + this.z1 + 1) / 2,
    };
  },
};

/** Concentric bands of invented glyphs, for the rings around the door. */
function glyphBand(size = 1024) {
  const { canvas, ctx } = canvas2d(size, size);
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ff4a1e';
  ctx.lineWidth = 4;

  for (const r of [size * 0.46, size * 0.34]) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const N = 32;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * size * 0.40, c + Math.sin(a) * size * 0.40);
    ctx.rotate(a + Math.PI / 2);
    const k = (i * 2246822519) >>> 0;
    ctx.beginPath();
    const arms = 3 + (k % 4);
    for (let j = 0; j < arms; j++) {
      const b = (j / arms) * Math.PI * 2 + ((k >> 5) % 9) * 0.22;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(b) * 22, Math.sin(b) * 22);
    }
    if (k % 4 === 0) ctx.rect(-9, -9, 18, 18);
    if (k % 5 === 0) ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  return canvas;
}

export function createMonolith() {
  const group = new THREE.Group();
  const centre = VAULT.centre;
  group.position.set(centre.x, centre.y, centre.z);
  group.name = 'seal';

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x08070a, roughness: 0.25, metalness: 0.35,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0x6e5423, roughness: 0.4, metalness: 0.9,
  });
  const seamMat = new THREE.MeshBasicMaterial({
    color: 0xff3a10, toneMapped: false, transparent: true, opacity: 0.85,
  });

  // Plinth and the slab itself, split down the middle so it can open.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.4, 0.7, 12), brassMat);
  plinth.position.y = 0.35;
  group.add(plinth);

  const halves = [];
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    half.position.set(0, 0.7, 0);
    group.add(half);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 6.4, 0.9), stoneMat);
    slab.position.set(side * 0.79, 3.2, 0);
    half.add(slab);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 6.5, 1.0), brassMat);
    trim.position.set(side * 1.55, 3.2, 0);
    half.add(trim);
    halves.push({ half, side });
  }

  // The seam between the halves, which is the only light in the chamber until the
  // moment it stops being a seam.
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 6.3), seamMat);
  seam.position.set(0, 3.9, 0.46);
  group.add(seam);
  const seamBack = seam.clone();
  seamBack.position.z = -0.46;
  seamBack.rotation.y = Math.PI;
  group.add(seamBack);

  // Rings of glyphs turning slowly in the air in front of the door.
  const bandTex = toTexture(glyphBand());
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: bandTex, transparent: true, opacity: 0.30 - i * 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(6.4 - i * 1.5, 6.4 - i * 1.5), mat);
    ring.position.set(0, 3.7, 1.3 + i * 0.8);
    rings.push({ ring, mat, dir: i % 2 ? 1 : -1, speed: 0.06 + i * 0.05 });
    group.add(ring);
  }

  // What is behind the door, revealed when it opens.
  const interior = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 6.3),
    new THREE.MeshBasicMaterial({ color: 0xffdcb0, toneMapped: false, transparent: true, opacity: 0 }),
  );
  interior.position.set(0, 3.9, -0.1);
  group.add(interior);

  const glow = new THREE.PointLight(0xff4a18, 3.0, 26, 1.4);
  glow.position.set(0, 3.6, 1.2);
  group.add(glow);

  let t = 0;
  let opened = 0;

  return {
    group,
    centre,

    /** Distance from a world position to the face of the door. */
    distanceTo(position) {
      return Math.hypot(
        position.x - centre.x,
        position.y - (centre.y + 3.6),
        position.z - centre.z,
      );
    },

    update(dt, { opening = false } = {}) {
      t += dt;
      opened += ((opening ? 1 : 0) - opened) * Math.min(1, dt * 0.45);

      for (const r of rings) {
        r.ring.rotation.z += dt * r.speed * r.dir * (1 + opened * 6);
        r.mat.opacity = (0.30 - rings.indexOf(r) * 0.06) * (0.7 + 0.3 * Math.sin(t * 1.7));
      }

      // The halves draw apart, the seam widens, and the light behind comes up.
      for (const h of halves) h.half.position.x = h.side * opened * 1.9;
      seam.scale.x = 1 + opened * 22;
      seamBack.scale.x = seam.scale.x;
      seamMat.opacity = 0.85 * (0.6 + 0.4 * Math.sin(t * 2.6)) * (1 - opened * 0.4);
      interior.material.opacity = opened * 0.9;
      glow.intensity = 3.0 + opened * 16 + Math.sin(t * 3.1) * 0.8;
      glow.distance = 26 + opened * 30;
    },
  };
}

/**
 * Carve the vault: a hollow chamber with a built shell, sitting on the bedrock at
 * the very bottom of the claim. Called after generation, before meshing.
 */
export function carveVault(world, { AIR, BEDROCK }) {
  // Shell first, one block proud of the interior on every face.
  for (let vy = VAULT.y0 - 1; vy <= VAULT.y1 + 1; vy++) {
    for (let vz = VAULT.z0 - 1; vz <= VAULT.z1 + 1; vz++) {
      for (let vx = VAULT.x0 - 1; vx <= VAULT.x1 + 1; vx++) {
        if (vy >= world.h || vx < 1 || vz < 1 || vx >= world.w - 1 || vz >= world.d - 1) continue;
        world.set(vx, vy, vz, BEDROCK);
      }
    }
  }
  // Then hollow it out.
  for (let vy = VAULT.y0; vy <= VAULT.y1; vy++) {
    for (let vz = VAULT.z0; vz <= VAULT.z1; vz++) {
      for (let vx = VAULT.x0; vx <= VAULT.x1; vx++) {
        world.set(vx, vy, vz, AIR);
      }
    }
  }
  // A single mineable plug in the ceiling, dead centre, so the way in is findable
  // by anyone who simply keeps drilling straight down from the landing pad.
  const cx = Math.floor(WORLD.CENTER_X);
  const cz = Math.floor(WORLD.CENTER_Z);
  for (let vy = VAULT.y0 - 1; vy <= VAULT.y0 - 1; vy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.set(cx + dx, vy, cz + dz, 3);
    }
  }
  world.recountChunks();
}
