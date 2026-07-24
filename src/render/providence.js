import * as THREE from 'three';
import { canvas2d, toTexture } from './texlib.js';
import { BLOCKS, LAVA, GAS } from '../world/blocks.js';
import { scanOre, scanHazards, richestWithin } from '../player/sensorData.js';
import { SENSOR_BY_KEY } from '../game/sensors.js';

/**
 * The Providence Engine.
 *
 * Every other module in the catalogue is an instrument: it measures something and
 * reports it. This one is sold without a specification, hangs from the ceiling
 * behind an iron shroud, and shows you ore through forty metres of solid basalt
 * without explaining how. It is the only fitting in the pod that Mr Natas signs
 * for personally, and the only one that charges by the second.
 *
 * Three things make it read as wrong rather than merely powerful:
 *   - it is armed from under a safety cover, like an ordnance release;
 *   - it bills you continuously, and when your credit runs out it goes on running
 *     and takes payment out of the hull instead;
 *   - the lens does not always point at the rock.
 */

const RANGE = 40;
const MAX_MARKS = 900;
const SIGIL_COUNT = 14;

/** Etched ring of invented glyphs. Geometric, deliberately not any real alphabet. */
function sigilRing(size = 512, ink = '#c8442e') {
  const { canvas, ctx } = canvas2d(size, size);
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, size * 0.30, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < SIGIL_COUNT; i++) {
    const a = (i / SIGIL_COUNT) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * size * 0.37, c + Math.sin(a) * size * 0.37);
    ctx.rotate(a + Math.PI / 2);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    // A different simple figure per position, built from a bit hash of the index.
    const k = (i * 2654435761) >>> 0;
    const arms = 2 + (k % 4);
    for (let j = 0; j < arms; j++) {
      const b = (j / arms) * Math.PI * 2 + ((k >> 3) % 7) * 0.3;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(b) * 14, Math.sin(b) * 14);
    }
    if (k % 3 === 0) ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  return canvas;
}

