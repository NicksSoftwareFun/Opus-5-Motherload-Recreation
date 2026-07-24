import { WORLD } from '../config.js';

/**
 * The surface base: six installations ringing the shaft mouth.
 *
 * Docking is proximity, not a keypress. Fly onto a pad and the pod's terminal
 * establishes an uplink and becomes that vendor's console; fly off and it goes back
 * to the status page. There is no dialog, no shop overlay, and nothing to dismiss —
 * the screen in front of you simply starts showing something else.
 */

const RING = 21;

const at = (deg) => ({
  x: WORLD.CENTER_X + Math.cos((deg * Math.PI) / 180) * RING,
  z: WORLD.CENTER_Z + Math.sin((deg * Math.PI) / 180) * RING,
});

export const STATIONS = [
  {
    key: 'fuel',
    name: 'FUEL DEPOT',
    sign: 'HYDRAZINE',
    page: 'vendor:fuel',
    color: 0xffb02a,
    ...at(0),
  },
  {
    key: 'repair',
    name: 'REPAIR RIG',
    sign: 'HULL SVC',
    page: 'vendor:repair',
    color: 0x4ad6ff,
    ...at(60),
  },
  {
    key: 'trader',
    name: 'ORE TRADER',
    sign: 'ASSAY',
    page: 'vendor:trader',
    color: 0x8cff7a,
    ...at(120),
  },
  {
    key: 'workshop',
    name: 'FITTING SHOP',
    sign: 'UPGRADES',
    page: 'vendor:workshop',
    color: 0xff8a4a,
    ...at(180),
  },
  {
    key: 'sensors',
    name: 'SENSOR BUREAU',
    sign: 'NATAS INSTR.',
    page: 'vendor:sensors',
    color: 0xc07aff,
    ...at(240),
  },
  {
    key: 'uplink',
    name: 'UPLINK TOWER',
    sign: 'CONTRACT',
    page: 'vendor:uplink',
    color: 0xff5a6a,
    ...at(300),
  },
];

export const STATION_BY_KEY = Object.fromEntries(STATIONS.map((s) => [s.key, s]));

/** Metres from a pad centre at which the uplink connects. */
export const DOCK_RANGE = 6.5;
/** Above this altitude you are flying over the base, not standing on it. */
export const DOCK_CEILING = 6;

/**
 * Solid volumes for the installations themselves, as world-space boxes.
 *
 * The buildings are meshes, not voxels, so nothing in the collision code knew they
 * were there and a pod could fly through a hydrazine tank without noticing. Each
 * structure is put up 7.5 m outboard of its pad (see createBase), which is what the
 * radial offset here reproduces — the pad stays clear so docking is unaffected, and
 * the building behind it is something you can hit.
 */
export const STATION_SOLIDS = STATIONS.map((s) => {
  const dx = s.x - WORLD.CENTER_X;
  const dz = s.z - WORLD.CENTER_Z;
  const r = Math.hypot(dx, dz) || 1;
  return {
    key: s.key,
    x: s.x + (7.5 * dx) / r,
    z: s.z + (7.5 * dz) / r,
    // One box per installation rather than a hull per girder: they are all roughly
    // this footprint, and the pilot's question is "can I fly through it", not
    // "by how many centimetres".
    hx: 5.2,
    hz: 5.0,
    top: 7.2,
  };
});

/** Nearest station the pod is docked with, or null. */
export function stationAt(position) {
  if (position.y > DOCK_CEILING || position.y < -2) return null;
  let best = null;
  let bestDist = DOCK_RANGE;
  for (const s of STATIONS) {
    const d = Math.hypot(position.x - s.x, position.z - s.z);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}
