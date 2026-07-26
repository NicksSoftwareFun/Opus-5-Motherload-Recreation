import { createAudio } from '../../src/audio/audio.js';
import { MOVEMENTS, movementFor } from '../../src/audio/music.js';
import { tone, burst, noiseBuffer } from '../../src/audio/synth.js';
import { BLOCKS, ORE_TABLE, ROCK, DIRT, HARDROCK } from '../../src/world/blocks.js';

/**
 * The Jukebox: a bench for the game's audio.
 *
 * It imports the real modules rather than reimplementing them, which is the only
 * thing that makes it worth having. If a pad here sounds wrong, the game sounds
 * wrong — there is no second copy of the synthesis to drift out of sync.
 *
 * Three jobs:
 *   1. Fire every sound in the game and see where it lives in the spectrum.
 *   2. Drive the continuous voices — drill, thrusters, beds, score — by hand.
 *   3. Build new cockpit sounds out of the same two primitives and take the code.
 */

const audio = createAudio();
let armed = false;

/** The control loop the game runs at 120 Hz; here it is just rAF. */
let lastFrame = performance.now();

// ---------------------------------------------------------------- catalogue

/**
 * Every one-shot the cockpit can make.
 *
 * `why` is the design note, not the API doc — the reason the sound is shaped the
 * way it is. That is the part that is worth reading while you listen to it.
 */
const SOUNDS = [
  {
    group: 'Cabin — things you do',
    items: [
      ['switchClack', 'Switch thrown', 'A mechanical clack, not a beep. Noise burst swept down, with a low square under it for the body of the toggle.', () => audio.switchClack(true)],
      ['switchClack off', 'Switch released', 'Same shape, pitched lower: a switch going off sounds duller than one going on.', () => audio.switchClack(false)],
      ['chirp', 'CRT region pressed', 'Rising square. The only genuinely electronic sound in the cabin, because it is the only genuinely electronic action.', () => audio.chirp()],
      ['blip', 'Page change', 'Deliberately unremarkable — it happens constantly and must never demand attention.', () => audio.blip()],
      ['confirm', 'Transaction accepted', 'Three rising squares. A major arpeggio is the one unambiguous "yes" in sound design.', () => audio.confirm()],
      ['deny', 'Refused', 'One falling sawtooth. Down is no, and sawtooth is rude.', () => audio.deny()],
      ['crtPower', 'Terminal comes up', 'A degaussing coil thunk plus a 15.6 kHz flyback whine. The most recognisable "machine switched on" sound there is.', () => audio.crtPower(true)],
      ['crtPower off', 'Terminal goes dark', 'The whine collapses first, then the thunk. Tubes die from the top down.', () => audio.crtPower(false)],
      ['uplink', 'Uplink established', 'Rising sine triad — a handshake, not an alarm.', () => audio.uplink(true)],
      ['uplink drop', 'Uplink lost', 'One falling sine. You have left the pad.', () => audio.uplink(false)],
      ['postTick', 'Self-test line', 'An 18 ms tick at 3.2 kHz. Twelve of them are the POST printing itself out.', () => audio.postTick()],
      ['typeTick', 'Teletype strike', 'One character hitting paper. Randomised in pitch every strike so a line does not machine-gun.', () => audio.typeTick()],
      ['carriageReturn', 'Carriage return', 'The carriage travelling and hitting its stop, then the platen stepping on 130 ms later. The half of a dot-matrix printer people actually remember.', () => audio.carriageReturn()],
      ['sonarPing', 'Chirp sonar', 'The pulse out, then the rock answering through the reverb send.', () => audio.sonarPing()],
      ['stow', 'Ore stowed (cheap)', 'Pitched off what it is worth. Ironium lands low.', () => audio.stow(30)],
      ['stow rich', 'Ore stowed (rich)', 'The same sound 680 Hz higher, because you just found something.', () => audio.stow(100000)],
      ['alarm', 'Generic attention', 'Two tones. Kept for callers that just want a noise.', () => audio.alarm()],
    ],
  },
  {
    group: 'Service — the surface installations',
    items: [
      ['pump', 'Hydrazine', 'A swept noise burst with a low square under it, and a valve knock at the end when the tank is full.', () => audio.pump()],
      ['weld', 'Repair rig', 'Five randomised arc bursts. Never the same twice, because a weld never is.', () => audio.weld()],
      ['servo', 'Module fitted', 'A sawtooth sweeping up as the rack travels, then a latch.', () => audio.servo()],
      ['jettison', 'Cargo purged', 'Doors, then six pieces of tumbling ore at random delays.', () => audio.jettison()],
      ['clutch in', 'Drill clutch engaged', 'The bit spinning up: a square sweeping 38 → 118 Hz.', () => audio.clutch(true)],
      ['clutch out', 'Drill clutch out', 'The same sweep reversed and longer. Things wind down slower than they wind up.', () => audio.clutch(false)],
    ],
  },
  {
    group: 'The mine — things done to you',
    items: [
      ['touchdown', 'Landing', 'Below the damage threshold. A landing you walked away from should still be audible.', () => audio.touchdown(6)],
      ['thud', 'Hard impact', 'Through the reverb send, so the mine answers it.', () => audio.thud(9)],
      ['breakBlock dirt', 'Dirt gives way', 'Filter frequency comes from the block hardness — soft rock breaks low.', () => audio.breakBlock(DIRT)],
      ['breakBlock rock', 'Rock gives way', 'The same call, harder block, brighter break.', () => audio.breakBlock(ROCK)],
      ['breakBlock basalt', 'Basalt gives way', 'Hardest of the three. One function, three sounds.', () => audio.breakBlock(HARDROCK)],
      ['gasVent', 'Pocket breached', 'A long hiss sweeping down. The one sound worth backing away from.', () => audio.gasVent(1)],
      ['explosion', 'Gas detonation', 'Blast, sub, and a delayed tail through the reverb — the tail is what gives it a room.', () => audio.explosion(1)],
      ['quake', 'Seismic event', 'Two and a half seconds of 90 Hz sweeping to 40, with a sub under it. Nothing you can do about it.', () => audio.quake(7)],
      ['rescueSting', 'Mr Natas cuts in', 'A tritone held on two sawtooths. He is not a nice man.', () => audio.rescueSting()],
    ],
  },
  {
    group: 'Klaxons — one at a time, most severe first',
    items: [
      ['fault hull', 'HULL', 'Three tones, fastest cadence. It interrupts anything less severe.', () => fireFault('hull')],
      ['fault heat', 'OVERHEAT', 'Three flat tones at 1480 Hz — urgent but not falling, because heat is recoverable.', () => fireFault('heat')],
      ['fault fuel', 'FUEL LOW', 'Two tones, slow. You have minutes, not seconds.', () => fireFault('fuel')],
      ['fault cargo', 'BAY FULL', 'One soft tone every 3.4 s. Good news wearing a warning light.', () => fireFault('cargo')],
    ],
  },
];

