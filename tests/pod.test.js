import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoxelWorld } from '../src/world/voxelWorld.js';
import { integrate, boxIntersectsSolid, solidAtCell } from '../src/player/physics.js';
import { Pod } from '../src/player/pod.js';
import { Subsystems, MODULES } from '../src/player/subsystems.js';
import { Hazards } from '../src/player/hazards.js';
import { columnBelow, scanOre, bitReading, slice } from '../src/player/sensorData.js';
import { UPGRADES, upgradeValue, upgradeTier, MAX_LEVEL, SERVICE } from '../src/game/economy.js';
import { SENSORS, sensorAvailable } from '../src/game/sensors.js';
import { Narrative, BEATS } from '../src/game/narrative.js';
import { ROCK, AIR, GAS, GOLDIUM, IRONIUM, BEDROCK } from '../src/world/blocks.js';

const vec = (x, y, z) => ({ x, y, z });

/** Minimal stand-in for ChunkManager: physics and hazards only need setBlock. */
function stubChunks(world) {
  const modified = new Map();
  return {
    modified,
    setBlock(x, vy, z, id) {
      const prev = world.set(x, vy, z, id);
      if (prev !== -1 && prev !== id) modified.set(world.index(x, vy, z), id);
      return prev;
    },
  };
}

describe('physics', () => {
  it('maps world cells onto voxel layers consistently', () => {
    const w = new VoxelWorld();
    w.set(10, 4, 10, ROCK);
    // Layer 4 fills world Y [-5, -4], so integer cell -5 is the solid one.
    expect(solidAtCell(w, 10, -5, 10)).toBe(true);
    expect(solidAtCell(w, 10, -4, 10)).toBe(false);
  });

  it('lands the pod on a floor instead of falling through it', () => {
    const w = new VoxelWorld();
    for (let vz = 0; vz < 64; vz++) {
      for (let vx = 0; vx < 64; vx++) w.set(vx, 10, vz, ROCK);
    }
    const body = {
      position: vec(32.5, -6, 32.5),
      velocity: { x: 0, y: 0, z: 0 },
      onGround: false,
      impactSpeed: 0,
    };
    // Vector3-like helpers the integrator uses.
    body.position = Object.assign(body.position, {});
    for (let i = 0; i < 600; i++) integrate(w, body, 1 / 120);

    expect(body.onGround).toBe(true);
    // Floor top is world Y -10; the pod's half-height is 0.38.
    expect(body.position.y).toBeGreaterThan(-9.7);
    expect(body.position.y).toBeLessThan(-9.5);
  });

  it('records an impact speed on landing so damage can be charged for it', () => {
    const w = new VoxelWorld();
    for (let vz = 0; vz < 64; vz++) {
      for (let vx = 0; vx < 64; vx++) w.set(vx, 40, vz, ROCK);
    }
    const body = {
      position: vec(32.5, -6, 32.5),
      velocity: { x: 0, y: 0, z: 0 },
      onGround: false,
      impactSpeed: 0,
    };
    let peak = 0;
    for (let i = 0; i < 2000; i++) {
      integrate(w, body, 1 / 120);
      peak = Math.max(peak, body.impactSpeed);
    }
    expect(peak).toBeGreaterThan(10);
  });

  it('stops horizontal motion at a wall', () => {
    const w = new VoxelWorld();
    for (let vy = 0; vy < 30; vy++) {
      for (let vz = 0; vz < 64; vz++) w.set(40, vy, vz, ROCK);
    }
    // Started close to the wall on purpose: horizontal drag bleeds off about
    // 3.7 m of travel, so from further out the pod never reaches it at all.
    const body = {
      position: vec(38.8, -10.5, 32.5),
      velocity: { x: 12, y: 0, z: 0 },
      onGround: false,
      impactSpeed: 0,
    };
    for (let i = 0; i < 120; i++) integrate(w, body, 1 / 120);
    // Stopped flush against the wall face at x = 40, minus the pod's half-width.
    expect(body.position.x).toBeLessThan(40);
    expect(body.position.x).toBeGreaterThan(39.5);
    expect(body.velocity.x).toBe(0);
  });

  it('detects a box overlapping solid rock', () => {
    const w = new VoxelWorld();
    w.set(10, 5, 10, ROCK);
    expect(boxIntersectsSolid(w, 10.5, -5.5, 10.5, 0.3, 0.3, 0.3)).toBe(true);
    expect(boxIntersectsSolid(w, 14.5, -5.5, 10.5, 0.3, 0.3, 0.3)).toBe(false);
  });
});

