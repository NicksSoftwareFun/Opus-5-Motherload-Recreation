/**
 * Render a scripted descent to an audio file you can share.
 *
 * This is not a recording of someone playing. It drives the game's own audio
 * module — the same `createAudio()` the cockpit uses — through a written timeline,
 * inside an OfflineAudioContext, so it renders faster than real time and comes out
 * identical every time bar the deliberate randomness in the motif and the creaks.
 *
 * The trick that makes it possible is OfflineAudioContext.suspend(): the control
 * loop that normally runs once a frame is stepped by suspending the render at each
 * tick, running the same update calls main.js makes, and resuming. The audio code
 * cannot tell the difference, which is the point — what you hear in the file is
 * what the game does, not an impression of it.
 *
 *   node scripts/render-track.mjs
 *
 * Output: docs/audio/motherload-descent.wav  (universal)
 *         docs/audio/motherload-descent.webm (Opus, ~15x smaller)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const DURATION = 86;
// Deliberately not under release/: the single-file build sets emptyOutDir on that
// directory, so anything parked there is deleted the next time somebody runs
// `npm run build:single`. It took exactly one build to find that out.
const OUT_DIR = 'docs/audio';

const server = await createServer({
  root: process.cwd(),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5261, strictPort: false },
});
await server.listen();

const bundled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(bundled) ? bundled : undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load' });
await page.waitForFunction(() => window.__MOTHERLOAD__?.ready === true, null, { timeout: 90000 });

console.log(`rendering ${DURATION}s offline...`);
const t0 = Date.now();

const stats = await page.evaluate(async (duration) => {
  const M = window.__MOTHERLOAD__;
  // The game's own loop would fight us for the audio module's control inputs.
  M.loop.stop();

  const SR = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * duration), SR);

  // createAudio() builds its own context from window.AudioContext. Hand it ours.
  const realAC = window.AudioContext;
  const realResume = ctx.resume.bind(ctx);
  ctx.resume = () => Promise.resolve();          // start() would otherwise trip it
  window.AudioContext = function () { return ctx; };
  const audio = M.audio;
  audio.start();
  window.AudioContext = realAC;
  ctx.resume = realResume;

  // ---------------------------------------------------------------- timeline
  // Depth in metres over time. Everything else in the score follows from this.
  const keys = [
    [0, 0], [14, 0], [18, 6], [30, 28], [48, 80], [62, 140], [74, 205], [86, 208],
  ];
  const depthAt = (t) => {
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, d0] = keys[i - 1];
        const [t1, d1] = keys[i];
        const k = (t - t0) / (t1 - t0);
        return d0 + (d1 - d0) * (k * k * (3 - 2 * k));   // smoothstep
      }
    }
    return keys[keys.length - 1][1];
  };

  const DIRT = 1, ROCK = 2, HARDROCK = 3, GOLDIUM = 8, EINSTEINIUM = 10;
  const between = (t, a, b) => t >= a && t < b;
  /**
   * What the bit is in at time t, and whether it is cutting at all.
   *
   * Cut in bursts with real gaps between them, which is both how anyone actually
   * drills and what lets the piece breathe: the score ducks 55% under the drill,
   * so every pause is the harmony coming back up. An unbroken cut would bury it.
   */
  const bursts = [
    [17.0, 22.5, DIRT],
    [25.5, 31.0, DIRT],
    [34.0, 37.0, ROCK],
    [38.6, 41.2, GOLDIUM],        // a seam: the ring opens
    [45.0, 50.0, ROCK],
    [53.5, 58.0, ROCK],
    [60.8, 63.4, EINSTEINIUM],    // a better seam, deeper
    [66.5, 71.5, HARDROCK],
  ];
  const cutting = (t) => {
    for (const [a, b, id] of bursts) if (between(t, a, b)) return id;
    return null;                                        // and after 71.5s, silence
  };

  // One-shots, at a time in seconds. This is the cabin doing its job around you.
  const cues = [
    [1.4, () => audio.crtPower(true)],
    [5.3, () => audio.confirm()],
    [6.4, () => audio.switchClack(true)],
    [7.0, () => audio.switchClack(true)],
    [7.6, () => audio.uplink(true)],
    [9.2, () => audio.chirp()],
    [10.0, () => audio.blip()],
    [13.4, () => audio.uplink(false)],
    [16.6, () => audio.clutch(true)],
    [24.0, () => audio.chirp()],
    [22.4, () => audio.breakBlock(1)],
    [36.9, () => audio.breakBlock(2)],
    [41.3, () => audio.stow(250)],
    [41.7, () => audio.chirp()],
    [46.0, () => audio.sonarPing()],
    [50.5, () => audio.sonarPing()],
    [55.0, () => audio.sonarPing()],
    [57.4, () => audio.blip()],
    [63.5, () => audio.stow(2000)],
    [66.0, () => audio.gasVent(1)],
    [67.4, () => audio.explosion(0.8)],
    [69.0, () => audio.thud(9)],
    [72.5, () => audio.quake(7)],
    [71.8, () => audio.clutch(false)],
    [78.0, () => audio.sonarPing()],
    [82.0, () => audio.blip()],
  ];
  // POST self-test, printing itself out as the pod wakes up.
  for (let i = 0; i < 12; i++) cues.push([2.0 + i * 0.26, () => audio.postTick()]);
  // A transmission clattering out of the teletype, mid-descent.
  for (let i = 0; i < 46; i++) cues.push([51.5 + i * 0.055, () => audio.typeTick()]);
  cues.push([54.2, () => audio.carriageReturn()]);
  for (let i = 0; i < 38; i++) cues.push([54.6 + i * 0.055, () => audio.typeTick()]);
  cues.push([56.9, () => audio.carriageReturn()]);
  cues.sort((a, b) => a[0] - b[0]);
  let nextCue = 0;

  // ------------------------------------------------------------- control loop
  const dt = 1 / 60;
  const steps = Math.floor(duration / dt) - 1;
  const quantum = 128 / SR;
  const quantise = (t) => Math.round(t / quantum) * quantum;

  const tick = (t) => {
    const depth = depthAt(t);
    const live = t >= 5.5;
    const block = cutting(t);
    const drilling = block !== null && live;
    // Magma gets close in the deep, which is what the ambience and the score's
    // danger term both read.
    const magma = t > 60 ? Math.min(1, (t - 60) / 9) * 0.75 : 0;
    // Thrusters: lively on the surface, then holding station down the shaft.
    let thrust = 0;
    if (between(t, 9, 13.5)) thrust = 0.8;
    else if (between(t, 14, 18)) thrust = 0.35;
    else if (live && t < 72) thrust = 0.14 + 0.10 * Math.sin(t * 0.7);

    audio.drill(dt, { active: drilling, blockId: block, power: 3.5 });
    audio.thruster(dt, thrust);
    audio.update(dt, {
      depth,
      live,
      hull: t > 67 ? 0.55 : 1,
      magma,
      speed: Math.abs(depthAt(t + 0.2) - depth) * 5,
      drilling: drilling ? 1 : 0,
      danger: Math.min(1, magma * 0.8 + (t > 67 ? 0.35 : 0)),
    });
    // Overheating from a long cut in hard rock, which is a klaxon you would
    // actually hear at this point in a run.
    audio.faults(dt, { heat: between(t, 64.5, 70.5) });

    while (nextCue < cues.length && cues[nextCue][0] <= t) cues[nextCue++][1]();
  };

  for (let i = 1; i <= steps; i++) {
    const when = quantise(i * dt);
    if (when >= duration) break;
    // eslint-disable-next-line no-loop-func
    ctx.suspend(when).then(() => {
      tick(when);
      ctx.resume();
    });
  }

  const rendered = await ctx.startRendering();

  // -------------------------------------------------------------- WAV encode
  const ch = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const frames = rendered.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * 4));
  const put = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  put(0, 'RIFF');
  bytes.setUint32(4, 36 + frames * 4, true);
  put(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 2, true);
  bytes.setUint32(24, SR, true);
  bytes.setUint32(28, SR * 4, true);
  bytes.setUint16(32, 4, true);
  bytes.setUint16(34, 16, true);
  put(36, 'data');
  bytes.setUint32(40, frames * 4, true);
  // Peak-normalise to -1 dBFS. The cockpit mix sits well below full scale on
  // purpose — there is headroom reserved for a detonation during a burn — but a
  // file somebody opens in a player should not need the volume cranked.
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(ch[c][i]));
  }
  const gain = peak > 0 ? 0.891 / peak : 1;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, ch[c][i] * gain));
      bytes.setInt16(44 + (i * 2 + c) * 2, v * 32767, true);
    }
    // Fade the last half second, so it ends rather than stops.
    if (i > frames - SR * 0.5) {
      const k = (frames - i) / (SR * 0.5);
      for (let c = 0; c < 2; c++) {
        const o = 44 + (i * 2 + c) * 2;
        bytes.setInt16(o, bytes.getInt16(o, true) * k, true);
      }
    }
  }
  // The compact copy is encoded from the same signal, so it needs the same gain.
  for (let c = 0; c < 2; c++) {
    const d = rendered.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      const k = i > frames - SR * 0.5 ? (frames - i) / (SR * 0.5) : 1;
      d[i] = Math.max(-1, Math.min(1, d[i] * gain)) * k;
    }
  }
  const wav = new Uint8Array(bytes.buffer);

  // Handed back in slices: a fifteen-megabyte base64 string in one go is not
  // something to put through a debugger protocol.
  window.__WAV__ = wav;
  window.__RENDERED__ = rendered;
  return { frames, seconds: frames / SR, peak, gain, bytes: wav.length };
}, DURATION);