/** Fire a single cadence of one klaxon, then stop. */
function fireFault(key) {
  const state = { [key]: true };
  audio.faults(99, state);          // large dt forces the cadence immediately
}

// ------------------------------------------------------------------- state

/** Everything the continuous voices are being driven with. */
const drive = {
  drillOn: false,
  drillBlock: ROCK,
  drillPower: 3.5,
  thrust: 0,
  projector: false,
  providence: false,
  depth: 0,
  live: true,
  hull: 1,
  magma: 0,
  speed: 0,
  danger: 0,
  faults: { hull: false, heat: false, fuel: false, cargo: false },
};

// -------------------------------------------------------------------- arm

const armBtn = document.getElementById('arm');
armBtn.addEventListener('click', () => {
  if (armed) return;
  audio.start();
  audio.setVolume(master.value / 100);
  armed = true;
  armBtn.textContent = 'AUDIO LIVE';
  armBtn.classList.add('on');
  document.body.classList.remove('cold');
  requestAnimationFrame(frame);
});

const master = document.getElementById('master');
const masterOut = document.getElementById('masterOut');
master.addEventListener('input', () => {
  masterOut.value = master.value;
  // The slider is the module's own master trim, not a second gain stage stacked on
  // top of it — so the level here is the level the game plays at.
  audio.setVolume(master.value / 100);
});

// ------------------------------------------------------------------ pads