describe('Pod', () => {
  let pod;
  beforeEach(() => { pod = new Pod(); });

  it('starts fully fuelled and intact at its fitted spec', () => {
    expect(pod.fuel).toBe(pod.maxFuel);
    expect(pod.hull).toBe(pod.maxHull);
    expect(pod.cargoUnits).toBe(0);
  });

  it('refuses ore that will not fit rather than overfilling the bay', () => {
    const cap = pod.maxCargo;
    for (let i = 0; i < cap; i++) expect(pod.addOre(IRONIUM, 1)).toBe(true);
    expect(pod.cargoFull).toBe(true);
    expect(pod.addOre(IRONIUM, 1)).toBe(false);
    expect(pod.cargoUnits).toBe(cap);
  });

  it('values and sells a mixed manifest correctly', () => {
    pod.addOre(GOLDIUM, 2);
    pod.addOre(IRONIUM, 3);
    const expected = 250 * 2 + 30 * 3;
    expect(pod.cargoValue()).toBe(expected);
    const before = pod.cash;
    expect(pod.sellCargo()).toBe(expected);
    expect(pod.cash).toBe(before + expected);
    expect(pod.cargoUnits).toBe(0);
  });

  it('sorts the manifest most valuable line first', () => {
    pod.addOre(IRONIUM, 5);
    pod.addOre(GOLDIUM, 1);
    expect(pod.manifest()[0].id).toBe(GOLDIUM);
  });

  it('derives capability from upgrade level and module condition together', () => {
    const rated = pod.drillPower;
    pod.applyUpgrade('drill');
    expect(pod.drillPower).toBeGreaterThan(rated);

    const healthy = pod.drillPower;
    pod.subsystems.applyDamage(1, { module: 'drill' });
    // A wrecked module still turns, but much more slowly.
    expect(pod.drillPower).toBeLessThan(healthy);
    expect(pod.drillPower).toBeGreaterThan(0);
  });

  it('shrinks the usable bay when the cargo servo is damaged', () => {
    const rated = pod.ratedCargo;
    pod.subsystems.applyDamage(1, { module: 'bay' });
    expect(pod.maxCargo).toBeLessThan(rated);
    expect(pod.maxCargo).toBeGreaterThan(0);
  });

  it('fills a newly fitted tank and hull, because you paid for the whole thing', () => {
    pod.fuel = 1;
    pod.hull = 1;
    pod.applyUpgrade('tank');
    pod.applyUpgrade('hull');
    expect(pod.fuel).toBe(pod.maxFuel);
    expect(pod.hull).toBe(pod.maxHull);
  });

  it('dies when the hull runs out and not before', () => {
    pod.damage(pod.maxHull - 1);
    expect(pod.alive).toBe(true);
    pod.damage(5);
    expect(pod.alive).toBe(false);
    expect(pod.hull).toBe(0);
  });

  it('survives a JSON round trip with everything that matters', () => {
    pod.applyUpgrade('drill');
    pod.applyUpgrade('cargo');
    pod.sensors.add('sonar');
    pod.addOre(GOLDIUM, 2);
    pod.cash = 4242;
    pod.deepestDepth = 187.5;
    pod.subsystems.applyDamage(0.4, { module: 'lights' });

    const clone = Pod.fromJSON(JSON.parse(JSON.stringify(pod.toJSON())));
    expect(clone.upgrades).toEqual(pod.upgrades);
    expect([...clone.sensors]).toEqual([...pod.sensors]);
    expect(clone.cash).toBe(pod.cash);
    expect(clone.cargoValue()).toBe(pod.cargoValue());
    expect(clone.deepestDepth).toBe(pod.deepestDepth);
    expect(clone.subsystems.health.lights).toBeCloseTo(pod.subsystems.health.lights, 6);
  });
});

