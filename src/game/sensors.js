/**
 * NATAS INSTRUMENTATION — the sensor catalogue.
 *
 * Every module is a physical fitting that appears in the cabin when you buy it,
 * and each answers a different question the mine keeps asking. They escalate from
 * "what am I cutting" to "what is beneath me" to "what is inside the rock" — and
 * then past the point where instrumentation stops being the right word for it.
 *
 * Prices sit deliberately between the upgrade tiers: a sensor is always something
 * you buy instead of a bigger drill, never as well as.
 */

export const SENSORS = [
  {
    key: 'densitometer',
    name: 'MK-I Densitometer',
    short: 'DENSITOMETER',
    cost: 750,
    mount: 'DASH',
    blurb: 'Reads composition and hardness at the bit. Predicts cut time.',
  },
  {
    key: 'sonar',
    name: 'Chirp Sonar Array',
    short: 'CHIRP SONAR',
    cost: 4000,
    mount: 'PORT RACK',
    blurb: 'Sweeping scope. Paints ore returns within 18 m through solid rock.',
  },
  {
    key: 'profiler',
    name: 'Strata Profiler',
    short: 'STRATA PROFILER',
    cost: 12000,
    mount: 'PORT RACK',
    blurb: 'Core sample of the 26 m directly beneath the pod, updated live.',
  },
  {
    key: 'thermal',
    name: 'Thermal Aperture',
    short: 'THERMAL APERTURE',
    cost: 40000,
    mount: 'STBD RACK',
    blurb: 'False-colour section along the axis of travel. Magma burns white.',
  },
  {
    key: 'lattice',
    name: 'Tomographic Lattice',
    short: 'TOMOGRAPHIC LATTICE',
    cost: 140000,
    mount: 'PROJECTOR',
    blurb: 'Fuses returns into the map projection. Ore and hazards in three axes.',
  },
  {
    key: 'providence',
    name: 'The Providence Engine',
    short: 'PROVIDENCE ENGINE',
    cost: 666000,
    mount: 'OVERHEAD',
    // The only entry in the catalogue that is not sold with a specification.
    blurb: 'It sees the whole seam. It does not need to be told where to look.',
    tithe: 45,
    warning: 'SERVICE LEVIED CONTINUOUSLY WHILE ARMED. SEE CONTRACT CLAUSE XI.',
  },
];

export const SENSOR_BY_KEY = Object.fromEntries(SENSORS.map((s) => [s.key, s]));

/** Modules are sold in order — you cannot skip to the Engine. */
export function nextSensor(owned) {
  return SENSORS.find((s) => !owned.has(s.key)) ?? null;
}

export function sensorAvailable(key, owned) {
  const index = SENSORS.findIndex((s) => s.key === key);
  if (index < 0 || owned.has(key)) return false;
  return SENSORS.slice(0, index).every((s) => owned.has(s.key));
}
