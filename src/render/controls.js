import * as THREE from 'three';
import { canvas2d, toTexture, drawBolt, LABEL_FONT } from './texlib.js';

/**
 * Physical controls: toggle switches, guarded switches, and rotary selectors.
 *
 * These are the difference between a game with a settings menu and a game about
 * operating a machine. The headlights are not a keybind, they are a switch on the
 * left rail that you look at and throw, and if you forget to throw it you descend
 * in the dark. Every control here carries a real hit volume so the crosshair
 * interaction system can find it.
 */

const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2c27, roughness: 0.85, metalness: 0.25 });
const leverMat = new THREE.MeshStandardMaterial({ color: 0xb8bcb2, roughness: 0.35, metalness: 0.85 });
const leverRed = new THREE.MeshStandardMaterial({ color: 0xc03426, roughness: 0.5, metalness: 0.3 });
const guardMat = new THREE.MeshStandardMaterial({
  color: 0xd8a12a, roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.85,
});

function legendPlate(text, width, height, sub = '') {
  const { canvas, ctx } = canvas2d(256, 96);
  ctx.fillStyle = '#24261f';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, 256, 3);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = '#d2ccbb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, sub ? 36 : 48);
  if (sub) {
    ctx.font = '13px "Arial Narrow", sans-serif';
    ctx.fillStyle = '#8f9a86';
    ctx.fillText(sub, 128, 64);
  }
  drawBolt(ctx, 12, 48, 5);
  drawBolt(ctx, 244, 48, 5);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ map: toTexture(canvas), roughness: 0.9 }),
  );
}

/**
 * A two-position toggle. `hit` is the mesh registered for crosshair interaction —
 * deliberately larger than the lever, because aiming a crosshair at a 6 mm stick
 * of metal is not a fun interaction.
 */
export function toggleSwitch({
  label = 'SWITCH',
  sub = '',
  on = false,
  size = 0.05,
  onChange = null,
} = {}) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(new THREE.BoxGeometry(size * 0.9, size * 0.9, 0.012), baseMat);
  group.add(base);

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.24, size * 0.30, 0.010, 10),
    leverMat,
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.z = 0.008;
  group.add(collar);

  // The lever pivots at the collar, so it swings rather than slides.
  //
  // It swings in front of the panel, never through it. The first version rotated the
  // lever about the panel plane, which meant one of its two positions pointed
  // *backwards* — the stick buried itself in its own mounting plate and all you could
  // see was the collar end-on. A real toggle stands proud of the panel in both
  // positions and leans up or down; that is what UP_POSE and DOWN_POSE are.
  const pivot = new THREE.Group();
  pivot.position.z = 0.013;
  group.add(pivot);
  // Local +Y is along the stick. Rotating the pivot by π/2 lays that along +Z, i.e.
  // straight out at the pilot; TILT then leans it off that axis by about 49°.
  const TILT = 0.85;
  const UP_POSE = Math.PI / 2 - TILT;
  const DOWN_POSE = Math.PI / 2 + TILT;

  const lever = new THREE.Mesh(new THREE.CapsuleGeometry(size * 0.11, size * 0.42, 3, 6), leverMat);
  // Seated *on* the pivot rather than straddling it, so nothing hangs below the
  // hinge to dip into the plate as it swings.
  lever.position.y = size * 0.32;
  pivot.add(lever);
  const tipMesh = new THREE.Mesh(new THREE.SphereGeometry(size * 0.15, 8, 6), leverRed);
  tipMesh.position.y = size * 0.56;
  pivot.add(tipMesh);

  const legend = legendPlate(label, size * 1.9, size * 0.62, sub);
  legend.position.set(0, -size * 0.78, 0.001);
  group.add(legend);

  // Generous invisible target, covering the legend plate as well as the switch.
  //
  // The label is the biggest, most obvious thing on the control and it is what a
  // player naturally puts the crosshair on, so it had better be clickable. Aiming at
  // a 6 mm stick of metal is not an interaction, it is an eye test.
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2.05, size * 1.8),
    // Double-sided: these panels are raked steeply towards the seat, and a
    // front-only target silently stops answering as you lean past its plane.
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  // Sat almost on the panel face rather than floating in front of it. Nothing else
  // on the switch is a raycast target, so there is nothing to clear — and a target
  // standing off the panel drifts away from the thing it represents as soon as you
  // look at it from an angle, which is its own kind of unreliable.
  hit.position.set(0, -size * 0.2, 0.02);
  group.add(hit);

  let state = on;
  let angle = state ? UP_POSE : DOWN_POSE;
  pivot.rotation.x = angle;

  const api = {
    group,
    hit,
    label,
    get on() { return state; },
    setState(v, silent = false) {
      if (state === v) return;
      state = v;
      if (!silent) onChange?.(state);
    },
    toggle() {
      state = !state;
      onChange?.(state);
      return state;
    },
    update(dt) {
      // Overshoot slightly and settle: switches snap into their detent.
      const target = state ? UP_POSE : DOWN_POSE;
      angle += (target - angle) * Math.min(1, dt * 22);
      pivot.rotation.x = angle;
      tipMesh.material = state ? leverRed : leverMat;
    },
    /** Crosshair highlight. */
    setHighlight(v) {
      collar.material = v ? highlightMat : leverMat;
    },
  };

  return api;
}

const highlightMat = new THREE.MeshStandardMaterial({
  color: 0xffe08a, emissive: 0x6a4a10, roughness: 0.3, metalness: 0.8,
});

