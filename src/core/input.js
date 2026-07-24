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

    /** Edge-triggered button state, cleared by consumeClicks(). */
    this.primaryPressed = false;
    this.secondaryPressed = false;
    this.primaryDown = false;
    this.secondaryDown = false;
    /** Consumers set this each frame to be notified of taps on named keys. */
    this.pressedKeys = new Set();

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

  /** True once per physical key press. */
  wasPressed(code) {
    return this.pressedKeys.has(code);
  }

  axis(negCode, posCode) {
    return (this.isDown(posCode) ? 1 : 0) - (this.isDown(negCode) ? 1 : 0);
  }

  /** Read and clear the accumulated look delta, in radians. */
  consumeLook() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /** Call once at the end of every frame. */
  endFrame() {
    this.primaryPressed = false;
    this.secondaryPressed = false;
    this.wheel = 0;
    this.pressedKeys.clear();
  }

  /** Test hook: the harness drives the game without a real pointer lock. */
  forceLock(v) {
    this.locked = v;
  }
}