export function createProvidence({ cockpit, world }) {
  // ---------------------------------------------------------------- cabin unit
  const unit = new THREE.Group();
  // Forward of the roof port, so the eye hangs over the canopy rather than through
  // the one piece of glass you look up out of.
  unit.position.set(0, 0.50, -0.26);
  cockpit.root.add(unit);

  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.75, metalness: 0.6 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0x8a6a32, roughness: 0.45, metalness: 0.85 });

  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.26), ironMat);
  unit.add(housing);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.10, 0.28), brassMat);
    rail.position.set(side * 0.14, 0, 0);
    unit.add(rail);
  }

  // Two hinged shutters that iris open when the Engine is armed.
  const shutters = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 0.125, -0.045, 0);
    unit.add(hinge);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.012, 0.25), ironMat);
    leaf.position.x = -side * 0.0625;
    hinge.add(leaf);
    shutters.push({ hinge, side });
  }

  // The lens: a dark eye on a yoke, so it can turn.
  const yoke = new THREE.Group();
  yoke.position.y = -0.055;
  unit.add(yoke);

  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x0b0605, roughness: 0.08, metalness: 0.2,
    emissive: 0x8a1408, emissiveIntensity: 0,
  });
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), lensMat);
  yoke.add(lens);

  const irisMat = new THREE.MeshBasicMaterial({
    color: 0xff3a18, transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide,
  });
  const iris = new THREE.Mesh(new THREE.RingGeometry(0.020, 0.034, 24), irisMat);
  iris.position.z = -0.052;
  yoke.add(iris);

  const ringTex = toTexture(sigilRing());
  const ringMats = [];
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: ringTex, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.20 - i * 0.05, 0.20 - i * 0.05), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.075 - i * 0.03;
    unit.add(ring);
    ringMats.push({ mat, ring, dir: i % 2 ? 1 : -1 });
  }

  // Red flood over the pilot's hands when it is running.
  const flood = new THREE.PointLight(0xff2a10, 0, 1.3, 2);
  flood.position.set(0, 0.34, -0.12);
  cockpit.root.add(flood);

  // ------------------------------------------------------------- world overlay
  // Drawn with depth testing off and a very high render order, so returns hang in
  // the air exactly where they are, straight through the rock in between.
  const overlay = new THREE.Group();
  overlay.renderOrder = 990;
  overlay.visible = false;

  const positions = new Float32Array(MAX_MARKS * 24 * 3);
  const colors = new Float32Array(MAX_MARKS * 24 * 3);
  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  markGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  markGeo.setDrawRange(0, 0);
  const marks = new THREE.LineSegments(
    markGeo,
    new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }),
  );
  marks.frustumCulled = false;
  marks.renderOrder = 991;
  overlay.add(marks);

  // The halo that marks the richest thing in range.
  const halo = new THREE.Group();
  halo.renderOrder = 992;
  overlay.add(halo);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: 0.9,
    depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9 + i * 0.35, 0.035, 6, 28), haloMat);
    ring.rotation.x = i * 1.1;
    ring.rotation.z = i * 0.7;
    halo.add(ring);
  }

  // Unit cube edge template, offset into place per mark.
  const EDGES = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 1], [1, 0, 1, 0, 0, 1], [0, 0, 1, 0, 0, 0],
    [0, 1, 0, 1, 1, 0], [1, 1, 0, 1, 1, 1], [1, 1, 1, 0, 1, 1], [0, 1, 1, 0, 1, 0],
    [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [1, 0, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
  ];

  const colorTmp = new THREE.Color();
  let markCount = 0;
  let target = null;
  let scanTimer = 0;
  let armed = false;
  let deploy = 0;
  let t = 0;
  let gazeTimer = 6 + Math.random() * 14;
  let gazing = 0;
  let unpaidFor = 0;

  function rebuild(position) {
    const ore = scanOre(world, position, RANGE, 2);
    const hazards = scanHazards(world, position, RANGE, 2);
    const cx = Math.floor(position.x);
    const cy = Math.floor(-position.y);
    const cz = Math.floor(position.z);

    let n = 0;
    const push = (vx, vy, vz, hex, scale) => {
      if (n >= MAX_MARKS) return;
      colorTmp.setHex(hex);
      const base = n * 24 * 3;
      const inset = (1 - scale) / 2;
      for (let e = 0; e < 12; e++) {
        const edge = EDGES[e];
        for (let v = 0; v < 2; v++) {
          const o = base + (e * 2 + v) * 3;
          positions[o] = vx + inset + edge[v * 3] * scale;
          positions[o + 1] = -(vy + 1) + inset + edge[v * 3 + 1] * scale;
          positions[o + 2] = vz + inset + edge[v * 3 + 2] * scale;
          colors[o] = colorTmp.r;
          colors[o + 1] = colorTmp.g;
          colors[o + 2] = colorTmp.b;
        }
      }
      n++;
    };

    for (const h of ore) {
      // Fade with distance so a wall of returns still reads as depth.
      const fade = 1 - (h.distance / RANGE) * 0.55;
      colorTmp.setHex(BLOCKS[h.id].glow || h.color).multiplyScalar(fade);
      push(cx + h.dx, cy - h.dy, cz + h.dz, colorTmp.getHex(), 0.55);
    }
    for (const h of hazards) {
      push(cx + h.dx, cy - h.dy, cz + h.dz, h.id === LAVA ? 0xff3a10 : 0x7aff40, 0.85);
    }

    markCount = n;
    markGeo.setDrawRange(0, n * 24);
    markGeo.attributes.position.needsUpdate = true;
    markGeo.attributes.color.needsUpdate = true;

    const best = richestWithin(world, position, RANGE);
    target = best
      ? {
        name: BLOCKS[best.id].name,
        value: best.value,
        distance: best.distance,
        world: new THREE.Vector3(cx + best.dx + 0.5, -(cy - best.dy) - 0.5, cz + best.dz + 0.5),
      }
      : null;
  }

  return {
    unit,
    overlay,
    get armed() { return armed; },
    get target() { return target; },
    get marks() { return markCount; },

    setArmed(v) {
      armed = v;
      if (!v) unpaidFor = 0;
    },

    /**
     * @returns {{ message: string|null }} anything the Engine wants to say.
     */
    update(dt, { owned, live, position, pod }) {
      const fitted = owned.has('providence');
      unit.visible = fitted;
      let message = null;

      const want = fitted && live && armed ? 1 : 0;
      deploy += (want - deploy) * Math.min(1, dt * 3.2);
      t += dt;

      // Shutters iris open, sigils spin up, the lens starts to glow.
      for (const s of shutters) s.hinge.rotation.z = s.side * deploy * 1.5;
      lensMat.emissiveIntensity = deploy * 1.6;
      irisMat.opacity = deploy * (0.55 + Math.sin(t * 4.3) * 0.18);
      flood.intensity = deploy * 0.8;
      for (const r of ringMats) {
        r.mat.opacity = deploy * 0.5;
        r.ring.rotation.z += dt * 0.7 * r.dir;
      }

      overlay.visible = deploy > 0.35;
      if (overlay.visible) {
        scanTimer += dt;
        if (scanTimer > 1.0) {
          scanTimer = 0;
          rebuild(position);
        }
        marks.material.opacity = 0.55 * deploy + Math.sin(t * 9) * 0.05;

        if (target) {
          halo.visible = true;
          halo.position.copy(target.world);
          halo.rotation.y += dt * 0.8;
          halo.rotation.x += dt * 0.3;
          const pulse = 1 + Math.sin(t * 2.4) * 0.10;
          halo.scale.setScalar(pulse);
          haloMat.opacity = 0.55 * deploy;
        } else {
          halo.visible = false;
        }
      }

      // The gaze. Most of the time the lens tracks the rock ahead; occasionally it
      // does not, and the only thing behind it is the pilot.
      gazeTimer -= dt;
      if (gazeTimer <= 0) {
        gazing = 2.4;
        gazeTimer = 14 + Math.random() * 26;
      }
      if (gazing > 0) gazing -= dt;
      const look = gazing > 0 ? 1 : 0;
      yoke.rotation.x += ((look ? 1.15 : 0) - yoke.rotation.x) * Math.min(1, dt * 2.4);

      // The tithe. It bills while armed; when the credit runs out it does not stop.
      if (fitted && live && armed) {
        const rate = SENSOR_BY_KEY.providence.tithe;
        if (pod.cash >= rate * dt) {
          pod.cash -= rate * dt;
        } else {
          pod.cash = 0;
          unpaidFor += dt;
          pod.damage(1.6 * dt);
          if (unpaidFor > 3 && unpaidFor % 6 < dt) {
            message = 'SERVICE UNPAID — SETTLEMENT TAKEN IN KIND';
          }
        }
      }

      return { message };
    },
  };
}
