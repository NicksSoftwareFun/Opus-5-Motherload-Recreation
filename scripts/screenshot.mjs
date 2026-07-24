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
    name: 'cold-start',
    description: 'Cold cabin before the master switch is thrown; standby lamp pulsing.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.body.position.set(32.5, 1.0, 44);
        g.body.velocity.set(0, 0, 0);
        g.look(0.90, -0.30);
        g.simulate(0.5);
      });
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'boot-menu',
    description: 'Self-test complete; the main menu is a page on the pod terminal.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.dashboard.switches.power.setState(true);
        g.session.setPower(true);
        g.look(0.0, -0.62);
        g.simulate(4.0);
      });
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'surface',
    description: 'Pod on the claim plaza, systems live, looking out over Mars.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.body.position.set(32.5, 1.0, 44);
        g.body.velocity.set(0, 0, 0);
        g.look(0.0, -0.05);
        g.simulate(0.5);
      });
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'switch-bank',
    description: 'Looking left at the master systems panel, crosshair on a switch.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.look(0.95, -0.30);
        g.simulate(0.4);
      });
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'terminal',
    description: 'The pod status page on the centre console terminal.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.teleport(48);
        g.pod.cash = 18450;
        g.pod.addOre(8, 3); g.pod.addOre(6, 4); g.pod.addOre(5, 2);
        g.pod.heat = 34; g.pod.fuel = 61; g.pod.hull = 78;
        g.look(0.0, -0.72);
        g.simulate(0.6);
      });
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'cargo-manifest',
    description: 'Cargo manifest page, ore stowed and priced.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.session.page = 'cargo';
        g.look(0.0, -0.72);
        g.simulate(0.4);
      });
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'base',
    description: 'The surface base ringing the shaft mouth, seen from the plaza.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.body.position.set(32.5, 2.4, 32.5);
        g.body.velocity.set(0, 0, 0);
        g.look(0.0, 0.02, { pod: -1.5708 });
        g.simulate(0.3);
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'workshop',
    description: 'Docked at the fitting shop; the terminal is the upgrade console.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.pod.cash = 42000;
        const s = g.stations.find((x) => x.key === 'workshop');
        g.body.position.set(s.x, 1.0, s.z);
        g.body.velocity.set(0, 0, 0);
        g.look(0.0, -0.72);
        g.simulate(0.5);
      });
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'trader',
    description: 'Docked at the ore trader with a full bay.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.pod.addOre(8, 4); g.pod.addOre(9, 2); g.pod.addOre(7, 3);
        const s = g.stations.find((x) => x.key === 'trader');
        g.body.position.set(s.x, 1.0, s.z);
        g.body.velocity.set(0, 0, 0);
        g.look(0.0, -0.72);
        g.simulate(0.5);
      });
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'shaft',
    description: 'Down a carved shaft, 60 m below the surface.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true); g.teleport(60);
        g.look(0.6, -0.25);
      });
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'drilling',
    description: 'Cutting downward at 90 m, spoil flying off the bit.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true); g.teleport(90);
        g.look(0.35, -0.75);
        g.input.primaryDown = true;
        g.simulate(6);
      });
      await page.waitForTimeout(500);
      const dug = await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        return {
          blocks: g.pod.stats.blocksDrilled,
          ore: g.pod.stats.oreMined,
          fuel: Math.round(g.pod.fuel),
          heat: Math.round(g.pod.heat),
          cut: Number(g.drill.cutFraction.toFixed(2)),
        };
      });
      console.log(`  drill check: ${JSON.stringify(dug)}`);
    },
    async after(page) {
      await page.evaluate(() => { window.__MOTHERLOAD__.input.primaryDown = false; });
    },
  },
  {
    name: 'deep',
    description: 'Deep strata at 200 m, where the valuable ore glows.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true); g.teleport(200);
        g.look(1.2, -0.1);
      });
      await page.waitForTimeout(900);
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
    await scenario.after?.(page);
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
