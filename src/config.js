/**
 * Shared tuning constants. One place to rebalance the game from.
 *
 * Coordinate conventions used everywhere:
 *   - World space is metres, Y-up, and Y = 0 is the Martian surface.
 *   - The mine occupies X,Z in [0, WORLD_W) x [0, WORLD_D) and extends downward.
 *   - Voxel (vx, vy, vz) with vy in [0, WORLD_H) fills the box
 *       x: [vx, vx+1]   y: [-(vy+1), -vy]   z: [vz, vz+1]
 *     so the top face of layer 0 sits exactly at Y = 0 and "depth in metres" is -Y.
 */

export const WORLD = {
  W: 64,
  D: 64,
  H: 256,
  CHUNK: 16,
  /** Where the pod spawns and the surface base is centred. */
  CENTER_X: 32.5,
  CENTER_Z: 32.5,
};

export const PHYSICS = {
  /** Mars surface gravity. Slightly exaggerated for a heavier, more deliberate pod. */
  GRAVITY: 5.4,
  TERMINAL_VELOCITY: 34,
  /** Pod collision box (metres). Fits comfortably inside a 1 m tunnel. */
  POD_HALF_W: 0.34,
  POD_HALF_H: 0.38,
  /** Linear drag applied to horizontal motion so the pod feels damped, not icy. */
  DRAG_H: 3.2,
  DRAG_V: 0.35,
  /** Impact speed at which hull damage begins, and damage per m/s beyond it. */
  FALL_SAFE_SPEED: 13,
  FALL_DAMAGE_PER_MS: 2.6,
};

export const POD = {
  BASE_FUEL: 100,
  BASE_HULL: 100,
  BASE_CARGO: 12,
  /** Newtons-ish; scaled by engine upgrade and thruster subsystem health. */
  BASE_THRUST_UP: 13.5,
  BASE_LATERAL: 9.0,
  /** Fuel burned per second at full vertical thrust, and per second idling. */
  FUEL_THRUST: 0.62,
  FUEL_IDLE: 0.035,
  FUEL_DRILL: 0.5,
  /** Heat model: drilling and lava add, radiator sheds. */
  HEAT_MAX: 100,
  HEAT_PER_DRILL_SECOND: 5.0,
  HEAT_COOLING: 7.5,
  HEAT_DAMAGE_THRESHOLD: 88,
  HEAT_DAMAGE_RATE: 6.0,
};

export const RENDER = {
  FOV: 72,
  NEAR: 0.02,
  FAR: 900,
  /** Fog density underground vs. at the surface — the mine should close in on you. */
  FOG_SURFACE: 0.0016,
  FOG_UNDERGROUND: 0.055,
  SHADOWS: false,
};

/** Martian palette, shared by terrain, sky and dust so everything agrees. */
export const PALETTE = {
  skyHigh: 0x2b1c1a,
  skyLow: 0xc98b57,
  sun: 0xffd9a8,
  ground: 0x8c4a2f,
  groundDark: 0x5d2f1d,
  rock: 0x6f4030,
  dust: 0xd9a273,
  /** Industrial cockpit tones, MicroProse-issue. */
  panel: 0x4a4f47,
  panelDark: 0x2b2f2a,
  metal: 0x8a8f87,
  hazard: 0xd8a12a,
  phosphor: 0x8cff7a,
  phosphorAmber: 0xffb340,
};

export const DEBUG = {
  /** Set from ?debug=1 to expose extra hooks and log timings. */
  enabled: typeof location !== 'undefined' && /[?&]debug=1/.test(location.search),
};
