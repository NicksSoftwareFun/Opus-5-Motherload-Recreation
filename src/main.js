import * as THREE from 'three';
import { Loop } from './core/loop.js';
import { createScene } from './render/scene.js';
import { createSurface } from './render/surface.js';
import { WORLD } from './config.js';

/**
 * Entry point. Phase 1 wires the renderer, the Martian surface and the fixed-step
 * loop together with a slow survey camera so the environment can be inspected;
 * the pod, cockpit and voxel mine take this over in the phases that follow.
 */

const seed = 1337;
const view = createScene();
const surface = createSurface(seed);
view.scene.add(surface.group);

const lookAt = new THREE.Vector3(WORLD.CENTER_X, -6, WORLD.CENTER_Z);
let orbit = 0;

const loop = new Loop({
  update(dt) {
    orbit += dt * 0.07;
    const r = 96;
    view.camera.position.set(
      WORLD.CENTER_X + Math.cos(orbit) * r,
      26 + Math.sin(orbit * 0.6) * 8,
      WORLD.CENTER_Z + Math.sin(orbit) * r,
    );
    view.camera.lookAt(lookAt);
    view.setDepth(-view.camera.position.y);
    surface.update(dt, view.camera.position);
  },
  render() {
    view.renderer.render(view.scene, view.camera);
  },
});

loop.start();

window.__MOTHERLOAD__ = {
  ready: true,
  version: '0.1.0',
  three: THREE.REVISION,
  loop,
  view,
  surface,
};
