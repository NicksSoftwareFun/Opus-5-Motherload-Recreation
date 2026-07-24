import { mulberry32 } from '../core/rng.js';

/**
 * Per-module damage.
 *
 * Carrier Command 2 tracks what broke, not how much health is left, and that is a
 * much better fit for a mining pod than one bar. A bad landing does not just cost
 * you 30 points — it costs you a headlight, or half your thrust, with the surface
 * still two hundred metres up. Hull integrity remains the thing that kills you;
 * these are what make the trip home interesting.
 *
 * Every module degrades gracefully: nothing switches off at a threshold, it just
 * gets worse, so the pilot notices the machine failing rather than being told.
 */

export const MODULES = [
  { key: 'drill', name: 'DRILL ASSEMBLY', effect: 'CUT RATE' },
  { key: 'thrusters', name: 'THRUSTER BUS', effect: 'LIFT' },
  { key: 'lights', name: 'LAMP CIRCUIT', effect: 'ILLUMINATION' },
  { key: 'cooling', name: 'HEAT EXCHANGER', effect: 'COOLING' },
  { key: 'bay', name: 'CARGO BAY SERVO', effect: 'CAPACITY' },
];

/** A module at zero still does something — a dead pod is not interesting. */
const FLOOR = {
  drill: 0.25,
  thrusters: 0.35,
  lights: 0.10,
  cooling: 0.30,
  bay: 0.40,
};

export class Subsystems {
  constructor(seed = 0x51e7) {
    this.health = Object.fromEntries(MODULES.map((m) => [m.key, 1]));
    this._rand = mulberry32(seed);
  }

  /** 0..1 effectiveness of a module, never quite reaching zero. */
  factor(key) {
    const h = this.health[key] ?? 1;
    const floor = FLOOR[key] ?? 0.25;
    return floor + (1 - floor) * h;
  }

  get worst() {
    let worst = null;
    for (const m of MODULES) {
      if (!worst || this.health[m.key] < this.health[worst.key]) worst = m;
    }
    return worst;
  }

  get anyDamaged() {
    return MODULES.some((m) => this.health[m.key] < 0.995);
  }

  /**
   * Route part of a damage event onto a module.
   *
   * Weighted toward whatever is already healthy, so damage spreads across the pod
   * instead of grinding one module to nothing and leaving the rest pristine.
   *
   * @returns {object|null} the module that took it, for the warning message.
   */
  applyDamage(amount, { module = null } = {}) {
    if (amount <= 0) return null;
    let target = module ? MODULES.find((m) => m.key === module) : null;

    if (!target) {
      const weights = MODULES.map((m) => 0.15 + this.health[m.key]);
      const total = weights.reduce((a, b) => a + b, 0);
      let roll = this._rand() * total;
      for (let i = 0; i < MODULES.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          target = MODULES[i];
          break;
        }
      }
      target = target ?? MODULES[0];
    }

    const before = this.health[target.key];
    this.health[target.key] = Math.max(0, before - amount);
    // Only report it when the module crosses into a worse band, so the comms are
    // not a stream of one-percent updates.
    const band = (v) => (v > 0.7 ? 3 : v > 0.4 ? 2 : v > 0.15 ? 1 : 0);
    return band(this.health[target.key]) < band(before) ? target : null;
  }

  repair(key, fraction) {
    const before = this.health[key];
    this.health[key] = Math.min(1, before + fraction);
    return this.health[key] - before;
  }

  repairAll(fraction = 1) {
    for (const m of MODULES) this.repair(m.key, fraction);
  }

  /** Total repair cost at the rig, in "points" the vendor charges for. */
  damageUnits() {
    return MODULES.reduce((sum, m) => sum + (1 - this.health[m.key]), 0) * 100;
  }

  toJSON() {
    return { ...this.health };
  }

  static fromJSON(data) {
    const s = new Subsystems();
    if (data) Object.assign(s.health, data);
    return s;
  }
}