const padHost = document.getElementById('pads');
for (const { group, items } of SOUNDS) {
  const wrap = document.createElement('div');
  wrap.className = 'group';
  const h = document.createElement('h3');
  h.textContent = group;
  wrap.appendChild(h);
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const [id, label, why, fire] of items) {
    const b = document.createElement('button');
    b.className = 'pad';
    b.type = 'button';
    b.title = `${id}() — ${why}`;
    b.innerHTML = `<b></b><em></em>`;
    b.querySelector('b').textContent = label;
    b.querySelector('em').textContent = why;
    b.addEventListener('click', (e) => {
      if (!armed) return;
      b.classList.add('hit');
      setTimeout(() => b.classList.remove('hit'), 110);
      if (e.shiftKey) {
        // Ten in a row: the test for whether a sound survives repetition.
        for (let i = 0; i < 10; i++) setTimeout(fire, i * 170);
      } else {
        fire();
      }
    });
    grid.appendChild(b);
  }
  wrap.appendChild(grid);
  padHost.appendChild(wrap);
}

// -------------------------------------------------------------- controls

/** A labelled slider row bound to a key on `drive`. */
function slider(host, { label, key, min, max, step = 0.01, format = (v) => v.toFixed(2), onInput }) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label></label><input type="range"><output></output>';
  row.querySelector('label').textContent = label;
  const input = row.querySelector('input');
  const out = row.querySelector('output');
  input.min = min; input.max = max; input.step = step; input.value = drive[key];
  out.textContent = format(drive[key]);
  input.addEventListener('input', () => {
    drive[key] = parseFloat(input.value);
    out.textContent = format(drive[key]);
    onInput?.(drive[key]);
  });
  host.appendChild(row);
  return { input, out };
}

/** A row of on/off buttons. */
function toggles(host, label, defs) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label></label><div class="toggles"></div><output></output>';
  row.querySelector('label').textContent = label;
  const box = row.querySelector('.toggles');
  for (const [text, get, set] of defs) {
    const b = document.createElement('button');
    b.className = 'tgl';
    b.type = 'button';
    b.textContent = text;
    const sync = () => b.classList.toggle('on', Boolean(get()));
    b.addEventListener('click', () => { set(!get()); sync(); });
    sync();
    box.appendChild(b);
  }
  host.appendChild(row);
}

const machinery = document.getElementById('machinery');

toggles(machinery, 'DRILL', [
  ['cutting', () => drive.drillOn, (v) => {
    drive.drillOn = v;
    if (armed) audio.clutch(v);
  }],
  ['projector', () => drive.projector, (v) => { drive.projector = v; audio.projector(v); }],
  ['providence', () => drive.providence, (v) => { drive.providence = v; audio.providence(v); }],
]);

// Block selector: the whole point of the drill voice is that this changes it.
{
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label>UNDER BIT</label><select></select><output></output>';
  const sel = row.querySelector('select');
  const out = row.querySelector('output');
  const options = [DIRT, ROCK, HARDROCK, ...ORE_TABLE.map((o) => o.id)];
  for (const id of options) {
    const def = BLOCKS[id];
    if (!def) continue;
    const o = document.createElement('option');
    o.value = String(id);
    o.textContent = def.name;
    if (id === ROCK) o.selected = true;
    sel.appendChild(o);
  }
  const sync = () => {
    const def = BLOCKS[drive.drillBlock];
    out.textContent = `H ${(def.hardness ?? 1).toFixed(2)}`;
  };
  sel.addEventListener('change', () => { drive.drillBlock = Number(sel.value); sync(); });
  sync();
  machinery.appendChild(row);
}

slider(machinery, { label: 'DRILL POWER', key: 'drillPower', min: 1, max: 6, step: 0.1, format: (v) => v.toFixed(1) });
slider(machinery, { label: 'THRUSTERS', key: 'thrust', min: 0, max: 1 });

toggles(machinery, 'KLAXON', [
  ['hull', () => drive.faults.hull, (v) => { drive.faults.hull = v; }],
  ['heat', () => drive.faults.heat, (v) => { drive.faults.heat = v; }],
  ['fuel', () => drive.faults.fuel, (v) => { drive.faults.fuel = v; }],
  ['cargo', () => drive.faults.cargo, (v) => { drive.faults.cargo = v; }],
]);

