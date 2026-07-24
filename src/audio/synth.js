/**
 * Synthesis primitives.
 *
 * Every sound in this game is made here, out of noise, oscillators and envelopes.
 * There are no audio files for the same reason there are no textures: everything is
 * generated at boot, so the whole game still fits in a single HTML file you can
 * double-click.
 *
 * These helpers take an explicit context and destination rather than reaching for a
 * module-level singleton, because the mixer owns the routing and the callers should
 * not have opinions about which bus they land on.
 */

/** A couple of seconds of white noise, looped as the bed for everything gritty. */
export function noiseBuffer(ctx, seconds = 2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * An impulse response for the mine's reverb, generated rather than recorded.
 *
 * Noise under an exponential decay is a crude convolution reverb, and crude is
 * exactly right here: a one-metre tunnel bored through rock is a small, dead,
 * unglamorous space. The point is not to sound like a cathedral, it is to stop the
 * mine sounding like a pair of headphones.
 */
export function impulseResponse(ctx, { seconds = 1.6, decay = 3.4 } = {}) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A little early sparseness, then a smooth tail. The random sign keeps the
      // two channels decorrelated, which is what makes it feel wide.
      data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay;
    }
  }
  return buffer;
}

/**
 * One-shot tone with an envelope. The workhorse behind every UI sound.
 *
 * Exponential ramps throughout, because gain envelopes that move linearly sound
 * like they are being faded by hand. Nothing in a cockpit fades by hand.
 */
export function tone(ctx, destination, freq, {
  duration = 0.09, type = 'square', gain = 0.16, attack = 0.004,
  sweep = null, delay = 0, detune = 0,
} = {}) {
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweep !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + duration);

  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(env);
  env.connect(destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  return osc;
}

/** Filtered noise burst — clicks, thuds, hisses, anything with grit in it. */
export function burst(ctx, destination, noise, {
  duration = 0.08, freq = 900, Q = 1, gain = 0.2, type = 'bandpass',
  sweep = null, delay = 0,
} = {}) {
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  // Start somewhere random in the buffer, so repeated hits are not identical.
  const offset = Math.random() * Math.max(0, noise.duration - duration - 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (sweep !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t0 + duration);
  filter.Q.value = Q;

  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(0.0002, gain), t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  src.connect(filter);
  filter.connect(env);
  env.connect(destination);
  src.start(t0, offset);
  src.stop(t0 + duration + 0.02);
}

/**
 * A looping noise voice behind a filter and a gain: the shape every continuous
 * environmental bed in this game takes.
 *
 * Returned rather than connected, so the caller decides the bus. `gain` and the
 * filter are handed back because everything interesting happens by moving them
 * from the simulation each frame.
 */
export function noiseVoice(ctx, noise, {
  type = 'bandpass', freq = 400, Q = 1, gain = 0,
} = {}) {
  const out = ctx.createGain();
  out.gain.value = gain;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = Q;
  filter.connect(out);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.connect(filter);
  src.start();

  return { out, filter, source: src };
}

/**
 * A slow LFO on some AudioParam. Used to keep the beds breathing: a static drone
 * stops being heard after about twenty seconds, and a drone that wanders never
 * quite does.
 */
export function lfo(ctx, target, { rate = 0.1, depth = 1, type = 'sine' } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = rate;
  const amp = ctx.createGain();
  amp.gain.value = depth;
  osc.connect(amp);
  amp.connect(target);
  osc.start();
  return { osc, amp };
}

/** Ramp a param toward a value without clicks, at a rate that suits control data. */
export function glide(param, value, now, time = 0.05) {
  param.setTargetAtTime(value, now, time);
}
