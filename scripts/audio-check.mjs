/**
 * Prove the game makes the sounds it claims to.
 *
 * A headless browser cannot be listened to, so the check measures instead: an
 * analyser across the master bus reports RMS, and each scenario asserts that the
 * mix is louder or quieter than it should be. That catches the failures that
 * actually happen with generated audio — a voice that never starts, a gain left at
 * zero, a graph that throws halfway through building — none of which show up in a
 * unit test and all of which are silent.
 *
 *   node scripts/audio-check.mjs
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const server = await createServer({
  root: process.cwd(),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5231, strictPort: false },
});
await server.listen();

const bundled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(bundled) ? bundled : undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox',
    // Without this the context stays suspended and every measurement is zero.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load' });
await page.waitForFunction(() => window.__MOTHERLOAD__?.ready === true, null, { timeout: 90000 });

const report = await page.evaluate(async () => {
  const M = window.__MOTHERLOAD__;
  const A = M.audio;
  A.start();
  await new Promise((r) => setTimeout(r, 200));

  /** Average the meter over a real second of wall time; one sample is noise. */
  const measure = async (ms = 900) => {
    let peak = 0;
    let sum = 0;
    let n = 0;
    const until = performance.now() + ms;
    while (performance.now() < until) {
      const v = A.level();
      peak = Math.max(peak, v);
      sum += v;
      n++;
      await new Promise((r) => setTimeout(r, 16));
    }
    return { rms: sum / Math.max(1, n), peak };
  };

  const out = { running: A.running, scenes: {} };

  // 1. Cold cockpit: master power off. Should be effectively silent.
  M.simulate(1.0);
  out.scenes.cold = await measure(700);

  // 2. Powered on the surface: cabin hum, wind, and the surface movement.
  M.boot(true);
  M.simulate(3.0);
  out.scenes.surface = await measure();
  out.scenes.surface.movement = A.movement;

  // 3. Deep: the score should have moved to another stratum entirely.
  M.teleport(200);
  M.simulate(4.0);
  out.scenes.deep = await measure();
  out.scenes.deep.movement = A.movement;

  // 4. Drilling: the machine is the loudest thing in the game.
  const before = A.level();
  void before;
  for (let i = 0; i < 240; i++) {
    A.drill(1 / 120, { active: true, blockId: 2, power: 3 });
  }
  out.scenes.drilling = await measure(700);

  A.drill(0.5, { active: false, blockId: null, power: 3 });

  // 5. One-shots: each should be audible above the bed it lands on.
  const oneShots = {};
  for (const [name, fire] of [
    ['switchClack', () => A.switchClack(true)],
    ['confirm', () => A.confirm()],
    ['explosion', () => A.explosion(1)],
    ['quake', () => A.quake(6)],
    ['jettison', () => A.jettison()],
    ['sonarPing', () => A.sonarPing()],
    ['rescueSting', () => A.rescueSting()],
    ['crtPower', () => A.crtPower(true)],
    ['pump', () => A.pump()],
    ['weld', () => A.weld()],
  ]) {
    fire();
    oneShots[name] = (await measure(420)).peak;
  }
  out.oneShots = oneShots;

  // 6. Alarms: silent with nothing wrong, audible with a fault standing.
  out.faultsQuiet = (await measure(400)).peak;
  for (let i = 0; i < 200; i++) A.faults(1 / 30, { hull: true });
  out.faultsLoud = (await measure(900)).peak;

  return out;
});

console.log(JSON.stringify(report, null, 2));

const fail = [];
if (!report.running) fail.push('audio context is not running');
if (report.scenes.cold.rms > 0.006) fail.push('cold cockpit is not silent');
if (report.scenes.surface.rms <= report.scenes.cold.rms) fail.push('powering on added nothing');
if (report.scenes.surface.movement === report.scenes.deep.movement) {
  fail.push('the score did not change stratum with depth');
}
if (report.scenes.drilling.rms <= report.scenes.surface.rms) fail.push('the drill is not audible');
for (const [name, peak] of Object.entries(report.oneShots)) {
  if (peak < 0.01) fail.push(`one-shot produced no sound: ${name}`);
}
if (report.faultsLoud <= report.faultsQuiet) fail.push('fault klaxon is inaudible');
if (errors.length) fail.push(`page errors: ${errors.join('; ')}`);

await browser.close();
await server.close();

if (fail.length) {
  console.error('\nFAILED:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('\naudio check: all scenes and one-shots produced sound');
