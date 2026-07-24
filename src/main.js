import * as THREE from 'three';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { createHeadTracking } from './core/headTracking.js';
import { createScene } from './render/scene.js';
import { createSurface } from './render/surface.js';
import { createBlockAtlas, createBlockMaterials } from './render/materials.js';
import { createCockpit } from './render/cockpit.js';
import { createDashboard } from './render/dashboard.js';
import { createInteraction } from './render/interaction.js';
import { createFX } from './render/fx.js';
import { createPodExterior } from './render/podExterior.js';
import { VoxelWorld } from './world/voxelWorld.js';
import { generateWorld } from './world/generator.js';
import { ChunkManager } from './world/chunkManager.js';
import { integrate, depthOf } from './player/physics.js';
import { Pod } from './player/pod.js';
import { Drill } from './player/drill.js';
import { Session, PHASE } from './game/session.js';
import { credits, SERVICE, UPGRADES, upgradeTier } from './game/economy.js';
import { createBase } from './render/base.js';
import { stationAt, STATIONS } from './game/stations.js';
import { hasSave, saveGame, loadGame, applyDiff } from './game/save.js';
import { AIR, BLOCKS } from './world/blocks.js';
import { WORLD, POD, PHYSICS, DEBUG } from './config.js';

/**
 * Entry point: builds the world, the pod and the cabin, and runs the loop.
 *
 * The one idea worth reading this file for is the look model. Mouse movement turns
 * the pilot's *head*, not the pod. Past a detent the pod follows your gaze and
 * catches up, which means small movements let you look around the cabin — at the
 * switch bank, at the terminal — while large ones steer. Without that split, the
 * side consoles would be permanently welded to the same spot on screen and none of
 * the diegetic interface would be reachable.
 */

const seed = 1337;

const view = createScene();
const input = new Input(view.renderer.domElement);
const tracker = createHeadTracking();

const surface = createSurface(seed);
view.scene.add(surface.group);

const base = createBase();
view.scene.add(base.group);

const world = new VoxelWorld();
const genInfo = generateWorld(world, seed);
if (DEBUG.enabled) console.log(`worldgen ${genInfo.ms.toFixed(0)}ms`);

const atlas = createBlockAtlas();
const materials = createBlockMaterials(atlas);
const chunks = new ChunkManager(world, atlas, materials);
view.scene.add(chunks.group);

const fx = createFX();
view.scene.add(fx.points);

// Only ever visible inside a camera feed's render target — see render/monitors.js.
const podExterior = createPodExterior();
view.scene.add(podExterior.group);

const cockpit = createCockpit();
const interaction = createInteraction(cockpit.camera);
const syncAspect = () => cockpit.resize(window.innerWidth / window.innerHeight);
syncAspect();
window.addEventListener('resize', syncAspect);

// --- Lighting rigs --------------------------------------------------------
// Headlights are bolted to the hull, so they follow the pod's heading. The boom
// lamp follows the pilot's aim, which is what lights whatever the drill is on even
// when you are cutting off to one side.
const headRig = new THREE.Object3D();
view.scene.add(headRig);
const aimRig = new THREE.Object3D();
view.scene.add(aimRig);

const headlights = [-1, 1].map((side) => {
  const lamp = new THREE.SpotLight(0xfff0cf, 11, 40, 0.72, 0.92, 0.85);
  lamp.position.set(side * 0.28, -0.12, -0.1);
  lamp.target.position.set(side * 0.9, -0.6, -9);
  headRig.add(lamp);
  headRig.add(lamp.target);
  return lamp;
});

const podFill = new THREE.PointLight(0xffd9b0, 1.5, 8, 1.1);
headRig.add(podFill);

const boomLamp = new THREE.SpotLight(0xffe6c0, 9, 14, 0.5, 0.8, 0.9);
boomLamp.position.set(0, 0, 0);
boomLamp.target.position.set(0, 0, -6);
aimRig.add(boomLamp);
aimRig.add(boomLamp.target);

// --- Game objects ---------------------------------------------------------
const pod = new Pod();
const drill = new Drill(world, chunks, pod);

const body = {
  position: new THREE.Vector3(WORLD.CENTER_X, 1.2, WORLD.CENTER_Z),
  velocity: new THREE.Vector3(),
  onGround: false,
  impactSpeed: 0,
  hitWall: false,
};

let lightsOn = true;
let drillClutch = true;
let manualPage = 0;
let station = null;
let mapOn = false;
let saveAvailable = hasSave();

