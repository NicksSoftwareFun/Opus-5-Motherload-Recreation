import { POD } from '../config.js';
import { BLOCKS } from '../world/blocks.js';
import { ORE_VALUE, upgradeValue, MAX_LEVEL } from '../game/economy.js';
import { Subsystems } from './subsystems.js';

/**
 * Everything the pod *is*, as opposed to where it is: consumables, cargo, money,
 * and the upgrade levels that derive its capabilities.
 *
 * Nothing in here knows about rendering. The instruments read this object; they do
 * not own any state of their own, which is what keeps the gauges honest.
 */
export class Pod {
  constructor() {
    this.upgrades = { drill: 0, hull: 0, tank: 0, engine: 0, cooling: 0, cargo: 0 };
    /** Per-module condition. Upgrades set the ceiling; damage sets what you get. */
    this.subsystems = new Subsystems();
    /** Sensor modules owned, by key. Populated by the Sensor Bureau. */
    this.sensors = new Set();

    this.cash = 200;
    this.fuel = this.maxFuel;
    this.hull = this.maxHull;
    this.heat = 0;

    /** blockId -> unit count. */
    this.cargo = new Map();

    this.alive = true;
    this.deepestDepth = 0;
    this.stats = { blocksDrilled: 0, oreMined: 0, earned: 0, rescues: 0 };
  }

  // --- Derived capabilities -------------------------------------------------

  get maxFuel() { return upgradeValue('tank', this.upgrades.tank); }
  get maxHull() { return upgradeValue('hull', this.upgrades.hull); }
  /** Fitted capacity, before damage. */
  get ratedCargo() { return upgradeValue('cargo', this.upgrades.cargo); }

  // Everything below is what the pod can actually do right now: the fitted spec
  // scaled by the condition of the module responsible for it. A damaged bay really
  // does hold less, and a damaged thruster bus really does struggle to climb out.
  get maxCargo() {
    return Math.max(1, Math.round(this.ratedCargo * this.subsystems.factor('bay')));
  }
  get drillPower() {
    return upgradeValue('drill', this.upgrades.drill) * this.subsystems.factor('drill');
  }
  get thrustScale() {
    return upgradeValue('engine', this.upgrades.engine) * this.subsystems.factor('thrusters');
  }
  get coolingScale() {
    return upgradeValue('cooling', this.upgrades.cooling) * this.subsystems.factor('cooling');
  }
  get lightScale() { return this.subsystems.factor('lights'); }

  get fuelFraction() { return this.maxFuel > 0 ? this.fuel / this.maxFuel : 0; }
  get hullFraction() { return this.maxHull > 0 ? this.hull / this.maxHull : 0; }
  get heatFraction() { return this.heat / POD.HEAT_MAX; }

  // --- Cargo ----------------------------------------------------------------

  get cargoUnits() {
    let n = 0;
    for (const count of this.cargo.values()) n += count;
    return n;
  }

  get cargoFraction() { return this.maxCargo > 0 ? this.cargoUnits / this.maxCargo : 0; }
  get cargoFull() { return this.cargoUnits >= this.maxCargo; }

  /** Returns true if the ore fit; false means the bay was full and it was lost. */
  addOre(blockId, units = 1) {
    const def = BLOCKS[blockId];
    if (!def || def.value <= 0) return false;
    if (this.cargoUnits + units > this.maxCargo) return false;
    this.cargo.set(blockId, (this.cargo.get(blockId) ?? 0) + units);
    this.stats.oreMined += units;
    return true;
  }

  cargoValue() {
    let total = 0;
    for (const [id, count] of this.cargo) total += (ORE_VALUE[id] ?? 0) * count;
    return total;
  }

  /** Sorted manifest for the cargo screen: most valuable line first. */
  manifest() {
    return [...this.cargo.entries()]
      .map(([id, count]) => ({
        id,
        name: BLOCKS[id].name,
        count,
        unit: ORE_VALUE[id] ?? 0,
        value: (ORE_VALUE[id] ?? 0) * count,
        color: BLOCKS[id].color,
      }))
      .sort((a, b) => b.value - a.value);
  }

  sellCargo() {
    const total = this.cargoValue();
    this.cargo.clear();
    this.cash += total;
    this.stats.earned += total;
    return total;
  }