describe('Subsystems', () => {
  it('degrades gracefully and never reaches zero effectiveness', () => {
    const s = new Subsystems();
    for (const m of MODULES) {
      s.applyDamage(5, { module: m.key });
      expect(s.health[m.key]).toBe(0);
      expect(s.factor(m.key)).toBeGreaterThan(0);
      expect(s.factor(m.key)).toBeLessThan(1);
    }
  });

  it('spreads unaimed damage across modules rather than grinding one down', () => {
    const s = new Subsystems();
    for (let i = 0; i < 60; i++) s.applyDamage(0.05);
    const damaged = MODULES.filter((m) => s.health[m.key] < 0.999);
    expect(damaged.length).toBeGreaterThan(2);
  });

  it('reports the worst module and prices a refit by total damage', () => {
    const s = new Subsystems();
    s.applyDamage(0.8, { module: 'cooling' });
    expect(s.worst.key).toBe('cooling');
    expect(s.damageUnits()).toBeCloseTo(80, 5);
    s.repairAll(1);
    expect(s.anyDamaged).toBe(false);
    expect(s.damageUnits()).toBeCloseTo(0, 5);
  });
});

describe('hazards', () => {
  it('lights a fuse when a cut exposes a gas pocket', () => {
    const world = new VoxelWorld();
    world.data.fill(ROCK);
    world.recountChunks();
    const pod = new Pod();
    const chunks = stubChunks(world);
    const hz = new Hazards(world, chunks, pod, pod.subsystems);

    world.set(20, 20, 20, GAS);
    chunks.setBlock(21, 20, 20, AIR);
    hz.onBlockRemoved(21, 20, 20);

    expect(hz.fuses.length).toBe(1);
    expect(hz.drain().some((e) => e.kind === 'gas-lit')).toBe(true);
  });

  it('detonates the pocket once the fuse burns down', () => {
    const world = new VoxelWorld();
    world.data.fill(ROCK);
    world.recountChunks();
    const pod = new Pod();
    const chunks = stubChunks(world);
    const hz = new Hazards(world, chunks, pod, pod.subsystems);

    world.set(20, 20, 20, GAS);
    chunks.setBlock(21, 20, 20, AIR);
    hz.onBlockRemoved(21, 20, 20);
    hz.drain();

    for (let i = 0; i < 200; i++) {
      hz.update(1 / 60, { position: vec(20.5, -20.5, 20.5), velocity: vec(0, 0, 0) });
    }
    const events = hz.drain();
    expect(events.some((e) => e.kind === 'explosion')).toBe(true);
    // A blast centred on the pod must hurt it.
    expect(pod.hull).toBeLessThan(pod.maxHull);
    // And it must leave a hole.
    expect(world.get(20, 20, 20)).toBe(AIR);
  });

  it('takes the whole seam with it: one pocket chains to its neighbours', () => {
    const world = new VoxelWorld();
    world.data.fill(ROCK);
    world.recountChunks();
    const pod = new Pod();
    const chunks = stubChunks(world);
    const hz = new Hazards(world, chunks, pod, pod.subsystems);

    // A seam of pockets running away from the one the drill opens, each spaced
    // far enough apart that only a chain — not a single blast radius — reaches
    // the far end of it.
    const seam = [];
    for (let i = 0; i < 6; i++) seam.push([20 + i * 4, 20, 20]);
    for (const [x, y, z] of seam) world.set(x, y, z, GAS);

    chunks.setBlock(19, 20, 20, AIR);
    hz.onBlockRemoved(19, 20, 20);
    hz.drain();

    // Well away from the seam: this is about the rock, not about the damage.
    const far = vec(20.5, -20.5, 60.5);
    for (let i = 0; i < 900; i++) hz.update(1 / 60, { position: far, velocity: vec(0, 0, 0) });

    // Every pocket is gone. Gas is not mineable, so any left behind would be a
    // permanent obstruction the drill could never clear.
    for (const [x, y, z] of seam) {
      expect(world.get(x, y, z)).not.toBe(GAS);
    }
    expect(hz.fuses.length).toBe(0);
  });

  it('does not chain to pockets that are nowhere near the blast', () => {
    const world = new VoxelWorld();
    world.data.fill(ROCK);
    world.recountChunks();
    const pod = new Pod();
    const chunks = stubChunks(world);
    const hz = new Hazards(world, chunks, pod, pod.subsystems);

    world.set(20, 20, 20, GAS);
    world.set(40, 20, 20, GAS);      // a separate pocket, twenty metres off
    chunks.setBlock(19, 20, 20, AIR);
    hz.onBlockRemoved(19, 20, 20);
    hz.drain();

    const far = vec(20.5, -20.5, 60.5);
    for (let i = 0; i < 600; i++) hz.update(1 / 60, { position: far, velocity: vec(0, 0, 0) });

    expect(world.get(20, 20, 20)).toBe(AIR);
    expect(world.get(40, 20, 20)).toBe(GAS);
  });

  it('drops unsupported rock but leaves braced rock alone', () => {
    const world = new VoxelWorld();
    world.data.fill(AIR);
    world.recountChunks();
    const pod = new Pod();
    const chunks = stubChunks(world);
    const hz = new Hazards(world, chunks, pod, pod.subsystems);

    // A single block with nothing beside it, over a freshly cut void.
    world.set(30, 30, 30, ROCK);
    hz.onBlockRemoved(30, 31, 30);
    expect(hz.falling.length).toBe(1);

    // Now one with a neighbour: braced, so it stays put.
    const hz2 = new Hazards(world, chunks, pod, pod.subsystems);
    world.set(40, 30, 40, ROCK);
    world.set(41, 30, 40, ROCK);
    hz2.onBlockRemoved(40, 31, 40);
    expect(hz2.falling.length).toBe(0);
  });

  it('never dislodges the claim boundary', () => {
    const world = new VoxelWorld();
    world.data.fill(AIR);
    world.recountChunks();
    const pod = new Pod();
    const hz = new Hazards(world, stubChunks(world), pod, pod.subsystems);
    world.set(30, 30, 30, BEDROCK);
    hz.onBlockRemoved(30, 31, 30);
    expect(hz.falling.length).toBe(0);
  });
});

