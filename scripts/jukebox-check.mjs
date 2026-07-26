/**
 * Drive the Jukebox headlessly and check it actually works.
 *
 * The tool is all DOM and Web Audio, so nothing in the vitest suite touches it. The
 * failures worth catching are the boring ones: an import that does not resolve, a
 * pad whose handler throws on the first click, a scope that never paints. All three
 * look identical from the outside — a page that sits there.
 *
 * It runs the same drive twice: once against the dev server, and once against
 * `release/motherload-jukebox.html` over file:// if that has been built. The second
 * pass is not redundant. The single-file build re-emits the whole tool as a classic
 * IIFE with everything inlined, and that transform has broken silently before — a
 * `$` in minified code eaten by String.replace's substitution patterns produced a
 * file that looked fine and was a syntax error. file:// is also where the origin
 * rules are strictest, which is exactly where a tool that ships as one file lives.
 *
 *   node scripts/jukebox-check.mjs
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const bundled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(bundled) ? bundled : undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});

/**
 * Load the tool at `url`, use it the way a person would, and report what happened.
 */
async function drive(url) {
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

  // --- Structure ----------------------------------------------------------
  const built = await page.evaluate(() => ({
    pads: document.querySelectorAll('#pads .pad').length,
    groups: document.querySelectorAll('#pads .group').length,
    machinery: document.querySelectorAll('#machinery .row').length,
    world: document.querySelectorAll('#world .row').length,
    strata: document.querySelectorAll('#strata .stratum').length,
    layers: document.querySelectorAll('#layers .layer').length,
    code: document.getElementById('code').textContent,
    // The stylesheet has to have come with it, or the single file is not single.
    styled: getComputedStyle(document.body).fontFamily.includes('mono'),
  }));

  // --- Arm and play -------------------------------------------------------
  await page.click('#arm');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    armed: document.getElementById('arm').classList.contains('on'),
    ctx: Boolean(window.__JUKEBOX__?.audio?.context),
    rate: window.__JUKEBOX__?.audio?.context?.sampleRate ?? 0,
  }));

  // Every pad, one after another. A handler that throws lands in `errors`.
  for (const pad of await page.$$('#pads .pad')) {
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

  // --- Did the scopes paint? ----------------------------------------------
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

  // --- Designer -----------------------------------------------------------
  await page.click('#addTone');
  await page.click('#addBurst');
  await page.click('#audition');
  await page.waitForTimeout(300);
  const designer = await page.evaluate(() => ({
    layers: document.querySelectorAll('#layers .layer').length,
    code: document.getElementById('code').textContent,
  }));

  // --- Volume -------------------------------------------------------------
  const volume = await page.evaluate(() => {
    const s = document.getElementById('master');
    s.value = '40';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      set: window.__JUKEBOX__.audio.volume,
      shown: document.getElementById('masterOut').value,
    };
  });

  await page.close();
  return { built, state, running, painted, designer, volume, errors };
}

/** Assert a run, print it, and return how many checks failed. */
function report(label, r) {
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };

  check(r.built.pads >= 30, `only ${r.built.pads} pads built`);
  check(r.built.groups >= 4, `only ${r.built.groups} pad groups`);
  check(r.built.machinery >= 4, `only ${r.built.machinery} machinery rows`);
  check(r.built.world >= 4, `only ${r.built.world} world rows`);
  check(r.built.strata >= 4, `only ${r.built.strata} strata rows`);
  check(r.built.layers >= 1, 'designer started with no layers');
  check(r.built.code.length > 40, 'designer emitted no code');
  check(r.built.styled, 'stylesheet did not load');
  check(r.state.armed, 'arm button did not latch');
  check(r.state.ctx, 'no AudioContext after arming');
  check(r.running > 0.0005, `machinery silent (master RMS ${r.running.toExponential(2)})`);
  check(r.painted.spectrum > 0.01, `spectrum blank (${(r.painted.spectrum * 100).toFixed(2)}% lit)`);
  check(r.painted.wave > 0.002, `waveform blank (${(r.painted.wave * 100).toFixed(2)}% lit)`);
  check(r.designer.layers === r.built.layers + 2, `layers ${r.built.layers} -> ${r.designer.layers}, expected +2`);
  // The emitted code calls audio.js's own `T`/`B` wrappers around tone()/burst(),
  // because that is what it has to be to paste in there unchanged.
  check(/\bT\(|\bB\(/.test(r.designer.code), 'designer code has no T()/B() call');
  check(Math.abs(r.volume.set - 0.4) < 1e-6, `slider set volume to ${r.volume.set}, expected 0.4`);
  check(r.volume.shown === '40', `readout shows ${r.volume.shown}, expected 40`);
  check(r.errors.length === 0, `${r.errors.length} page error(s)`);

  console.log(`\n${label}`);
  console.log(`  pads          ${r.built.pads} across ${r.built.groups} groups`);
  console.log(`  rows          machinery ${r.built.machinery}, world ${r.built.world}, strata ${r.built.strata}`);
  console.log(`  context       ${r.state.rate} Hz`);
  console.log(`  drill+thrust  master RMS ${r.running.toFixed(4)}`);
  console.log(`  scopes        spectrum ${(r.painted.spectrum * 100).toFixed(1)}% lit, wave ${(r.painted.wave * 100).toFixed(1)}%`);
  console.log(`  designer      ${r.built.layers} -> ${r.designer.layers} layers, ${r.designer.code.length} chars of code`);
  console.log(`  volume        slider 40 -> ${r.volume.set}`);
  for (const e of r.errors) console.log(`  ! ${e}`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  return fails.length;
}

let failed = 0;

// --- Source, over the dev server -----------------------------------------
const server = await createServer({
  root: process.cwd(),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5213, strictPort: false },
});
await server.listen();
failed += report('source (vite dev)', await drive(`${server.resolvedUrls.local[0]}tools/jukebox/index.html`));
await server.close();

// --- The shipped single file, over file:// --------------------------------
const single = resolve(process.cwd(), 'release/motherload-jukebox.html');
if (existsSync(single)) {
  failed += report('release/motherload-jukebox.html (file://)', await drive(pathToFileURL(single).href));
} else {
  console.log('\nrelease/motherload-jukebox.html not built — skipping the file:// pass');
  console.log('  npm run build:jukebox');
}

await browser.close();

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nOK');