/** Reset the world to pristine, then replay a saved diff over it if there is one. */
function resetWorld(diff = null) {
  generateWorld(world, seed);
  chunks.modified.clear();
  if (diff) {
    applyDiff(world, diff);
    for (let i = 0; i < diff.length; i += 2) chunks.modified.set(diff[i], diff[i + 1]);
  }
  // Everything that was meshed is now wrong; drop it and rebuild around the pod.
  for (const key of [...chunks.chunks.keys()]) chunks._unload(key);
  chunks.dirty.clear();
}

const session = new Session({
  pod,
  hasSave: () => saveAvailable,
  onStartRun: (fresh) => {
    if (fresh) {
      resetWorld();
      Object.assign(pod, new Pod());
      body.position.set(WORLD.CENTER_X, 1.0, WORLD.CENTER_Z);
    } else {
      const data = loadGame();
      if (data) {
        resetWorld(data.diff);
        Object.assign(pod, data.pod);
        body.position.set(...data.position);
      }
    }
    body.velocity.set(0, 0, 0);
    chunks.prime(body.position);
  },
});

const actions = {
  setPower: (on) => session.setPower(on),
  setLights: (on) => { lightsOn = on; },
  setDrillClutch: (on) => { drillClutch = on; },
  setMap: (on) => { mapOn = on; },
  jettison: () => {
    const lost = pod.jettisonCargo();
    session.post(lost > 0 ? `BAY PURGED — ${credits(lost)} LOST` : 'BAY ALREADY EMPTY');
  },
  setPage: (p) => { session.page = p; },
  setManualPage: (n) => { manualPage = (n + 3) % 3; },
  recentreTracker: () => {
    if (tracker.connected) {
      tracker.recentre();
      session.post('HEAD TRACKER RECENTRED');
    } else {
      tracker.reconnect();
      session.post('SEARCHING FOR TRACKER BRIDGE');
    }
  },
  startRun: (fresh) => session.startRun(fresh),

  buyFuel: (litres) => {
    const cost = Math.ceil(litres * SERVICE.FUEL_PER_LITRE);
    if (!pod.spend(cost)) return session.post('INSUFFICIENT CREDIT');
    const added = pod.refuel(litres);
    return session.post(`+${added.toFixed(0)}L — ${credits(cost)} CR`);
  },
  repairHull: (points) => {
    const cost = Math.ceil(points * SERVICE.REPAIR_PER_POINT);
    if (!pod.spend(cost)) return session.post('INSUFFICIENT CREDIT');
    const done = pod.repair(points);
    return session.post(`+${done.toFixed(0)} PLATING — ${credits(cost)} CR`);
  },
  sellAll: () => {
    const units = pod.cargoUnits;
    const total = pod.sellCargo();
    session.post(total > 0 ? `${units}U ASSAYED — ${credits(total)} CR` : 'BAY EMPTY');
  },
  buyUpgrade: (key) => {
    const level = pod.upgradeLevel(key);
    const next = upgradeTier(key, level + 1);
    if (!next || level >= 5) return session.post('ALREADY AT MAXIMUM SPEC');
    if (!pod.spend(next.cost)) return session.post('INSUFFICIENT CREDIT');
    pod.applyUpgrade(key);
    return session.post(`FITTED: ${next.name.toUpperCase()}`);
  },
  saveGame: () => {
    const result = saveGame({
      seed,
      pod,
      position: body.position,
      modified: chunks.modified,
      deepest: pod.deepestDepth,
    });
    saveAvailable = result.ok;
    session.post(
      result.ok
        ? `TRANSMITTED — ${result.blocks} EDITS, ${(result.bytes / 1024).toFixed(1)} KB`
        : 'TRANSMISSION FAILED',
    );
  },
};

const dashboard = createDashboard({ cockpit, pod, session, interaction, actions, world });

// --- Look model -----------------------------------------------------------
let podYaw = 0;
/** Head starts turned slightly left so the standby lamp is in view on a cold start. */
let headYaw = 0.40;
let headPitch = -0.10;
let shake = 0;

const HEAD_YAW_LIMIT = 1.95;
const HEAD_PITCH_LIMIT = 1.15;
const FOLLOW_DEADZONE = 0.45;
/** Wider detent when idle, so a turned head only unwinds if you look right round. */
const FOLLOW_IDLE_DEADZONE = 1.45;
const FOLLOW_RATE = 5.0;

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const lean = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const aimDir = new THREE.Vector3();

chunks.prime(body.position);

