import { PHASE, POST_LINES } from '../game/session.js';
import { credits } from '../game/economy.js';
import { BLOCKS } from '../world/blocks.js';

/**
 * Pages for the centre console terminal.
 *
 * Each page is a function of (ctx, api, state) that both draws and registers its
 * clickable regions — see ui/screen.js. Nothing here knows about three.js; a page
 * is just ink on a tube.
 */

const PAD = 12;

/**
 * Tab strip along the bottom. Present on every in-flight page.
 * While docked, the station gets its own tab so you can check the manifest without
 * having to lift off and land again.
 */
function tabs(api, state, active) {
  const items = [
    ['status', 'STATUS'],
    ['cargo', 'CARGO'],
    ['systems', 'SYS'],
    ['manual', 'MANUAL'],
  ];
  if (state.station) items.unshift([state.station.page, 'DOCK']);
  const w = (api.W - PAD * 2) / items.length;
  items.forEach(([id, label], i) => {
    api.button(PAD + i * w + 2, api.H - 34, w - 4, 26, label, {
      id: `tab:${id}`,
      active: active === id,
      onClick: () => state.actions.setPage(id),
    });
  });
}

/** Cold, unpowered tube. */
export function offPage(ctx, api) {
  api.clear();
}

/**
 * The self-test, and then the main menu.
 *
 * These are two screens rather than one scrolling page: a real machine finishes
 * POSTing and hands the tube over to whatever runs next. Trying to fit both at once
 * pushed the second menu option off the bottom of the CRT.
 */
export function bootPage(ctx, api, state) {
  if (state.session.phase !== PHASE.BOOT) return menuPage(ctx, api, state);

  api.clear();
  const P = api.P;
  let y = 20;
  const shown = POST_LINES.slice(0, state.session.revealed);

  for (const line of shown) {
    if (line.kind === 'gap') { y += 9; continue; }
    if (line.kind === 'head') {
      api.text(line.text, PAD, y, { size: 14, color: P.hot, bold: true });
    } else {
      // Leader dots between label and result, the way a POST screen aligns.
      const dots = '.'.repeat(Math.max(2, 34 - line.text.length));
      api.text(`${line.text} ${dots}`, PAD, y, { size: 13, color: P.ink });
      api.text(
        line.result,
        api.W - PAD, y,
        { size: 13, align: 'right', color: line.kind === 'odd' ? P.hot : P.ink, bold: true },
      );
    }
    y += 17;
  }

  // Blinking cursor while the test is still running.
  if (Math.floor(state.time * 3) % 2 === 0) {
    ctx.fillStyle = P.ink;
    ctx.fillRect(PAD, y - 6, 9, 13);
  }
}

export function menuPage(ctx, api, state) {
  api.clear();
  const P = api.P;

  api.text('NATAS HEAVY INDUSTRIES', api.W / 2, 34, {
    size: 15, align: 'center', color: P.hot, bold: true,
  });
  api.text('MARS EXCAVATION CONTRACT 7734', api.W / 2, 56, {
    size: 12, align: 'center', color: P.dim,
  });
  api.rule(74);

  const bw = api.W - PAD * 2 - 40;
  let y = 104;
  api.button(PAD + 20, y, bw, 34, 'NEW EXCAVATION', {
    id: 'menu:new',
    onClick: () => state.actions.startRun(true),
  });
  y += 46;
  api.button(PAD + 20, y, bw, 34, 'RESUME CONTRACT', {
    id: 'menu:resume',
    disabled: !state.hasSave,
    onClick: () => state.actions.startRun(false),
  });

  y += 58;
  api.rule(y - 14);
  api.text('SELF TEST COMPLETE. ALL SYSTEMS NOMINAL.', api.W / 2, y, {
    size: 11, align: 'center', color: P.dim,
  });
  y += 17;
  api.text('CONTRACT TERMS ON FILE.', api.W / 2, y, { size: 11, align: 'center', color: P.dim });
  y += 15;
  api.text('SIGNATURE ALREADY PRESENT.', api.W / 2, y, { size: 11, align: 'center', color: P.hot });
}

