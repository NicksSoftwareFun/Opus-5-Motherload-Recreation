import * as THREE from 'three';
import { fbm2, mulberry32 } from '../core/rng.js';

/**
 * Canvas texture helpers shared by the cockpit and its screens.
 *
 * Everything the player looks at inside the pod is drawn here: scuffed panel metal,
 * hazard tape, stencilled labels, phosphor CRT glass. Keeping them in one place
 * keeps the industrial look consistent, which matters more than any single texture
 * because the cockpit is the only thing on screen that never changes.
 */

/** Chunky condensed face for stencilled panel lettering. */
export const STENCIL_FONT = "bold 26px 'Arial Narrow', 'Helvetica Neue', Impact, sans-serif";
export const LABEL_FONT = "bold 18px 'Arial Narrow', 'Helvetica Neue', Impact, sans-serif";

export function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext('2d') };
}

export function toTexture(canvas, { repeat = null, nearest = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (nearest) tex.magFilter = THREE.NearestFilter;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/**
 * Painted, scuffed machine panel: base colour, subtle fbm mottling, brushed
 * horizontal grain, scratches that expose bare metal, and optional bolt heads.
 */
export function panelTexture({
  size = 512,
  color = '#4a4f47',
  seed = 1,
  bolts = 0,
  grime = 0.5,
  scratches = 18,
  bare = '#9aa09a',
} = {}) {
  const { canvas, ctx } = canvas2d(size, size);
  const base = new THREE.Color(color);

  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mottle = fbm2(x * 0.012, y * 0.012, { octaves: 4, seed });
      // Brushed grain runs across the panel; dirt collects toward the bottom.
      const grain = fbm2(x * 0.9, y * 0.06, { octaves: 1, seed: seed + 3 });
      const dirt = grime * 0.35 * (y / size) * fbm2(x * 0.02, y * 0.02, { octaves: 3, seed: seed + 9 });
      const b = 1 + (mottle - 0.5) * 0.28 + (grain - 0.5) * 0.1 - dirt;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, base.r * 255 * b));
      img.data[i + 1] = Math.max(0, Math.min(255, base.g * 255 * b));
      img.data[i + 2] = Math.max(0, Math.min(255, base.b * 255 * b));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const rand = mulberry32(seed * 7919 + 13);
  ctx.lineCap = 'round';
  for (let i = 0; i < scratches; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 8 + rand() * 90;
    const ang = (rand() - 0.5) * 0.9 + (rand() < 0.5 ? 0 : Math.PI / 2);
    ctx.strokeStyle = rand() < 0.6 ? `rgba(0,0,0,${0.10 + rand() * 0.18})` : `${bare}55`;
    ctx.lineWidth = 0.7 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  if (bolts > 0) {
    const step = size / bolts;
    for (let i = 0; i < bolts; i++) {
      for (const [bx, by] of [
        [step * (i + 0.5), step * 0.4],
        [step * (i + 0.5), size - step * 0.4],
      ]) {
        drawBolt(ctx, bx, by, 6.5);
      }
    }
  }

  return canvas;
}

/** A hex bolt head with a highlight and a cast shadow. */
export function drawBolt(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#b9bdb6');
  g.addColorStop(1, '#5e625c');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

/** Diagonal hazard tape, scuffed. */
export function hazardTexture({ size = 256, a = '#d8a12a', b = '#191713' } = {}) {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = b;
  const w = size / 4;
  ctx.save();
  ctx.translate(-size, 0);
  ctx.rotate(-0.5);
  for (let i = -2; i < 12; i++) ctx.fillRect(i * w * 2, -size, w, size * 3);
  ctx.restore();

  const rand = mulberry32(4242);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rand() * 0.28})`;
    ctx.fillRect(rand() * size, rand() * size, rand() * 22, rand() * 5);
  }
  return canvas;
}

/** Stencilled text on a painted plate — used for panel legends. */
export function labelPlate({
  width = 256, height = 64, text = 'LABEL', color = '#3a3f38',
  ink = '#d7d2c4', font = STENCIL_FONT, align = 'center', seed = 5,
} = {}) {
  const { canvas, ctx } = canvas2d(width, height);
  ctx.drawImage(panelTexture({ size: 256, color, seed, scratches: 6, grime: 0.35 }), 0, 0, width, height);
  ctx.font = font;
  ctx.fillStyle = ink;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.88;
  ctx.fillText(text, align === 'center' ? width / 2 : 12, height / 2 + 1);
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * Phosphor CRT surface. `draw(ctx, w, h)` paints the content; this wraps it in the
 * glass: vignette, scanlines, a curved bloom and a bit of grime on the screen.
 */
export function crtSurface({ width = 512, height = 384 } = {}) {
  const { canvas, ctx } = canvas2d(width, height);
  return {
    canvas,
    ctx,
    width,
    height,
    /** Paint one frame. `body` draws the content in screen pixels. */
    render(body, { phosphor = '#8cff7a', bg = '#07120a', power = 1 } = {}) {
      ctx.save();
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      if (power > 0.01) {
        ctx.save();
        ctx.globalAlpha = power;
        ctx.fillStyle = phosphor;
        ctx.strokeStyle = phosphor;
        body(ctx, width, height);
        ctx.restore();
      }

      // Scanlines. Cheap, and they do more for the CRT read than anything else.
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#000';
      for (let y = 0; y < height; y += 3) ctx.fillRect(0, y, width, 1);
      ctx.globalAlpha = 1;

      // Corner vignette plus a soft centre bloom, so the tube looks curved.
      const vig = ctx.createRadialGradient(
        width / 2, height / 2, height * 0.25,
        width / 2, height / 2, height * 0.78,
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
  };
}
