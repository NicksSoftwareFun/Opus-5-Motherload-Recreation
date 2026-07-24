/**
 * Fixed-timestep game loop with a render interpolation hook.
 *
 * Physics against a voxel grid has to be deterministic and frame-rate independent —
 * a 144 Hz monitor must not make the drill faster or the pod fall further — so
 * simulation runs on a fixed 1/120 s step and rendering happens once per frame.
 */
export class Loop {
  constructor({ step = 1 / 120, maxSubSteps = 8, update, render }) {
    this.step = step;
    this.maxSubSteps = maxSubSteps;
    this.update = update;
    this.render = render;
    this.accumulator = 0;
    this.elapsed = 0;
    this.frame = 0;
    this.running = false;
    this._last = 0;
    this._raf = 0;
    this._tick = this._tick.bind(this);

    // Rolling frame-time stats, surfaced on the debug handle for the perf checks.
    this.frameMs = 0;
    this.avgFrameMs = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _tick() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    // Read the clock directly rather than trusting the rAF timestamp: headless
    // Chromium hands out timestamps from a different origin than performance.now().
    const now = performance.now();
    // Clamp: a backgrounded tab must not spend a minute of frozen time catching up.
    const rawDelta = Math.max(0, Math.min((now - this._last) / 1000, 0.25));
    this._last = now;
    this.frameMs = rawDelta * 1000;
    this.avgFrameMs = this.avgFrameMs === 0 ? this.frameMs : this.avgFrameMs * 0.94 + this.frameMs * 0.06;

    this.accumulator += rawDelta;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSubSteps) {
      this.update(this.step, this.elapsed);
      this.elapsed += this.step;
      this.accumulator -= this.step;
      steps++;
    }
    // If we blew the substep budget, drop the backlog rather than spiral.
    if (steps === this.maxSubSteps) this.accumulator = 0;

    this.frame++;
    this.render(rawDelta, this.accumulator / this.step);
  }
}
