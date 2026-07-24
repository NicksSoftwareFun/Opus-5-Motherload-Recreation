import * as THREE from 'three';
import { RENDER, PALETTE } from '../config.js';
import { panelTexture, hazardTexture, toTexture } from './texlib.js';

/**
 * The cockpit interior.
 *
 * It lives in its own scene, drawn as a second pass over the world with the depth
 * buffer cleared. That is what lets the cabin be a believable one-person space while
 * the pod itself is barely wider than the 1 m tunnel it bores — the interior can
 * never clip into rock, and the mine can stay claustrophobically tight.
 *
 * Layout, in metres, with the pilot's eye at the origin looking down -Z:
 *
 *      overhead panel  y +0.44           <- depth & cash readout, warning lamps
 *      header          y +0.30
 *      ---- canopy aperture: x +/-0.50, y -0.17..+0.24, at z -0.45 ----
 *      dashboard       y -0.30, tilted   <- gauges, terminal, switch bank
 *      side consoles   x +/-0.52         <- monitor feed, breakers
 *
 * Everything the player reads is mounted on one of those surfaces. Nothing is drawn
 * in screen space.
 */

const FRAME = 0.055;

/** Convenience: a box with position and rotation in one call. */
function box(w, h, d, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name = '' } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  if (name) mesh.name = name;
  return mesh;
}

/** A cylinder spanning two points — used for the drill boom's support struts. */
function strut(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function makeMaterials() {
  // Deliberately desaturated: the cabin is grey machinery so that the instruments,
  // the hazard tape and the ore outside are the only saturated things in frame.
  const hull = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#4c4e4b', seed: 3, bolts: 5, grime: 0.7 })),
    roughness: 0.85,
    metalness: 0.22,
  });
  const hullDark = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#2c2e2c', seed: 11, grime: 0.9, scratches: 26 })),
    roughness: 0.9,
    metalness: 0.18,
  });
  const frame = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#6e706c', seed: 17, bolts: 7, grime: 0.45 })),
    roughness: 0.7,
    metalness: 0.45,
  });
  const hazard = new THREE.MeshStandardMaterial({
    map: toTexture(hazardTexture(), { repeat: [14, 1] }),
    color: 0x6e6e6e,
    roughness: 0.9,
    metalness: 0.12,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14150f, roughness: 1.0, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8f948c, roughness: 0.42, metalness: 0.85 });
  const drillSteel = new THREE.MeshStandardMaterial({ color: 0xb0b4ac, roughness: 0.34, metalness: 0.95 });
  return { hull, hullDark, frame, hazard, rubber, steel, drillSteel };
}