export function statusPage(ctx, api, state) {
  api.clear();
  const { pod, depth, drill, speed } = state;
  const P = api.P;
  api.title('POD STATUS', `${speed >= 0 ? 'DESC' : 'ASC'} ${Math.abs(speed).toFixed(1)} M/S`);

  // Depth gets the whole top of the tube. It is the number the run is about.
  api.text('DEPTH', PAD, 48, { size: 12, color: P.dim });
  api.text(`${Math.max(0, depth).toFixed(1)}`, api.W - 54, 56, {
    size: 38, align: 'right', bold: true, color: P.hot,
  });
  api.text('M', api.W - PAD, 62, { size: 15, align: 'right', color: P.dim });
  api.text('CREDITS', PAD, 84, { size: 12, color: P.dim });
  api.text(credits(pod.cash), api.W - PAD, 84, { size: 16, align: 'right', bold: true });
  api.rule(98);

  // Label / bar / value in fixed columns so nothing can collide as values grow.
  const LABEL_W = 62;
  const VALUE_W = 74;
  const barX = PAD + LABEL_W;
  const barW = api.W - PAD * 2 - LABEL_W - VALUE_W;
  let y = 118;
  const meter = (name, t, value, opts = {}) => {
    api.text(name, PAD, y + 7, { size: 12, color: P.dim });
    api.bar(barX, y, barW, 15, t, opts);
    api.text(value, api.W - PAD, y + 7, { size: 13, align: 'right', bold: true });
    y += 25;
  };

  meter('FUEL', pod.fuelFraction, `${Math.round(pod.fuel)}L`, {
    color: pod.fuelFraction < 0.2 ? P.hot : P.ink,
  });
  meter('HULL', pod.hullFraction, `${Math.round(pod.hull)}`, {
    color: pod.hullFraction < 0.3 ? P.hot : P.ink,
  });
  meter('HEAT', pod.heatFraction, `${Math.round(pod.heat)}%`, { warn: 0.85 });
  meter('CARGO', pod.cargoFraction, `${pod.cargoUnits}/${pod.maxCargo}`, { warn: 0.9 });

  y += 4;
  api.rule(y - 6);
  y += 12;
  const target = drill?.target;
  if (target) {
    const def = BLOCKS[target.id];
    api.text('UNDER BIT', PAD, y, { size: 12, color: P.dim });
    api.text(def.name.toUpperCase(), api.W - PAD, y, {
      size: 14, align: 'right', bold: true, color: def.value > 0 ? P.hot : P.ink,
    });
    y += 22;
    api.text('CUT', PAD, y, { size: 12, color: P.dim });
    api.bar(barX, y - 7, barW + VALUE_W - 8, 12, drill.cutFraction);
  } else {
    api.text('BIT CLEAR', PAD, y, { size: 13, color: P.dim });
  }

  if (state.session.notice) {
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, api.H - 62, api.W, 22);
    api.text(state.session.notice, api.W / 2, api.H - 51, {
      size: 13, color: P.bg, align: 'center', bold: true,
    });
  }

  tabs(api, state, 'status');
}

export function cargoPage(ctx, api, state) {
  api.clear();
  const { pod } = state;
  const P = api.P;
  api.title('CARGO MANIFEST', `${pod.cargoUnits}/${pod.maxCargo} U`);

  const rows = pod.manifest();
  let y = 44;
  if (!rows.length) {
    api.text('BAY EMPTY', PAD, y, { size: 14, color: P.dim });
  } else {
    api.text('ORE', PAD, y, { size: 11, color: P.dim });
    api.text('QTY', api.W - 150, y, { size: 11, color: P.dim, align: 'right' });
    api.text('VALUE', api.W - PAD, y, { size: 11, color: P.dim, align: 'right' });
    y += 8;
    api.rule(y);
    y += 14;
    for (const row of rows.slice(0, 9)) {
      api.text(row.name.toUpperCase(), PAD, y, { size: 13 });
      api.text(String(row.count), api.W - 150, y, { size: 13, align: 'right' });
      api.text(credits(row.value), api.W - PAD, y, { size: 13, align: 'right', bold: true });
      y += 19;
    }
  }

  y = api.H - 66;
  api.rule(y - 12);
  api.text('BAY VALUE', PAD, y, { size: 12, color: P.dim });
  api.text(credits(pod.cargoValue()), api.W - PAD, y, {
    size: 17, align: 'right', bold: true, color: P.hot,
  });

  tabs(api, state, 'cargo');
}