function update(dt, elapsed) {
  // --- Look ---
  const look = input.consumeLook();
  headYaw = THREE.MathUtils.clamp(headYaw - look.dx, -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT);
  headPitch = THREE.MathUtils.clamp(headPitch - look.dy, -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT);

  // Past the detent, the pod turns to bring your gaze back to centre — but only
  // while you are actually flying it. Standing still, your head stays where you put
  // it, which is what makes the side consoles usable: park, look right, work the
  // feed knob, look back. With the follow always on, every panel you turned to read
  // would slide back to the middle of the canopy before you could click anything.
  const steering = input.isDown('KeyW') || input.isDown('KeyS')
    || input.isDown('KeyA') || input.isDown('KeyD')
    || input.isDown('Space') || input.isDown('ControlLeft') || input.isDown('ShiftLeft')
    || input.primaryDown;
  const deadzone = steering ? FOLLOW_DEADZONE : FOLLOW_IDLE_DEADZONE;
  const excess = headYaw - THREE.MathUtils.clamp(headYaw, -deadzone, deadzone);
  const turn = excess * Math.min(1, dt * (steering ? FOLLOW_RATE : FOLLOW_RATE * 0.35));
  podYaw += turn;
  headYaw -= turn;

  // Head tracking rides on top of the mouse look: the tracker moves the pilot's
  // head inside the cabin, the mouse still steers the pod. The follow detent above
  // reads only the mouse component, so leaning never spins the pod.
  tracker.update(dt);
  if (input.wasPressed('F9')) tracker.recentre();
  const trk = tracker.pose;
  const lookYaw = headYaw + trk.yaw;
  const lookPitch = THREE.MathUtils.clamp(headPitch + trk.pitch, -1.35, 1.35);

  const viewYaw = podYaw + lookYaw;
  cockpit.camera.rotation.set(lookPitch, lookYaw, trk.roll, 'YXZ');
  // Positional lean gives real parallax against the canopy frame and the consoles.
  cockpit.camera.position.set(trk.x, trk.y, -trk.z);
  cockpit.camera.updateMatrixWorld(true);

  // --- Crosshair interaction ---
  interaction.update(dt);
  if (input.primaryPressed) interaction.activate();

  const live = session.systemsLive;

  // --- Thrust ---
  forward.set(-Math.sin(podYaw), 0, -Math.cos(podYaw));
  right.set(Math.cos(podYaw), 0, -Math.sin(podYaw));

  const drive = live ? input.axis('KeyS', 'KeyW') : 0;
  const strafe = live ? input.axis('KeyA', 'KeyD') : 0;
  const lift = live
    ? (input.isDown('Space') ? 1 : 0)
      - (input.isDown('ControlLeft') || input.isDown('ShiftLeft') ? 1 : 0)
    : 0;

  const powered = live && pod.fuel > 0;
  const thrusting = powered && (lift > 0 || drive !== 0 || strafe !== 0);
  if (powered) {
    const lateral = POD.BASE_LATERAL * pod.thrustScale;
    body.velocity.addScaledVector(forward, drive * lateral * dt);
    body.velocity.addScaledVector(right, strafe * lateral * dt);
    if (lift > 0) body.velocity.y += POD.BASE_THRUST_UP * pod.thrustScale * dt;
    else if (lift < 0) body.velocity.y -= lateral * 0.6 * dt;
  }

  integrate(world, body, dt, { terrainHeightAt: surface.heightAt });

  if (body.impactSpeed > PHYSICS.FALL_SAFE_SPEED) {
    const over = body.impactSpeed - PHYSICS.FALL_SAFE_SPEED;
    pod.damage(over * PHYSICS.FALL_DAMAGE_PER_MS);
    shake = Math.min(1, shake + over * 0.06);
    fx.impactDust(body.position, over);
  }

  // --- Drill ---
  aimDir.set(
    -Math.sin(viewYaw) * Math.cos(lookPitch),
    Math.sin(lookPitch),
    -Math.cos(viewYaw) * Math.cos(lookPitch),
  );
  const wantDrill = input.primaryDown && live && drillClutch && !interaction.blockingDrill;
  const result = drill.update(dt, {
    origin: body.position,
    direction: aimDir,
    wantDrill,
    elapsed,
  });

  if (result.cutting && drill.target) {
    const t = drill.target;
    fx.drillSpray(
      dt,
      { x: t.vx + 0.5, y: -t.vy - 0.5, z: t.vz + 0.5 },
      t.normal,
      BLOCKS[t.id].color,
    );
    shake = Math.min(0.30, shake + dt * 0.8);
  }
  if (result.broke) {
    fx.blockBurst(result.broke.position, result.broke.color, result.broke.ore);
    shake = Math.min(0.6, shake + 0.10);
    if (result.broke.ore) {
      session.post(
        result.broke.stowed
          ? `${result.broke.name.toUpperCase()} STOWED — ${credits(result.broke.value)}`
          : `BAY FULL — ${result.broke.name.toUpperCase()} LOST`,
        2.4,
      );
    }
  }

  if (live) pod.update(dt, { thrusting, drilling: drill.active });
  fx.update(dt);
  session.update(dt);

  const depth = depthOf(body.position);
  pod.deepestDepth = Math.max(pod.deepestDepth, depth);

  // --- Cameras and rigs ---
  shake = Math.max(0, shake - dt * 1.8);
  // The lean is in cabin space, so rotate it into the world before applying it.
  lean.set(trk.x, trk.y, -trk.z).applyAxisAngle(UP, viewYaw);
  view.camera.position.copy(body.position).add(lean);
  if (shake > 0.001) {
    view.camera.position.x += (Math.random() - 0.5) * shake * 0.06;
    view.camera.position.y += (Math.random() - 0.5) * shake * 0.06;
  }
  view.camera.rotation.set(
    lookPitch, viewYaw, trk.roll + (Math.random() - 0.5) * shake * 0.02, 'YXZ',
  );

  headRig.position.copy(body.position);
  headRig.rotation.set(0, podYaw, 0, 'YXZ');
  aimRig.position.copy(body.position);
  aimRig.rotation.set(lookPitch, viewYaw, 0, 'YXZ');
  for (const lamp of headlights) lamp.intensity = lightsOn && live ? 11 : 0;
  podFill.intensity = lightsOn && live ? 1.5 : 0.25;
  boomLamp.intensity = lightsOn && live ? 9 : 0;

  view.setDepth(depth);
  surface.update(dt, body.position);
  base.update(dt);

  // Docking is proximity: land on a pad and the terminal becomes that vendor's
  // console. Leaving the pad hands the tube back to the status page.
  const nowStation = live ? stationAt(body.position) : null;
  if (nowStation !== station) {
    station = nowStation;
    if (station) {
      session.page = station.page;
      session.post(`UPLINK ESTABLISHED — ${station.name}`);
    } else if (session.page.startsWith('vendor:')) {
      session.page = 'status';
    }
  }

  // Exterior model and hull cameras track the body; the model stays hidden until a
  // feed is actually being rendered.
  podExterior.sync(body.position, podYaw, dt);
  dashboard.monitors.aim({ position: body.position, podYaw, aimDir });

  const speed = -body.velocity.y;
  const uiState = {
    pod, session, drill, depth, speed, time: elapsed,
    podYaw,
    podPosition: body.position,
    modified: chunks.modified,
    mapOn,
    manualPage,
    station,
    tracker,
    upgrades: UPGRADES,
    prices: { fuel: SERVICE.FUEL_PER_LITRE, repair: SERVICE.REPAIR_PER_POINT },
    hasSave: saveAvailable,
    actions,
  };
  dashboard.update(dt, uiState);
  cockpit.update(dt, {
    depth,
    drilling: drill.active,
    velocity: body.velocity,
    power: session.power ? 1 : 0,
    lightsOn: lightsOn && live,
  });
}

