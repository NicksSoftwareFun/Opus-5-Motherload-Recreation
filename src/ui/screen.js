import * as THREE from 'three';
import { crtSurface } from '../render/texlib.js';

/**
 * A phosphor CRT bolted into the cockpit.
 *
 * Content is drawn in immediate mode: the page function paints *and* registers its
 * own hit regions in the same pass, so a button can never drift out of sync with
 * the box drawn around it. Hit regions live in canvas pixel space and are matched
 * against the UV of the crosshair ray, which is what makes a menu that exists only
 * as a texture on a mesh actually clickable.
 *
 * Screens redraw at a limited rate. Uploading a 512x340 canvas to the GPU every
 * frame costs more than the entire mine does, and a 1990s industrial terminal
 * looking a little sluggish is a feature.
 */

export const FONT = {
  mono: (px) => `${px}px "Courier New", ui-monospace, monospace`,
  bold: (px) => `bold ${px}px "Courier New", ui-monospace, monospace`,
  head: (px) => `bold ${px}px "Arial Narrow", "Helvetica Neue", Impact, sans-serif`,
};

export const PHOSPHOR = {
  green: { ink: '#8cff7a', dim: '#3f7a38', bg: '#050e07', hot: '#e6ffdd' },
  amber: { ink: '#ffb340', dim: '#8a5c1c', bg: '#120b03', hot: '#ffe9c4' },
  red: { ink: '#ff4a4a', dim: '#8a2020', bg: '#140404', hot: '#ffd4d4' },
};

export class Screen {
  constructor({
    width = 0.30,
    height = 0.20,
    px = 512,
    py = 340,
    palette = PHOSPHOR.green,
    fps = 14,
    name = 'screen',
  } = {}) {
    this.palette = palette;
    this.surface = crtSurface({ width: px, height: py });
    this.px = px;
    this.py = py;
    this.fps = fps;
    this._acc = 1;
    this.power = 0;

    this.texture = new THREE.CanvasTexture(this.surface.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    // Unlit: a CRT emits, it is not lit by the cabin.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.mesh.name = name;
    this.mesh.userData.screen = this;

    /** Regions registered by the last draw pass. */
    this.regions = [];
    this.hover = null;
    /** Page function: (ctx, api, state) => void */
    this.page = null;
    this.state = {};
    this.dirty = true;
  }

  setPage(fn) {
    if (this.page !== fn) {
      this.page = fn;
      this.dirty = true;
      this._acc = 1;
    }
  }

  /** Build the immediate-mode drawing API handed to page functions. */
  _api(ctx) {
    const P = this.palette;
    const regions = this.regions;
    const hover = this.hover;
    const W = this.px;
    const H = this.py;

    const api = {
      W, H, P, ctx,

      clear() {
        ctx.fillStyle = P.bg;
        ctx.fillRect(0, 0, W, H);
      },

      /** Title bar with the industrial stripe down the side. */
      title(text, right = '') {
        ctx.fillStyle = P.dim;
        ctx.fillRect(0, 0, W, 26);
        ctx.fillStyle = P.bg;
        ctx.font = FONT.head(17);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, 10, 14);
        if (right) {
          ctx.textAlign = 'right';
          ctx.fillText(right, W - 10, 14);
        }
        ctx.textAlign = 'left';
      },

      text(str, x, y, { size = 15, color = P.ink, align = 'left', bold = false } = {}) {
        ctx.font = bold ? FONT.bold(size) : FONT.mono(size);
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.fillText(str, x, y);
        ctx.textAlign = 'left';
      },

      rule(y, { color = P.dim, inset = 8 } = {}) {
        ctx.fillStyle = color;
        ctx.fillRect(inset, y, W - inset * 2, 1);
      },

      /** Horizontal meter with a segmented fill, the way panel gauges read. */
      bar(x, y, w, h, t, { color = P.ink, warn = null, segments = 24 } = {}) {
        ctx.strokeStyle = P.dim;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        const filled = Math.round(Math.max(0, Math.min(1, t)) * segments);
        const sw = (w - 4) / segments;
        for (let i = 0; i < filled; i++) {
          ctx.fillStyle = warn && i / segments > warn ? P.hot : color;
          ctx.fillRect(x + 2 + i * sw, y + 2, Math.max(1, sw - 1), h - 3);
        }
      },

      /**
       * A clickable button. Registers its own hit region, so what you can click is
       * exactly what was drawn.
       */
      button(x, y, w, h, label, { id, disabled = false, active = false, onClick = null } = {}) {
        const isHover = hover === id && !disabled;
        ctx.strokeStyle = disabled ? P.dim : P.ink;
        ctx.lineWidth = active || isHover ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        if (active || isHover) {
          ctx.fillStyle = isHover && !active ? P.dim : P.ink;
          ctx.fillRect(x + 2, y + 2, w - 3, h - 3);
        }
        ctx.font = FONT.head(Math.min(16, h - 6));
        ctx.fillStyle = active ? P.bg : disabled ? P.dim : isHover ? P.bg : P.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + h / 2 + 1);
        ctx.textAlign = 'left';
        if (!disabled) regions.push({ id, x, y, w, h, onClick });
      },

      /** Non-interactive framed box, for grouping readouts. */
      frame(x, y, w, h, label = '') {
        ctx.strokeStyle = P.dim;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        if (label) {
          ctx.fillStyle = P.bg;
          ctx.fillRect(x + 8, y - 1, ctx.measureText(label).width + 10, 3);
          api.text(label, x + 12, y, { size: 11, color: P.dim });
        }
      },
    };
    return api;
  }

  /** Redraw if the rate limiter allows. `power` fades the tube up from cold. */
  update(dt, state) {
    this.state = state ?? this.state;
    this._acc += dt;
    const period = 1 / this.fps;
    if (this._acc < period && !this.dirty) return;
    this._acc = 0;
    this.dirty = false;

    this.regions = [];
    const page = this.page;
    const api = this._api(this.surface.ctx);
    this.surface.render(
      (ctx) => {
        if (page) page(ctx, api, this.state);
      },
      { phosphor: this.palette.ink, bg: this.palette.bg, power: this.power },
    );
    this.texture.needsUpdate = true;
  }

  /** Find the region under a UV from the crosshair ray. */
  regionAt(u, v) {
    const x = u * this.px;
    const y = (1 - v) * this.py;
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
}
