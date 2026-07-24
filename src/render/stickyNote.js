import * as THREE from 'three';
import { canvas2d, toTexture } from './texlib.js';

/**
 * The controls, on a sticky note taped to the dashboard.
 *
 * A game with no HUD still has to tell you which key turns the pod. Putting it on a
 * curling yellow note that a previous pilot stuck to the edge of the dash keeps that
 * promise intact — it is a physical object in the cabin, in the place where a real
 * operator would actually stick one, and it is exactly as authoritative as a
 * handwritten note deserves to be.
 */

const LINES = [
  ['W A S D', 'thrust'],
  ['SPACE', 'climb'],
  ['SHIFT', 'descend'],
  ['Q / E', 'turn the pod'],
  ['CTRL', 'drill straight down'],
  ['MOUSE', 'look around'],
  ['WHEEL', 'zoom'],
  ['CLICK', 'drill, or work'],
  ['', 'whatever you are'],
  ['', 'looking at'],
  ['F9', 'recentre tracker'],
];

function notePaper() {
  const W = 420;
  const H = 450;
  const { canvas, ctx } = canvas2d(W, H);

  // Paper, with a slightly darker edge and a shadow under the curl.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#f2e07a');
  grad.addColorStop(0.75, '#eed861');
  grad.addColorStop(1, '#dcc44e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Grubby thumbprints and coffee, because it has been in there a while.
  ctx.fillStyle = 'rgba(120,95,30,0.10)';
  for (let i = 0; i < 22; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, 6 + Math.random() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120,80,20,0.18)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.83, 42, 0.4, 5.1);
  ctx.stroke();

  // Handwriting. Two columns: the key, then what it does.
  ctx.fillStyle = '#1e2a4a';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 36px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive, sans-serif';
  ctx.fillText('POD CONTROLS', 22, 40);
  ctx.strokeStyle = 'rgba(30,42,74,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 64);
  ctx.lineTo(W - 26, 60);
  ctx.stroke();

  let y = 100;
  for (const [key, what] of LINES) {
    // A hand-written list is never perfectly aligned.
    const jitter = (Math.random() - 0.5) * 2.2;
    ctx.font = 'bold 29px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive, sans-serif';
    ctx.fillStyle = '#16224a';
    ctx.fillText(key, 22, y + jitter);
    ctx.font = '26px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive, sans-serif';
    ctx.fillStyle = '#2c3a5e';
    ctx.fillText(what, 186, y + jitter);
    y += 34;
  }

  ctx.font = 'italic 22px "Comic Sans MS", "Segoe Print", cursive, sans-serif';
  ctx.fillStyle = 'rgba(30,42,74,0.75)';
  ctx.fillText('power switch is on the left', 22, H - 22);

  return canvas;
}

/** A strip of tape, slightly translucent, holding a corner down. */
function tapeStrip() {
  const { canvas, ctx } = canvas2d(128, 64);
  ctx.fillStyle = 'rgba(238,238,225,0.55)';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, i * 11, 128, 3);
  return canvas;
}

export function createStickyNote({ width = 0.21 } = {}) {
  const group = new THREE.Group();
  const height = width * (450 / 420);

  const note = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height, 1, 6),
    new THREE.MeshStandardMaterial({
      map: toTexture(notePaper()),
      roughness: 0.95,
      metalness: 0,
      // A touch of self-illumination so it stays readable in a dark cabin without
      // needing the pilot to point a lamp at it.
      emissiveMap: toTexture(notePaper()),
      emissive: 0x6a5c22,
      emissiveIntensity: 0.30,
      side: THREE.DoubleSide,
    }),
  );

  // Curl the bottom edge away from the panel — sticky notes do not lie flat.
  const pos = note.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = 0.5 - pos.getY(i) / height;
    pos.setZ(i, v * v * 0.012);
  }
  pos.needsUpdate = true;
  note.geometry.computeVertexNormals();
  group.add(note);

  const tapeMat = new THREE.MeshStandardMaterial({
    map: toTexture(tapeStrip()), transparent: true, opacity: 0.8, roughness: 0.5,
  });
  for (const [x, y, rot] of [
    [-width * 0.30, height * 0.52, 0.22],
    [width * 0.32, height * 0.50, -0.16],
  ]) {
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.26, height * 0.10), tapeMat);
    tape.position.set(x, y, 0.002);
    tape.rotation.z = rot;
    group.add(tape);
  }

  // Stuck on at a slight angle, because nobody sticks these on straight.
  group.rotation.z = -0.045;
  return { group, note };
}