export function systemsPage(ctx, api, state) {
  api.clear();
  const P = api.P;
  api.title('SYSTEMS');
  const { pod } = state;

  const rows = [
    ['DRILL ASSEMBLY', `MK ${pod.upgrades.drill + 1}`],
    ['HULL PLATING', `${Math.round(pod.hull)}/${pod.maxHull}`],
    ['FUEL CELL', `${Math.round(pod.fuel)}/${pod.maxFuel} L`],
    ['LIFT ENGINE', `TYPE-${pod.upgrades.engine + 1}`],
    ['HEAT EXCHANGER', `${pod.coolingScale.toFixed(1)}X`],
    ['CARGO BAY', `${pod.maxCargo} U`],
  ];

  let y = 46;
  for (const [name, value] of rows) {
    api.text(name, PAD, y, { size: 13, color: P.dim });
    api.text(value, api.W - PAD, y, { size: 14, align: 'right', bold: true });
    y += 22;
  }

  y += 4;
  api.rule(y - 12);
  api.text('SENSOR SUITE', PAD, y, { size: 12, color: P.dim });
  api.text(
    pod.sensors.size === 0 ? 'NONE FITTED' : `${pod.sensors.size} MODULE(S) ONLINE`,
    api.W - PAD, y,
    { size: 13, align: 'right', bold: pod.sensors.size > 0 },
  );
  y += 22;

  // Head tracking is a peripheral, so it is reported here like any other fitting.
  const tracker = state.tracker;
  const trackerState = !tracker?.available ? 'DISABLED'
    : tracker.connected ? 'LOCKED'
      : tracker.searching ? 'SEARCHING' : 'NO SIGNAL';
  api.text('HEAD TRACKER', PAD, y, { size: 12, color: P.dim });
  api.text(trackerState, api.W - PAD, y, {
    size: 13, align: 'right', bold: true,
    color: tracker?.connected ? P.hot : P.dim,
  });
  y += 14;
  api.button(
    PAD, y, api.W - PAD * 2, 24,
    tracker?.connected ? 'RECENTRE HEAD TRACKER  [F9]' : 'SEARCH FOR HEAD TRACKER',
    {
      id: 'sys:recentre',
      disabled: !tracker?.available,
      onClick: () => state.actions.recentreTracker(),
    },
  );

  tabs(api, state, 'systems');
}

