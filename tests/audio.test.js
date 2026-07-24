import { describe, it, expect } from 'vitest';
import { MOVEMENTS, movementFor } from '../src/audio/music.js';
import { ORE_TABLE } from '../src/world/blocks.js';

/**
 * The score's mapping from strata to harmony.
 *
 * Everything else about the audio needs an AudioContext and a pair of ears; this
 * part is a pure function over depth and is exactly the part that would break
 * silently. A movement table with an out-of-order threshold does not throw, it just
 * quietly plays the wrong chord for the next two hundred metres.
 */
describe('the environmental score', () => {
  it('starts at the surface and ends at the seal', () => {
    expect(movementFor(-5).name).toBe('SURFACE');
    expect(movementFor(0).name).toBe('SURFACE');
    expect(movementFor(1000).name).toBe('THE SEAL');
  });

  it('hands over at each threshold and not before', () => {
    for (const m of MOVEMENTS) {
      if (m.from === -Infinity) continue;
      expect(movementFor(m.from).name).toBe(m.name);
      // A hair above the previous boundary must still be the previous movement.
      expect(movementFor(m.from - 0.01).name).not.toBe(m.name);
    }
  });

  it('descends: every movement is lower and darker than the one above it', () => {
    for (let i = 1; i < MOVEMENTS.length; i++) {
      const above = MOVEMENTS[i - 1];
      const below = MOVEMENTS[i];
      expect(below.from).toBeGreaterThan(above.from);
      // The root walks down and the filter closes. That descent *is* the score.
      expect(below.root).toBeLessThan(above.root);
      expect(below.cutoff).toBeLessThan(above.cutoff);
    }
  });

  it('covers the whole claim, including the deepest ore', () => {
    // The last movement must begin at or before the deepest thing worth digging
    // for, or the bottom of the game would be scored by the movement above it.
    const deepestOre = Math.max(...ORE_TABLE.map((o) => o.peak));
    const last = MOVEMENTS[MOVEMENTS.length - 1];
    expect(last.from).toBeGreaterThan(deepestOre * 0.8);
    // And no gap: every depth from the surface down resolves to something.
    for (let d = 0; d <= 256; d += 4) {
      expect(movementFor(d)).toBeTruthy();
    }
  });

  it('gives every movement a playable chord', () => {
    for (const m of MOVEMENTS) {
      expect(m.chord.length).toBeGreaterThanOrEqual(3);
      expect(m.chord[0]).toBe(0);            // always voiced from the root
      expect(m.level).toBeGreaterThan(0);
      for (const n of m.chord) expect(Number.isFinite(n)).toBe(true);
    }
  });
});
