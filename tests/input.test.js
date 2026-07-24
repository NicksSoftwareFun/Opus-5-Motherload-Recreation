import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Input } from '../src/core/input.js';

/**
 * Input edge handling, under the fixed-timestep loop.
 *
 * These are regression tests for a pair of bugs that between them made the cockpit
 * switches feel broken: a rendered frame runs zero, one or several 1/120 s substeps
 * depending on the frame budget, and the old code both re-read the click on every
 * substep and threw it away on frames that ran none. The switch therefore toggled
 * twice (a visible wiggle and no state change) or not at all, apparently at random.
 */

/** The smallest event target the Input class will accept. */
function stubTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    emit(type, ev = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, ...ev });
    },
    requestPointerLock() {},
  };
}

let saved;

beforeEach(() => {
  const doc = stubTarget();
  const win = stubTarget();
  saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = doc;
  globalThis.window = win;
});

afterEach(() => {
  globalThis.document = saved.document;
  globalThis.window = saved.window;
});

function pressPrimary(input, canvas) {
  input.forceLock(true);
  canvas.emit('mousedown', { button: 0 });
}

describe('click edges under a multi-substep frame', () => {
  it('reports a click to exactly one substep', () => {
    const canvas = stubTarget();
    const input = new Input(canvas);
    pressPrimary(input, canvas);

    // Three substeps in one rendered frame, as happens whenever the frame runs long.
    const seen = [0, 0, 0].map(() => {
      input.noteStep();
      return input.consumePrimaryClick();
    });
    expect(seen).toEqual([true, false, false]);
  });

  it('does not lose a click landing on a frame with no substep', () => {
    const canvas = stubTarget();
    const input = new Input(canvas);
    pressPrimary(input, canvas);

    // A 144 Hz monitor renders frames that contain no simulation step at all.
    input.endFrame();
    input.endFrame();

    input.noteStep();
    expect(input.consumePrimaryClick()).toBe(true);
  });

  it('retires an unconsumed click once the simulation has run', () => {
    const canvas = stubTarget();
    const input = new Input(canvas);
    pressPrimary(input, canvas);

    input.noteStep();          // a substep ran, but nothing consumed the click
    input.endFrame();
    input.noteStep();
    expect(input.consumePrimaryClick()).toBe(false);
  });

  it('treats key taps the same way', () => {
    const canvas = stubTarget();
    const input = new Input(canvas);
    globalThis.window.emit('keydown', { code: 'F9' });

    input.endFrame();          // no substep: the tap must survive
    input.noteStep();
    expect(input.consumePress('F9')).toBe(true);
    expect(input.consumePress('F9')).toBe(false);
  });

  it('accumulates wheel notches until a substep reads them', () => {
    const canvas = stubTarget();
    const input = new Input(canvas);
    canvas.emit('wheel', { deltaY: 120 });
    canvas.emit('wheel', { deltaY: 120 });
    input.endFrame();
    expect(input.consumeWheel()).toBe(2);
    expect(input.consumeWheel()).toBe(0);
  });
});