const world = document.getElementById('world');
const depthRow = slider(world, {
  label: 'DEPTH (m)', key: 'depth', min: 0, max: 256, step: 1,
  format: (v) => `${v | 0} m`,
  onInput: () => paintStrata(),
});
toggles(world, 'SYSTEMS', [
  ['powered', () => drive.live, (v) => { drive.live = v; }],
]);
slider(world, { label: 'HULL', key: 'hull', min: 0, max: 1, format: (v) => `${(v * 100) | 0}%` });
slider(world, { label: 'MAGMA NEAR', key: 'magma', min: 0, max: 1 });
slider(world, { label: 'SPEED (m/s)', key: 'speed', min: 0, max: 30, step: 0.5, format: (v) => v.toFixed(1) });
slider(world, { label: 'DANGER', key: 'danger', min: 0, max: 1 });

// A shortcut that does what the demo track does, so you can hear the arc.
{
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label>DESCEND</label><div class="toggles"></div><output></output>';
  const box = row.querySelector('.toggles');
  const b = document.createElement('button');
  b.className = 'tgl';
  b.type = 'button';
  b.textContent = 'ride 0 → 256 m over 60 s';
  let riding = null;
  b.addEventListener('click', () => {
    if (riding) { clearInterval(riding); riding = null; b.classList.remove('on'); return; }
    b.classList.add('on');
    const t0 = performance.now();
    riding = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / 60000);
      drive.depth = k * 256;
      depthRow.input.value = String(drive.depth);
      depthRow.out.textContent = `${drive.depth | 0} m`;
      paintStrata();
      if (k >= 1) { clearInterval(riding); riding = null; b.classList.remove('on'); }
    }, 100);
  });
  box.appendChild(b);
  world.appendChild(row);
}

// ------------------------------------------------------------ mood panel

/** Interval names, for reading a chord without counting semitones. */
const INTERVALS = {
  0: 'root', 1: 'minor 2nd', 2: 'major 2nd', 3: 'minor 3rd', 4: 'major 3rd',
  5: 'perfect 4th', 6: 'TRITONE', 7: 'perfect 5th', 8: 'minor 6th',
  9: 'major 6th', 10: 'minor 7th', 11: 'major 7th', 12: 'octave',
  14: 'major 9th', 19: '12th',
};
/** The intervals that are doing the unpleasant work. */
const TENSE = new Set([1, 6, 8, 10, 11]);

/**
 * Sensory roughness, Plomp & Levelt.
 *
 * Two partials close together but not identical beat against each other inside one
 * critical band, and that beating is what the ear reports as harshness. Summing it
 * over the first six harmonics of every chord tone gives a number that tracks how
 * unpleasant a chord is without anybody having an opinion about it — which is the
 * point of putting it on screen next to the movements.
 */
function roughness(root, chord, partials = 6) {
  const comps = [];
  for (const semi of chord) {
    const f0 = root * 2 ** (semi / 12);
    for (let n = 1; n <= partials; n++) comps.push({ f: f0 * n, a: 1 / n });
  }
  let total = 0;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const lo = Math.min(comps[i].f, comps[j].f);
      const hi = Math.max(comps[i].f, comps[j].f);
      const s = 0.24 / (0.0207 * lo + 18.96);
      const x = s * (hi - lo);
      total += comps[i].a * comps[j].a * (Math.exp(-3.5 * x) - Math.exp(-5.75 * x));
    }
  }
  return total;
}

const ROUGH = MOVEMENTS.map((m) => roughness(m.root, m.chord));
const ROUGH_MAX = Math.max(...ROUGH);

const strataHost = document.getElementById('strata');
function paintStrata() {
  const here = movementFor(drive.depth);
  strataHost.innerHTML = '';
  MOVEMENTS.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'stratum' + (m === here ? ' here' : '');
    const from = m.from === -Infinity ? 0 : m.from;
    const to = MOVEMENTS[i + 1] ? MOVEMENTS[i + 1].from : 256;
    const ivals = m.chord.map((n) => {
      const base = n % 12;
      const name = INTERVALS[n] ?? INTERVALS[base] ?? `${n} semis`;
      const tense = TENSE.has(base) && n !== 0;
      return `<span class="ival${tense ? ' tense' : ''}">${name}</span>`;
    }).join('');
    const pct = Math.round((ROUGH[i] / ROUGH_MAX) * 100);
    el.innerHTML = `
      <div><div class="name">${m.name}</div><div class="depth">${from}–${to} m</div></div>
      <div class="depth">${m.root.toFixed(1)} Hz</div>
      <div class="ivals">${ivals}</div>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <div class="nums">rough ${ROUGH[i].toFixed(2)}<br>cutoff ${m.cutoff} Hz</div>`;
    strataHost.appendChild(el);
  });
}
paintStrata();

