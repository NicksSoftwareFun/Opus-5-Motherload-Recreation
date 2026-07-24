import * as THREE from 'three';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { createScene } from './render/scene.js';
import { createSurface } from './render/surface.js';
import { createBlockAtlas, createBlockMaterials } from './render/materials.js';
import { createCockpit } from './render/cockpit.js';
import { VoxelWorld } from './world/voxelWorld.js';
import { generateWorld } from './world/generator.js';
import { ChunkManager } from './world/chunkManager.js';
import { integrate, depthOf } from './player/physics.js';
import { AIR } from './world/blocks.js';
import { WORLD, POD, DEBUG } from './config.js';

/**
 * Entry point.
 *
 * Phase 2 flies a bare pod through a real voxel mine. The cockpit, drill and
 * instrumentation land in the phases that follow; for now the camera sits where the
 * pilot's head will be.
 */

const seed = 1337;

const view = createScene();
const input = new Input(view.renderer.domElement);

const surface = createSurface(seed);
view.scene.add(surface.group);

const world = new VoxelWorld();
const genInfo = generateWorld(world, seed);
if (DEBUG.enabled) console.log(`worldgen ${genInfo.ms.toFixed(0)}ms`);

const atlas = createBlockAtlas();
const materials = createBlockMaterials(atlas);
const chunks = new ChunkManager(world, atlas, materials);
view.scene.add(chunks.group);

const cockpit = createCockpit();
cockpit.resize(window.innerWidth / window.innerHeight);
window.addEventListener('resize', () => cockpit.resize(window.innerWidth / window.innerHeight));

// Headlights ride on a rig that copies the pod's orientation, so the beam always
// goes where the pilot is looking. Underground they are the only light there is.
const headRig = new THREE.Object3D();
view.scene.add(headRig);

const headlights = [-1, 1].map((side) => {
  const lamp = new THREE.SpotLight(0xfff0cf, 42, 40, 0.72, 0.92, 1.3);
  lamp.position.set(side * 0.28, -0.12, -0.1);
  lamp.target.position.set(side * 0.9, -0.6, -9);
  headRig.add(lamp);
  headRig.add(lamp.target);
  return lamp;
});

// A short-range fill so the rock immediately around the pod is never pure black —
// the spots alone leave the walls beside you invisible in a 1 m shaft.
const podFill = new THREE.PointLight(0xffd9b0, 3.2, 7, 1.8);
headRig.add(podFill);

const body = {
  position: new THREE.Vector3(WORLD.CENTER_X, 1.2, WORLD.CENTER_Z),
  velocity: new THREE.Vector3(),
  onGround: false,
  impactSpeed: 0,
  hitWall: false,
};

let yaw = 0;
let pitch = -0.12;

const forward = new THREE.Vector3();
const right = new THREE.Vector3();

chunks.prime(body.position);

function update(dt) {
  const look = input.consumeLook();
  yaw -= look.dx;
  pitch = THREE.MathUtils.clamp(pitch - look.dy, -1.35, 1.35);

  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  const drive = input.axis('KeyS', 'KeyW');
  const strafe = input.axis('KeyA', 'KeyD');
  const lift = (input.isDown('Space') ? 1 : 0) - (input.isDown('ControlLeft') || input.isDown('ShiftLeft') ? 1 : 0);

  body.velocity.addScaledVector(forward, drive * POD.BASE_LATERAL * dt);
  body.velocity.addScaledVector(right, strafe * POD.BASE_LATERAL * dt);
  if (lift > 0) body.velocity.y += POD.BASE_THRUST_UP * dt;
  else if (lift < 0) body.velocity.y -= POD.BASE_LATERAL * 0.6 * dt;

  integrate(world, body, dt, { terrainHeightAt: surface.heightAt });

  view.camera.position.copy(body.position);
  view.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  headRig.position.copy(body.position);
  headRig.rotation.copy(view.camera.rotation);

  const depth = depthOf(body.position);
  view.setDepth(depth);
  surface.update(dt, body.position);
  cockpit.update(dt, { depth, drilling: input.primaryDown, velocity: body.velocity, power: 1 });
}

function render() {
  chunks.update(body.position);
  const r = view.renderer;
  r.autoClear = true;
  r.render(view.scene, view.camera);
  // Second pass: the cabin, over a cleared depth buffer. See render/cockpit.js.
  r.autoClear = false;
  r.clearDepth();
  r.render(cockpit.scene, cockpit.camera);
  r.autoClear = true;
  input.endFrame();
}

const loop = new Loop({ update, render });
loop.start();

/** Debug + test surface. The screenshot harness drives the game through this. */
window.__MOTHERLOAD__ = {
  ready: true,
  version: '0.2.0',
  three: THREE.REVISION,
  loop,
  view,
  cockpit,
  headlights,
  world,
  chunks,
  body,
  input,
  genInfo,

  /** Drop the pod to a depth, carving a shaft above it so it does not clip in. */
  teleport(depth) {
    const cx = Math.floor(WORLD.CENTER_X);
    const cz = Math.floor(WORLD.CENTER_Z);
    for (let vy = 0; vy <= Math.min(WORLD.H - 4, Math.floor(depth) + 1); vy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) chunks.setBlock(cx + dx, vy, cz + dz, AIR);
      }
    }
    body.position.set(WORLD.CENTER_X, -depth, WORLD.CENTER_Z);
    body.velocity.set(0, 0, 0);
    chunks.prime(body.position);
  },

  look(y, p) {
    yaw = y;
    pitch = p;
  },
};
