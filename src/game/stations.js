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
