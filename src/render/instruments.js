import * as THREE from 'three';
import { canvas2d, toTexture, drawBolt, LABEL_FONT } from './texlib.js';

/**
 * Physical instruments: dial gauges with real needles, LED ladders, dot-matrix
 * readouts and warning lamps.
 *
 * These are backlit panel instruments, so their faces use unlit materials — a fuel
 * gauge you cannot read because the cabin lamp failed is realism nobody wants. The
 * bezels around them are lit metal, which is what ties them into the cabin.
 */

const litFace = (canvas) => new THREE.MeshBasicMaterial({
  map: toTexture(canvas),
  toneMapped: false,
});

const bezelMat = new THREE.MeshStandardMaterial({ color: 0x54574f, roughness: 0.55, metalness: 0.7 });
const needleMat = new THREE.MeshBasicMaterial({ color: 0xff8a3c, toneMapped: false });
const hubMat = new THREE.MeshStandardMaterial({ color: 0x1b1c19, roughness: 0.8, metalness: 0.3 });

/**
 * Round dial with tick marks, a labelled arc and an optional redline sector.
 * `setValue(0..1)` sweeps the needle across `sweep` radians.
 */
export function dialGauge({
  radius = 0.075,
  label = 'FUEL',
  units = '',
  ticks = 10,
  redline = null,
  face = '#141712',
  ink = '#cfd6c6',
  accent = '#8cff7a',
  sweep = Math.PI * 1.35,
} = {}) {
  const px = 256;
  const { canvas, ctx } = canvas2d(px, px);
  const c = px / 2;
  const r = px * 0.44;
  const start = Math.PI / 2 + sweep / 2;

  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(c, c, px / 2, 0, Math.PI * 2);
  ctx.fill();

  // Redline sector, given as [from, to] in scale units — low for fuel, high for
  // heat. Drawn as a fan rather than with ctx.arc: the ticks below use maths
  // orientation (y up) and canvas arcs use screen orientation, and mixing the two
  // put the redline on the wrong side of the dial.
  if (redline) {
    const [from, to] = redline;
    ctx.beginPath();
    ctx.moveTo(c, c);
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      const a = start - sweep * t;
      ctx.lineTo(c + Math.cos(a) * r * 1.02, c - Math.sin(a) * r * 1.02);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,40,30,0.45)';
    ctx.fill();
  }

  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const a = start - sweep * t;
    const major = i % 5 === 0;
    const r0 = r * (major ? 0.74 : 0.84);
    ctx.strokeStyle = major ? ink : 'rgba(207,214,198,0.55)';
    ctx.lineWidth = major ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c - Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r * 0.96, c - Math.sin(a) * r * 0.96);
    ctx.stroke();
  }

  ctx.fillStyle = ink;
  ctx.font = `bold ${px * 0.10}px "Arial Narrow", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, c, c + r * 0.40);
  if (units) {
    ctx.font = `${px * 0.07}px "Arial Narrow", sans-serif`;
    ctx.fillStyle = accent;
    ctx.fillText(units, c, c + r * 0.62);
  }

  const group = new THREE.Group();
  const dial = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), litFace(canvas));
  group.add(dial);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.03, radius * 0.09, 8, 32), bezelMat);
  ring.position.z = -0.002;
  group.add(ring);

  // The needle sits in the same maths orientation as the face: rotation.z is a
  // counter-clockwise angle, and the dial texture is drawn with y up to match.
  const needle = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.86, radius * 0.055, 0.002), needleMat);
  blade.position.x = radius * 0.33;
  needle.add(blade);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.22, radius * 0.05, 0.002), needleMat);
  tail.position.x = -radius * 0.13;
  needle.add(tail);
  needle.position.z = 0.004;
  group.add(needle);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.10, radius * 0.10, 0.006, 10), hubMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.006;
  group.add(hub);

  let shown = 0;
  return {
    group,
    needle,
    /** Needles have mass: they lag and settle rather than snapping. */
    setValue(t, dt = 1) {
      const target = Math.max(0, Math.min(1.02, t));
      shown += (target - shown) * Math.min(1, dt * 7);
      needle.rotation.z = start - sweep * shown;
    },
  };
}

/**
 * A ladder of LED segments. Used for hull integrity and cargo fill, where a count
 * of discrete lamps reads faster at a glance than any needle.
 */
export function ledBar({
  count = 12,
  width = 0.20,
  height = 0.016,
  color = 0x66ff88,
  warnColor = 0xff5a3c,
  warnBelow = 0.3,
  vertical = false,
} = {}) {
  const group = new THREE.Group();
  const gap = width / count;
  const segW = gap * 0.72;
  const cells = [];
  const OFF = 0x161a15;

  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: OFF, toneMapped: false });
    const geo = vertical
      ? new THREE.PlaneGeometry(height, segW)
      : new THREE.PlaneGeometry(segW, height);
    const cell = new THREE.Mesh(geo, mat);
    const offset = -width / 2 + gap * (i + 0.5);
    if (vertical) cell.position.y = offset;
    else cell.position.x = offset;
    group.add(cell);
    cells.push({ cell, mat });
  }

  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(
      vertical ? height * 2.2 : width * 1.06,
      vertical ? width * 1.06 : height * 2.2,
    ),
    new THREE.MeshStandardMaterial({ color: 0x121310, roughness: 0.9 }),
  );
  backing.position.z = -0.002;
  group.add(backing);

  return {
    group,
    setValue(t) {
      const lit = Math.round(Math.max(0, Math.min(1, t)) * count);
      const warn = t <= warnBelow;
      for (let i = 0; i < count; i++) {
        cells[i].mat.color.setHex(i < lit ? (warn ? warnColor : color) : OFF);
      }
    },
  };
}

/**
 * Dot-matrix readout. Redrawn only when the string changes, because these update
 * every time the pod moves a metre and the upload is the expensive part.
 */
export function digitDisplay({
  chars = 7,
  width = 0.26,
  height = 0.052,
  color = '#ffb340',
  label = '',
} = {}) {
  const px = 64 * chars;
  const py = 96;
  const { canvas, ctx } = canvas2d(px, py);
  const texture = toTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });

  const group = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  group.add(plate);

  const surround = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.10, height * 1.45, 0.012),
    bezelMat,
  );
  surround.position.z = -0.008;
  group.add(surround);

  let last = null;
  let caption = label;
  const api = {
    group,
    /** Relabel the readout. The altimeter changes what it is measuring in flight. */
    setLabel(str) {
      if (str === caption) return;
      caption = str;
      const text = last;
      last = null;
      api.setText(text ?? '');
    },
    setText(str) {
      if (str === last) return;
      last = str;
      ctx.fillStyle = '#0b0a06';
      ctx.fillRect(0, 0, px, py);

      // Ghost the unlit segments behind the value, like a real VFD panel.
      ctx.font = `bold ${py * 0.72}px "Courier New", monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,179,64,0.10)';
      ctx.fillText('8'.repeat(chars), px - 8, py * 0.54);

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillText(str.slice(-chars), px - 8, py * 0.54);
      ctx.shadowBlur = 0;

      if (caption) {
        ctx.font = `bold ${py * 0.20}px "Arial Narrow", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,179,64,0.65)';
        ctx.fillText(caption, 8, py * 0.16);
      }
      texture.needsUpdate = true;
    },
  };
  api.setText('');
  return api;
}

/** Warning lamp: a lens that lights, over a stencilled legend. */
export function warningLamp({ label = 'FUEL', color = 0xff9a2a, width = 0.09 } = {}) {
  const group = new THREE.Group();

  const { canvas, ctx } = canvas2d(128, 48);
  ctx.fillStyle = '#141510';
  ctx.fillRect(0, 0, 128, 48);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = '#c9c4b4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 26);
  const legend = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.36),
    new THREE.MeshStandardMaterial({ map: toTexture(canvas), roughness: 0.9 }),
  );
  legend.position.y = -width * 0.42;
  group.add(legend);

  const lensMat = new THREE.MeshBasicMaterial({ color: 0x2a1a10, toneMapped: false });
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.78, width * 0.40), lensMat);
  lens.position.y = width * 0.02;
  group.add(lens);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.90, width * 0.52, 0.010),
    bezelMat,
  );
  rim.position.set(0, width * 0.02, -0.006);
  group.add(rim);

  const on = new THREE.Color(color);
  const off = new THREE.Color(0x2a1a10);
  let phase = 0;

  return {
    group,
    /** `state` 0 = dark, 1 = lit, 2 = flashing. */
    setState(state, dt = 0) {
      phase += dt * 6.5;
      if (state === 2) {
        const blink = Math.sin(phase) > 0 ? 1 : 0.12;
        lensMat.color.copy(off).lerp(on, blink);
      } else {
        lensMat.color.copy(state ? on : off);
      }
    },
  };
}

/** Small stencilled plate for labelling anything bolted to a panel. */
export function nameplate({ text = '', width = 0.16, height = 0.028, color = '#2f322c' } = {}) {
  const { canvas, ctx } = canvas2d(256, 48);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 40, 256, 8);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = '#cfcabb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 25);
  drawBolt(ctx, 10, 24, 5);
  drawBolt(ctx, 246, 24, 5);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: toTexture(canvas), roughness: 0.85 }),
  );
}
