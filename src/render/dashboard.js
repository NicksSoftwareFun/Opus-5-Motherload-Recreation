import * as THREE from 'three';
import { Screen, PHOSPHOR } from '../ui/screen.js';
import { PAGES } from '../ui/pages.js';
import { PHASE } from '../game/session.js';
import { dialGauge, ledBar, digitDisplay, warningLamp, nameplate } from './instruments.js';
import { toggleSwitch, rotarySelector } from './controls.js';
import { createMonitors, FEED_LABELS } from './monitors.js';
import { createHologram } from './hologram.js';
import { createSensorRack } from './sensorRack.js';
import { createProvidence } from './providence.js';
import { createTeletype } from './teletype.js';
import { createStickyNote } from './stickyNote.js';
import { guardedSwitch } from './controls.js';
import { credits } from '../game/economy.js';

/**
 * Populates the cockpit's mounting surfaces with working instruments and wires
 * them to the pod.
 *
 * The arrangement follows the pilot's eye: the things you must not miss (fuel,
 * hull, cargo, depth) are gauges and lamps readable at a glance without turning
 * your head, and the things you deliberately consult (manifest, shops, manual) live
 * on a terminal you look down at. The switches are off to the left, where you have
 * to look away from the rock to reach them.
 */

const DASH_Z = 0.028;
const PANEL_Z = 0.026;

