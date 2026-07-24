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
import { Pod } from './player/pod.js';
import { Drill } from './player/drill.js';
import { createFX } from './render/fx.js';
import { AIR, BLOCKS } from './world/blocks.js';
import { WORLD, POD, PHYSICS, DEBUG } from './config.js';

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

// Shallow decay on purpose. A physically correct inverse square blows out the wall
// of a 1 m shaft — which is where the pod spends nearly all of its life — while
// still leaving a cavern ten metres off pitch black. A gentler falloff keeps both
// legible, and the fog handles the sense of distance instead.
const headlights = [-1, 1].map((side) => {
  const lamp = new THREE.SpotLight(0xfff0cf, 11, 40, 0.72, 0.92, 0.85);
  lamp.position.set(side * 0.28, -0.12, -0.1);
  lamp.target.position.set(side * 0.9, -0.6, -9);
  headRig.add(lamp);
  headRig.add(lamp.target);
  return lamp;
});

// A short-range fill so the rock immediately around the pod is never pure black —
// the spots alone leave the walls beside you invisible in a 1 m shaft.
const podFill = new THREE.PointLight(0xffd9b0, 1.5, 8, 1.1);
headRig.add(podFill);

const body = {
  position: new THREE.Vector3(WORLD.CENTER_X, 1.2, WORLD.CENTER_Z),
  velocity: new THREE.Vector3(),
  onGround: false,
  impactSpeed: 0,
  hitWall: false,
};

const pod = new Pod();
const drill = new Drill(world, chunks, pod);
const fx = createFX();
view.scene.add(fx.points);

let yaw = 0;
let pitch = -0.12;
let shake = 0;

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const eye = new THREE.Vector3();

chunks.prime(body.position);

function update(dt, elapsed) {
  const look = input.consumeLook();
  yaw -= look.dx;
  pitch = THREE.MathUtils.clamp(pitch - look.dy, -1.35, 1.35);

  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  const drive = input.axis('KeyS', 'KeyW');
  const strafe = input.axis('KeyA', 'KeyD');
  const lift = (input.isDown('Space') ? 1 : 0)
    - (input.isDown('ControlLeft') || input.isDown('ShiftLeft') ? 1 : 0);

  // No fuel, no thrust. Gravity still very much applies.
  const powered = pod.fuel > 0;
  const thrusting = powered && (lift > 0 || drive !== 0 || strafe !== 0);
  if (powered) {
    const lateral = POD.BASE_LATERAL * pod.thrustScale;
    body.velocity.addScaledVector(forward, drive * lateral * dt);
    body.velocity.addScaledVector(right, strafe * lateral * dt);
    if (lift > 0) body.velocity.y += POD.BASE_THRUST_UP * pod.thrustScale * dt;
    else if (lift < 0) body.velocity.y -= lateral * 0.6 * dt;
  }

  integrate(world, body, dt, { terrainHeightAt: surface.heightAt });

  // Landing damage. Below the safe speed the suspension takes it; above, the hull does.
  if (body.impactSpeed > PHYSICS.FALL_SAFE_SPEED) {
    const excess = body.impactSpeed - PHYSICS.FALL_SAFE_SPEED;
    pod.damage(excess * PHYSICS.FALL_DAMAGE_PER_MS);
    shake = Math.min(1, shake + excess * 0.06);
    fx.impactDust(body.position, excess);
  }

  // --- Drilling ---
  eye.copy(body.position);
  aimDir.set(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
  const result = drill.update(dt, {
    origin: eye,
    direction: aimDir,
    wantDrill: input.primaryDown,
    elapsed,
  });

  if (result.cutting && drill.target) {
    const t = drill.target;
    fx.drillSpray(
      dt,
      { x: t.vx + 0.5, y: -t.vy - 0.5, z: t.vz + 0.5 },
      { x: t.normal.x, y: t.normal.y, z: t.normal.z },
      BLOCKS[t.id].color,
    );
    shake = Math.min(0.35, shake + dt * 0.9);
  }
  if (result.broke) {
    fx.blockBurst(result.broke.position, result.broke.color, result.broke.ore);
    shake = Math.min(0.6, shake + 0.12);
  }

  pod.update(dt, { thrusting, drilling: drill.active });
  // Particles age on the simulation clock, not the render clock, so a headless
  // simulate() run does not accumulate six seconds of undecayed spoil.
  fx.update(dt);

  const depth = depthOf(body.position);
  pod.deepestDepth = Math.max(pod.deepestDepth, depth);

  shake = Math.max(0, shake - dt * 1.8);
  view.camera.position.copy(body.position);
  if (shake > 0.001) {
    view.camera.position.x += (Math.random() - 0.5) * shake * 0.06;
    view.camera.position.y += (Math.random() - 0.5) * shake * 0.06;
  }
  view.camera.rotation.set(pitch, yaw, (Math.random() - 0.5) * shake * 0.02, 'YXZ');
  headRig.position.copy(body.position);
  headRig.rotation.set(pitch, yaw, 0, 'YXZ');

  view.setDepth(depth);
  surface.update(dt, body.position);
  cockpit.update(dt, {
    depth,
    drilling: drill.active,
    velocity: body.velocity,
    power: 1,
  });
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
  pod,
  drill,
  fx,
  input,
  genInfo,

  /**
   * Drop the pod to a depth, carving a shaft above it so it does not clip in, and
   * set it down resting on the shaft floor. Landing it rather than dropping it
   * matters for the capture harness: under software rendering the pod would still
   * be in mid-air seconds later, with nothing in drill range.
   */
  teleport(depth) {
    const cx = Math.floor(WORLD.CENTER_X);
    const cz = Math.floor(WORLD.CENTER_Z);
    const bottom = Math.min(WORLD.H - 4, Math.floor(depth) + 1);
    for (let vy = 0; vy <= bottom; vy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) chunks.setBlock(cx + dx, vy, cz + dz, AIR);
      }
    }
    body.position.set(
      WORLD.CENTER_X,
      -(bottom + 1) + PHYSICS.POD_HALF_H + 0.02,
      WORLD.CENTER_Z,
    );
    body.velocity.set(0, 0, 0);
    chunks.prime(body.position);
  },

  look(y, p) {
    yaw = y;
    pitch = p;
  },

  /**
   * Advance the simulation by N seconds without rendering.
   *
   * Software rendering runs at a fraction of real time, so a capture that waits on
   * the wall clock gets a fraction of the simulation it asked for. Stepping the
   * fixed timestep directly makes scenarios both fast and deterministic.
   */
  simulate(seconds) {
    const steps = Math.round(seconds / loop.step);
    for (let i = 0; i < steps; i++) {
      update(loop.step, loop.elapsed);
      loop.elapsed += loop.step;
    }
    return steps;
  },
};
