import { tone, lfo, glide } from './synth.js';

/**
 * The score, which is not a soundtrack.
 *
 * There is no composed music in this game and no loop that plays over the top of
 * it. What there is is a chord that belongs to the rock you are currently inside,
 * and the rock changes as you dig. Every movement here is pinned to a stratum: the
 * root note walks *down* as you descend, the mode sours, the filter closes, and by
 * the time you are at the bottom of the claim the harmony has become something you
 * would not choose to sit in.
 *
 * That is the whole idea. The player should be able to tell roughly how deep they
 * are with their eyes shut, and should feel the ground getting worse before the
 * instruments say so. It is diegetic in the only sense that matters for sound: it
 * is *about* the place, and it is generated from the same numbers the place is.
 *
 * Nothing here has a tempo. A pulse would make it a soundtrack and start competing
 * with the machinery, which is the thing the player is actually listening to.
 */

/**
 * Movements, deepest last. `from` is the depth in metres at which each takes over.
 *
 * Roots descend by whole steps, so the transitions are audible as a settling rather
 * than a key change. Chords are semitone offsets from the root.
 */
export const MOVEMENTS = [
  {
    name: 'SURFACE',
    from: -Infinity,
    root: 110.00,          // A2 — open, cold, unresolved. Nobody lives here either.
    chord: [0, 7, 14, 19],  // fifth and ninth: wide and empty, no third to commit
    cutoff: 900,
    level: 0.055,
    detune: 6,
  },
  {
    name: 'OVERBURDEN',
    from: 14,
    root: 98.00,           // G2
    chord: [0, 3, 7, 10],   // plain aeolian minor: the work starts
    cutoff: 720,
    level: 0.065,
    detune: 8,
  },
  {
    name: 'DEEP STRATA',
    from: 62,
    root: 87.31,           // F2
    chord: [0, 3, 7, 10],
    cutoff: 540,
    level: 0.070,
    detune: 11,
  },
  {
    name: 'BASALT',
    from: 122,
    root: 82.41,           // E2
    chord: [0, 3, 8, 10],   // minor with a flat sixth leaning on the fifth
    cutoff: 420,
    level: 0.075,
    detune: 14,
  },
  {
    name: 'THE DEEP',
    from: 182,
    root: 73.42,           // D2
    chord: [0, 3, 6, 10],   // half-diminished: nothing here is stable
    cutoff: 330,
    level: 0.080,
    detune: 18,
  },
  {
    name: 'THE SEAL',
    from: 234,
    root: 65.41,           // C2
    chord: [0, 1, 6, 7],    // minor second against a tritone. Not a chord, a warning.
    cutoff: 260,
    level: 0.090,
    detune: 24,
  },
];

const semitone = (root, n) => root * 2 ** (n / 12);

/**
 * Which movement owns this depth. Pure, and exported, because the mapping from
 * strata to harmony is the one part of the score worth asserting in a test: the
 * roots must descend, the bands must not overlap, and the surface must be the
 * thing you get when you are standing on it.
 */
export function movementFor(depth) {
  let found = MOVEMENTS[0];
  for (const m of MOVEMENTS) if (depth >= m.from) found = m;
  return found;
}