describe('sensor sampling', () => {
  const world = new VoxelWorld();
  world.data.fill(ROCK);
  world.set(32, 21, 32, GOLDIUM);
  world.recountChunks();

  it('reads a core sample directly beneath the pod', () => {
    const core = columnBelow(world, vec(32.5, -20.5, 32.5), 6);
    expect(core.length).toBe(6);
    expect(core[0].depth).toBe(21);
    expect(core[0].id).toBe(GOLDIUM);
  });

  it('returns ore in pod-relative coordinates', () => {
    const hits = scanOre(world, vec(32.5, -20.5, 32.5), 6, 1);
    const gold = hits.find((h) => h.id === GOLDIUM);
    expect(gold).toBeTruthy();
    expect(gold.dx).toBe(0);
    expect(gold.dz).toBe(0);
    // One layer deeper than the pod, so downward is negative in world terms.
    expect(gold.dy).toBe(-1);
    expect(gold.value).toBe(250);
  });

  it('predicts cut time from hardness and drill power', () => {
    const r = bitReading({ id: ROCK, distance: 0.6 }, 2);
    expect(r.cuttable).toBe(true);
    expect(r.eta).toBeCloseTo(0.95 / 2, 5);

    const bed = bitReading({ id: BEDROCK, distance: 0.6 }, 2);
    expect(bed.cuttable).toBe(false);
  });

  it('samples a section of the requested size', () => {
    const s = slice(world, vec(32.5, -20.5, 32.5), 0, { w: 8, h: 6 });
    expect(s.w).toBe(8);
    expect(s.h).toBe(6);
    expect(s.cells.length).toBe(48);
  });
});

describe('economy', () => {
  it('prices every upgrade line as a strictly rising ladder', () => {
    for (const line of UPGRADES) {
      for (let i = 1; i < line.tiers.length; i++) {
        expect(line.tiers[i].cost).toBeGreaterThan(line.tiers[i - 1].cost);
        expect(line.tiers[i].value).toBeGreaterThan(line.tiers[i - 1].value);
      }
      expect(line.tiers[0].cost).toBe(0);
    }
  });

  it('clamps upgrade lookups at the top tier', () => {
    expect(upgradeValue('drill', 99)).toBe(upgradeValue('drill', MAX_LEVEL));
    expect(upgradeTier('hull', 99).name).toBe(upgradeTier('hull', MAX_LEVEL).name);
  });

  it('keeps a full refit affordable relative to what the deep game pays', () => {
    const total = UPGRADES.reduce(
      (sum, line) => sum + line.tiers.reduce((s, t) => s + t.cost, 0),
      0,
    );
    expect(total).toBeGreaterThan(1_000_000);
    expect(total).toBeLessThan(3_000_000);
    expect(SERVICE.RESCUE_CUT).toBeGreaterThan(0);
    expect(SERVICE.RESCUE_CUT).toBeLessThan(0.5);
  });
});