/**
 * A switch under a hinged safety cover. You have to lift the cover before you can
 * throw it, which is exactly the right amount of ceremony for something that
 * should never be thrown by accident.
 */
export function guardedSwitch({ label = 'ARM', sub = '', size = 0.06, onChange = null } = {}) {
  const inner = toggleSwitch({ label, sub, size, onChange });
  const group = new THREE.Group();
  group.add(inner.group);

  // The cover has to hinge *clear* of the lever, which now stands proud of the panel
  // in both positions rather than lying back into it. A guard flush to the plate
  // would close straight through the stick it is supposed to be protecting.
  const coverPivot = new THREE.Group();
  coverPivot.position.set(0, size * 0.62, 0.013 + size * 0.62);
  group.add(coverPivot);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(size * 1.1, size * 1.25, 0.005), guardMat);
  cover.position.y = -size * 0.62;
  coverPivot.add(cover);
  // Side cheeks, so it reads as a cage over the switch rather than a floating pane.
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, size * 1.25, size * 0.62), guardMat,
    );
    cheek.position.set(s * size * 0.55, -size * 0.62, -size * 0.31);
    coverPivot.add(cheek);
  }

  let open = false;
  let coverAngle = 0;

  return {
    group,
    hit: inner.hit,
    label,
    get on() { return inner.on; },
    get open() { return open; },
    /** First click lifts the cover; the second throws the switch. */
    toggle() {
      if (!open) {
        open = true;
        return inner.on;
      }
      return inner.toggle();
    },
    close() { open = false; },
    setState(v, silent) { inner.setState(v, silent); },
    update(dt) {
      inner.update(dt);
      const target = open ? -1.35 : 0;
      coverAngle += (target - coverAngle) * Math.min(1, dt * 10);
      coverPivot.rotation.x = coverAngle;
    },
    setHighlight(v) { inner.setHighlight(v); },
  };
}

/**
 * Rotary selector with detented positions — used for the monitor feed selector and
 * the terminal page knob.
 */
export function rotarySelector({
  label = 'SELECT',
  options = ['A', 'B', 'C'],
  index = 0,
  size = 0.055,
  onChange = null,
} = {}) {
  const group = new THREE.Group();

  const dialFace = (() => {
    const { canvas, ctx } = canvas2d(192, 192);
    ctx.fillStyle = '#1d1f1a';
    ctx.beginPath();
    ctx.arc(96, 96, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cfcabb';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(96, 96);
    ctx.lineTo(96, 22);
    ctx.stroke();
    // Knurling around the rim so it reads as something you grip and turn.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(96 + Math.cos(a) * 78, 96 + Math.sin(a) * 78);
      ctx.lineTo(96 + Math.cos(a) * 94, 96 + Math.sin(a) * 94);
      ctx.stroke();
    }
    return canvas;
  })();

  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.5, size * 0.44, 0.016, 20),
    new THREE.MeshStandardMaterial({ color: 0x35382f, roughness: 0.7, metalness: 0.4 }),
  );
  knob.rotation.x = Math.PI / 2;
  knob.position.z = 0.008;
  group.add(knob);

  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(size * 0.48, 24),
    new THREE.MeshStandardMaterial({ map: toTexture(dialFace), roughness: 0.6 }),
  );
  cap.position.z = 0.017;
  group.add(cap);

  // Position legends around the knob.
  const ring = new THREE.Group();
  group.add(ring);
  const { canvas: legendCanvas, ctx: lctx } = canvas2d(256, 256);
  lctx.fillStyle = '#23251f';
  lctx.beginPath();
  lctx.arc(128, 128, 128, 0, Math.PI * 2);
  lctx.fill();
  lctx.font = '18px "Arial Narrow", sans-serif';
  lctx.fillStyle = '#cfcabb';
  lctx.textAlign = 'center';
  lctx.textBaseline = 'middle';
  const spread = Math.PI * 1.4;
  options.forEach((opt, i) => {
    const a = -Math.PI / 2 - spread / 2 + (spread * i) / Math.max(1, options.length - 1);
    lctx.fillText(opt, 128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
  });
  const legendRing = new THREE.Mesh(
    new THREE.CircleGeometry(size * 1.15, 28),
    new THREE.MeshStandardMaterial({ map: toTexture(legendCanvas), roughness: 0.9 }),
  );
  legendRing.position.z = -0.001;
  ring.add(legendRing);

  const knobLegend = legendPlate(label, size * 1.9, size * 0.5);
  knobLegend.position.set(0, -size * 1.45, 0.001);
  group.add(knobLegend);

  // As with the toggles: the target covers the legend ring and the plate, not just
  // the knob, and answers from either side because the console is raked.
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2.6, size * 3.0),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  hit.position.set(0, -size * 0.4, 0.025);
  group.add(hit);

  let current = index;
  let shown = index;

  return {
    group,
    hit,
    label,
    get index() { return current; },
    get value() { return options[current]; },
    /** Clicking advances one detent; the knob spins round at the end. */
    toggle() {
      current = (current + 1) % options.length;
      onChange?.(current, options[current]);
      return current;
    },
    setIndex(i) {
      current = ((i % options.length) + options.length) % options.length;
      onChange?.(current, options[current]);
    },
    update(dt) {
      shown += (current - shown) * Math.min(1, dt * 14);
      const a = -spread / 2 + (spread * shown) / Math.max(1, options.length - 1);
      cap.rotation.z = -a;
      knob.rotation.y = -a;
    },
    setHighlight(v) {
      cap.material.emissive = new THREE.Color(v ? 0x4a3a10 : 0x000000);
    },
  };
}