export function manualPage(ctx, api, state) {
  api.clear();
  const P = api.P;
  const page = state.manualPage ?? 0;
  const PAGES = [
    {
      title: 'CONTROLS',
      lines: [
        'W / A / S / D    THRUST',
        'SPACE            LIFT',
        'CTRL             DESCEND',
        'MOUSE            LOOK / AIM',
        'LEFT BUTTON      DRILL, OR OPERATE',
        '                 WHATEVER THE SIGHT',
        '                 IS RESTING ON',
        '',
        'TURN YOUR HEAD PAST THE DETENT AND',
        'THE POD FOLLOWS YOUR GAZE.',
      ],
    },
    {
      title: 'ORE VALUES',
      table: true,
    },
    {
      title: 'HAZARD NOTES',
      lines: [
        'MAGMA     CONTACT IS FATAL TO PLATING.',
        '          THE HEAT EXCHANGER BUYS TIME,',
        '          NOT IMMUNITY.',
        '',
        'POCKETS   PRESSURISED GAS DETONATES WHEN',
        '          OPENED. DRILL AWAY FROM IT.',
        '',
        'FALLS     BELOW 13 M/S THE SUSPENSION',
        '          TAKES IT. ABOVE, YOU DO.',
        '',
        'CLAIM     BOUNDARY ROCK CANNOT BE CUT.',
        '          THE CONTRACT IS SPECIFIC.',
      ],
    },
  ];

  const p = PAGES[page % PAGES.length];
  api.title(`FIELD MANUAL - ${p.title}`, `${(page % PAGES.length) + 1}/${PAGES.length}`);

  let y = 46;
  if (p.table) {
    const ores = Object.entries(BLOCKS)
      .map(([, b]) => b)
      .filter((b) => b && b.value > 0)
      .sort((a, b) => a.value - b.value);
    for (const ore of ores) {
      api.text(ore.name.toUpperCase(), PAD, y, { size: 12 });
      api.text(credits(ore.value), api.W - PAD, y, { size: 12, align: 'right', bold: true });
      y += 17;
    }
  } else {
    for (const line of p.lines) {
      api.text(line, PAD, y, { size: 12, color: line.startsWith(' ') ? P.dim : P.ink });
      y += 16;
    }
  }

  api.button(PAD, api.H - 68, 90, 26, 'PREV', {
    id: 'manual:prev',
    onClick: () => state.actions.setManualPage(page - 1),
  });
  api.button(api.W - PAD - 90, api.H - 68, 90, 26, 'NEXT', {
    id: 'manual:next',
    onClick: () => state.actions.setManualPage(page + 1),
  });

  tabs(api, state, 'manual');
}

// --- Vendor consoles -------------------------------------------------------
// Every station reuses the same furniture: a header identifying the uplink, the
// pod's relevant number, and one or two large buttons. They are terminals bolted to
// a shed on Mars, not a storefront.

function vendorHeader(api, state, title) {
  api.title(title, credits(state.pod.cash));
}

export function fuelPage(ctx, api, state) {
  api.clear();
  const { pod, prices } = state;
  const P = api.P;
  vendorHeader(api, state, 'FUEL DEPOT');

  const need = pod.maxFuel - pod.fuel;
  const fullCost = Math.ceil(need * prices.fuel);
  const partial = Math.min(need, 25);
  const partialCost = Math.ceil(partial * prices.fuel);

  api.text('TANK', PAD, 52, { size: 12, color: P.dim });
  api.bar(PAD + 62, 45, api.W - PAD * 2 - 130, 15, pod.fuelFraction);
  api.text(`${Math.round(pod.fuel)}/${pod.maxFuel}L`, api.W - PAD, 52, {
    size: 13, align: 'right', bold: true,
  });
  api.text(`RATE  ${prices.fuel.toFixed(2)} CR / LITRE`, PAD, 78, { size: 12, color: P.dim });
  api.rule(92);

  api.button(PAD, 106, api.W - PAD * 2, 34,
    need < 0.5 ? 'TANK FULL' : `FILL TANK — ${credits(fullCost)} CR`, {
      id: 'fuel:full',
      disabled: need < 0.5 || !pod.canAfford(fullCost),
      onClick: () => state.actions.buyFuel(need),
    });
  api.button(PAD, 150, api.W - PAD * 2, 30,
    `ADD ${Math.round(partial)}L — ${credits(partialCost)} CR`, {
      id: 'fuel:part',
      disabled: need < 0.5 || !pod.canAfford(partialCost),
      onClick: () => state.actions.buyFuel(partial),
    });

  api.text('HYDRAZINE IS BILLED TO YOUR CONTRACT.', PAD, 200, { size: 11, color: P.dim });
  if (state.session.notice) {
    api.text(state.session.notice, PAD, 220, { size: 12, color: P.hot, bold: true });
  }
  tabs(api, state, state.station?.page);
}