export function createCockpit() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(RENDER.FOV, 1, 0.008, 8);
  const root = new THREE.Group();
  scene.add(root);
  // The camera is part of the graph so things parented to it (the drill boom, the
  // sight) are drawn. The cabin is fixed to the pod; the camera is the pilot's head
  // turning inside it, which is how the side consoles become reachable at all.
  scene.add(camera);

  const mat = makeMaterials();

  // --- Shell ---------------------------------------------------------------
  const shell = new THREE.Group();
  shell.name = 'shell';
  root.add(shell);

  shell.add(box(1.42, 0.05, 1.18, mat.hullDark, { y: -0.66, z: -0.03, name: 'floor' }));
  shell.add(box(1.42, 1.20, 0.06, mat.hullDark, { y: -0.05, z: 0.46, name: 'bulkhead' }));
  shell.add(box(1.42, 0.06, 1.18, mat.hullDark, { y: 0.60, z: -0.03, name: 'ceiling' }));

  for (const side of [-1, 1]) {
    shell.add(box(0.06, 1.22, 1.10, mat.hull, { x: side * 0.69, y: -0.03, z: -0.02, name: 'wall' }));
    // Structural ribs. Three per side is enough to read as a pressure hull.
    for (let i = 0; i < 3; i++) {
      shell.add(box(0.035, 1.16, 0.05, mat.frame, { x: side * 0.655, y: -0.03, z: -0.34 + i * 0.32 }));
    }
    // Conduit runs along the roof line.
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 8), mat.rubber);
    conduit.rotation.x = Math.PI / 2;
    conduit.position.set(side * 0.60, 0.52, -0.02);
    shell.add(conduit);
  }

  // --- Canopy frame --------------------------------------------------------
  const canopy = new THREE.Group();
  canopy.name = 'canopy';
  root.add(canopy);

  canopy.add(box(1.46, 0.17, 0.13, mat.frame, { y: 0.325, z: -0.44, name: 'header' }));
  for (const side of [-1, 1]) {
    canopy.add(box(0.14, 0.62, 0.12, mat.frame, { x: side * 0.575, y: 0.03, z: -0.44, rz: side * 0.05 }));
    // Corner gussets, the small triangular plates every real machine has.
    canopy.add(box(0.10, 0.10, 0.10, mat.frame, { x: side * 0.50, y: 0.22, z: -0.44, rz: side * 0.78 }));
  }
  // Hazard tape along the sill: the one bright thing in the pilot's lower view.
  canopy.add(box(1.40, 0.035, 0.08, mat.hazard, { y: -0.183, z: -0.432, name: 'sillTape' }));

  // --- Dashboard -----------------------------------------------------------
  // Tilted back toward the pilot so the whole surface is readable with a glance
  // down rather than a full head drop.
  const dash = new THREE.Group();
  dash.name = 'dash';
  // Placed so the terminal centre sits ~35 degrees below the horizon: far enough
  // down to be out of the way of the rock, close enough that consulting it is a
  // glance rather than a full head drop.
  dash.position.set(0, -0.245, -0.345);
  dash.rotation.x = -0.80;
  root.add(dash);
  dash.add(box(1.36, 0.36, 0.05, mat.hull, { name: 'dashPanel' }));
  dash.add(box(1.40, 0.04, 0.075, mat.frame, { y: -0.19, name: 'dashLip' }));

  // Knee bolster below the dash, closing the gap down to the floor.
  root.add(box(1.30, 0.30, 0.05, mat.hullDark, { y: -0.52, z: -0.12, rx: -0.30 }));

  // --- Overhead panel ------------------------------------------------------
  const overhead = new THREE.Group();
  overhead.name = 'overhead';
  overhead.position.set(0, 0.455, -0.26);
  overhead.rotation.x = 0.88;
  root.add(overhead);
  overhead.add(box(1.14, 0.30, 0.045, mat.hull, { name: 'overheadPanel' }));
  overhead.add(box(1.18, 0.035, 0.07, mat.frame, { y: -0.16 }));

  // --- Side consoles -------------------------------------------------------
  // Angled to face the pilot, so operating them is a deliberate turn of the head.
  const consoles = {};
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(side * 0.545, -0.16, -0.10);
    // Negated against `side`: the panel's face has to turn *inward*, toward the
    // pilot. Rotating it the other way pointed both consoles at the hull.
    g.rotation.set(0.16, -side * 0.95, 0);
    root.add(g);
    g.add(box(0.42, 0.44, 0.05, mat.hull, { name: 'consolePanel' }));
    g.add(box(0.46, 0.035, 0.075, mat.frame, { y: -0.235 }));
    consoles[side < 0 ? 'left' : 'right'] = g;
  }

  // --- Seat ----------------------------------------------------------------
  root.add(box(0.52, 0.09, 0.44, mat.rubber, { y: -0.60, z: 0.20 }));
  root.add(box(0.52, 0.60, 0.10, mat.rubber, { y: -0.28, z: 0.42, rx: 0.10 }));
  for (const side of [-1, 1]) {
    root.add(box(0.05, 0.05, 0.40, mat.steel, { x: side * 0.22, y: -0.645, z: 0.20 }));
  }

  // --- Drill boom ----------------------------------------------------------
  // Sits low in the aperture so it frames the view instead of blocking it, and it
  // points wherever the pilot looks — the drill and the crosshair are one thing.
  const drill = new THREE.Group();
  drill.name = 'drill';
  // Parented to the camera, not the cabin: the boom follows the pilot's gaze, so
  // the sight and the bit are always the same thing. Sits low enough that the
  // housing tucks behind the sill and only the bit is visible ahead of the canopy.
  drill.position.set(0, -0.29, -0.44);
  camera.add(drill);

  // Two struts running out from the sill to a housing ahead of the canopy. A drill
  // aimed straight down the view axis is otherwise just a circle; the struts are
  // what make it read as a boom reaching out in front of the pod.
  for (const side of [-1, 1]) {
    drill.add(strut(
      new THREE.Vector3(side * 0.30, 0.02, 0.02),
      new THREE.Vector3(side * 0.055, -0.02, -0.30),
      0.018, mat.steel,
    ));
  }
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.085, 0.15), mat.hull);
  housing.position.z = -0.32;
  drill.add(housing);
  drill.add(box(0.13, 0.022, 0.05, mat.hazard, { y: 0.052, z: -0.32 }));

  // Work lamps either side of the bit. Without them the drill is a silhouette
  // against its own headlight pool — backlit by the very rock it is cutting.
  const lampLens = new THREE.MeshStandardMaterial({
    color: 0xfff0d0, emissive: 0xffdda0, emissiveIntensity: 2.4, roughness: 0.3,
  });
  for (const side of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8), lampLens);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(side * 0.048, 0.012, -0.395);
    drill.add(lens);
  }

  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 10), mat.steel);
  boom.rotation.x = Math.PI / 2;
  boom.position.z = -0.44;
  drill.add(boom);

  const spinner = new THREE.Group();
  spinner.position.z = -0.50;
  drill.add(spinner);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.20, 8), mat.drillSteel);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.10;
  spinner.add(shaft);
  // Auger flights: stacked, progressively smaller cones read as a bit at this size.
  for (let i = 0; i < 4; i++) {
    const flight = new THREE.Mesh(
      new THREE.ConeGeometry(0.062 - i * 0.008, 0.07, 6, 1, true),
      mat.drillSteel,
    );
    flight.rotation.x = -Math.PI / 2;
    flight.rotation.z = i * 0.8;
    flight.position.z = -0.06 - i * 0.05;
    spinner.add(flight);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 6), mat.drillSteel);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.29;
  spinner.add(tip);

  // --- Canopy glass --------------------------------------------------------
  // Barely there, but it catches the cabin lights and puts a surface between the
  // pilot and the mine, which the view badly needs at the surface.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.06, 0.44),
    new THREE.MeshPhysicalMaterial({
      color: 0xbfd4d0,
      transparent: true,
      opacity: 0.055,
      roughness: 0.12,
      metalness: 0,
      transmission: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.position.set(0, 0.035, -0.455);
  glass.name = 'glass';
  root.add(glass);

  // --- Cabin lighting ------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x6a6b68, 0x100e0b, 0.5);
  scene.add(hemi);

  const cabinLamp = new THREE.PointLight(0xffd0a0, 2.6, 3.0, 2);
  cabinLamp.position.set(0, 0.50, 0.06);
  scene.add(cabinLamp);

  // Instruments cast a little green up onto the pilot's side of the dash. Kept low
  // — enough to tint the bezels, not enough to make the whole cabin look radioactive.
  const instrumentGlow = new THREE.PointLight(PALETTE.phosphor, 0.30, 0.85, 2);
  instrumentGlow.position.set(0, -0.24, -0.18);
  scene.add(instrumentGlow);

  // Daylight through the canopy. Driven by depth in update(), so the cabin visibly
  // loses the sun as you descend and the instruments take over.
  const daylight = new THREE.DirectionalLight(PALETTE.sun, 1.5);
  daylight.position.set(0.2, 0.6, -1);
  scene.add(daylight);

  // Bounce from the headlights hitting rock ahead — keeps the cabin from going
  // flat black once daylight is gone.
  const headlightBounce = new THREE.DirectionalLight(0xffc98a, 0.0);
  headlightBounce.position.set(0, -0.2, -1);
  scene.add(headlightBounce);

  // Spill from the drill's own work lamps, so the boom is lit from in front.
  const drillLamp = new THREE.PointLight(0xffe2b0, 1.5, 1.3, 2);
  drillLamp.position.set(0, -0.25, -0.80);
  scene.add(drillLamp);

  const state = {
    drillSpin: 0,
    sway: new THREE.Vector2(),
  };

  return {
    scene,
    camera,
    root,
    parts: { dash, overhead, consoles, drill, spinner, glass, canopy, shell },
    materials: mat,
    lights: { cabinLamp, instrumentGlow, daylight, headlightBounce, drillLamp, hemi },

    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },

    /**
     * @param {number} dt
     * @param {{depth:number, drilling:boolean, velocity:THREE.Vector3, power:number}} pod
     */
    update(dt, pod) {
      const depth = Math.max(0, pod.depth ?? 0);
      const sunlight = Math.max(0, 1 - depth / 12);
      daylight.intensity = 1.5 * sunlight * sunlight;
      headlightBounce.intensity = pod.lightsOn === false ? 0.05 : 0.34 * (1 - sunlight * 0.8);
      cabinLamp.intensity = (pod.power ?? 1) * 2.6;
      drillLamp.intensity = pod.lightsOn === false ? 0 : 1.5;
      instrumentGlow.intensity = (pod.power ?? 1) * 0.30;

      if (pod.drilling) {
        state.drillSpin += dt * 26;
        spinner.rotation.z = state.drillSpin;
        // Bit chatter: the whole boom judders while it is cutting.
        drill.position.x = (Math.random() - 0.5) * 0.006;
        drill.position.y = -0.29 + (Math.random() - 0.5) * 0.006;
      } else {
        state.drillSpin += dt * 1.2;
        spinner.rotation.z = state.drillSpin;
        drill.position.x *= 0.85;
        drill.position.y += (-0.29 - drill.position.y) * 0.2;
      }

      // The cabin lags the pod a little under acceleration — suspension travel.
      const v = pod.velocity;
      if (v) {
        state.sway.x += ((-v.x * 0.004) - state.sway.x) * Math.min(1, dt * 6);
        state.sway.y += ((-v.y * 0.003) - state.sway.y) * Math.min(1, dt * 6);
        root.position.x = THREE.MathUtils.clamp(state.sway.x, -0.02, 0.02);
        root.position.y = THREE.MathUtils.clamp(state.sway.y, -0.025, 0.025);
      }
    },
  };
}
