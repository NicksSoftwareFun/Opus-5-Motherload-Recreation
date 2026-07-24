import * as THREE from 'three';
import { canvas2d, toTexture, panelTexture } from './texlib.js';

/**
 * The dot-matrix teletype beside the seat.
 *
 * Mr Natas's transmissions arrive as paper. The head clatters across, a line
 * appears a character at a time, and the strip feeds up out of the slot with
 * sprocket holes down both edges. It is slower than a text box and that is the
 * entire point: the story is a physical object in the cabin that you can glance at
 * while still flying, and it is the only warm-white thing in a room of phosphor.
 *
 * The paper is one long canvas scrolled behind a window, so a transmission that
 * runs past the visible strip pushes the earlier lines up out of sight exactly the
 * way real fanfold does.
 */

const PAPER_W = 256;
const PAPER_H = 512;
const LINE_H = 18;
/** Characters that fit between the sprocket margins at the print font size. */
const COLS = 30;
const CHAR_MS = 0.022;
const LINE_PAUSE = 0.13;

/** Hard-wrap to the carriage width. A printer has no choice but to wrap. */
function wrap(line, cols) {
  if (line.length <= cols) return [line];
  const out = [];
  let current = '';
  for (const word of line.split(' ')) {
    if (current && current.length + 1 + word.length > cols) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

export function createTeletype({ onStrike = null, onLine = null } = {}) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    map: toTexture(panelTexture({ color: '#3e4139', seed: 91, bolts: 4, grime: 0.9 })),
    roughness: 0.85, metalness: 0.25,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8f948c, roughness: 0.45, metalness: 0.8 });

  // Housing with a slot across the top for the paper to come out of.
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.19), bodyMat);
  group.add(housing);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.012, 0.03), steelMat)
    .translateY(0.052).translateZ(-0.055));

  // Tractor sprockets either side of the slot.
  for (const side of [-1, 1]) {
    const sprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), steelMat);
    sprocket.rotation.z = Math.PI / 2;
    sprocket.position.set(side * 0.105, 0.052, -0.055);
    group.add(sprocket);
  }

  // The print head, which slides while it is typing.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.022, 0.030), steelMat);
  head.position.set(0, 0.050, -0.020);
  group.add(head);

  // --- Paper ---------------------------------------------------------------
  const { canvas, ctx } = canvas2d(PAPER_W, PAPER_H);
  const texture = toTexture(canvas);
  const paperMat = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.95, metalness: 0,
    emissiveMap: texture, emissive: 0x3a352a, emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
  });
  // Slight curl: the strip leans back toward the pilot as it feeds out.
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.30, 1, 8), paperMat);
  paper.position.set(0, 0.205, -0.085);
  paper.rotation.x = -0.22;
  group.add(paper);

  const pos = paper.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = pos.getY(i) / 0.30 + 0.5;
    pos.setZ(i, -v * v * 0.045);
  }
  pos.needsUpdate = true;
  paper.geometry.computeVertexNormals();

  /** Every line printed so far, most recent last. */
  const printed = [];
  /** Lines waiting to be typed, and the one currently under the head. */
  let pending = [];
  let current = null;
  let typed = 0;
  let charTimer = 0;
  let pauseTimer = 0;
  let dirty = true;
  let clatter = 0;
  const baseY = 0;

  const partialText = () => (current === null ? '' : current.slice(0, typed));

  function repaint() {
    // Paper stock: warm off-white with a faint horizontal tooth.
    ctx.fillStyle = '#d9d2bd';
    ctx.fillRect(0, 0, PAPER_W, PAPER_H);
    ctx.fillStyle = 'rgba(0,0,0,0.035)';
    for (let y = 0; y < PAPER_H; y += 4) ctx.fillRect(0, y, PAPER_W, 1);

    // Sprocket holes down both margins.
    ctx.fillStyle = '#2a2a26';
    for (let y = 8; y < PAPER_H; y += 22) {
      ctx.beginPath();
      ctx.arc(11, y, 4.5, 0, Math.PI * 2);
      ctx.arc(PAPER_W - 11, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(23, 0); ctx.lineTo(23, PAPER_H);
    ctx.moveTo(PAPER_W - 23, 0); ctx.lineTo(PAPER_W - 23, PAPER_H);
    ctx.stroke();

    // Text, oldest at the top, the line under the head at the bottom. Once the
    // strip is full the earliest lines scroll up out of the window, exactly the
    // way real fanfold does.
    const visible = Math.floor((PAPER_H - 24) / LINE_H);
    const partial = partialText();
    const all = current !== null ? [...printed, partial] : printed;
    const window_ = all.slice(Math.max(0, all.length - visible));

    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textBaseline = 'middle';
    window_.forEach((line, i) => {
      const y = 18 + i * LINE_H;
      // Impact printing is never perfectly aligned or perfectly inked.
      const jitter = ((i * 2654435761) % 7) / 7 - 0.5;
      ctx.fillStyle = '#3b372f';
      ctx.globalAlpha = 0.72 + (((i * 40503) % 100) / 100) * 0.28;
      ctx.fillText(line, 31 + jitter, y);
      ctx.globalAlpha = 1;
    });

    texture.needsUpdate = true;
  }

  repaint();

  return {
    group,
    paper,

    get busy() { return pending.length > 0 || current !== null; },
    get lineCount() { return printed.length; },

    /** Queue a transmission. Each entry is one line, wrapped to the paper width. */
    print(lines) {
      if (!lines?.length) return;
      // A blank feed between messages, so separate transmissions read as separate.
      if (printed.length || pending.length) pending.push('');
      for (const line of lines) pending.push(...wrap(line, COLS));
    },

    /** Drop everything. Used when a run restarts. */
    clear() {
      printed.length = 0;
      pending = [];
      current = null;
      typed = 0;
      dirty = true;
    },

    update(dt, { live = true } = {}) {
      if (pauseTimer > 0) {
        pauseTimer -= dt;
      } else if (current === null && pending.length > 0) {
        current = pending.shift();
        typed = 0;
        charTimer = 0;
        if (current === '') {
          printed.push('');
          current = null;
          pauseTimer = LINE_PAUSE;
          dirty = true;
        }
      }

      if (current !== null) {
        charTimer += dt;
        while (charTimer >= CHAR_MS && typed < current.length) {
          charTimer -= CHAR_MS;
          typed++;
          dirty = true;
          clatter = 1;
          onStrike?.();
        }
        if (typed >= current.length) {
          printed.push(current);
          current = null;
          typed = 0;
          pauseTimer = LINE_PAUSE;
          dirty = true;
          // The carriage going back and the paper stepping on: the punctuation of
          // a dot-matrix printer, and the half of the sound people actually
          // remember.
          onLine?.();
        }
      }

      // The head slides with the column being struck and springs back on carriage
      // return; the housing shakes a little while it is working.
      const col = current !== null && current.length ? typed / current.length : 0;
      head.position.x = -0.085 + col * 0.17;
      clatter = Math.max(0, clatter - dt * 6);
      group.position.y = baseY + clatter * 0.0016 * Math.sin(performance.now() * 0.09);

      paperMat.emissiveIntensity = live ? 0.35 : 0.05;

      if (dirty) {
        dirty = false;
        repaint();
      }
    },
  };
}