describe('sensor catalogue', () => {
  it('sells strictly in order, so the Engine cannot be bought first', () => {
    const owned = new Set();
    expect(sensorAvailable('providence', owned)).toBe(false);
    expect(sensorAvailable(SENSORS[0].key, owned)).toBe(true);

    for (const module of SENSORS) {
      expect(sensorAvailable(module.key, owned)).toBe(true);
      owned.add(module.key);
      // Already fitted is not available again.
      expect(sensorAvailable(module.key, owned)).toBe(false);
    }
  });

  it('prices the Providence Engine as the thing you buy last', () => {
    const engine = SENSORS[SENSORS.length - 1];
    expect(engine.key).toBe('providence');
    expect(engine.cost).toBe(666000);
    expect(engine.tithe).toBeGreaterThan(0);
    for (const other of SENSORS.slice(0, -1)) {
      expect(other.cost).toBeLessThan(engine.cost);
    }
  });
});

describe('narrative', () => {
  const base = { launched: false, depth: 0, earned: 0, rescues: 0, sensors: new Set() };

  it('fires the opening beat once and only once', () => {
    const n = new Narrative();
    expect(n.update({ ...base, launched: true }).length).toBe(1);
    expect(n.update({ ...base, launched: true }).length).toBe(0);
  });

  it('holds deep beats back until the pod has actually been deep', () => {
    const n = new Narrative();
    n.update({ ...base, launched: true });
    expect(n.fired.has('depth220')).toBe(false);
    n.update({ ...base, launched: true, depth: 230 });
    expect(n.fired.has('depth220')).toBe(true);
  });

  it('remembers what has already been printed across a save', () => {
    const n = new Narrative();
    n.update({ ...base, launched: true });
    const restored = new Narrative(n.toJSON());
    expect(restored.update({ ...base, launched: true }).length).toBe(0);
  });

  it('has a unique id and some text for every beat', () => {
    const ids = new Set();
    for (const beat of BEATS) {
      expect(ids.has(beat.id)).toBe(false);
      ids.add(beat.id);
      expect(beat.lines.length).toBeGreaterThan(0);
      expect(typeof beat.when).toBe('function');
    }
  });
});

describe('save', () => {
  beforeEach(() => {
    // jsdom is not configured for these tests, so stand in a tiny localStorage.
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
  });

  it('round-trips a run through storage as seed plus edits', async () => {
    const { saveGame, loadGame, hasSave, applyDiff } = await import('../src/game/save.js');
    const pod = new Pod();
    pod.cash = 90210;
    pod.addOre(GOLDIUM, 3);
    pod.sensors.add('densitometer');

    const modified = new Map([[1234, AIR], [5678, AIR]]);
    expect(hasSave()).toBe(false);
    const result = saveGame({
      seed: 1337,
      pod,
      position: { x: 32.5, y: -40, z: 32.5 },
      modified,
      deepest: 40,
      narrative: ['welcome'],
    });
    expect(result.ok).toBe(true);
    expect(result.blocks).toBe(2);
    expect(hasSave()).toBe(true);

    const loaded = loadGame();
    expect(loaded.seed).toBe(1337);
    expect(loaded.pod.cash).toBe(90210);
    expect(loaded.pod.cargoValue()).toBe(750);
    expect([...loaded.pod.sensors]).toEqual(['densitometer']);
    expect(loaded.position).toEqual([32.5, -40, 32.5]);
    expect(loaded.narrative).toEqual(['welcome']);
    expect(loaded.diff.length).toBe(4);

    // Replaying the diff must reproduce the edits on a pristine world.
    const world = new VoxelWorld();
    world.data.fill(ROCK);
    applyDiff(world, loaded.diff);
    expect(world.data[1234]).toBe(AIR);
    expect(world.data[5678]).toBe(AIR);
  });

  it('stays small: a save is kilobytes, not the megabyte the grid occupies', async () => {
    const { saveGame } = await import('../src/game/save.js');
    const modified = new Map();
    for (let i = 0; i < 5000; i++) modified.set(i * 7, AIR);
    const result = saveGame({
      seed: 1,
      pod: new Pod(),
      position: { x: 0, y: 0, z: 0 },
      modified,
    });
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeLessThan(120_000);
  });
});