export function createDashboard({ cockpit, pod, session, interaction, actions, world, audio }) {
  const { dash, overhead, consoles } = cockpit.parts;

  // --- Dashboard: the main terminal ---------------------------------------
  const terminal = new Screen({
    width: 0.365, height: 0.228, px: 512, py: 320, palette: PHOSPHOR.green, name: 'terminal',
  });
  terminal.mesh.position.set(0, 0.012, DASH_Z);
  dash.add(terminal.mesh);
  interaction.register(terminal.mesh, { kind: 'screen', screen: terminal });

  const terminalBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.405, 0.268, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.8, metalness: 0.3 }),
  );
  terminalBezel.position.set(0, 0.012, DASH_Z - 0.014);
  dash.add(terminalBezel);

  // --- Dashboard: left gauge cluster --------------------------------------
  const fuelGauge = dialGauge({
    radius: 0.068, label: 'FUEL', units: 'LITRES', ticks: 10, redline: [0, 0.15], accent: '#ffb340',
  });
  fuelGauge.group.position.set(-0.335, 0.048, DASH_Z);
  dash.add(fuelGauge.group);

  const heatGauge = dialGauge({
    radius: 0.050, label: 'HEAT', units: 'CORE', ticks: 10, redline: [0.85, 1], accent: '#ff6a3c',
  });
  heatGauge.group.position.set(-0.335, -0.100, DASH_Z);
  dash.add(heatGauge.group);

  // --- Dashboard: right ladder stack --------------------------------------
  const hullBar = ledBar({ count: 14, width: 0.22, color: 0x66ff88, warnBelow: 0.3 });
  hullBar.group.position.set(0.345, 0.098, DASH_Z);
  dash.add(hullBar.group);
  const hullPlate = nameplate({ text: 'HULL INTEGRITY', width: 0.20, height: 0.026 });
  hullPlate.position.set(0.345, 0.066, DASH_Z);
  dash.add(hullPlate);

  const cargoBar = ledBar({ count: 14, width: 0.22, color: 0x8ad6ff, warnBelow: -1 });
  cargoBar.group.position.set(0.345, 0.010, DASH_Z);
  dash.add(cargoBar.group);
  const cargoPlate = nameplate({ text: 'CARGO BAY', width: 0.20, height: 0.026 });
  cargoPlate.position.set(0.345, -0.022, DASH_Z);
  dash.add(cargoPlate);

  const cutBar = ledBar({ count: 14, width: 0.22, color: 0xffc24a, warnBelow: -1 });
  cutBar.group.position.set(0.345, -0.078, DASH_Z);
  dash.add(cutBar.group);
  const cutPlate = nameplate({ text: 'BIT PROGRESS', width: 0.20, height: 0.026 });
  cutPlate.position.set(0.345, -0.110, DASH_Z);
  dash.add(cutPlate);

  // --- Overhead: readouts and warning lamps --------------------------------
  const depthReadout = digitDisplay({ chars: 6, width: 0.32, height: 0.062, color: '#ffb340', label: 'DEPTH M' });
  depthReadout.group.position.set(-0.28, 0.055, 0.026);
  overhead.add(depthReadout.group);

  const cashReadout = digitDisplay({ chars: 9, width: 0.40, height: 0.062, color: '#8cff7a', label: 'CREDITS' });
  cashReadout.group.position.set(0.26, 0.055, 0.026);
  overhead.add(cashReadout.group);

  const lamps = {
    fuel: warningLamp({ label: 'FUEL LOW', color: 0xffb02a, width: 0.115 }),
    hull: warningLamp({ label: 'HULL', color: 0xff3a2a, width: 0.115 }),
    heat: warningLamp({ label: 'OVERHEAT', color: 0xff6a20, width: 0.115 }),
    cargo: warningLamp({ label: 'BAY FULL', color: 0x4ac8ff, width: 0.115 }),
  };
  Object.values(lamps).forEach((lamp, i) => {
    lamp.group.position.set(-0.40 + i * 0.267, -0.062, 0.026);
    overhead.add(lamp.group);
  });

  // --- Left console: the switch bank ---------------------------------------
  const left = consoles.left;
  const leftPlate = nameplate({ text: 'MASTER SYSTEMS', width: 0.30, height: 0.036 });
  leftPlate.position.set(0, 0.185, PANEL_Z);
  left.add(leftPlate);

  const switches = {};

  switches.power = toggleSwitch({
    label: 'MASTER', sub: 'BUS PWR', size: 0.058,
    onChange: (on) => actions.setPower(on),
  });
  switches.power.group.position.set(-0.095, 0.105, PANEL_Z);
  left.add(switches.power.group);

  // Standby telltale beside the master switch. In a cold, dark cabin this pulsing
  // amber lamp is the only thing on and is what tells a new pilot where to start.
  const standby = warningLamp({ label: 'STANDBY', color: 0xffb02a, width: 0.085 });
  standby.group.position.set(-0.095, 0.176, PANEL_Z);
  left.add(standby.group);

  // The lamp alone is too small to find in a dark cabin, so it throws light of its
  // own onto the switch panel. Pulsing amber in an otherwise dead cockpit is the
  // whole tutorial: it says "the machine starts here" without a word of text.
  const standbyGlow = new THREE.PointLight(0xffb02a, 0, 0.5, 2);
  standbyGlow.position.set(-0.095, 0.158, PANEL_Z + 0.06);
  left.add(standbyGlow);

  switches.lights = toggleSwitch({
    label: 'LAMPS', sub: 'EXT', size: 0.058, on: true,
    onChange: (on) => actions.setLights(on),
  });
  switches.lights.group.position.set(0.095, 0.105, PANEL_Z);
  left.add(switches.lights.group);

  switches.drill = toggleSwitch({
    label: 'DRILL', sub: 'CLUTCH', size: 0.058, on: true,
    onChange: (on) => actions.setDrillClutch(on),
  });
  switches.drill.group.position.set(-0.095, -0.010, PANEL_Z);
  left.add(switches.drill.group);

  switches.jettison = toggleSwitch({
    label: 'BAY', sub: 'RELEASE', size: 0.058,
    onChange: (on) => {
      if (on) actions.jettison();
      // Spring-loaded: it does not stay thrown.
      setTimeout(() => switches.jettison.setState(false, true), 260);
    },
  });
  switches.jettison.group.position.set(-0.095, -0.125, PANEL_Z);
  left.add(switches.jettison.group);

  switches.map = toggleSwitch({
    label: 'MAP', sub: 'PROJECTOR', size: 0.058,
    onChange: (on) => actions.setMap(on),
  });
  switches.map.group.position.set(0.095, -0.010, PANEL_Z);
  left.add(switches.map.group);

  for (const sw of Object.values(switches)) {
    interaction.register(sw.hit, {
      kind: 'control',
      control: sw,
      onClick: () => {
        const on = sw.toggle();
        audio?.switchClack(on);
      },
    });
  }

  // --- Right console: the exterior camera feeds ----------------------------
  const right = consoles.right;
  const monitors = createMonitors({ width: 0.30, height: 0.20 });
  monitors.group.position.set(0, 0.070, PANEL_Z);
  right.add(monitors.group);

  const feedKnob = rotarySelector({
    label: 'FEED', options: FEED_LABELS, size: 0.052,
    onChange: (i) => monitors.setIndex(i),
  });
  feedKnob.group.position.set(-0.115, -0.135, PANEL_Z);
  right.add(feedKnob.group);
  interaction.register(feedKnob.hit, {
    kind: 'control',
    control: feedKnob,
    onClick: () => { feedKnob.toggle(); audio?.switchClack(true); },
  });

  const rightPlate = nameplate({ text: 'HULL OPTICS', width: 0.16, height: 0.028 });
  rightPlate.position.set(-0.115, -0.198, PANEL_Z);
  right.add(rightPlate);

  // The Providence Engine is armed from under a safety cover, like an ordnance
  // release. Two deliberate actions, on the far side of the cabin from the drill.
  const armSwitch = guardedSwitch({
    label: 'PROVIDENCE', sub: 'ARM', size: 0.062,
    onChange: (on) => actions.setProvidence(on),
  });
  armSwitch.group.position.set(0.105, -0.130, PANEL_Z);
  right.add(armSwitch.group);
  interaction.register(armSwitch.hit, {
    kind: 'control',
    control: armSwitch,
    onClick: () => { armSwitch.toggle(); audio?.switchClack(armSwitch.on); },
  });

  // --- Hologram projector --------------------------------------------------
  // Mounted on the cabin root rather than the dash so the column stands vertically
  // regardless of how far the dashboard is raked, and offset right of centre so a
  // deployed projection never sits on top of the drill sight.
  const hologram = createHologram(world);
  hologram.group.position.set(0.235, -0.205, -0.395);
  cockpit.root.add(hologram.group);

  // --- Sensor fittings -----------------------------------------------------
  const sensorRack = createSensorRack({ cockpit, world, interaction, audio });
  const providence = createProvidence({ cockpit, world });

  // --- Teletype ------------------------------------------------------------
  const teletype = createTeletype({
    onStrike: () => audio?.typeTick(),
    onLine: () => audio?.carriageReturn(),
  });
  cockpit.parts.teletypeBay.add(teletype.group);

  // --- Sticky note ---------------------------------------------------------
  // Stuck to the inside of the canopy glass, bottom-left, exactly where a real
  // operator puts one. Lying flat on the raked dashboard it was foreshortened into
  // an unreadable sliver; on the glass it faces the seat square-on and costs only a
  // corner of the view, which is the trade every windscreen note has ever made.
  const sticky = createStickyNote({ width: 0.205 });
  // Low in the corner of the glass. The windscreen now runs down past the pilot's
  // knees, and a note left at the old height ended up floating in the middle of the
  // view rather than tucked out of the way at the bottom of it.
  sticky.group.position.set(-0.395, -0.183, -0.448);
  cockpit.root.add(sticky.group);

  // --- Update --------------------------------------------------------------
  let standbyPhase = 0;

  return {
    terminal,
    sticky,
    monitors,
    hologram,
    sensorRack,
    providence,
    teletype,
    feedKnob,
    armSwitch,
    switches,
    lamps,

    update(dt, state) {
      const live = session.power;
      const tubePower = live ? 1 : 0;
      terminal.power += (tubePower - terminal.power) * Math.min(1, dt * 6);

      // Instruments die with the bus. A dark cockpit should be genuinely dark.
      const t = live ? 1 : 0;
      fuelGauge.setValue(pod.fuelFraction * t, dt);
      heatGauge.setValue(pod.heatFraction * t, dt);
      hullBar.setValue(live ? pod.hullFraction : 0);
      cargoBar.setValue(live ? pod.cargoFraction : 0);
      cutBar.setValue(live ? (state.drill?.cutFraction ?? 0) : 0);

      // One instrument, two jobs. Airborne it is an altimeter reading height above
      // whatever is under you; in the rock it goes back to reading depth. The sign
      // is the tell — a leading + means there is air below the skids.
      if (live && state.agl !== null && state.agl !== undefined) {
        depthReadout.setLabel('AGL M');
        depthReadout.setText(`+${state.agl.toFixed(1)}`);
      } else {
        depthReadout.setLabel('DEPTH M');
        depthReadout.setText(live ? Math.max(0, state.depth).toFixed(0) : '');
      }
      cashReadout.setText(live ? credits(pod.cash) : '');

      const flashing = (on, warn) => (!live ? 0 : warn ? 2 : on ? 1 : 0);
      lamps.fuel.setState(flashing(pod.fuelFraction < 0.35, pod.fuelFraction < 0.12), dt);
      lamps.hull.setState(flashing(pod.hullFraction < 0.5, pod.hullFraction < 0.22), dt);
      lamps.heat.setState(flashing(pod.heatFraction > 0.6, pod.heatFraction > 0.86), dt);
      lamps.cargo.setState(flashing(pod.cargoFraction > 0.8, pod.cargoFull), dt);

      for (const sw of Object.values(switches)) sw.update(dt);
      feedKnob.update(dt);
      armSwitch.update(dt);
      armSwitch.group.visible = pod.sensors.has('providence');
      standby.setState(live ? 0 : 2, dt);
      standbyPhase += dt * 3.2;
      standbyGlow.intensity = live ? 0 : 0.35 + Math.sin(standbyPhase) * 0.30;

      // Route the terminal to the right page for the current phase.
      if (!live) terminal.setPage(PAGES.off);
      else if (session.phase === PHASE.BOOT || session.phase === PHASE.MENU) terminal.setPage(PAGES.boot);
      else terminal.setPage(PAGES[session.page] ?? PAGES.status);

      terminal.update(dt, state);

      monitors.update(dt, {
        live,
        depth: state.depth,
        speed: state.speed,
        heading: ((state.podYaw ?? 0) * -180 / Math.PI + 360) % 360,
      });
      hologram.update(dt, {
        on: live && state.mapOn,
        podPosition: state.podPosition,
        modified: state.modified,
        lattice: pod.sensors.has('lattice'),
      });

      teletype.update(dt, { live });

      sensorRack.sync(pod.sensors);
      sensorRack.update(dt, {
        owned: pod.sensors,
        live,
        position: state.podPosition,
        podYaw: state.podYaw ?? 0,
        drillTarget: state.drill?.target ?? null,
        drillPower: pod.drillPower,
      });

      const word = providence.update(dt, {
        owned: pod.sensors,
        live,
        position: state.podPosition,
        pod,
      });
      if (word.message) session.post(word.message, 4);
    },
  };
}
