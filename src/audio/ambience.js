import { noiseVoice, burst, tone, lfo, glide } from './synth.js';

/**
 * The beds: everything you stop noticing after a minute and would notice
 * immediately if it stopped.
 *
 * Four environments share the pod, and which one you are in is a continuous
 * quantity rather than a state: on the pad you are almost all wind, at 200 m you
 * are almost all rock, and on the way down there is a stretch where you are half
 * of each. Crossfading them on depth is what makes the descent feel like a
 * journey rather than a change of backdrop.
 *
 * The cabin hum sits under all of it whenever the master switch is on, because the
 * single most important thing sound does in this game is tell you the machine is
 * alive. Throwing the switch in a cold, silent cockpit and hearing the electrics
 * come up is the whole opening of the game.
 */
export function createAmbience(ctx, { bus, noise, reverb }) {
  // --- Mars wind -----------------------------------------------------------
  // Wind whistles because something is in the way of it. The pod is a box with
  // struts, a drill boom and an aerial on it, and each of those has a note it sings
  // when the air goes past — so this is three narrow resonances rather than one
  // wide one. A broad filter over noise is just noise with the treble rolled off:
  // it reads as static, because nothing in it has a pitch to hear.
  //
  // Each voice wanders in pitch and swells in level on its own slow cycle, and the
  // cycles are deliberately incommensurate — 0.083, 0.052 and 0.037 Hz, none a
  // multiple of another — so the three never line up twice and the wind never
  // repeats a phrase. On top of that the weather itself drifts; see update().
  const windOut = ctx.createGain();
  windOut.gain.value = 0;
  windOut.connect(bus);

  const VOICES = [
    // freq   Q    wander  drift   gust   level  pan
    [1550, 13.0, 430, 0.083, 0.041, 3.4, -0.55],   // the whistle round a strut
    [620, 8.0, 190, 0.052, 0.029, 2.8, 0.45],   // the howl through the frame
    [245, 5.0, 80, 0.037, 0.023, 2.2, -0.15],   // a low moan under both
  ];
  const canPan = typeof ctx.createStereoPanner === 'function';
  const windVoices = VOICES.map(([freq, Q, wander, drift, gust, level, pan]) => {
    const v = noiseVoice(ctx, noise, { type: 'bandpass', freq, Q, gain: level });
    // Both of these are *added* to the parameter's own value, so update() can move
    // the base pitch and level underneath while these keep breathing on top.
    lfo(ctx, v.filter.frequency, { rate: drift, depth: wander });
    lfo(ctx, v.out.gain, { rate: gust, depth: level * 0.7 });
    if (canPan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      v.out.connect(p);
      p.connect(windOut);
    } else {
      v.out.connect(windOut);
    }
    return { ...v, base: freq, level };
  });

  // A thin bed of moving air beneath the resonances, so it is a wind and not an
  // organ. Quiet on purpose: it is the thing you would miss rather than hear.
  const windAir = noiseVoice(ctx, noise, { type: 'highpass', freq: 620, Q: 0.4, gain: 0.16 });
  windAir.out.connect(windOut);
  lfo(ctx, windAir.filter.frequency, { rate: 0.019, depth: 220 });

  // --- Cavern --------------------------------------------------------------
  // Not a sound so much as a pressure: everything above about 120 Hz removed, so
  // it reads as mass rather than as noise. Goes through the reverb, which is the
  // only thing that makes the mine feel like it has a size.
  const cavern = noiseVoice(ctx, noise, { type: 'lowpass', freq: 110, Q: 0.4, gain: 0 });
  cavern.out.connect(reverb ?? bus);
  lfo(ctx, cavern.filter.frequency, { rate: 0.023, depth: 34 });

  // A tectonic drone under it, felt rather than heard, that sinks as you descend.
  const groanGain = ctx.createGain();
  groanGain.gain.value = 0;
  groanGain.connect(bus);
  const groan = ctx.createOscillator();
  groan.type = 'sine';
  groan.frequency.value = 34;
  groan.connect(groanGain);
  groan.start();

  // --- Magma ---------------------------------------------------------------
  // Proximity, not contact. You should hear the chamber through the rock and have
  // the chance to change your mind about the next cut.
  const magma = noiseVoice(ctx, noise, { type: 'bandpass', freq: 190, Q: 0.7, gain: 0 });
  magma.out.connect(reverb ?? bus);
  lfo(ctx, magma.filter.frequency, { rate: 0.19, depth: 70 });

  // --- Cabin ---------------------------------------------------------------
  const cabin = ctx.createGain();
  cabin.gain.value = 0;
  cabin.connect(bus);

  // Mains hum and its third harmonic — the sound of a bus bar under load.
  for (const [f, g] of [[57, 0.5], [171, 0.12], [228, 0.05]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const a = ctx.createGain();
    a.gain.value = g;
    o.connect(a);
    a.connect(cabin);
    o.start();
  }
  // Air handling: a soft hiss so the cabin has an atmosphere in it.
  const air = noiseVoice(ctx, noise, { type: 'lowpass', freq: 1100, Q: 0.4, gain: 0.06 });
  air.out.connect(cabin);
  // A faint inverter whine on top, which is what makes it read as *electrical*.
  const whine = ctx.createOscillator();
  whine.type = 'triangle';
  whine.frequency.value = 3140;
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0.006;
  whine.connect(whineGain);
  whineGain.connect(cabin);
  whine.start();

  let creakIn = 6;
  let crackleIn = 0.4;
  let windLevel = 0;
  /**
   * The weather.
   *
   * The per-voice LFOs give the wind a breath; this gives it a mood. Every twenty
   * seconds or so it picks a new pitch centre and a new strength and takes its
   * time getting there, so a minute of standing on the pad is never the same
   * minute twice — it lulls, it gets up, it drops a semitone and sits there.
   * Without it three sine LFOs eventually reveal themselves as three sine LFOs.
   */
  let weatherIn = 0;
  let windPitch = 1;
  let windPitchTo = 1;
  let windForce = 0.7;
  let windForceTo = 0.7;
  let cavernLevel = 0;
  let magmaLevel = 0;
  let cabinLevel = 0;

  return {
    /**
     * @param {number} dt
     * @param {object} s
     * @param {number} s.depth      metres below datum; negative in the air
     * @param {number} s.live       0..1, systems powered
     * @param {number} s.hull       0..1 hull integrity
     * @param {number} s.magma      0..1 proximity to lava
     * @param {number} s.speed      m/s, for wind noise while moving
     */
    update(dt, { depth = 0, live = 0, hull = 1, magma: magmaNear = 0, speed = 0 } = {}) {
      const now = ctx.currentTime;

      // Crossfade. Fully outside by the surface, fully inside by twenty metres,
      // and a long overlap in between where the shaft mouth is still audible.
      const inside = Math.min(1, Math.max(0, depth / 20));
      const outside = 1 - inside;

      // Weather drift. New target every 16-34 seconds, crawled toward at a rate
      // slow enough that you never catch it changing.
      weatherIn -= dt;
      if (weatherIn <= 0) {
        weatherIn = 16 + Math.random() * 18;
        windPitchTo = 0.72 + Math.random() * 0.62;    // most of an octave either way
        windForceTo = 0.35 + Math.random() * 0.85;
      }
      windPitch += (windPitchTo - windPitch) * Math.min(1, dt * 0.09);
      windForce += (windForceTo - windForce) * Math.min(1, dt * 0.07);

      // Moving through the air raises the pitch as well as the level, which is the
      // difference between wind blowing past you and you flying through it.
      const rush = Math.min(1, speed * 0.05);
      for (const v of windVoices) {
        glide(v.filter.frequency, v.base * windPitch * (1 + rush * 0.22), now, 1.2);
      }
      windLevel += (outside * (0.062 + Math.min(0.05, speed * 0.004)) * windForce - windLevel)
        * Math.min(1, dt * 1.2);
      glide(windOut.gain, windLevel, now, 0.3);

      // Depth thickens the rock bed, but with a ceiling: past a hundred metres it
      // is already as heavy as it is going to get and the score takes over.
      const weight = Math.min(1, depth / 110);
      cavernLevel += (inside * (0.06 + weight * 0.10) - cavernLevel) * Math.min(1, dt * 0.8);
      glide(cavern.out.gain, cavernLevel, now, 0.4);
      glide(groanGain.gain, inside * (0.012 + weight * 0.03), now, 0.6);
      glide(groan.frequency, 38 - weight * 12, now, 1.2);

      magmaLevel += (Math.min(1, magmaNear) - magmaLevel) * Math.min(1, dt * 1.6);
      glide(magma.out.gain, magmaLevel * 0.16, now, 0.2);

      cabinLevel += (live * 0.05 - cabinLevel) * Math.min(1, dt * 2.2);
      glide(cabin.gain, cabinLevel, now, 0.15);

      if (!live) return;

      // --- Hull stress ------------------------------------------------------
      // The pod complains. How often depends on how deep you are and how much of
      // the hull is left, which makes a damaged pod at depth genuinely unnerving
      // to sit in without a single number changing on the panel.
      creakIn -= dt * (0.35 + weight * 1.5 + (1 - hull) * 1.8) * inside;
      if (creakIn <= 0) {
        creakIn = 5 + Math.random() * 14;
        const strain = weight * 0.6 + (1 - hull) * 0.6;
        burst(ctx, reverb ?? bus, noise, {
          duration: 0.5 + Math.random() * 0.7,
          freq: 150 + Math.random() * 260,
          Q: 7 + strain * 9,
          gain: 0.05 + strain * 0.10,
          sweep: 70 + Math.random() * 90,
        });
        // A metal groan under the creak, pitched down: steel giving, not gravel.
        tone(ctx, reverb ?? bus, 90 + Math.random() * 60, {
          duration: 1.1, type: 'sine', gain: 0.03 + strain * 0.05,
          attack: 0.25, sweep: 52,
        });
      }

      // --- Magma crackle ----------------------------------------------------
      if (magmaLevel > 0.12) {
        crackleIn -= dt * magmaLevel * 3;
        if (crackleIn <= 0) {
          crackleIn = 0.15 + Math.random() * 0.5;
          burst(ctx, reverb ?? bus, noise, {
            duration: 0.05 + Math.random() * 0.12,
            freq: 700 + Math.random() * 1800,
            Q: 2.5,
            gain: 0.03 + magmaLevel * 0.06,
            sweep: 220,
          });
        }
      }
    },
  };
}
