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
    name: 'chase-feed',
    description: 'Chase camera feed on the right console, pod visible outside.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.teleport(40);
        g.dashboard.feedKnob.setIndex(0);
        g.look(-1.28, -0.30);
        g.simulate(1.0);
      });
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'hologram',
    description: 'Volumetric mine map deployed after carving a network of tunnels.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        // Carve a shaft with side galleries so the projection has something to show.
        for (let vy = 0; vy < 120; vy++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) g.chunks.setBlock(32 + dx, vy, 32 + dz, 0);
          }
          if (vy % 18 === 0) {
            for (let i = 0; i < 22; i++) {
              g.chunks.setBlock(32 + i, vy, 32, 0);
              g.chunks.setBlock(32 - i, vy, 32 + (vy % 36 ? 1 : -1) * 6, 0);
            }
          }
        }
        g.teleport(72);
        g.dashboard.switches.map.setState(true);
        g.look(-0.30, -0.28);
        g.simulate(2.5);
      });
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'sensor-bureau',
    description: 'The Sensor Bureau catalogue, with the Providence Engine at the bottom.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.pod.cash = 900000;
        const s = g.stations.find((x) => x.key === 'sensors');
        g.body.position.set(s.x, 1.0, s.z);
        g.body.velocity.set(0, 0, 0);
        g.look(0.0, -0.72);
        g.simulate(0.5);
      });
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'sensor-suite',
    description: 'Port rack: chirp sonar scope and strata profiler, both live.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        for (const k of ['densitometer', 'sonar', 'profiler', 'thermal', 'lattice']) {
          g.pod.sensors.add(k);
        }
        g.teleport(96);
        g.look(1.18, -0.16);
        g.simulate(2.5);
      });
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'providence',
    description: 'The Providence Engine armed: ore and magma seen through solid rock.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        for (const s of ['densitometer', 'sonar', 'profiler', 'thermal', 'lattice', 'providence']) {
          g.pod.sensors.add(s);
        }
        g.pod.cash = 500000;
        g.teleport(150);
        g.dashboard.providence.setArmed(true);
        g.dashboard.armSwitch.setState(true);
        g.look(0.15, -0.08);
        g.simulate(3.0);
      });
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'rescue',
    description: 'Hull lost at depth; the emergency uplink relays the recovery terms.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.teleport(120);
        g.pod.cash = 84000;
        g.pod.addOre(9, 5);
        g.pod.hull = 0;
        g.look(0.0, -0.72);
        g.simulate(4.0);
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'faults',
    description: 'Systems schematic after a rough trip: modules degraded.',
    async run(page) {
      await page.evaluate(() => {
        const g = window.__MOTHERLOAD__;
        g.boot(true);
        g.teleport(60);
        g.pod.subsystems.applyDamage(0.55, { module: 'lights' });
        g.pod.subsystems.applyDamage(0.35, { module: 'thrusters' });
        g.pod.subsystems.applyDamage(0.18, { module: 'bay' });
        g.pod.hull = g.pod.maxHull * 0.42;
        g.session.page = 'systems';
        g.look(0.0, -0.72);
        g.simulate(0.6);
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
    // The head-tracking bridge is optional and normally absent; the browser logs a
    // refused WebSocket that JavaScript cannot suppress. Not a game fault.
    const text = m.text();
    if (m.type() === 'error' && !text.includes('4243')) consoleErrors.push(text);
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
