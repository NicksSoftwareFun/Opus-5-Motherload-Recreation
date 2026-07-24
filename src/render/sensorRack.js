import * as THREE from 'three';
import { Screen, PHOSPHOR } from '../ui/screen.js';
import { nameplate } from './instruments.js';
import { BLOCKS, LAVA, GAS, isOre } from '../world/blocks.js';
import { scanOre, columnBelow, slice, bitReading } from '../player/sensorData.js';

/**
 * The instruments the Sensor Bureau sells, as physical fittings.
 *
 * Each one appears in the cabin only once bought, in the bay its catalogue entry
 * names, and each is a genuinely different way of looking at the same voxel grid:
 * one reads the bit, one listens through the rock, one takes a core, one looks at
 * heat. They earn their prices by answering questions the pilot is actually asking
 * at that stage of the game.
 *
 * Scans are throttled per instrument rather than run per frame. See sensorData.js.
 */

const RACK_Z = 0.026;

/** Ore tier -> scope colour, so a return's worth is legible before you dig it. */
function oreInk(id) {
  const v = BLOCKS[id].value;
  if (v >= 20000) return '#ff6ad0';
  if (v >= 2000) return '#8cff7a';
  if (v >= 250) return '#ffd447';
  return '#ff9a5a';
}

export function createSensorRack({ cockpit, world }) {
  const { dash, racks } = cockpit.parts;
  const modules = {};

  // --- MK-I Densitometer: a strip above the terminal -----------------------
  const densit = new Screen({
    width: 0.30, height: 0.052, px: 384, py: 66, palette: PHOSPHOR.amber, fps: 10,
    name: 'densitometer',
  });
  densit.mesh.position.set(0, 0.148, 0.028);
  const densitBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.335, 0.078, 0.016),
    new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.8, metalness: 0.3 }),
  );
  densitBezel.position.set(0, 0.148, 0.020);
  const densitGroup = new THREE.Group();
  densitGroup.add(densit.mesh, densitBezel);
  dash.add(densitGroup);
  modules.densitometer = { group: densitGroup, screens: [densit] };

  densit.setPage((ctx, api, state) => {
    const P = api.P;
    api.clear();
    const r = state.bit;
    ctx.fillStyle = P.dim;
    ctx.fillRect(0, 0, 88, api.H);
    api.text('BIT', 44, 20, { size: 13, align: 'center', color: P.bg, bold: true });
    api.text('ASSAY', 44, 44, { size: 11, align: 'center', color: P.bg });

    if (!r) {
      api.text('NO RETURN', 104, api.H / 2, { size: 16, color: P.dim, bold: true });
      return;
    }
    api.text(r.name.toUpperCase(), 104, 20, {
      size: 16, bold: true, color: r.ore ? P.hot : P.ink,
    });
    api.text(
      r.cuttable ? `H ${r.hardness.toFixed(2)}   ETA ${r.eta.toFixed(1)}S` : 'UNCUTTABLE',
      104, 46, { size: 13, color: P.ink },
    );
    if (r.ore) {
      api.text(`${r.value} CR`, api.W - 10, 20, { size: 14, align: 'right', bold: true, color: P.hot });
    }
    // Hardness bar along the bottom edge, full scale = the toughest rock there is.
    if (r.cuttable) {
      api.bar(104, api.H - 14, api.W - 118, 8, Math.min(1, r.hardness / 3.2), { segments: 18 });
    }
  });

  // --- Chirp Sonar: PPI scope, port rack ----------------------------------
  const sonar = new Screen({
    width: 0.235, height: 0.235, px: 288, py: 288, palette: PHOSPHOR.green, fps: 20,
    name: 'sonar',
  });
  sonar.mesh.position.set(0, 0.095, RACK_Z);
  const sonarPlate = nameplate({ text: 'CHIRP SONAR', width: 0.20, height: 0.030 });
  sonarPlate.position.set(0, -0.043, RACK_Z);
  const sonarGroup = new THREE.Group();
  sonarGroup.add(sonar.mesh, sonarPlate);
  racks.left.add(sonarGroup);
  modules.sonar = { group: sonarGroup, screens: [sonar] };

  let sweep = 0;
  let oreHits = [];
  let sonarTimer = 0;
  const RANGE = 18;

  sonar.setPage((ctx, api, state) => {
    const P = api.P;
    api.clear();
    const cx = api.W / 2;
    const cy = api.H / 2;
    const R = api.W * 0.44;

    // Range rings and cardinal ticks.
    ctx.strokeStyle = P.dim;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    // The sweep: a fading wedge, drawn as a fan of lines behind the leading edge.
    for (let i = 0; i < 26; i++) {
      const a = sweep - i * 0.045;
      ctx.strokeStyle = `rgba(140,255,122,${0.55 * (1 - i / 26) ** 2})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }

    // Returns. Bearing is relative to the pod's nose, which points up the scope.
    for (const hit of oreHits) {
      const horiz = Math.hypot(hit.rx, hit.rz);
      if (horiz > RANGE) continue;
      const px = cx + (hit.rx / RANGE) * R;
      const py = cy - (hit.rz / RANGE) * R;
      // Brighten a blip as the sweep passes it, then let it decay.
      const bearing = Math.atan2(py - cy, px - cx);
      let delta = ((sweep - bearing) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const fresh = Math.max(0, 1 - delta / 2.2);
      // Returns at the pod's own level read larger than ones above or below it.
      const size = 2.2 + (Math.abs(hit.dy) < 2 ? 3.2 : Math.abs(hit.dy) < 4 ? 2.0 : 1.2);
      ctx.globalAlpha = 0.25 + fresh * 0.75;
      ctx.fillStyle = oreInk(hit.id);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    api.text(`R ${RANGE}M`, 8, 14, { size: 11, color: P.dim });
    api.text(`${oreHits.length} RTN`, api.W - 8, 14, { size: 11, color: P.dim, align: 'right' });
    api.text('FWD', cx, 14, { size: 11, color: P.dim, align: 'center' });
  });

  // --- Strata Profiler: core sample column, port rack ---------------------
  const profiler = new Screen({
    width: 0.075, height: 0.30, px: 96, py: 384, palette: PHOSPHOR.amber, fps: 6,
    name: 'profiler',
  });
  profiler.mesh.position.set(-0.105, -0.145, RACK_Z);
  const profilerPlate = nameplate({ text: 'STRATA', width: 0.10, height: 0.026 });
  profilerPlate.position.set(0.04, -0.145, RACK_Z);
  profilerPlate.rotation.z = -Math.PI / 2;
  const profilerGroup = new THREE.Group();
  profilerGroup.add(profiler.mesh, profilerPlate);
  racks.left.add(profilerGroup);
  modules.profiler = { group: profilerGroup, screens: [profiler] };

  const CORE_DEPTH = 26;
  let core = [];

  profiler.setPage((ctx, api, state) => {
    const P = api.P;
    api.clear();
    const bandH = api.H / CORE_DEPTH;
    core.forEach((cell, i) => {
      const def = cell.def;
      const c = new THREE.Color(def.color);
      ctx.fillStyle = cell.id === 0 ? '#080604'
        : `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`;
      ctx.fillRect(18, i * bandH, api.W - 18, bandH + 0.6);
      // Ore and hazards get a bright flag out into the margin.
      if (isOre(cell.id) || cell.id === LAVA || cell.id === GAS) {
        ctx.fillStyle = cell.id === LAVA ? '#ff5a1e' : cell.id === GAS ? '#9ad84a' : oreInk(cell.id);
        ctx.fillRect(0, i * bandH + 1, 14, Math.max(2, bandH - 2));
      }
    });
    // Depth ticks every 5 m down the left margin.
    ctx.fillStyle = P.dim;
    for (let d = 5; d < CORE_DEPTH; d += 5) {
      ctx.fillRect(0, (d * api.H) / CORE_DEPTH, api.W, 1);
      api.text(`${d}`, 3, (d * api.H) / CORE_DEPTH - 7, { size: 9, color: P.ink });
    }
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, api.W - 2, api.H - 2);
  });

  // --- Thermal Aperture: false-colour section, starboard rack -------------
  const thermal = new Screen({
    width: 0.27, height: 0.19, px: 320, py: 224, palette: PHOSPHOR.amber, fps: 8,
    name: 'thermal',
  });
  thermal.mesh.position.set(0, 0.085, RACK_Z);
  const thermalPlate = nameplate({ text: 'THERMAL APERTURE', width: 0.24, height: 0.030 });
  thermalPlate.position.set(0, -0.035, RACK_Z);
  const thermalGroup = new THREE.Group();
  thermalGroup.add(thermal.mesh, thermalPlate);
  racks.right.add(thermalGroup);
  modules.thermal = { group: thermalGroup, screens: [thermal] };

  let section = null;

  thermal.setPage((ctx, api, state) => {
    const P = api.P;
    api.clear();
    if (!section) return;
    const { w, h, cells } = section;
    const cw = api.W / w;
    const ch = (api.H - 22) / h;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const id = cells[j * w + i];
        let fill;
        if (id === LAVA) fill = '#fff2c0';
        else if (id === GAS) fill = '#2f6bd8';
        else if (isOre(id)) fill = '#ff9d3c';
        else if (id === 0) fill = '#05080e';
        else {
          // Cold rock ramps from near-black to a dull blue by hardness.
          const hard = Math.min(1, BLOCKS[id].hardness / 2.2);
          const v = 18 + hard * 46;
          fill = `rgb(${v * 0.5 | 0},${v * 0.7 | 0},${v | 0})`;
        }
        ctx.fillStyle = fill;
        ctx.fillRect(i * cw, 22 + j * ch, cw + 0.6, ch + 0.6);
      }
    }
    // Pod marker at the section's origin.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    const px = api.W * 0.28;
    const py = 22 + (api.H - 22) / 2;
    ctx.strokeRect(px - 4, py - 4, 8, 8);

    ctx.fillStyle = P.dim;
    ctx.fillRect(0, 0, api.W, 20);
    api.text('THERMAL SECTION', 8, 10, { size: 12, color: P.bg, bold: true });
    api.text('MAGMA', api.W - 8, 10, { size: 11, color: P.bg, align: 'right' });
  });

  // Everything starts unfitted.
  for (const m of Object.values(modules)) m.group.visible = false;

  let scanTimer = 0;
  let coreTimer = 0;
  let sectionTimer = 0;

  return {
    modules,

    /** Show or hide fittings to match what the pod owns. */
    sync(owned) {
      for (const [key, m] of Object.entries(modules)) m.group.visible = owned.has(key);
    },

    update(dt, ctx) {
      const { owned, position, podYaw, drillTarget, drillPower, live } = ctx;
      const state = { bit: bitReading(drillTarget, drillPower) };

      if (owned.has('densitometer')) {
        densit.power = live ? 1 : 0;
        densit.update(dt, state);
      }

      if (owned.has('sonar')) {
        sonar.power = live ? 1 : 0;
        sweep += dt * 2.1;
        sonarTimer += dt;
        if (sonarTimer > 0.7 && live) {
          sonarTimer = 0;
          // Rotate returns into pod-relative axes so the scope reads nose-up.
          const cos = Math.cos(-podYaw);
          const sin = Math.sin(-podYaw);
          // A PPI scope shows a slab, not a sphere: without the vertical filter the
          // deep strata paint 150 returns and the display is unreadable polka dots.
          oreHits = scanOre(world, position, RANGE, 2)
            .filter((h) => Math.abs(h.dy) <= 5)
            .map((h) => ({
              ...h,
              rx: h.dx * cos - h.dz * sin,
              rz: h.dx * sin + h.dz * cos,
            }));
        }
        sonar.dirty = true;
        sonar.update(dt, state);
      }

      if (owned.has('profiler')) {
        profiler.power = live ? 1 : 0;
        coreTimer += dt;
        if (coreTimer > 0.35 && live) {
          coreTimer = 0;
          core = columnBelow(world, position, CORE_DEPTH);
          profiler.dirty = true;
        }
        profiler.update(dt, state);
      }

      if (owned.has('thermal')) {
        thermal.power = live ? 1 : 0;
        sectionTimer += dt;
        if (sectionTimer > 0.28 && live) {
          sectionTimer = 0;
          section = slice(world, position, podYaw);
          thermal.dirty = true;
        }
        thermal.update(dt, state);
      }

      scanTimer += dt;
    },
  };
}
