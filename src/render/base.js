import * as THREE from 'three';
import { STATIONS, DOCK_RANGE } from '../game/stations.js';
import { panelTexture, hazardTexture, toTexture, canvas2d, STENCIL_FONT } from './texlib.js';

/**
 * The surface base: six installations around the shaft mouth, each with a landing
 * pad and a lit sign.
 *
 * Silhouette does the navigating. From the middle of the plaza you should be able
 * to tell the tank farm from the gantry from the dish without reading anything, so
 * every building is a different shape at a different height, and the signs are
 * emissive so they still read once the sun is behind the mesas.
 */

function makeMaterials() {
  const shell = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#787d74', seed: 41, bolts: 6, grime: 0.85 }), { repeat: [2, 2] }),
    roughness: 0.85, metalness: 0.3,
  });
  const shellDark = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#3d413a', seed: 47, grime: 1.0, scratches: 30 }), { repeat: [2, 2] }),
    roughness: 0.9, metalness: 0.25,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa09a, roughness: 0.45, metalness: 0.85 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 0.95, metalness: 0.1 });
  const hazard = new THREE.MeshStandardMaterial({
    map: toTexture(hazardTexture(), { repeat: [6, 1] }), roughness: 0.85, metalness: 0.2,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2a3a3a, roughness: 0.2, metalness: 0.6, emissive: 0x0a1412,
  });
  return { shell, shellDark, steel, rust, hazard, glass };
}

const box = (w, h, d, mat, x, y, z, rot = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rot.rx ?? 0, rot.ry ?? 0, rot.rz ?? 0);
  return m;
};

const cyl = (rt, rb, h, seg, mat, x, y, z, rot = {}) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rot.rx ?? 0, rot.ry ?? 0, rot.rz ?? 0);
  return m;
};

/** Illuminated sign board. Reads at distance and at dusk, which is always. */
function signBoard(text, sub, color, width = 6.4) {
  const { canvas, ctx } = canvas2d(512, 160);
  ctx.fillStyle = '#15170f';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 140);

  ctx.font = 'bold 56px "Arial Narrow", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  ctx.fillText(text, 256, 64);
  ctx.font = STENCIL_FONT;
  ctx.fillStyle = 'rgba(220,220,210,0.75)';
  ctx.fillText(sub, 256, 116);

  const tex = toTexture(canvas);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9,
    roughness: 0.8, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.3125), mat);
}

