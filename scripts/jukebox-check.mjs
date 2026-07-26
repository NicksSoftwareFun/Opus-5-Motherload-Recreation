/**
 * Drive the Jukebox headlessly and check it actually works.
 *
 * The tool is all DOM and Web Audio, so nothing in the vitest suite touches it. The
 * failures worth catching are the boring ones: an import that does not resolve, a
 * pad whose handler throws on the first click, a scope that never paints. All three
 * look identical from the outside — a page that sits there.
 *
 *   node scripts/jukebox-check.mjs
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const server = await createServer({
  root: process.cwd(),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5213, strictPort: false },
});
await server.listen();
const url = `${server.resolvedUrls.local[0]}tools/jukebox/index.html`;

const bundled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(bundled) ? bundled : undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // Chromium asks for a favicon nobody shipped; that is not a fault in the tool.
  if (m.type() === 'error' && !/favicon/.test(m.location()?.url ?? '')) {
    errors.push(`console: ${m.text()}`);
  }
});

await page.goto(url, { waitUntil: 'load' });

// --- Structure ------------------------------------------------------------
const built = await page.evaluate(() => ({
  pads: document.querySelectorAll('#pads .pad').length,
  groups: document.querySelectorAll('#pads .group').length,
  machinery: document.querySelectorAll('#machinery .row').length,
  world: document.querySelectorAll('#world .row').length,
  strata: document.querySelectorAll('#strata .stratum').length,
  layers: document.querySelectorAll('#layers .layer').length,
  code: document.getElementById('code').textContent,
}));

// --- Arm and play ---------------------------------------------------------
await page.click('#arm');
await page.waitForTimeout(300);

const state = await page.evaluate(() => ({
  armed: document.getElementById('arm').classList.contains('on'),
  ctx: Boolean(window.__JUKEBOX__?.audio?.context),
  rate: window.__JUKEBOX__?.audio?.context?.sampleRate ?? 0,
}));

// Every pad, one after another. A handler that throws lands in `errors`.
const pads = await page.$$('#pads .pad');
for (const pad of pads) {
  await pad.click();
  await page.waitForTimeout(35);
}
await page.waitForTimeout(400);

// Machinery: run the drill and the thrusters for a moment.
await page.evaluate(() => {
  const d = window.__JUKEBOX__.drive;
  d.drillOn = true;
  d.thrust = 0.8;
  d.depth = 140;
});
await page.waitForTimeout(1200);
const running = await page.evaluate(() => window.__JUKEBOX__.audio.level());

await page.evaluate(() => {
  const d = window.__JUKEBOX__.drive;
  d.drillOn = false;
  d.thrust = 0;
});

// --- Did the scopes paint? -----------------------------------------------
const painted = await page.evaluate(() => {
  const ink = (id) => {
    const cv = document.getElementById(id);
    const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 60 || px[i + 1] > 60 || px[i + 2] > 60) lit++;
    }
    return lit / (px.length / 4);
  };
  return { spectrum: ink('spectrum'), wave: ink('wave') };
});

// --- Designer -------------------------------------------------------------
await page.click('#addTone');
await page.click('#addBurst');
await page.click('#audition');
await page.waitForTimeout(300);
const designer = await page.evaluate(() => ({
  layers: document.querySelectorAll('#layers .layer').length,
  code: document.getElementById('code').textContent,
}));

// --- Volume ---------------------------------------------------------------
const volume = await page.evaluate(() => {
  const s = document.getElementById('master');
  s.value = '40';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return { slider: window.__JUKEBOX__.audio.volume, shown: document.getElementById('masterOut').value };
});

await browser.close();
await server.close();

// --- Report ---------------------------------------------------------------
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

check(built.pads >= 30, `only ${built.pads} pads built`);
check(built.groups >= 4, `only ${built.groups} pad groups`);
check(built.machinery >= 4, `only ${built.machinery} machinery rows`);
check(built.world >= 4, `only ${built.world} world rows`);
check(built.strata >= 4, `only ${built.strata} strata rows`);
check(built.layers >= 1, 'designer started with no layers');
check(built.code.length > 40, 'designer emitted no code');
check(state.armed, 'arm button did not latch');
check(state.ctx, 'no AudioContext after arming');
check(running > 0.0005, `machinery silent (master RMS ${running.toExponential(2)})`);
check(painted.spectrum > 0.01, `spectrum blank (${(painted.spectrum * 100).toFixed(2)}% lit)`);
check(painted.wave > 0.002, `waveform blank (${(painted.wave * 100).toFixed(2)}% lit)`);
check(designer.layers === built.layers + 2, `layers ${built.layers} -> ${designer.layers}, expected +2`);
// The emitted code calls audio.js's own `T`/`B` wrappers around tone()/burst(),
// because that is what it has to be to paste in there unchanged.
check(/\bT\(|\bB\(/.test(designer.code), 'designer code has no T()/B() call');
check(Math.abs(volume.slider - 0.4) < 1e-6, `slider set volume to ${volume.slider}, expected 0.4`);
check(volume.shown === '40', `readout shows ${volume.shown}, expected 40`);
check(errors.length === 0, `${errors.length} page error(s)`);

console.log(`pads          ${built.pads} across ${built.groups} groups`);
console.log(`rows          machinery ${built.machinery}, world ${built.world}, strata ${built.strata}`);
console.log(`context       ${state.rate} Hz`);
console.log(`drill+thrust  master RMS ${running.toFixed(4)}`);
console.log(`scopes        spectrum ${(painted.spectrum * 100).toFixed(1)}% lit, wave ${(painted.wave * 100).toFixed(1)}%`);
console.log(`designer      ${built.layers} -> ${designer.layers} layers, ${designer.code.length} chars of code`);
console.log(`volume        slider 40 -> ${volume.slider}`);

if (errors.length) for (const e of errors) console.log(`  ! ${e}`);

if (fails.length) {
  console.log(`\nFAIL (${fails.length}):`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK');
