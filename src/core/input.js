/**
 * Input. Pointer lock is engaged permanently while playing.
 *
 * There is deliberately no "cursor mode": the crosshair *is* the cursor. Looking at
 * a switch or a screen in the cockpit and clicking operates it; looking at rock and
 * clicking drills it. Keeping one mode is what lets the menus live in the world
 * without the player constantly toggling their mouse in and out of the game.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.locked = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.sensitivity = 0.0022;

    /**
     * Edge-triggered state. A press lives here until somebody consumes it, or until
     * the end of a frame in which the simulation actually ran — see endFrame().
     */
    this.primaryPressed = false;
    this.secondaryPressed = false;
    this.primaryDown = false;
    this.secondaryDown = false;
    /** Taps on named keys, one entry per physical press. */
    this.pressedKeys = new Set();
    this._stepped = false;

    this._bind();
  }

  _bind() {
    const canvas = this.dom;

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) {
        this.primaryDown = true;
        this.primaryPressed = true;
      } else if (e.button === 2) {
        this.secondaryDown = true;
        this.secondaryPressed = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.primaryDown = false;
      if (e.button === 2) this.secondaryDown = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.primaryDown = false;
        this.secondaryDown = false;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      // Space and the arrows would otherwise scroll the page out from under us.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** True once per physical key press. Read-only: does not retire the press. */
  wasPressed(code) {
    return this.pressedKeys.has(code);
  }

  /**
   * True once per physical key press, and retires it.
   *
   * Anything read inside the fixed-timestep update must consume rather than peek.
   * A rendered frame can contain two or three 1/120 s substeps, and a flag that is
   * merely peeked at is seen by every one of them.
   */
  consumePress(code) {
    return this.pressedKeys.delete(code);
  }

  /**
   * True once per physical left-click, and retires it.
   *
   * This is the difference between a switch that throws and a switch that wiggles.
   * Peeking at the flag toggled the switch once per substep, so a frame with two
   * substeps turned it on and straight back off — a visible twitch and no state
   * change, at whatever rate the frame budget happened to land on an even number.
   */
  consumePrimaryClick() {
    const p = this.primaryPressed;
    this.primaryPressed = false;
    return p;
  }

  /** True once per physical right-click, and retires it. */
  consumeSecondaryClick() {
    const p = this.secondaryPressed;
    this.secondaryPressed = false;
    return p;
  }

  /** Call at the top of every simulation substep. */
  noteStep() {
    this._stepped = true;
  }

  axis(negCode, posCode) {
    return (this.isDown(posCode) ? 1 : 0) - (this.isDown(negCode) ? 1 : 0);
  }

  /** Read and clear accumulated wheel notches (positive = scrolled down). */
  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Read and clear the accumulated look delta, in radians. */
  consumeLook() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /**
   * Call once at the end of every frame.
   *
   * Edges are only retired if the simulation ran this frame. A fast monitor renders
   * frames that contain no 1/120 s substep at all, and clearing unconditionally
   * threw those clicks in the bin before anything could act on them — which is
   * precisely what a switch that works "sometimes" feels like. Held over, the click
   * is picked up by the next substep instead of being lost.
   */
  endFrame() {
    if (!this._stepped) return;
    this.primaryPressed = false;
    this.secondaryPressed = false;
    this.wheel = 0;
    this.pressedKeys.clear();
    this._stepped = false;
  }

  /** Test hook: the harness drives the game without a real pointer lock. */
  forceLock(v) {
    this.locked = v;
  }
}
