import * as THREE from 'three';
import { canvas2d, toTexture } from './texlib.js';

/**
 * Crosshair interaction.
 *
 * There is exactly one pointer in this game and it is the middle of the screen.
 * Aim it at rock and the left button drills; aim it at a switch or a screen region
 * and the same button operates that instead. Pointer lock is therefore never
 * released, and the diegetic menus need no cursor mode to be usable.
 *
 * The reticle is the drill's own optical sight, mounted on the boom, so even the
 * crosshair is a physical object rather than an overlay.
 */

function reticleTexture() {
  const { canvas, ctx } = canvas2d(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(210,255,200,0.85)';
  ctx.lineWidth = 2;
  // Four ticks and a gap in the middle: never obscure what you are aiming at.
  for (const [x0, y0, x1, y1] of [
    [64, 22, 64, 44], [64, 84, 64, 106], [22, 64, 44, 64], [84, 64, 106, 64],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(64, 64, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(210,255,200,0.9)';
  ctx.fill();
  return canvas;
}

function bracketTexture() {
  const { canvas, ctx } = canvas2d(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,196,80,0.95)';
  ctx.lineWidth = 4;
  const s = 30;
  const c = [[14, 14, 1, 1], [114, 14, -1, 1], [14, 114, 1, -1], [114, 114, -1, -1]];
  for (const [x, y, dx, dy] of c) {
    ctx.beginPath();
    ctx.moveTo(x + dx * s, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * s);
    ctx.stroke();
  }
  return canvas;
}

export function createInteraction(camera) {
  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);

  /** Registered targets: { mesh, kind, control?, screen?, onClick? } */
  const targets = [];
  const meshes = [];

  // Sight and hover bracket ride on the camera, so they are always dead centre.
  const sight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.030, 0.030),
    new THREE.MeshBasicMaterial({
      map: toTexture(reticleTexture()), transparent: true, depthTest: false, toneMapped: false,
    }),
  );
  sight.position.set(0, 0, -0.30);
  sight.renderOrder = 500;
  camera.add(sight);

  const bracket = new THREE.Mesh(
    new THREE.PlaneGeometry(0.040, 0.040),
    new THREE.MeshBasicMaterial({
      map: toTexture(bracketTexture()), transparent: true, depthTest: false, toneMapped: false,
    }),
  );
  bracket.position.set(0, 0, -0.30);
  bracket.renderOrder = 501;
  bracket.visible = false;
  camera.add(bracket);

  let hovered = null;
  let hoveredRegion = null;
  let pulse = 0;

  return {
    sight,
    bracket,

    register(mesh, entry) {
      targets.push({ mesh, ...entry });
      meshes.push(mesh);
    },

    unregisterAll() {
      targets.length = 0;
      meshes.length = 0;
    },

    get hovered() { return hovered; },
    get hoveredRegion() { return hoveredRegion; },
    /** True when the crosshair is on cabin hardware, so the drill must hold fire. */
    get blockingDrill() { return hovered !== null; },

    update(dt) {
      raycaster.setFromCamera(center, camera);
      const hits = raycaster.intersectObjects(meshes, false);

      const previous = hovered;
      hovered = null;
      hoveredRegion = null;

      if (hits.length) {
        const hit = hits[0];
        const entry = targets.find((t) => t.mesh === hit.object);
        if (entry) {
          if (entry.kind === 'screen' && hit.uv) {
            const region = entry.screen.regionAt(hit.uv.x, hit.uv.y);
            entry.screen.hover = region ? region.id : null;
            // Only count the screen as hovered where something is clickable, so
            // reading a status page does not disarm the drill.
            if (region) {
              hovered = entry;
              hoveredRegion = region;
            }
          } else if (entry.kind !== 'screen') {
            hovered = entry;
          }
        }
      }

      // Clear stale hover highlight on whatever we just left.
      if (previous && previous !== hovered) {
        previous.control?.setHighlight(false);
        if (previous.kind === 'screen') previous.screen.hover = null;
      }
      hovered?.control?.setHighlight(true);

      pulse += dt * 5;
      bracket.visible = hovered !== null;
      if (bracket.visible) {
        const s = 1 + Math.sin(pulse) * 0.05;
        bracket.scale.set(s, s, 1);
      }
      sight.material.opacity = hovered ? 0.35 : 1;
      sight.material.transparent = true;
    },

    /** Fire whatever the crosshair is on. Returns true if something was operated. */
    activate() {
      if (!hovered) return false;
      if (hovered.kind === 'screen') {
        hoveredRegion?.onClick?.(hoveredRegion.id);
        return true;
      }
      hovered.onClick?.(hovered);
      return true;
    },
  };
}
