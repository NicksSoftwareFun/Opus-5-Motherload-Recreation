/**
 * Headless capture harness.
 *
 * Boots the real Vite dev server, drives the real game in Chromium (SwiftShader,
 * so it works on a machine with no GPU) and writes PNGs to ./shots. Each shot is a
 * named scenario that scripts input through the same code path a player uses.
 *
 *   npm run shots              capture everything
 *   npm run shots -- surface   capture only scenarios matching "surface"
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'shots');

/** Each scenario gets the page and may drive the game before the capture. */
const SCENARIOS = [
  {
    name: 'surface-survey',
    description: 'Survey camera orbiting the claim on the Martian surface.',
    async run(page) {
      await page.waitForTimeout(1200);
    },
  },
];

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const chosen = filter.length
    ? SCENARIOS.filter((s) => filter.some((f) => s.name.includes(f)))
    : SCENARIOS;

  if (!chosen.length) {
    console.error(`No scenarios match ${filter.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(outDir, { recursive: true });

  const server = await createServer({
    root,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 5199, strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  console.log(`vite: ${url}`);

  // Use the browser that ships with the container rather than downloading one; its
  // revision may not match this Playwright build, so point at it explicitly.
  const bundled = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({
    executablePath: existsSync(bundled) ? bundled : undefined,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MOTHERLOAD__?.ready === true, null, { timeout: 30000 });

  // The whole point of the diegetic rule: the document must contain the canvas and
  // nothing else. If a later phase ever reaches for a DOM overlay, this fails loudly.
  const domReport = await page.evaluate(() => {
    const allowed = new Set(['CANVAS', 'SCRIPT', 'STYLE', 'LINK']);
    const stray = [...document.body.children].filter((el) => !allowed.has(el.tagName));
    return { canvases: document.querySelectorAll('canvas').length, stray: stray.map((e) => e.tagName) };
  });
  if (domReport.stray.length) {
    throw new Error(`Non-diegetic DOM elements present in <body>: ${domReport.stray.join(', ')}`);
  }
  console.log(`diegetic DOM check: ok (${domReport.canvases} canvas element(s), no overlay)`);

  const results = [];
  for (const scenario of chosen) {
    await scenario.run(page);
    const file = path.join(outDir, `${scenario.name}.png`);
    await page.screenshot({ path: file });
    const perf = await page.evaluate(() => ({
      avgFrameMs: window.__MOTHERLOAD__.loop?.avgFrameMs ?? null,
      frames: window.__MOTHERLOAD__.loop?.frame ?? null,
    }));
    console.log(
      `shot: ${scenario.name}  avgFrame=${perf.avgFrameMs?.toFixed(1)}ms frames=${perf.frames}`,
    );
    results.push({ ...perf, name: scenario.name });
  }

  await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ results, consoleErrors }, null, 2));

  await browser.close();
  await server.close();

  if (consoleErrors.length) {
    console.error(`\n${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 20)) console.error(`  ${e}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