console.log(`offline render: ${stats.seconds.toFixed(1)}s of audio, peak ${stats.peak.toFixed(3)} -> normalised x${stats.gain.toFixed(2)}, `
  + `${(stats.bytes / 1e6).toFixed(1)} MB, took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

mkdirSync(OUT_DIR, { recursive: true });

// Pull the WAV back in slices and stitch it.
const SLICE = 4 << 20;
const parts = [];
for (let off = 0; off < stats.bytes; off += SLICE) {
  const b64 = await page.evaluate(([o, n]) => {
    const view = window.__WAV__.subarray(o, o + n);
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < view.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }, [off, SLICE]);
  parts.push(Buffer.from(b64, 'base64'));
}
const wavPath = `${OUT_DIR}/motherload-descent.wav`;
writeFileSync(wavPath, Buffer.concat(parts));
console.log(`wrote ${wavPath}`);

// Play the finished buffer through MediaRecorder for a compact copy. This is the
// same audio, just encoded — it is not a second render.
console.log('encoding Opus (real time)...');
const opusB64 = await page.evaluate(async (duration) => {
  const rendered = window.__RENDERED__;
  const live = new AudioContext({ sampleRate: rendered.sampleRate });
  const dest = live.createMediaStreamDestination();
  const src = live.createBufferSource();
  src.buffer = rendered;
  src.connect(dest);
  const rec = new MediaRecorder(dest.stream, {
    mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start();
  src.start();
  await new Promise((r) => setTimeout(r, duration * 1000 + 600));
  rec.stop();
  await done;
  const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  return btoa(s);
}, DURATION);
const opusPath = `${OUT_DIR}/motherload-descent.webm`;
writeFileSync(opusPath, Buffer.from(opusB64, 'base64'));
console.log(`wrote ${opusPath}`);

if (errors.length) console.error('page errors:', errors);
await browser.close();
await server.close();