/** Landing pad: concentric rings and approach chevrons in the station's colour. */
function landingPad(color) {
  const { canvas, ctx } = canvas2d(512, 512);
  const c = 256;
  ctx.fillStyle = '#3a2a20';
  ctx.beginPath();
  ctx.arc(c, c, 256, 0, Math.PI * 2);
  ctx.fill();

  const hex = `#${new THREE.Color(color).getHexString()}`;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(c, c, 232, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, 150, 0, Math.PI * 2);
  ctx.stroke();

  // Chevrons pointing inward, the universal "put it here" marking.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * 195, c + Math.sin(a) * 195);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(16, 12);
    ctx.lineTo(0, 2);
    ctx.lineTo(-16, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Scuffing, because everything on this planet is filthy.
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#241a12';
  for (let i = 0; i < 160; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const mat = new THREE.MeshStandardMaterial({
    map: toTexture(canvas), roughness: 0.95, metalness: 0.05,
    transparent: true, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(DOCK_RANGE, 36), mat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.03;
  return pad;
}

/** Small pulsing beacon on a post. */
function beacon(color, height = 3.2) {
  const g = new THREE.Group();
  const post = cyl(0.09, 0.11, height, 6,
    new THREE.MeshStandardMaterial({ color: 0x4a4d46, roughness: 0.8, metalness: 0.5 }),
    0, height / 2, 0);
  g.add(post);
  const lensMat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 2.2, roughness: 0.35,
  });
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lensMat);
  lens.position.y = height + 0.12;
  g.add(lens);
  g.userData.lensMat = lensMat;
  return g;
}

// --- Individual installations ---------------------------------------------

function fuelDepot(m) {
  const g = new THREE.Group();
  g.add(box(9, 0.5, 7, m.shellDark, 0, 0.25, 0));
  for (let i = 0; i < 3; i++) {
    const x = -2.6 + i * 2.6;
    g.add(cyl(1.15, 1.15, 6.4, 14, m.shell, x, 3.7, 0));
    g.add(cyl(1.22, 1.22, 0.35, 14, m.hazard, x, 1.0, 0));
    g.add(cyl(1.2, 0.55, 0.9, 14, m.shell, x, 7.3, 0));
  }
  // Manifold pipework across the tank tops.
  for (const z of [-1.35, 1.35]) {
    g.add(cyl(0.14, 0.14, 6.4, 8, m.steel, 0, 6.4, z, { rz: Math.PI / 2 }));
  }
  g.add(cyl(0.14, 0.14, 3.2, 8, m.steel, 3.4, 4.9, 0, { rz: 0.5 }));
  g.add(box(2.4, 2.2, 1.6, m.shellDark, 0, 1.6, 3.6));
  g.add(box(2.0, 0.9, 0.12, m.glass, 0, 2.1, 4.42));
  return g;
}

function repairRig(m) {
  const g = new THREE.Group();
  g.add(box(10, 0.5, 8, m.shellDark, 0, 0.25, 0));
  // A-frame gantry.
  for (const z of [-3, 3]) {
    for (const s of [-1, 1]) {
      g.add(cyl(0.16, 0.22, 8.6, 6, m.steel, s * 3.6, 4.3, z, { rz: -s * 0.16 }));
    }
    g.add(box(7.6, 0.4, 0.4, m.steel, 0, 8.3, z));
  }
  g.add(box(0.5, 0.5, 6.4, m.steel, 0, 8.6, 0));
  // Hoist: trolley, cable and hook.
  g.add(box(1.0, 0.6, 1.0, m.shell, 1.2, 8.2, 0));
  g.add(cyl(0.04, 0.04, 3.4, 5, m.steel, 1.2, 6.4, 0));
  g.add(box(0.5, 0.7, 0.5, m.rust, 1.2, 4.5, 0));
  g.add(box(3.2, 2.6, 2.4, m.shell, -3.4, 1.8, 2.4));
  g.add(box(2.6, 1.0, 0.12, m.glass, -3.4, 2.4, 3.65));
  g.add(box(3.4, 0.3, 0.1, m.hazard, -3.4, 0.7, 3.66));
  return g;
}

function oreTrader(m) {
  const g = new THREE.Group();
  g.add(cyl(6.0, 6.4, 1.2, 20, m.shellDark, 0, 0.6, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.shell);
  dome.position.y = 1.2;
  g.add(dome);
  g.add(cyl(1.2, 1.2, 0.6, 12, m.hazard, 0, 6.5, 0));

  // Conveyor feeding a hopper: this is where the ore actually goes.
  const belt = box(1.8, 0.35, 9.0, m.shellDark, 4.2, 3.4, 0, { rx: 0.52 });
  g.add(belt);
  for (let i = 0; i < 7; i++) {
    g.add(box(2.0, 0.12, 0.2, m.steel, 4.2, 1.0 + i * 0.78, -3.4 + i * 1.28, { rx: 0.52 }));
  }
  g.add(box(2.6, 2.2, 2.6, m.rust, 5.0, 0.9, -4.6));
  g.add(cyl(0.2, 0.2, 4.0, 6, m.steel, 4.2, 2.0, 1.2));
  return g;
}

function fittingShop(m) {
  const g = new THREE.Group();
  g.add(box(12, 0.5, 9, m.shellDark, 0, 0.25, 0));
  g.add(box(11, 4.6, 8, m.shell, 0, 2.6, 0));
  // Barrel roof.
  const roof = cyl(4.2, 4.2, 11, 14, m.shell, 0, 4.9, 0, { rz: Math.PI / 2 });
  roof.scale.set(1, 1, 0.52);
  g.add(roof);
  // Roller door, striped, with a rail above it.
  g.add(box(5.4, 3.6, 0.2, m.hazard, 0, 2.0, 4.05));
  g.add(box(6.0, 0.35, 0.4, m.steel, 0, 4.0, 4.1));
  // Jib crane off the side.
  g.add(cyl(0.22, 0.26, 7.0, 6, m.steel, -6.4, 3.5, 3.0));
  g.add(box(0.3, 0.3, 4.4, m.steel, -6.4, 6.9, 4.8));
  g.add(cyl(0.04, 0.04, 2.2, 5, m.steel, -6.4, 5.8, 6.8));
  g.add(box(1.6, 1.6, 1.6, m.rust, 5.6, 1.0, 5.2));
  return g;
}

function sensorBureau(m) {
  const g = new THREE.Group();
  g.add(box(9, 0.5, 8, m.shellDark, 0, 0.25, 0));
  g.add(box(8, 3.0, 7, m.shell, 0, 1.8, 0));
  g.add(box(8.4, 0.4, 7.4, m.shellDark, 0, 3.4, 0));
  g.add(box(4.0, 0.9, 0.15, m.glass, 0, 2.3, 3.55));

  // Parabolic dish on a yoke — it turns, which is most of the character.
  const mount = new THREE.Group();
  mount.position.set(0, 3.6, 0);
  g.add(mount);
  mount.add(cyl(0.3, 0.4, 1.6, 8, m.steel, 0, 0.8, 0));
  const yoke = new THREE.Group();
  yoke.position.y = 1.7;
  mount.add(yoke);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
    new THREE.MeshStandardMaterial({ color: 0xcfd4cc, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide }),
  );
  dish.rotation.x = -1.15;
  yoke.add(dish);
  yoke.add(cyl(0.07, 0.07, 2.2, 5, m.steel, 0, 0.7, 0.9, { rx: -0.5 }));
  g.userData.dishYoke = yoke;

  // Antenna array along the roof.
  for (let i = 0; i < 5; i++) {
    const x = -3 + i * 1.5;
    g.add(cyl(0.035, 0.05, 2.2 + (i % 2) * 0.9, 4, m.steel, x, 4.6, -2.8));
  }
  return g;
}

function uplinkTower(m) {
  const g = new THREE.Group();
  g.add(box(6, 0.5, 6, m.shellDark, 0, 0.25, 0));
  // Lattice mast: four legs with X bracing.
  const H = 13;
  const legs = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
  for (const [x, z] of legs) {
    g.add(cyl(0.1, 0.16, H, 5, m.steel, x * 0.55, H / 2, z * 0.55, { rx: 0, rz: 0 }));
  }
  for (let level = 0; level < 7; level++) {
    const y = 1.2 + level * 1.7;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      const a = new THREE.Vector3(ax * 0.55, y, az * 0.55);
      const b = new THREE.Vector3(bx * 0.55, y + 1.7, bz * 0.55);
      const dir = new THREE.Vector3().subVectors(b, a);
      const brace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, dir.length(), 4), m.steel,
      );
      brace.position.copy(a).addScaledVector(dir, 0.5);
      brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      g.add(brace);
    }
  }
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
    new THREE.MeshStandardMaterial({ color: 0xd6dad2, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }),
  );
  dish.rotation.set(-0.9, 0.7, 0);
  dish.position.set(0, H - 1.2, 0.9);
  g.add(dish);
  g.add(box(2.6, 2.2, 2.2, m.shell, 2.8, 1.3, 1.4));
  g.add(box(2.0, 0.8, 0.12, m.glass, 2.8, 1.7, 2.52));
  return g;
}