export function createMusic(ctx, destination, { voices = 4 } = {}) {
  // --- Pad -----------------------------------------------------------------
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  filter.Q.value = 0.9;
  filter.connect(out);

  // The filter breathes. A drone that holds perfectly still stops being heard
  // after about twenty seconds; one that wanders never quite does.
  lfo(ctx, filter.frequency, { rate: 0.031, depth: 130 });

  /** Each chord tone is two oscillators a few cents apart, which is what makes it
   *  sound like an instrument rather than a test signal. */
  const pad = [];
  for (let i = 0; i < voices; i++) {
    const vGain = ctx.createGain();
    vGain.gain.value = i === 0 ? 0.5 : 0.3 / i;
    vGain.connect(filter);
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sawtooth';
    b.type = 'triangle';
    a.frequency.value = 110;
    b.frequency.value = 110;
    a.connect(vGain);
    b.connect(vGain);
    a.start();
    b.start();
    pad.push({ a, b, gain: vGain });
  }

  // Sub: an octave below the root, sine, felt more than heard.
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;
  subGain.connect(filter);
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 55;
  sub.connect(subGain);
  sub.start();

  const canPan = typeof ctx.createStereoPanner === 'function';

  let movement = MOVEMENTS[0];
  let level = 0;
  let motifIn = 9;
  let announced = null;


  /** Retune every voice. Slow glides, so a stratum change settles rather than cuts. */
  function retune(m, now, time) {
    for (let i = 0; i < pad.length; i++) {
      const n = m.chord[i % m.chord.length] + (i >= m.chord.length ? 12 : 0);
      const f = semitone(m.root, n);
      glide(pad[i].a.frequency, f, now, time);
      glide(pad[i].b.frequency, f, now, time);
      pad[i].a.detune.setTargetAtTime(-m.detune, now, time);
      pad[i].b.detune.setTargetAtTime(m.detune, now, time);
    }
    glide(sub.frequency, m.root / 2, now, time);
    glide(filter.frequency, m.cutoff, now, time);
  }

  retune(movement, ctx.currentTime, 0.01);

  return {
    get movement() { return movement.name; },

    /**
     * @param {number} dt
     * @param {{depth:number, live:boolean, drilling:number, danger:number}} state
     *   `drilling` and `danger` are 0..1. The score gets out of the way of the
     *   machine and leans in when the mine is trying to kill you.
     */
    update(dt, { depth = 0, live = false, drilling = 0, danger = 0 } = {}) {
      const now = ctx.currentTime;

      const next = movementFor(depth);
      if (next !== movement) {
        movement = next;
        // Eight seconds to cross a stratum boundary: slow enough that nobody
        // catches it happening, fast enough to have arrived by the time it matters.
        retune(movement, now, 2.6);
      }

      // A cold pod is silent. The score is part of the machine being switched on,
      // not part of the game being open.
      const duck = 1 - drilling * 0.55;
      const target = live ? movement.level * duck * (1 + danger * 0.5) : 0;
      level += (target - level) * Math.min(1, dt * 0.9);
      glide(out.gain, level, now, 0.4);

      if (!live) {
        announced = null;
        return;
      }

      // Mark an arrival, once, quietly: a low swell as the new stratum takes over.
      if (announced !== movement.name) {
        if (announced !== null) {
          tone(ctx, destination, movement.root / 2, {
            duration: 5.0, type: 'sine', gain: 0.06, attack: 1.6,
          });
        }
        announced = movement.name;
      }

      // --- Motif ------------------------------------------------------------
      // Single notes from the current chord, two or three octaves up, at intervals
      // long enough that they never form a rhythm. They are the only thing in the
      // mix that could be called a melody, and there is deliberately not much of it.
      motifIn -= dt;
      if (motifIn <= 0) {
        motifIn = 7 + Math.random() * 11;
        const n = movement.chord[(Math.random() * movement.chord.length) | 0];
        const octave = 24 + (Math.random() < 0.35 ? 12 : 0);
        const freq = semitone(movement.root, n + octave);

        let bus = destination;
        if (canPan) {
          const panner = ctx.createStereoPanner();
          panner.pan.value = (Math.random() * 2 - 1) * 0.7;
          panner.connect(destination);
          bus = panner;
        }
        tone(ctx, bus, freq, {
          duration: 3.2 + Math.random() * 2.5,
          type: 'triangle',
          gain: 0.035 * duck,
          attack: 0.6,
        });
        // A fifth underneath it, quieter and later: two notes read as an
        // instrument, one reads as a beep.
        tone(ctx, bus, semitone(movement.root, n + octave - 5), {
          duration: 2.6, type: 'sine', gain: 0.02 * duck, attack: 0.8, delay: 0.35,
        });
      }
    },
  };
}