// --------------------------------------------------------------- designer

let layerId = 0;
const layers = [];
const layerHost = document.getElementById('layers');

const TONE_PARAMS = [
  ['freq', 20, 6000, 1, 660],
  ['sweep', 0, 6000, 1, 0],
  ['duration', 0.01, 3, 0.01, 0.09],
  ['gain', 0, 0.5, 0.005, 0.14],
  ['attack', 0.001, 1, 0.001, 0.004],
  ['delay', 0, 1.5, 0.01, 0],
];
const BURST_PARAMS = [
  ['freq', 40, 8000, 1, 900],
  ['sweep', 0, 8000, 1, 0],
  ['duration', 0.01, 3, 0.01, 0.12],
  ['gain', 0, 0.6, 0.005, 0.2],
  ['Q', 0.1, 24, 0.1, 1.2],
  ['delay', 0, 1.5, 0.01, 0],
];

function addLayer(kind, init = {}) {
  const id = ++layerId;
  const params = kind === 'tone' ? TONE_PARAMS : BURST_PARAMS;
  const layer = {
    id,
    kind,
    type: kind === 'tone' ? 'square' : 'bandpass',
    values: Object.fromEntries(params.map(([k, , , , d]) => [k, init[k] ?? d])),
  };
  if (init.type) layer.type = init.type;
  layers.push(layer);

  const el = document.createElement('div');
  el.className = 'layer';
  el.innerHTML = `
    <div class="layer-head">
      <b class="${kind}">${kind === 'tone' ? 'TONE — oscillator + envelope' : 'BURST — filtered noise + envelope'}</b>
      <button type="button">remove</button>
    </div>
    <div class="params"></div>`;
  el.querySelector('button').addEventListener('click', () => {
    layers.splice(layers.indexOf(layer), 1);
    el.remove();
    writeCode();
  });

  const host = el.querySelector('.params');
  // Waveform / filter type first, since it changes the character most.
  {
    const p = document.createElement('div');
    p.className = 'param';
    p.innerHTML = '<label></label><select></select>';
    p.querySelector('label').textContent = kind === 'tone' ? 'wave' : 'filter';
    const sel = p.querySelector('select');
    const opts = kind === 'tone'
      ? ['square', 'sine', 'triangle', 'sawtooth']
      : ['bandpass', 'lowpass', 'highpass'];
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === layer.type) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { layer.type = sel.value; writeCode(); });
    host.appendChild(p);
  }
  for (const [key, min, max, step] of params) {
    const p = document.createElement('div');
    p.className = 'param';
    p.innerHTML = '<label></label><input type="range"><output></output>';
    p.querySelector('label').textContent = key;
    const input = p.querySelector('input');
    const out = p.querySelector('output');
    input.min = min; input.max = max; input.step = step; input.value = layer.values[key];
    const fmt = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
    out.textContent = fmt(layer.values[key]);
    input.addEventListener('input', () => {
      layer.values[key] = parseFloat(input.value);
      out.textContent = fmt(layer.values[key]);
      writeCode();
    });
    host.appendChild(p);
  }
  layerHost.appendChild(el);
  writeCode();
}

/** Play the designed sound through the game's own primitives. */
function audition() {
  const ctx = audio.context;
  if (!ctx || !armed) return;
  if (!auditionNoise) auditionNoise = noiseBuffer(ctx);
  for (const l of layers) {
    const v = l.values;
    if (l.kind === 'tone') {
      tone(ctx, ctx.destination, v.freq, {
        duration: v.duration, type: l.type, gain: v.gain, attack: v.attack,
        sweep: v.sweep > 0 ? v.sweep : null, delay: v.delay,
      });
    } else {
      burst(ctx, ctx.destination, auditionNoise, {
        duration: v.duration, freq: v.freq, Q: v.Q, gain: v.gain, type: l.type,
        sweep: v.sweep > 0 ? v.sweep : null, delay: v.delay,
      });
    }
  }
}
let auditionNoise = null;

