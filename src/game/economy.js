import { ORE_TABLE } from '../world/blocks.js';

/**
 * Prices and upgrade tiers.
 *
 * The curve is the original game's: every tier costs roughly what the *previous*
 * tier's depth band pays out over a few good hauls, so an upgrade always feels like
 * it was earned by the run that funded it. Maxing every line costs about 1.8M, well
 * inside what the mine holds but far outside what you can carry in one trip — the
 * cargo bay, not the ore, is the real constraint.
 */

/** Ore sale value per unit, keyed by block id. */
export const ORE_VALUE = Object.fromEntries(ORE_TABLE.map((o) => [o.id, o.value]));

const line = (key, name, blurb, unit, tiers) => ({ key, name, blurb, unit, tiers });

export const UPGRADES = [
  line('drill', 'Drill Assembly', 'Cutting rate through rock.', 'x', [
    { name: 'MK I Tungsten Bit', value: 1.0, cost: 0 },
    { name: 'MK II Carbide Auger', value: 1.5, cost: 750 },
    { name: 'MK III Diamond Auger', value: 2.2, cost: 3200 },
    { name: 'MK IV Plasma Lance', value: 3.2, cost: 14000 },
    { name: 'MK V Resonance Cutter', value: 4.6, cost: 60000 },
    { name: 'MK VI Singularity Bore', value: 6.5, cost: 260000 },
  ]),
  line('hull', 'Hull Plating', 'Structural integrity before failure.', 'pts', [
    { name: 'Standard Plate', value: 100, cost: 0 },
    { name: 'Reinforced Plate', value: 160, cost: 600 },
    { name: 'Composite Shell', value: 240, cost: 2600 },
    { name: 'Ablative Carapace', value: 360, cost: 11000 },
    { name: 'Titanium Monocoque', value: 540, cost: 48000 },
    { name: 'Adamant Carapace', value: 800, cost: 210000 },
  ]),
  line('tank', 'Fuel Cell', 'Litres of hydrazine carried.', 'L', [
    { name: '100L Standard Cell', value: 100, cost: 0 },
    { name: '160L Extended Cell', value: 160, cost: 500 },
    { name: '250L Bladder Tank', value: 250, cost: 2200 },
    { name: '380L Bladder Tank', value: 380, cost: 9500 },
    { name: '580L Reservoir', value: 580, cost: 40000 },
    { name: '900L Deep Reservoir', value: 900, cost: 180000 },
  ]),
  line('engine', 'Lift Engine', 'Thrust available for climbing out.', 'x', [
    { name: 'Type-1 Lifter', value: 1.0, cost: 0 },
    { name: 'Type-2 Lifter', value: 1.25, cost: 800 },
    { name: 'Type-3 Impeller', value: 1.55, cost: 3400 },
    { name: 'Type-4 Impeller', value: 1.9, cost: 15000 },
    { name: 'Type-5 Ascendant', value: 2.3, cost: 65000 },
    { name: 'Type-6 Ascendant', value: 2.8, cost: 280000 },
  ]),
  line('cooling', 'Heat Exchanger', 'Resistance to drill and magma heat.', 'x', [
    { name: 'Passive Fins', value: 1.0, cost: 0 },
    { name: 'Forced Loop', value: 1.4, cost: 700 },
    { name: 'Glycol Loop', value: 1.9, cost: 3000 },
    { name: 'Cryogenic Loop', value: 2.6, cost: 13000 },
    { name: 'Phase-Change Sink', value: 3.5, cost: 55000 },
    { name: 'Vacuum Sink', value: 4.8, cost: 240000 },
  ]),
  line('cargo', 'Cargo Bay', 'Ore units carried per trip.', 'u', [
    { name: '12u Hopper', value: 12, cost: 0 },
    { name: '20u Hopper', value: 20, cost: 650 },
    { name: '32u Bay', value: 32, cost: 2800 },
    { name: '48u Bay', value: 48, cost: 12000 },
    { name: '70u Hold', value: 70, cost: 52000 },
    { name: '100u Deep Hold', value: 100, cost: 225000 },
  ]),
];

export const UPGRADE_BY_KEY = Object.fromEntries(UPGRADES.map((u) => [u.key, u]));

export function upgradeValue(key, level) {
  const line_ = UPGRADE_BY_KEY[key];
  const tier = line_.tiers[Math.min(level, line_.tiers.length - 1)];
  return tier.value;
}

export function upgradeTier(key, level) {
  const line_ = UPGRADE_BY_KEY[key];
  return line_.tiers[Math.min(level, line_.tiers.length - 1)];
}

export function nextUpgrade(key, level) {
  const line_ = UPGRADE_BY_KEY[key];
  return level + 1 < line_.tiers.length ? line_.tiers[level + 1] : null;
}

export const MAX_LEVEL = UPGRADES[0].tiers.length - 1;

/** Refuelling and repairs are cheap early and stay cheap — they are not the game. */
export const SERVICE = {
  FUEL_PER_LITRE: 3.2,
  REPAIR_PER_POINT: 9,
  /** Fraction of cash Mr Natas keeps when he has to come and get you. */
  RESCUE_CUT: 0.22,
  RESCUE_MINIMUM: 250,
};

/** Format credits the way the pod's terminals do. */
export function credits(n) {
  const v = Math.max(0, Math.round(n));
  return `${v.toLocaleString('en-US')}`;
}
