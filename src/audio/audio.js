import { BLOCKS, isOre } from '../world/blocks.js';
import {
  noiseBuffer, impulseResponse, tone, burst, noiseVoice, lfo, glide,
} from './synth.js';
import { createAmbience } from './ambience.js';
import { createMusic } from './music.js';

/**
 * The mixer, the machinery, and every sound the game makes on purpose.
 *
 * Nothing here is a recording. Everything is oscillators, filtered noise and gain
 * envelopes, generated at boot, for the same reason there are no texture files.
 *
 * The design is the one simulation games have converged on, because it works:
 *
 *   - Continuous voices for anything that is *running*, driven by the simulation
 *     rather than triggered by it. The drill is not a sample that plays while you
 *     hold the button, it is a machine whose timbre comes from the block under the
 *     bit — soft regolith churns, basalt grinds, and ore rings.
 *   - Discrete, mechanical feedback for anything you *do*. Switches clack, screens
 *     chirp, the teletype hammers. Nothing in the cabin goes "boop".
 *   - Alarms that tell you which thing is wrong, in a cadence you can recognise
 *     before you have looked up, and that never stack.
 *   - A bed underneath all of it that says where you are, and a score that says
 *     how deep. See ambience.js and music.js.
 *
 * Four buses so that all of that can coexist: the cabin stays crisp and dry, the
 * mine sits behind a small reverb, the beds sit behind the mine, and the score sits
 * under everything and gets out of the way when the drill is cutting. A compressor
 * across the master keeps a gas detonation during a thruster burn from clipping.
 */

/** Warning cadences, most severe first. Only one sounds at a time — see faults(). */
const FAULTS = [
  { key: 'hull', period: 0.85, gain: 0.16, pattern: [1180, 880, 1180] },
  { key: 'heat', period: 1.05, gain: 0.13, pattern: [1480, 1480, 1480] },
  { key: 'fuel', period: 1.9, gain: 0.12, pattern: [740, 620] },
  { key: 'cargo', period: 3.4, gain: 0.09, pattern: [980] },
];

