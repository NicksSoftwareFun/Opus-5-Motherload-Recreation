import { BLOCKS, isOre } from '../world/blocks.js';

/**
 * All of the game's sound, synthesised at runtime.
 *
 * There are no audio files for the same reason there are no textures: everything is
 * generated, so the whole game still fits in one HTML file. Every effect here is
 * oscillators, filtered noise and gain envelopes.
 *
 * The drill is the interesting one. It is not a sample that plays while you hold the
 * button — it is a continuous rumble whose timbre is derived from the block under the
 * bit. Soft regolith is a low, muffled churn; deep basalt is a harder, grittier,
 * higher-passed grind; and ore rings, with a resonant tone pitched off its value, so
 * you can *hear* that you have hit something worth stowing before you look up at the
 * assay strip.
 */

/** A couple of seconds of white noise, looped as the bed for everything gritty. */
function noiseBuffer(ctx, seconds = 2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let ui = null;
  let world = null;
  let noise = null;
  let enabled = true;
  let started = false;

  // Drill voice
  let drillNoise = null;
  let drillBand = null;
  let drillLow = null;
  let drillGain = null;
  let motor = null;
  let motorGain = null;
  let ringFilter = null;
  let ringGain = null;

  // Thruster voice
  let thrustNoise = null;
  let thrustFilter = null;
  let thrustGain = null;

  function build() {
    if (started) return;
    started = true;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      enabled = false;
      return;
    }
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);

    // Two buses so cabin sounds stay crisp while the mine sits behind them.
    ui = ctx.createGain();
    ui.gain.value = 0.55;
    ui.connect(master);

    world = ctx.createGain();
    world.gain.value = 0.9;
    world.connect(master);

    noise = noiseBuffer(ctx);

    // --- Drill --------------------------------------------------------------
    drillGain = ctx.createGain();
    drillGain.gain.value = 0;
    drillGain.connect(world);

    drillLow = ctx.createBiquadFilter();
    drillLow.type = 'lowpass';
    drillLow.frequency.value = 900;
    drillLow.connect(drillGain);

    drillBand = ctx.createBiquadFilter();
    drillBand.type = 'bandpass';
    drillBand.frequency.value = 180;
    drillBand.Q.value = 1.2;
    drillBand.connect(drillLow);

    drillNoise = ctx.createBufferSource();
    drillNoise.buffer = noise;
    drillNoise.loop = true;
    drillNoise.connect(drillBand);
    drillNoise.start();

    // The ring: a narrow resonant peak that only opens up on ore.
    ringGain = ctx.createGain();
    ringGain.gain.value = 0;
    ringGain.connect(world);
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

    // --- Thrusters ----------------------------------------------------------
    thrustGain = ctx.createGain();
    thrustGain.gain.value = 0;
    thrustGain.connect(world);
    thrustFilter = ctx.createBiquadFilter();
    thrustFilter.type = 'bandpass';
    thrustFilter.frequency.value = 620;
    thrustFilter.Q.value = 0.7;
    thrustFilter.connect(thrustGain);
    thrustNoise = ctx.createBufferSource();
    thrustNoise.buffer = noise;
    thrustNoise.loop = true;
    thrustNoise.connect(thrustFilter);
    thrustNoise.start();
  }

  /** One-shot tone with an envelope. The workhorse behind every UI sound. */
  function tone(freq, {
    duration = 0.09, type = 'square', gain = 0.16, attack = 0.004,
    sweep = null, bus = null, delay = 0,
  } = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + duration);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(env);
    env.connect(bus ?? ui);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Filtered noise burst — clicks, thuds, hisses. */
  function burst({
    duration = 0.08, freq = 900, Q = 1, gain = 0.2, type = 'bandpass',
    bus = null, sweep = null,
  } = {}) {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    if (sweep !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + duration);
    filter.Q.value = Q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(bus ?? ui);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  let drillLevel = 0;
  let ringLevel = 0;
  let thrustLevel = 0;
  let chatter = 0;

  return {
    /** Must be called from a user gesture; the browser will not start audio before one. */
    start() {
      build();
      if (ctx?.state === 'suspended') ctx.resume();
    },

    get running() { return Boolean(ctx) && ctx.state === 'running'; },
    get enabled() { return enabled; },

    setEnabled(on) {
      enabled = on;
      if (master) {
        master.gain.setTargetAtTime(on ? 0.7 : 0.0001, ctx.currentTime, 0.05);
      }
    },

    // --- Cabin ---------------------------------------------------------------
    /** A switch being thrown: a mechanical clack, not a beep. */
    switchClack(on) {
      burst({ duration: 0.045, freq: on ? 2600 : 1900, Q: 1.4, gain: 0.30, sweep: 700 });
      tone(on ? 240 : 180, { duration: 0.05, type: 'square', gain: 0.06 });
    },

    /** A region on a CRT being pressed. */
    chirp() {
      tone(1480, { duration: 0.055, type: 'square', gain: 0.10, sweep: 1900 });
    },

    /** Page change, minor acknowledgement. */
    blip() {
      tone(880, { duration: 0.04, type: 'square', gain: 0.07 });
    },

    /** A transaction went through. */
    confirm() {
      tone(660, { duration: 0.07, type: 'square', gain: 0.10 });
      tone(990, { duration: 0.09, type: 'square', gain: 0.10, delay: 0.06 });
      tone(1320, { duration: 0.13, type: 'square', gain: 0.09, delay: 0.13 });
    },

    /** Refused: not enough credit, wrong order, nothing to sell. */
    deny() {
      tone(200, { duration: 0.16, type: 'sawtooth', gain: 0.12, sweep: 130 });
    },

    /** Ore stowed in the bay. */
    stow(value = 0) {
      const base = value >= 20000 ? 1560 : value >= 2000 ? 1250 : value >= 250 ? 1050 : 880;
      tone(base, { duration: 0.09, type: 'triangle', gain: 0.13 });
      tone(base * 1.5, { duration: 0.14, type: 'triangle', gain: 0.10, delay: 0.07 });
    },

    /** The pod's own alarm, for a lamp that has started flashing. */
    alarm() {
      tone(720, { duration: 0.11, type: 'square', gain: 0.11 });
      tone(560, { duration: 0.13, type: 'square', gain: 0.11, delay: 0.13 });
    },

    /** POST line printing during the boot self-test. */
    postTick() {
      burst({ duration: 0.02, freq: 3200, Q: 3, gain: 0.05 });
    },

    /** One character striking the teletype paper. */
    typeTick() {
      burst({ duration: 0.018, freq: 2400 + Math.random() * 900, Q: 6, gain: 0.075 });
    },

    // --- Mine ----------------------------------------------------------------
    /** Landing hard, or a rock coming down on the hull. */
    thud(strength = 1) {
      const g = Math.min(0.5, 0.12 + strength * 0.03);
      burst({ duration: 0.28, freq: 180, Q: 0.8, gain: g, sweep: 60, bus: world });
      tone(70, { duration: 0.32, type: 'sine', gain: g * 0.8, sweep: 38, bus: world });
    },

    /** Gas going up. */
    explosion(strength = 1) {
      const g = Math.min(0.6, 0.2 + strength * 0.4);
      burst({ duration: 0.7, freq: 900, Q: 0.4, gain: g, sweep: 50, bus: world });
      tone(90, { duration: 0.8, type: 'sine', gain: g * 0.7, sweep: 30, bus: world });
    },

    /** A block giving way. */
    breakBlock(blockId) {
      const def = BLOCKS[blockId] ?? BLOCKS[2];
      const hard = Math.min(1, (def.hardness ?? 1) / 3);
      burst({
        duration: 0.16, freq: 420 + hard * 900, Q: 1.1,
        gain: 0.20, sweep: 140, bus: world,
      });
    },

    /**
     * The continuous drill voice.
     *
     * Timbre comes from the block: hardness raises the band the grind sits in and
     * tightens it, and ore opens a narrow resonant peak pitched off its value. The
     * result is that you learn what you are cutting by ear.
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

      drillBand.frequency.setTargetAtTime((110 + hard * 340) * wobble, now, 0.05);
      drillBand.Q.setTargetAtTime(0.8 + hard * 3.2, now, 0.08);
      drillLow.frequency.setTargetAtTime(520 + hard * 2200, now, 0.08);
      drillGain.gain.setTargetAtTime(drillLevel * 0.22, now, 0.03);

      motor.frequency.setTargetAtTime(34 + power * 16, now, 0.1);
      motorGain.gain.setTargetAtTime(drillLevel * 0.11, now, 0.05);

      // Ore rings. Richer ore rings higher and louder.
      const ore = def && isOre(def.id);
      const ringTarget = active && ore ? 1 : 0;
      ringLevel += (ringTarget - ringLevel) * Math.min(1, dt * 8);
      if (ore) {
        const v = Math.log10(Math.max(10, def.value));
        ringFilter.frequency.setTargetAtTime(500 + v * 340, now, 0.06);
      }
      ringGain.gain.setTargetAtTime(ringLevel * 0.085, now, 0.05);
    },

    /** Thruster hiss, scaled by how hard the engines are working. */
    thruster(dt, amount = 0) {
      if (!ctx) return;
      thrustLevel += (Math.min(1, amount) - thrustLevel) * Math.min(1, dt * 7);
      thrustGain.gain.setTargetAtTime(thrustLevel * 0.075, ctx.currentTime, 0.04);
      thrustFilter.frequency.setTargetAtTime(420 + thrustLevel * 700, ctx.currentTime, 0.06);
    },
  };
}