export function repairPage(ctx, api, state) {
  api.clear();
  const { pod, prices } = state;
  const P = api.P;
  vendorHeader(api, state, 'REPAIR RIG');

  const missing = pod.maxHull - pod.hull;
  const fullCost = Math.ceil(missing * prices.repair);
  const partial = Math.min(missing, 25);
  const partialCost = Math.ceil(partial * prices.repair);

  api.text('HULL', PAD, 52, { size: 12, color: P.dim });
  api.bar(PAD + 62, 45, api.W - PAD * 2 - 130, 15, pod.hullFraction, {
    color: pod.hullFraction < 0.3 ? P.hot : P.ink,
  });
  api.text(`${Math.round(pod.hull)}/${pod.maxHull}`, api.W - PAD, 52, {
    size: 13, align: 'right', bold: true,
  });
  api.text(`RATE  ${prices.repair.toFixed(2)} CR / POINT`, PAD, 78, { size: 12, color: P.dim });
  api.rule(92);

  api.button(PAD, 106, api.W - PAD * 2, 34,
    missing < 0.5 ? 'HULL SOUND' : `FULL REPAIR — ${credits(fullCost)} CR`, {
      id: 'repair:full',
      disabled: missing < 0.5 || !pod.canAfford(fullCost),
      onClick: () => state.actions.repairHull(missing),
    });
  api.button(PAD, 150, api.W - PAD * 2, 30,
    `PATCH ${Math.round(partial)} — ${credits(partialCost)} CR`, {
      id: 'repair:part',
      disabled: missing < 0.5 || !pod.canAfford(partialCost),
      onClick: () => state.actions.repairHull(partial),
    });

  api.text('PLATING ONLY. WE DO NOT ASK WHAT HIT YOU.', PAD, 200, { size: 11, color: P.dim });
  if (state.session.notice) {
    api.text(state.session.notice, PAD, 220, { size: 12, color: P.hot, bold: true });
  }
  tabs(api, state, state.station?.page);
}

export function traderPage(ctx, api, state) {
  api.clear();
  const { pod } = state;
  const P = api.P;
  vendorHeader(api, state, 'ORE TRADER');

  const rows = pod.manifest();
  let y = 48;
  if (!rows.length) {
    api.text('NOTHING TO ASSAY.', PAD, y, { size: 14, color: P.dim });
  } else {
    for (const row of rows.slice(0, 6)) {
      api.text(`${row.count}x ${row.name.toUpperCase()}`, PAD, y, { size: 13 });
      api.text(credits(row.value), api.W - PAD, y, { size: 13, align: 'right', bold: true });
      y += 19;
    }
    if (rows.length > 6) {
      api.text(`+${rows.length - 6} MORE`, PAD, y, { size: 11, color: P.dim });
      y += 16;
    }
  }

  const total = pod.cargoValue();
  api.rule(api.H - 122);
  api.text('ASSAYED VALUE', PAD, api.H - 104, { size: 12, color: P.dim });
  api.text(credits(total), api.W - PAD, api.H - 104, {
    size: 18, align: 'right', bold: true, color: P.hot,
  });
  api.button(PAD, api.H - 88, api.W - PAD * 2, 34,
    total > 0 ? `SELL ALL — ${credits(total)} CR` : 'BAY EMPTY', {
      id: 'trade:sell',
      disabled: total <= 0,
      onClick: () => state.actions.sellAll(),
    });
  tabs(api, state, state.station?.page);
}

export function workshopPage(ctx, api, state) {
  api.clear();
  const { pod, upgrades } = state;
  const P = api.P;
  vendorHeader(api, state, 'FITTING SHOP');

  let y = 34;
  for (const line of upgrades) {
    const level = pod.upgradeLevel(line.key);
    const current = line.tiers[level];
    const next = level + 1 < line.tiers.length ? line.tiers[level + 1] : null;
    const affordable = next && pod.canAfford(next.cost);

    api.text(line.name.toUpperCase(), PAD, y + 9, { size: 12 });
    api.text(`${current.value}${line.unit}`, PAD + 126, y + 9, { size: 12, color: P.dim });
    if (next) {
      api.text(`> ${next.value}${line.unit}`, PAD + 190, y + 9, { size: 12, color: P.hot });
      api.button(api.W - PAD - 96, y, 96, 20, credits(next.cost), {
        id: `up:${line.key}`,
        disabled: !affordable,
        onClick: () => state.actions.buyUpgrade(line.key),
      });
    } else {
      api.text('MAX', api.W - PAD, y + 9, { size: 12, align: 'right', color: P.dim });
    }
    y += 25;
  }

  api.rule(y + 2);
  api.text(
    state.session.notice ?? 'FITTINGS ARE FINAL. NO REFUNDS ON THIS CONTRACT.',
    PAD, y + 20,
    { size: 11, color: state.session.notice ? P.hot : P.dim },
  );
  tabs(api, state, state.station?.page);
}

