/**
 * Throw the cockpit switches the way a player does, and check they stay thrown.
 *
 * The failure this exists to catch was invisible to unit tests: a real click is one
 * mousedown followed by however many fixed-timestep substeps the frame happens to
 * contain, and the switch was toggling once per substep. Anything that drives the
 * game through its debug hooks rather than through the DOM never sees it.
 *
 *   node scripts/switch-check.mjs
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const server = await createServer({
  root: process.cwd(),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5211, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls.local[0];

const bundled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(bundled) ? bundled : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__MOTHERLOAD__?.ready === true, null, { timeout: 90000 });

const result = await page.evaluate(() => {
  const M = window.__MOTHERLOAD__;
  const canvas = document.querySelector('canvas');
  M.input.forceLock(true);

  const click = () => {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  };

  /** Point the head straight at a control's hit plane. */
  const aim = (target) => {
    target.updateWorldMatrix(true, false);
    const e = target.matrixWorld.elements;
    const cam = M.cockpit.camera;
    const dx = e[12] - cam.position.x;
    const dy = e[13] - cam.position.y;
    const dz = e[14] - cam.position.z;
    M.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    M.simulate(1 / 120);
  };

  const out = { hover: {}, toggles: {}, lever: {} };
  const sw = M.dashboard.switches;

  for (const [name, control] of Object.entries(sw)) {
    aim(control.hit);
    out.hover[name] = M.interaction.hovered?.control?.label ?? null;
    const before = control.on;
    click();
    // One rendered frame's worth of simulation: several substeps, as in real play.
    M.simulate(0.05);
    out.toggles[name] = { before, after: control.on, changed: before !== control.on };
  }

  // Geometry check: in both positions the lever must stand in front of its own
  // mounting plate, never behind it.
  // The moving parts are everything under the pivot: the stick and its red tip.
  const probe = sw.power;
  const pivot = probe.group.children.find((c) => c.isGroup);
  for (const state of [true, false]) {
    probe.setState(state, true);
    M.simulate(0.5);                       // let it settle into its detent
    probe.group.updateWorldMatrix(true, true);
    let minZ = Infinity;
    for (const mesh of pivot.children) {
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        // Vertex → world → back into the switch's own frame, which is the only
        // frame in which "in front of the panel" means anything.
        const v = new (probe.group.position.constructor)(pos.getX(i), pos.getY(i), pos.getZ(i));
        mesh.localToWorld(v);
        probe.group.worldToLocal(v);
        if (v.z < minZ) minZ = v.z;
      }
    }
    out.lever[state ? 'on' : 'off'] = Number(minZ.toFixed(4));
  }
  // The mounting plate is 12 mm thick and centred on the group origin.
  out.leverPanelFaceZ = 0.006;

  out.systemsLive = M.session.systemsLive;
  return out;
});

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('page errors:', errors);



// A look at the bank itself, for eyeballing the lever poses.
await page.evaluate(() => {
  const M = window.__MOTHERLOAD__;
  M.dashboard.switches.power.setState(true, true);
  M.dashboard.switches.lights.setState(false, true);
  M.dashboard.switches.drill.setState(true, true);
  M.simulate(1.0);
  const hit = M.dashboard.switches.drill.hit;
  hit.updateWorldMatrix(true, false);
  const e = hit.matrixWorld.elements;
  const cam = M.cockpit.camera;
  const dx = e[12] - cam.position.x, dy = e[13] - cam.position.y, dz = e[14] - cam.position.z;
  M.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  M.simulate(0.2);
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/switch-bank-fixed.png' });

await browser.close();
await server.close();