const BUILDERS = {
  fuel: fuelDepot,
  repair: repairRig,
  trader: oreTrader,
  workshop: fittingShop,
  sensors: sensorBureau,
  uplink: uplinkTower,
};

export function createBase() {
  const m = makeMaterials();
  const group = new THREE.Group();
  group.name = 'base';

  const built = [];

  for (const station of STATIONS) {
    const g = new THREE.Group();
    g.position.set(station.x, 0, station.z);
    // Face every building inward toward the shaft mouth.
    g.rotation.y = Math.atan2(
      station.x - 32.5,
      station.z - 32.5,
    ) + Math.PI;
    group.add(g);

    const building = BUILDERS[station.key](m);
    building.position.z = -7.5;
    g.add(building);

    const pad = landingPad(station.color);
    g.add(pad);

    // Sign on posts at the edge of the pad, not floating in front of the building —
    // the silhouette behind it is how you identify the station from a distance.
    const sign = signBoard(station.sign, station.name, station.color, 5.2);
    sign.position.set(0, 4.0, -1.4);
    g.add(sign);
    for (const sx of [-2.2, 2.2]) {
      g.add(cyl(0.09, 0.11, 4.0, 6, m.steel, sx, 2.0, -1.4));
    }

    const bcn = beacon(station.color);
    bcn.position.set(4.6, 0, -1.0);
    g.add(bcn);
    const bcn2 = beacon(station.color);
    bcn2.position.set(-4.6, 0, -1.0);
    g.add(bcn2);

    built.push({ station, group: g, building, beacons: [bcn, bcn2], sign });
  }

  let t = 0;
  return {
    group,
    stations: built,
    update(dt) {
      t += dt;
      for (const b of built) {
        // Beacons pulse out of phase with each other so the base looks alive.
        const phase = Math.sin(t * 2.2 + b.station.x * 0.4);
        const lit = 0.6 + phase * phase * 2.4;
        for (const bc of b.beacons) bc.userData.lensMat.emissiveIntensity = lit;
        const yoke = b.building.userData.dishYoke;
        if (yoke) yoke.rotation.y = t * 0.35;
      }
    },
  };
}