  jettisonCargo() {
    const lost = this.cargoValue();
    this.cargo.clear();
    return lost;
  }

  // --- Consumables ----------------------------------------------------------

  burnFuel(amount) {
    this.fuel = Math.max(0, this.fuel - amount);
    return this.fuel > 0;
  }

  refuel(litres) {
    const before = this.fuel;
    this.fuel = Math.min(this.maxFuel, this.fuel + litres);
    return this.fuel - before;
  }

  damage(amount) {
    if (amount <= 0) return 0;
    this.hull = Math.max(0, this.hull - amount);
    if (this.hull <= 0) this.alive = false;
    return amount;
  }

  repair(points) {
    const before = this.hull;
    this.hull = Math.min(this.maxHull, this.hull + points);
    return this.hull - before;
  }

  addHeat(amount) {
    this.heat = Math.min(POD.HEAT_MAX * 1.4, this.heat + amount / this.coolingScale);
  }

  canAfford(cost) { return this.cash >= cost; }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    this.cash -= cost;
    return true;
  }

  upgradeLevel(key) { return this.upgrades[key] ?? 0; }
  isMaxed(key) { return this.upgradeLevel(key) >= MAX_LEVEL; }

  applyUpgrade(key) {
    this.upgrades[key] = Math.min(MAX_LEVEL, this.upgrades[key] + 1);
    // A bigger tank or hull arrives full — you paid for the whole thing.
    if (key === 'tank') this.fuel = this.maxFuel;
    if (key === 'hull') this.hull = this.maxHull;
  }

  /**
   * Per-tick upkeep: idle fuel burn, heat shedding, and heat damage past the
   * threshold. Thrust and drill costs are charged by their own systems.
   */
  update(dt, { thrusting = false, drilling = false, surface = false } = {}) {
    if (this.fuel > 0) {
      let burn = POD.FUEL_IDLE;
      // Getting about on the surface is cheap. Down the shaft you are holding a
      // few tonnes of pod against gravity with the thrusters and every second of
      // it is on the meter, but crossing the plaza between the trader and the
      // fitting shop should not be a resource decision — it is walking to the
      // shops, and charging full burn for it made the surface feel like a tax.
      if (thrusting) burn += POD.FUEL_THRUST * (surface ? POD.FUEL_SURFACE_SCALE : 1);
      if (drilling) burn += POD.FUEL_DRILL;
      this.burnFuel(burn * dt);
    }

    if (drilling) this.addHeat(POD.HEAT_PER_DRILL_SECOND * dt);
    this.heat = Math.max(0, this.heat - POD.HEAT_COOLING * this.coolingScale * dt * 0.35);

    if (this.heat > POD.HEAT_DAMAGE_THRESHOLD) {
      const over = (this.heat - POD.HEAT_DAMAGE_THRESHOLD) / (POD.HEAT_MAX - POD.HEAT_DAMAGE_THRESHOLD);
      this.damage(POD.HEAT_DAMAGE_RATE * over * dt);
    }
  }

  /** Serialisable snapshot for the save system. */
  toJSON() {
    return {
      upgrades: { ...this.upgrades },
      sensors: [...this.sensors],
      cash: this.cash,
      fuel: this.fuel,
      hull: this.hull,
      heat: this.heat,
      cargo: [...this.cargo.entries()],
      subsystems: this.subsystems.toJSON(),
      deepestDepth: this.deepestDepth,
      stats: { ...this.stats },
    };
  }

  static fromJSON(data) {
    const pod = new Pod();
    Object.assign(pod.upgrades, data.upgrades ?? {});
    pod.sensors = new Set(data.sensors ?? []);
    pod.cash = data.cash ?? 0;
    pod.fuel = data.fuel ?? pod.maxFuel;
    pod.hull = data.hull ?? pod.maxHull;
    pod.heat = data.heat ?? 0;
    pod.cargo = new Map(data.cargo ?? []);
    pod.subsystems = Subsystems.fromJSON(data.subsystems);
    pod.deepestDepth = data.deepestDepth ?? 0;
    Object.assign(pod.stats, data.stats ?? {});
    pod.alive = pod.hull > 0;
    return pod;
  }
}