const codeEl = document.getElementById('code');
function writeCode() {
  if (!layers.length) {
    codeEl.textContent = '// add a layer to build a sound';
    return;
  }
  const num = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));
  const body = layers.map((l) => {
    const v = l.values;
    const opts = [];
    opts.push(`duration: ${num(v.duration)}`);
    if (l.kind === 'tone') {
      opts.push(`type: '${l.type}'`);
    } else {
      opts.push(`freq: ${num(v.freq)}`, `Q: ${num(v.Q)}`);
      if (l.type !== 'bandpass') opts.push(`type: '${l.type}'`);
    }
    opts.push(`gain: ${num(v.gain)}`);
    if (l.kind === 'tone' && v.attack !== 0.004) opts.push(`attack: ${num(v.attack)}`);
    if (v.sweep > 0) opts.push(`sweep: ${num(v.sweep)}`);
    if (v.delay > 0) opts.push(`delay: ${num(v.delay)}`);
    return l.kind === 'tone'
      ? `      T(${num(v.freq)}, { ${opts.join(', ')} });`
      : `      B({ ${opts.join(', ')} });`;
  }).join('\n');

  codeEl.textContent = `    /** Your sound. Drop it into the returned object in src/audio/audio.js. */
    newSound() {
${body}
    },`;
}

document.getElementById('addTone').addEventListener('click', () => addLayer('tone'));
document.getElementById('addBurst').addEventListener('click', () => addLayer('burst'));
document.getElementById('audition').addEventListener('click', audition);
document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codeEl.textContent);
    const b = document.getElementById('copy');
    const old = b.textContent;
    b.textContent = 'copied';
    setTimeout(() => { b.textContent = old; }, 1200);
  } catch { /* clipboard blocked; the text is selectable anyway */ }
});

/** Starting points, taken from real sounds in the game. */
const PRESETS = {
  'empty': [],
  'switch clack': [
    ['burst', { duration: 0.045, freq: 2600, Q: 1.4, gain: 0.3, sweep: 700 }],
    ['tone', { freq: 240, duration: 0.05, type: 'square', gain: 0.06 }],
  ],
  'confirm chime': [
    ['tone', { freq: 660, duration: 0.07, type: 'square', gain: 0.1 }],
    ['tone', { freq: 990, duration: 0.09, type: 'square', gain: 0.1, delay: 0.06 }],
    ['tone', { freq: 1320, duration: 0.13, type: 'square', gain: 0.09, delay: 0.13 }],
  ],
  'carriage return': [
    ['burst', { duration: 0.13, freq: 1500, Q: 1.1, gain: 0.1, sweep: 420 }],
    ['burst', { duration: 0.07, freq: 700, Q: 2.4, gain: 0.07, delay: 0.13 }],
  ],
  'deep impact': [
    ['burst', { duration: 0.28, freq: 180, Q: 0.8, gain: 0.35, sweep: 60 }],
    ['tone', { freq: 70, duration: 0.32, type: 'sine', gain: 0.28, sweep: 38 }],
  ],
  'Natas sting (tritone)': [
    ['tone', { freq: 58.27, duration: 2.6, type: 'sawtooth', gain: 0.1, attack: 0.02 }],
    ['tone', { freq: 82.41, duration: 2.4, type: 'sawtooth', gain: 0.07, attack: 0.3 }],
  ],
};
const presetSel = document.getElementById('preset');
for (const name of Object.keys(PRESETS)) {
  const o = document.createElement('option');
  o.value = name; o.textContent = name;
  presetSel.appendChild(o);
}
presetSel.addEventListener('change', () => {
  layers.length = 0;
  layerHost.innerHTML = '';
  for (const [kind, init] of PRESETS[presetSel.value]) addLayer(kind, init);
  writeCode();
});
presetSel.value = 'switch clack';
for (const [kind, init] of PRESETS['switch clack']) addLayer(kind, init);

// ---------------------------------------------------------------- scopes

const specCv = document.getElementById('spectrum');
const waveCv = document.getElementById('wave');
const specCtx = specCv.getContext('2d');
const waveCtx = waveCv.getContext('2d');
let freqData = null;
let timeData = null;