function render(dt) {
  chunks.update(body.position);
  const r = view.renderer;
  // Camera feeds first, into their own target, with the pod's exterior revealed.
  dashboard.monitors.render(r, view.scene, dt, { reveal: podExterior.group });
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
  version: '0.5.0',
  three: THREE.REVISION,
  loop,
  view,
  cockpit,
  dashboard,
  interaction,
  headlights,
  world,
  chunks,
  body,
  pod,
  drill,
  session,
  tracker,
  podExterior,
  base,
  stations: STATIONS,
  fx,
  input,
  genInfo,
  PHASE,

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

  /** Aim the head. Yaw is relative to the pod; positive is to the left. */
  look(yawValue, pitchValue, { pod: podYawValue = null } = {}) {
    headYaw = yawValue;
    headPitch = pitchValue;
    if (podYawValue !== null) podYaw = podYawValue;
  },

  /** Skip the cold-start ceremony: throw the master switch and take the menu option. */
  boot(startRun = true) {
    dashboard.switches.power.setState(true);
    session.setPower(true);
    session.bootTime = 999;
    session.update(0.001);
    if (startRun) session.startRun(true);
  },

  /**
   * Advance the simulation by N seconds without rendering. Software rendering runs
   * at a fraction of real time, so capture scenarios step the fixed timestep
   * directly rather than racing the wall clock.
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