export function createAudio() {
  let ctx = null;
  let enabled = true;
  let started = false;
  /** Master trim, 0..1. The mixer below is balanced against this sitting at 0.7. */
  let volume = 0.7;

  let master = null;
  let ui = null;
  let world = null;
  let ambientBus = null;
  let musicBus = null;
  let reverbIn = null;
  let noise = null;

  let ambience = null;
  let music = null;
  let probe = null;
  let probeData = null;

  // Continuous machinery voices.
  let drillBand = null;
  let drillLow = null;
  let drillGain = null;
  let motor = null;
  let motorGain = null;
  let ringFilter = null;
  let ringGain = null;
  let thrustFilter = null;
  let thrustGain = null;
  let thrustRumble = null;
  let projectorGain = null;
  let providenceGain = null;
  let providenceOsc = null;

  function build() {
    if (started) return;
    started = true;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      enabled = false;
      return;
    }
    ctx = new AC();

    // --- Mixer ---------------------------------------------------------------
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0.0001;

    // Glue, and a ceiling. Without this a detonation on top of a thruster burn on
    // top of the score is comfortably past full scale.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    master.connect(comp);
    comp.connect(ctx.destination);

    ui = ctx.createGain();
    ui.gain.value = 0.55;
    ui.connect(master);

    world = ctx.createGain();
    world.gain.value = 0.9;
    world.connect(master);

    ambientBus = ctx.createGain();
    ambientBus.gain.value = 0.85;
    ambientBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.8;
    musicBus.connect(master);

    // --- Reverb --------------------------------------------------------------
    // A send, not an insert: the mine is wet, the cabin is dry, and a switch you
    // throw six inches from your face should not have a tail on it.
    const convolver = ctx.createConvolver();
    convolver.buffer = impulseResponse(ctx, { seconds: 1.7, decay: 3.2 });
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    convolver.connect(wet);
    wet.connect(master);
    reverbIn = ctx.createGain();
    reverbIn.gain.value = 1;
    reverbIn.connect(convolver);
    reverbIn.connect(world);

    noise = noiseBuffer(ctx);

    // --- Drill ---------------------------------------------------------------
    drillGain = ctx.createGain();
    drillGain.gain.value = 0;
    drillGain.connect(reverbIn);

    drillLow = ctx.createBiquadFilter();
    drillLow.type = 'lowpass';
    drillLow.frequency.value = 900;
    drillLow.connect(drillGain);

    drillBand = ctx.createBiquadFilter();
    drillBand.type = 'bandpass';
    drillBand.frequency.value = 180;
    drillBand.Q.value = 1.2;
    drillBand.connect(drillLow);

    const drillNoise = ctx.createBufferSource();
    drillNoise.buffer = noise;
    drillNoise.loop = true;
    drillNoise.connect(drillBand);
    drillNoise.start();

    // The ring: a narrow resonant peak that only opens up on ore.
    ringGain = ctx.createGain();
    ringGain.gain.value = 0;
    ringGain.connect(reverbIn);
    ringFilter = ctx.createBiquadFilter();
    ringFilter.type = 'bandpass';
    ringFilter.frequency.value = 1400;
    ringFilter.Q.value = 18;
    ringFilter.connect(ringGain);
    const ringSource = ctx.createBufferSource();
    ringSource.buffer = noise;
    ringSource.loop = true;
    ringSource.connect(ringFilter);
    ringSource.start();

    // The motor: a low square under the noise so the drill has a *machine* in it.
    motorGain = ctx.createGain();
    motorGain.gain.value = 0;
    motorGain.connect(world);
    motor = ctx.createOscillator();
    motor.type = 'square';
    motor.frequency.value = 42;
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 260;
    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motor.start();

    // --- Thrusters -----------------------------------------------------------
    // Two layers: the hiss of gas leaving a nozzle, and the rumble it makes in the
    // frame. Hiss alone sounds like a leak; rumble alone sounds like a lorry.
    thrustGain = ctx.createGain();
    thrustGain.gain.value = 0;
    thrustGain.connect(world);
    thrustFilter = ctx.createBiquadFilter();
    thrustFilter.type = 'bandpass';
    thrustFilter.frequency.value = 620;
    thrustFilter.Q.value = 0.7;
    thrustFilter.connect(thrustGain);
    const thrustNoise = ctx.createBufferSource();
    thrustNoise.buffer = noise;
    thrustNoise.loop = true;
    thrustNoise.connect(thrustFilter);
    thrustNoise.start();

    thrustRumble = noiseVoice(ctx, noise, { type: 'lowpass', freq: 150, Q: 0.6, gain: 0 });
    thrustRumble.out.connect(world);

    // --- Map projector -------------------------------------------------------
    // A cooling fan and a transformer. It is a piece of hardware on the dash and it
    // should be audible that you left it running.
    projectorGain = ctx.createGain();
    projectorGain.gain.value = 0;
    projectorGain.connect(ui);
    const fan = noiseVoice(ctx, noise, { type: 'bandpass', freq: 480, Q: 1.6, gain: 0.5 });
    fan.out.connect(projectorGain);
    const transformer = ctx.createOscillator();
    transformer.type = 'triangle';
    transformer.frequency.value = 232;
    const tg = ctx.createGain();
    tg.gain.value = 0.03;
    transformer.connect(tg);
    tg.connect(projectorGain);
    transformer.start();

    // --- Providence Engine ---------------------------------------------------
    // The top sensor tier is sold without a specification and bills you by the
    // second. It gets a voice to match: a detuned pair a tritone apart, drifting,
    // that you can hear the moment the safety cover comes off.
    providenceGain = ctx.createGain();
    providenceGain.gain.value = 0;
    providenceGain.connect(reverbIn);
    providenceOsc = ctx.createOscillator();
    providenceOsc.type = 'sawtooth';
    providenceOsc.frequency.value = 58.27;
    const pFilter = ctx.createBiquadFilter();
    pFilter.type = 'lowpass';
    pFilter.frequency.value = 300;
    const pTritone = ctx.createOscillator();
    pTritone.type = 'sawtooth';
    pTritone.frequency.value = 82.41;   // a tritone above: the interval nobody likes
    pTritone.detune.value = 9;
    providenceOsc.connect(pFilter);
    pTritone.connect(pFilter);
    pFilter.connect(providenceGain);
    lfo(ctx, pFilter.frequency, { rate: 0.087, depth: 140 });
    lfo(ctx, providenceOsc.detune, { rate: 0.037, depth: 22 });
    providenceOsc.start();
    pTritone.start();

    // A meter across the master, for the test harness. Nothing can be heard from a
    // headless browser, so the only way to assert that a sound exists is to measure
    // it — see scripts/audio-check.mjs.
    probe = ctx.createAnalyser();
    probe.fftSize = 2048;
    probeData = new Float32Array(probe.fftSize);
    master.connect(probe);

    ambience = createAmbience(ctx, { bus: ambientBus, noise, reverb: reverbIn });
    music = createMusic(ctx, musicBus);
  }

  /** Shorthands so every sound below reads as one line. */
  const T = (freq, opts = {}) => {
    if (!enabled || !ctx) return;
    tone(ctx, opts.bus ?? ui, freq, opts);
  };
  const B = (opts = {}) => {
    if (!enabled || !ctx) return;
    burst(ctx, opts.bus ?? ui, noise, opts);
  };

  let drillLevel = 0;
  let ringLevel = 0;
  let thrustLevel = 0;
  let chatter = 0;
  let biteIn = 0;
  let faultIn = 0;
  let faultKey = null;

  return {
    /** Must be called from a user gesture; the browser will not start audio before one. */
    start() {
      build();
      if (ctx?.state === 'suspended') ctx.resume();
    },

    get running() { return Boolean(ctx) && ctx.state === 'running'; },
    get enabled() { return enabled; },
    get movement() { return music?.movement ?? null; },

    /**
     * The context and the meter, for tooling.
     *
     * The Jukebox (tools/jukebox) needs somewhere to hang a scope and somewhere to
     * build audition voices that share this mixer. Read-only handles to what is
     * already there — nothing here changes what the game does.
     */
    get context() { return ctx; },
    get analyser() { return probe; },

    /** RMS across the master bus, 0..1. A test hook: see the note in build(). */
    level() {
      if (!probe) return 0;
      probe.getFloatTimeDomainData(probeData);
      let sum = 0;
      for (let i = 0; i < probeData.length; i++) sum += probeData[i] * probeData[i];
      return Math.sqrt(sum / probeData.length);
    },

    setEnabled(on) {
      enabled = on;
      if (master) master.gain.setTargetAtTime(on ? volume : 0.0001, ctx.currentTime, 0.05);
    },

    /**
     * Master trim, 0..1. Muted stays muted — the trim is remembered and takes
     * effect the next time the mixer is switched on.
     */
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
    },

    get volume() { return volume; },

    // --- Cabin ---------------------------------------------------------------
    /** A switch being thrown: a mechanical clack, not a beep. */
    switchClack(on) {
      B({ duration: 0.045, freq: on ? 2600 : 1900, Q: 1.4, gain: 0.30, sweep: 700 });
      T(on ? 240 : 180, { duration: 0.05, type: 'square', gain: 0.06 });
    },

    /** A region on a CRT being pressed. */
    chirp() {
      T(1480, { duration: 0.055, type: 'square', gain: 0.10, sweep: 1900 });
    },

    /** Page change, minor acknowledgement. */
    blip() {
      T(880, { duration: 0.04, type: 'square', gain: 0.07 });
    },

    /** A transaction went through. */
    confirm() {
      T(660, { duration: 0.07, type: 'square', gain: 0.10 });
      T(990, { duration: 0.09, type: 'square', gain: 0.10, delay: 0.06 });
      T(1320, { duration: 0.13, type: 'square', gain: 0.09, delay: 0.13 });
    },

    /** Refused: not enough credit, wrong order, nothing to sell. */
    deny() {
      T(200, { duration: 0.16, type: 'sawtooth', gain: 0.12, sweep: 130 });
    },

    /** Ore stowed in the bay. Richer ore lands higher. */
    stow(value = 0) {
      const base = value >= 20000 ? 1560 : value >= 2000 ? 1250 : value >= 250 ? 1050 : 880;
      T(base, { duration: 0.09, type: 'triangle', gain: 0.13 });
      T(base * 1.5, { duration: 0.14, type: 'triangle', gain: 0.10, delay: 0.07 });
      B({ duration: 0.10, freq: 320, Q: 1.2, gain: 0.09, sweep: 140, bus: world });
    },

    /** Generic two-tone attention tone. Kept for callers that just want a noise. */
    alarm() {
      T(720, { duration: 0.11, type: 'square', gain: 0.11 });
      T(560, { duration: 0.13, type: 'square', gain: 0.11, delay: 0.13 });
    },

    /** POST line printing during the boot self-test. */
    postTick() {
      B({ duration: 0.02, freq: 3200, Q: 3, gain: 0.05 });
    },

    /** One character striking the teletype paper. */
    typeTick() {
      B({ duration: 0.018, freq: 2400 + Math.random() * 900, Q: 6, gain: 0.075 });
    },

    /** End of a printed line: the carriage going back and the paper stepping on. */
    carriageReturn() {
      B({ duration: 0.13, freq: 1500, Q: 1.1, gain: 0.10, sweep: 420 });
      B({ duration: 0.07, freq: 700, Q: 2.4, gain: 0.07, delay: 0.13 });
    },

    /**
     * A cathode ray tube coming up, or going down.
     *
     * The thunk of a degaussing coil is the most recognisable "this machine just
     * switched on" sound there is, and the pod's terminal has earned it.
     */
    crtPower(on) {
      if (on) {
        B({ duration: 0.22, freq: 240, Q: 1.6, gain: 0.16, sweep: 90 });
        T(15600, { duration: 0.5, type: 'sine', gain: 0.012, attack: 0.25 });
      } else {
        T(15600, { duration: 0.22, type: 'sine', gain: 0.01, sweep: 400 });
        B({ duration: 0.12, freq: 180, Q: 1.2, gain: 0.08, sweep: 60 });
      }
    },

    /** Uplink to a surface installation established, or dropped. */
    uplink(on) {
      if (on) {
        T(520, { duration: 0.08, type: 'sine', gain: 0.10 });
        T(780, { duration: 0.10, type: 'sine', gain: 0.10, delay: 0.07 });
        T(1040, { duration: 0.20, type: 'sine', gain: 0.08, delay: 0.15 });
      } else {
        T(700, { duration: 0.10, type: 'sine', gain: 0.07, sweep: 420 });
      }
    },

    /** Hydrazine going into the tank. */
    pump() {
      B({ duration: 1.15, freq: 260, Q: 1.0, gain: 0.11, sweep: 520, bus: world });
      T(64, { duration: 1.2, type: 'square', gain: 0.05, sweep: 82, bus: world });
      B({ duration: 0.09, freq: 900, Q: 2, gain: 0.10, delay: 1.15 });
    },

    /** The repair rig working on the hull. */
    weld() {
      for (let i = 0; i < 5; i++) {
        B({
          duration: 0.10 + Math.random() * 0.13, freq: 2200 + Math.random() * 1600,
          Q: 1.1, gain: 0.09, sweep: 600, bus: world, delay: i * 0.17,
        });
      }
    },

    /** A module coming out of its bay and a new one going in. */
    servo() {
      T(180, { duration: 0.42, type: 'sawtooth', gain: 0.055, sweep: 320, bus: world });
      B({ duration: 0.07, freq: 1400, Q: 2.2, gain: 0.11, delay: 0.42 });
    },

    /** Cargo bay doors, and everything in them going away. */
    jettison() {
      B({ duration: 0.18, freq: 420, Q: 1.3, gain: 0.16, sweep: 150, bus: world });
      T(120, { duration: 0.30, type: 'square', gain: 0.07, sweep: 60, bus: world });
      for (let i = 0; i < 6; i++) {
        B({
          duration: 0.09, freq: 300 + Math.random() * 700, Q: 2, gain: 0.07,
          sweep: 180, bus: world, delay: 0.16 + i * 0.06 + Math.random() * 0.05,
        });
      }
    },

    /** The chirp sonar going out, and the rock answering. */
    sonarPing() {
      T(1760, { duration: 0.10, type: 'sine', gain: 0.075, sweep: 990 });
      T(880, { duration: 0.55, type: 'sine', gain: 0.030, attack: 0.02, delay: 0.11, bus: reverbIn });
    },

    // --- Mine ----------------------------------------------------------------
    /** Setting down on the pads, or on rock, without breaking anything. */
    touchdown(strength = 1) {
      const g = Math.min(0.22, 0.05 + strength * 0.02);
      B({ duration: 0.16, freq: 150, Q: 1.1, gain: g, sweep: 60, bus: world });
      B({ duration: 0.09, freq: 900, Q: 1.6, gain: g * 0.4, sweep: 300, bus: world });
    },

    /** Landing hard, or a rock coming down on the hull. */
    thud(strength = 1) {
      const g = Math.min(0.5, 0.12 + strength * 0.03);
      B({ duration: 0.28, freq: 180, Q: 0.8, gain: g, sweep: 60, bus: reverbIn });
      T(70, { duration: 0.32, type: 'sine', gain: g * 0.8, sweep: 38, bus: world });
    },

    /** Gas going up. */
    explosion(strength = 1) {
      const g = Math.min(0.6, 0.2 + strength * 0.4);
      B({ duration: 0.7, freq: 900, Q: 0.4, gain: g, sweep: 50, bus: reverbIn });
      T(90, { duration: 0.8, type: 'sine', gain: g * 0.7, sweep: 30, bus: world });
      // The rock answering afterwards, which is what gives it a room.
      B({ duration: 1.4, freq: 260, Q: 0.6, gain: g * 0.3, sweep: 80, bus: reverbIn, delay: 0.1 });
    },

    /** A pocket found but not yet lit. The one sound worth backing away from. */
    gasVent(strength = 1) {
      B({
        duration: 0.9, freq: 2600, Q: 3.2, gain: 0.05 + strength * 0.06,
        sweep: 1400, bus: reverbIn,
      });
    },

    /** Deep seismic movement. Long, low, and nothing you can do about it. */
    quake(strength = 1) {
      const g = Math.min(0.4, 0.14 + strength * 0.02);
      B({ duration: 2.4, freq: 90, Q: 0.5, gain: g, sweep: 40, bus: reverbIn });
      T(38, { duration: 2.8, type: 'sine', gain: g * 0.8, attack: 0.6, sweep: 24, bus: world });
    },

    /** A block giving way. */
    breakBlock(blockId) {
      const def = BLOCKS[blockId] ?? BLOCKS[2];
      const hard = Math.min(1, (def.hardness ?? 1) / 3);
      B({
        duration: 0.16, freq: 420 + hard * 900, Q: 1.1,
        gain: 0.20, sweep: 140, bus: reverbIn,
      });
    },

    /** Mr Natas cutting in on the emergency channel. */
    rescueSting() {
      T(58.27, { duration: 2.6, type: 'sawtooth', gain: 0.10, attack: 0.02, bus: world });
      T(82.41, { duration: 2.4, type: 'sawtooth', gain: 0.07, attack: 0.3, bus: world });
      B({ duration: 0.5, freq: 1800, Q: 0.8, gain: 0.10, sweep: 200, bus: reverbIn });
    },

    // --- Continuous machinery ------------------------------------------------
    /**
     * The drill voice.
     *
     * Timbre comes from the block: hardness raises the band the grind sits in and
     * tightens it, and ore opens a narrow resonant peak pitched off its value. The
     * result is that you learn what you are cutting by ear. On top of that the bit
     * *bites* — a tick rate that rises with drill power, so a tier-six drill in
     * soft rock sounds fast and a tier-one in basalt sounds like it is struggling.
     */
    drill(dt, { active = false, blockId = null, power = 1 } = {}) {
      if (!ctx) return;
      const now = ctx.currentTime;

      const target = active ? 1 : 0;
      drillLevel += (target - drillLevel) * Math.min(1, dt * (active ? 12 : 6));

      const def = blockId !== null ? BLOCKS[blockId] : null;
      const hardness = def ? Math.min(3.2, def.hardness || 1) : 1;
      const hard = hardness / 3.2;

      // Bit chatter: the band wobbles, so it grinds rather than hums.
      chatter += dt * (7 + power * 5);
      const wobble = 1 + Math.sin(chatter) * 0.16 + Math.sin(chatter * 2.7) * 0.07;

      glide(drillBand.frequency, (110 + hard * 340) * wobble, now, 0.05);
      glide(drillBand.Q, 0.8 + hard * 3.2, now, 0.08);
      glide(drillLow.frequency, 520 + hard * 2200, now, 0.08);
      glide(drillGain.gain, drillLevel * 0.22, now, 0.03);

      glide(motor.frequency, 34 + power * 16, now, 0.1);
      glide(motorGain.gain, drillLevel * 0.11, now, 0.05);

      // Ore rings. Richer ore rings higher and louder.
      const ore = def && isOre(def.id);
      const ringTarget = active && ore ? 1 : 0;
      ringLevel += (ringTarget - ringLevel) * Math.min(1, dt * 8);
      if (ore) {
        const v = Math.log10(Math.max(10, def.value));
        glide(ringFilter.frequency, 500 + v * 340, now, 0.06);
      }
      glide(ringGain.gain, ringLevel * 0.085, now, 0.05);

      // Individual bites of the auger against the face.
      if (active && drillLevel > 0.4) {
        biteIn -= dt;
        if (biteIn <= 0) {
          biteIn = 0.055 + (1 - Math.min(1, power / 6)) * 0.05 + hard * 0.04;
          B({
            duration: 0.035, freq: 900 + hard * 2200 + Math.random() * 400,
            Q: 3.5, gain: 0.05 + hard * 0.05, sweep: 300, bus: world,
          });
        }
      }
    },

    /** The bit spinning up when the clutch goes in, and winding down when it comes out. */
    clutch(engaged) {
      if (engaged) {
        T(38, { duration: 0.85, type: 'square', gain: 0.07, sweep: 118, bus: world });
        B({ duration: 0.10, freq: 700, Q: 2.0, gain: 0.13 });
      } else {
        T(118, { duration: 1.3, type: 'square', gain: 0.06, sweep: 32, bus: world });
        B({ duration: 0.08, freq: 520, Q: 2.0, gain: 0.10 });
      }
    },

    /** Thruster hiss and frame rumble, scaled by how hard the engines are working. */
    thruster(dt, amount = 0) {
      if (!ctx) return;
      const now = ctx.currentTime;
      thrustLevel += (Math.min(1, amount) - thrustLevel) * Math.min(1, dt * 7);
      glide(thrustGain.gain, thrustLevel * 0.075, now, 0.04);
      glide(thrustFilter.frequency, 420 + thrustLevel * 700, now, 0.06);
      glide(thrustRumble.out.gain, thrustLevel * 0.06, now, 0.05);
      glide(thrustRumble.filter.frequency, 110 + thrustLevel * 90, now, 0.08);
    },

    /** The hologram projector, running or not. */
    projector(on) {
      if (!ctx) return;
      glide(projectorGain.gain, on ? 0.035 : 0, ctx.currentTime, 0.25);
    },

    /** The Providence Engine, armed or stowed. */
    providence(on) {
      if (!ctx) return;
      glide(providenceGain.gain, on ? 0.075 : 0, ctx.currentTime, on ? 1.4 : 0.6);
    },

    /**
     * Fault klaxons.
     *
     * One at a time, most severe first, each with its own cadence — so the pilot
     * learns to identify the fault from across the cabin without reading a lamp.
     * They stop the instant the condition clears, which is what stops them being
     * the thing you turn the sound off to escape.
     */
    faults(dt, state = {}) {
      if (!ctx || !enabled) return;
      const active = FAULTS.find((f) => state[f.key]);
      if (!active) {
        faultKey = null;
        faultIn = 0;
        return;
      }
      // Switching to a worse fault sounds immediately; it has earned the interrupt.
      if (active.key !== faultKey) {
        faultKey = active.key;
        faultIn = 0;
      }
      faultIn -= dt;
      if (faultIn > 0) return;
      faultIn = active.period;
      active.pattern.forEach((freq, i) => {
        T(freq, {
          duration: 0.10, type: 'square', gain: active.gain, delay: i * 0.14,
        });
      });
    },

    /**
     * The beds and the score, once per frame.
     *
     * Everything in here is a continuous quantity read straight off the simulation:
     * no events, no triggers, just the world being loud in proportion to itself.
     */
    update(dt, state = {}) {
      if (!ctx) return;
      ambience.update(dt, state);
      music.update(dt, state);
    },
  };
}