describe('impacts on every axis', () => {
  /** A body sitting in open air, ready to be flown into something. */
  const flyer = (x, y, z, v) => ({
    position: vec(x, y, z),
    velocity: { ...v },
    onGround: false,
    impactSpeed: 0,
    hitWall: false,
  });

  it('records an impact when the pod hits a wall, not only a floor', () => {
    const w = new VoxelWorld();
    // A wall filling one voxel column, and the pod flying into it at speed.
    for (let vy = 0; vy < 20; vy++) {
      for (let vz = 0; vz < 64; vz++) w.set(40, vy, vz, ROCK);
    }
    const body = flyer(38.0, -5.5, 32.5, { x: 26, y: 0, z: 0 });
    for (let i = 0; i < 40 && body.impactSpeed === 0; i++) integrate(w, body, 1 / 120);

    expect(body.impactSpeed).toBeGreaterThan(20);
    expect(body.hitWall).toBe(true);
    expect(body.velocity.x).toBe(0);
  });

  it('records an impact when the pod hits a ceiling', () => {
    const w = new VoxelWorld();
    for (let vz = 0; vz < 64; vz++) {
      for (let vx = 0; vx < 64; vx++) w.set(vx, 4, vz, ROCK);
    }
    // Layer 4 spans world Y [-5, -4], so the ceiling's underside is at -5.
    const body = flyer(32.5, -7.0, 32.5, { x: 0, y: 22, z: 0 });
    for (let i = 0; i < 40 && body.impactSpeed === 0; i++) integrate(w, body, 1 / 120);

    expect(body.impactSpeed).toBeGreaterThan(15);
    expect(body.velocity.y).toBe(0);
  });

  it('stops the pod against a surface installation', () => {
    const w = new VoxelWorld();
    const solids = [{ x: 40, z: 32.5, hx: 5, hz: 5, top: 7 }];
    // Started close in: horizontal drag is heavy, and the point of the test is the
    // collision, not how much speed the pod bleeds crossing the plaza.
    const body = flyer(33.6, 1.0, 32.5, { x: 24, y: 0, z: 0 });
    for (let i = 0; i < 60 && body.impactSpeed === 0; i++) {
      integrate(w, body, 1 / 120, { solids });
    }

    expect(body.impactSpeed).toBeGreaterThan(18);
    // Held outside the box rather than pushed through it.
    expect(body.position.x).toBeLessThan(35.1);
  });

  it('lets the pod land on an installation roof rather than clipping into it', () => {
    const w = new VoxelWorld();
    const solids = [{ x: 32.5, z: 32.5, hx: 5, hz: 5, top: 7 }];
    const body = flyer(32.5, 9.0, 32.5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 400; i++) integrate(w, body, 1 / 120, { solids });

    expect(body.onGround).toBe(true);
    expect(body.position.y).toBeGreaterThan(7.3);
    expect(body.position.y).toBeLessThan(7.5);
  });
});

describe('ground clearance', () => {
  it('reports the height of the floor under the pod', async () => {
    const { groundBelow } = await import('../src/player/physics.js');
    const w = new VoxelWorld();
    for (let vz = 0; vz < 64; vz++) {
      for (let vx = 0; vx < 64; vx++) w.set(vx, 10, vz, ROCK);
    }
    // Layer 10 spans world Y [-11, -10]; its top face is -10.
    expect(groundBelow(w, 32.5, 0, 32.5)).toBe(-10);
    // Nothing within reach reads as no ground at all, not as zero.
    expect(groundBelow(w, 32.5, 0, 32.5, { reach: 4 })).toBe(null);
  });
});
