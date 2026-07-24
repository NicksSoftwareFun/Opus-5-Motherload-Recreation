import * as THREE from 'three';
import { canvas2d, toTexture } from './texlib.js';

/**
 * Exterior camera feeds on the right-hand console.
 *
 * The player never leaves the cockpit, so seeing the pod from outside has to be
 * something the machine does rather than something the camera does. Three cameras
 * are bolted to the hull and their output lands on a CRT you turn to look at,
 * selected with a rotary knob under the screen.
 *
 * Only the selected feed renders, at a fraction of the frame rate, into a small
 * target — a second full-resolution view of the mine every frame would cost more
 * than the mine itself.
 */

const FEEDS = [
  { key: 'chase', label: 'CHASE', fov: 62 },
  { key: 'bit', label: 'BIT', fov: 52 },
  { key: 'plumb', label: 'PLUMB', fov: 72 },
  { key: 'off', label: 'OFF', fov: 60 },
];

export const FEED_LABELS = FEEDS.map((f) => f.label);

/** Overlay drawn over the video: framing marks, feed name, and a data strip. */
function makeOverlay(px, py) {
  const { canvas, ctx } = canvas2d(px, py);
  const texture = toTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, toneMapped: false, depthWrite: false,
  });
  let last = '';

  return {
    material,
    draw(label, lines, live) {
      const key = `${label}|${lines.join('|')}|${live}`;
      if (key === last) return;
      last = key;

      ctx.clearRect(0, 0, px, py);

      // Corner framing marks — the universal "this is a camera" signal.
      ctx.strokeStyle = live ? 'rgba(255,190,90,0.9)' : 'rgba(255,190,90,0.35)';
      ctx.lineWidth = 3;
      const s = 22;
      for (const [x, y, dx, dy] of [
        [10, 10, 1, 1], [px - 10, 10, -1, 1], [10, py - 10, 1, -1], [px - 10, py - 10, -1, -1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * s, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * s);
        ctx.stroke();
      }

      // Centre reticle.
      ctx.beginPath();
      ctx.moveTo(px / 2 - 14, py / 2); ctx.lineTo(px / 2 - 5, py / 2);
      ctx.moveTo(px / 2 + 5, py / 2); ctx.lineTo(px / 2 + 14, py / 2);
      ctx.moveTo(px / 2, py / 2 - 14); ctx.lineTo(px / 2, py / 2 - 5);
      ctx.moveTo(px / 2, py / 2 + 5); ctx.lineTo(px / 2, py / 2 + 14);
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 20px "Arial Narrow", Impact, sans-serif';
      ctx.fillStyle = 'rgba(255,190,90,0.95)';
      ctx.textBaseline = 'top';
      ctx.fillText(label, 20, 18);

      if (live) {
        ctx.fillStyle = 'rgba(255,70,60,0.95)';
        ctx.beginPath();
        ctx.arc(px - 30, 27, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = '15px "Courier New", monospace';
      ctx.fillStyle = 'rgba(255,190,90,0.85)';
      lines.forEach((line, i) => ctx.fillText(line, 20, py - 30 - (lines.length - 1 - i) * 19));

      // Scanlines, so the feed reads as a tube and not a second window.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 0; y < py; y += 3) ctx.fillRect(0, y, px, 1);

      texture.needsUpdate = true;
    },
  };
}

export function createMonitors({ width = 0.30, height = 0.20, px = 384, py = 256, fps = 18 } = {}) {
  const target = new THREE.WebGLRenderTarget(px, py, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });

  const cameras = Object.fromEntries(
    FEEDS.map((f) => [f.key, new THREE.PerspectiveCamera(f.fov, px / py, 0.05, 400)]),
  );

  const group = new THREE.Group();

  const video = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: target.texture, toneMapped: false }),
  );
  group.add(video);

  const dead = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: 0x0a0906, toneMapped: false }),
  );
  dead.position.z = 0.0008;
  group.add(dead);

  const overlay = makeOverlay(px, py);
  const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), overlay.material);
  overlayMesh.position.z = 0.0016;
  group.add(overlayMesh);

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.14, height * 1.18, 0.018),
    new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.8, metalness: 0.3 }),
  );
  bezel.position.z = -0.012;
  group.add(bezel);

  let index = 0;
  let acc = 1;
  let power = 0;

  const tmpPos = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  return {
    group,
    feeds: FEEDS,
    get feedKey() { return FEEDS[index].key; },
    get index() { return index; },
    setIndex(i) { index = ((i % FEEDS.length) + FEEDS.length) % FEEDS.length; },

    /** Place the hull cameras for this frame. */
    aim({ position, podYaw, aimDir }) {
      // Chase: mostly *above* and only slightly behind. A pod in a one-metre shaft
      // has solid rock two metres to its rear, so a conventional chase camera would
      // spend the whole game buried; the open space is the hole you came down.
      const chase = cameras.chase;
      tmpDir.set(-Math.sin(podYaw), 0, -Math.cos(podYaw));
      chase.position.copy(position).addScaledVector(tmpDir, -0.95).addScaledVector(UP, 1.5);
      chase.lookAt(tmpPos.copy(position).addScaledVector(tmpDir, 1.2));

      // Bit: just ahead of the drill, looking where the drill looks.
      const bit = cameras.bit;
      bit.position.copy(position).addScaledVector(aimDir, 0.55).addScaledVector(UP, -0.05);
      bit.lookAt(tmpPos.copy(position).addScaledVector(aimDir, 6));

      // Plumb: straight down the hole, the one view drilling actually needs.
      const plumb = cameras.plumb;
      plumb.position.copy(position).addScaledVector(UP, 0.2);
      plumb.lookAt(tmpPos.copy(position).addScaledVector(UP, -8));
    },

    /**
     * Draw the selected feed into its target. Must be called before the main pass;
     * `reveal` toggles the exterior pod model, which is hidden the rest of the time.
     */
    render(renderer, scene, dt, { reveal = null } = {}) {
      acc += dt;
      if (power < 0.5 || this.feedKey === 'off') return false;
      if (acc < 1 / fps) return false;
      acc = 0;

      if (reveal) reveal.visible = true;
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, cameras[this.feedKey]);
      renderer.setRenderTarget(prevTarget);
      if (reveal) reveal.visible = false;
      return true;
    },

    update(dt, { live, depth, speed, heading }) {
      power += ((live ? 1 : 0) - power) * Math.min(1, dt * 6);
      const on = power > 0.5 && this.feedKey !== 'off';
      dead.visible = !on;
      video.visible = on;
      overlayMesh.visible = power > 0.2;
      overlay.draw(
        on ? FEEDS[index].label : 'FEED OFF',
        on
          ? [`DEPTH ${Math.max(0, depth).toFixed(1)}M`, `HDG ${heading.toFixed(0)}  V ${speed.toFixed(1)}M/S`]
          : [],
        on,
      );
    },
  };
}