function drawScopes() {
  const an = audio.analyser;
  if (!an) return;
  if (!freqData) {
    freqData = new Uint8Array(an.frequencyBinCount);
    timeData = new Float32Array(an.fftSize);
  }
  an.getByteFrequencyData(freqData);
  an.getFloatTimeDomainData(timeData);

  const sr = audio.context.sampleRate;
  const W = specCv.width;
  const H = specCv.height;
  specCtx.fillStyle = '#0e0f13';
  specCtx.fillRect(0, 0, W, H);

  // Log frequency axis: an octave should take the same space everywhere, or the
  // bottom four octaves — where nearly all of this game lives — get one pixel.
  const fMin = 30;
  const fMax = 16000;
  const xOf = (f) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;

  specCtx.strokeStyle = '#232733';
  specCtx.fillStyle = '#5b6478';
  specCtx.font = '10px ui-monospace, monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = xOf(f);
    specCtx.beginPath();
    specCtx.moveTo(x, 0);
    specCtx.lineTo(x, H);
    specCtx.stroke();
    specCtx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, H - 4);
  }

  // Bin i is centred at i * sr / fftSize; walk only the bins inside the drawn band
  // so the path is one contiguous run and needs no "have I started yet" state.
  const binHz = sr / an.fftSize;
  const lo = Math.max(1, Math.ceil(fMin / binHz));
  const hi = Math.min(freqData.length - 1, Math.floor(fMax / binHz));

  specCtx.beginPath();
  specCtx.moveTo(xOf(lo * binHz), H);
  for (let i = lo; i <= hi; i++) {
    specCtx.lineTo(xOf(i * binHz), H - (freqData[i] / 255) * (H - 12));
  }
  specCtx.lineTo(xOf(hi * binHz), H);
  specCtx.closePath();
  const grad = specCtx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,179,64,0.85)');
  grad.addColorStop(1, 'rgba(255,179,64,0.06)');
  specCtx.fillStyle = grad;
  specCtx.fill();

  // Stroke the trace on its own so the two baseline segments of the fill polygon
  // do not get drawn as a bright line along the bottom of the graticule.
  specCtx.beginPath();
  for (let i = lo; i <= hi; i++) {
    const x = xOf(i * binHz);
    const y = H - (freqData[i] / 255) * (H - 12);
    if (i === lo) specCtx.moveTo(x, y); else specCtx.lineTo(x, y);
  }
  specCtx.strokeStyle = '#ffb340';
  specCtx.lineWidth = 1;
  specCtx.stroke();

  const WW = waveCv.width;
  const WH = waveCv.height;
  waveCtx.fillStyle = '#0e0f13';
  waveCtx.fillRect(0, 0, WW, WH);
  waveCtx.strokeStyle = '#313644';
  waveCtx.beginPath();
  waveCtx.moveTo(0, WH / 2);
  waveCtx.lineTo(WW, WH / 2);
  waveCtx.stroke();
  waveCtx.strokeStyle = '#7ee081';
  waveCtx.beginPath();
  for (let i = 0; i < timeData.length; i++) {
    const x = (i / timeData.length) * WW;
    const y = WH / 2 - timeData[i] * (WH / 2) * 3.2;
    if (i === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
  }
  waveCtx.stroke();
}

// ------------------------------------------------------------------ loop

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  audio.drill(dt, {
    active: drive.drillOn,
    blockId: drive.drillBlock,
    power: drive.drillPower,
  });
  audio.thruster(dt, drive.thrust);
  audio.update(dt, {
    depth: drive.depth,
    live: drive.live,
    hull: drive.hull,
    magma: drive.magma,
    speed: drive.speed,
    drilling: drive.drillOn ? 1 : 0,
    danger: drive.danger,
  });
  audio.faults(dt, drive.faults);

  drawScopes();
  requestAnimationFrame(frame);
}

/**
 * Test hook, same idea as the game's `__MOTHERLOAD__`.
 *
 * `scripts/jukebox-check.mjs` drives the tool through the DOM like a person would,
 * but it still needs to read the meter and shove the drive state around without
 * synthesising drag events on a range input.
 */
window.__JUKEBOX__ = { audio, drive, get armed() { return armed; } };