export function uplinkPage(ctx, api, state) {
  api.clear();
  const { pod } = state;
  const P = api.P;
  vendorHeader(api, state, 'UPLINK TOWER');

  const rows = [
    ['DEEPEST', `${Math.round(pod.deepestDepth)} M`],
    ['BLOCKS CUT', String(pod.stats.blocksDrilled)],
    ['ORE RECOVERED', `${pod.stats.oreMined} U`],
    ['LIFETIME EARNINGS', credits(pod.stats.earned)],
    ['RECOVERIES', String(pod.stats.rescues)],
  ];
  let y = 50;
  for (const [k, v] of rows) {
    api.text(k, PAD, y, { size: 12, color: P.dim });
    api.text(v, api.W - PAD, y, { size: 13, align: 'right', bold: true });
    y += 21;
  }

  api.rule(y + 2);
  api.button(PAD, y + 14, api.W - PAD * 2, 34, 'TRANSMIT CONTRACT STATE', {
    id: 'uplink:save',
    onClick: () => state.actions.saveGame(),
  });
  api.text(
    state.session.notice ?? 'NATAS HEAVY INDUSTRIES ACKNOWLEDGES RECEIPT.',
    PAD, y + 62,
    { size: 11, color: state.session.notice ? P.hot : P.dim },
  );
  tabs(api, state, state.station?.page);
}

export function sensorPage(ctx, api, state) {
  api.clear();
  const P = api.P;
  const { pod, sensors, sensorAvailable } = state;
  vendorHeader(api, state, 'SENSOR BUREAU');

  let y = 32;
  for (const module of sensors) {
    const owned = pod.sensors.has(module.key);
    const buyable = sensorAvailable(module.key, pod.sensors);
    const affordable = buyable && pod.canAfford(module.cost);

    api.text(module.short, PAD, y + 8, {
      size: 13, bold: true, color: owned ? P.dim : module.key === 'providence' ? P.hot : P.ink,
    });
    api.text(module.mount, PAD, y + 24, { size: 10, color: P.dim });

    if (owned) {
      api.text('FITTED', api.W - PAD, y + 14, { size: 12, align: 'right', color: P.dim });
    } else if (!buyable) {
      api.text('LOCKED', api.W - PAD, y + 14, { size: 12, align: 'right', color: P.dim });
    } else {
      api.button(api.W - PAD - 104, y + 2, 104, 24, `${credits(module.cost)}`, {
        id: `sensor:${module.key}`,
        disabled: !affordable,
        onClick: () => state.actions.buySensor(module.key),
      });
    }
    y += 38;
  }

  api.rule(y - 4);
  const focus = sensors.find((m) => !pod.sensors.has(m.key)) ?? sensors[sensors.length - 1];
  api.text(
    state.session.notice ?? focus.blurb,
    PAD, y + 12,
    { size: 11, color: state.session.notice ? P.hot : P.dim },
  );
  if (!state.session.notice && focus.warning) {
    api.text(focus.warning, PAD, y + 26, { size: 10, color: P.hot });
  }

  tabs(api, state, state.station?.page);
}

export const PAGES = {
  off: offPage,
  boot: bootPage,
  status: statusPage,
  cargo: cargoPage,
  systems: systemsPage,
  manual: manualPage,
  'vendor:fuel': fuelPage,
  'vendor:repair': repairPage,
  'vendor:trader': traderPage,
  'vendor:workshop': workshopPage,
  'vendor:uplink': uplinkPage,
  'vendor:sensors': sensorPage,
};
