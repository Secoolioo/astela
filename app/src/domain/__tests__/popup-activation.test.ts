import { describe, expect, it } from 'vitest';
import { activates, activationLifespan, Activations } from '../navigation/popup-activation.ts';

describe('activates', () => {
  it('counts presses of the mouse, touches, taps and keys other than Escape', () => {
    expect(activates({ type: 'mouseDown' })).toBe(true);
    expect(activates({ type: 'touchEnd' })).toBe(true);
    expect(activates({ type: 'gestureTap' })).toBe(true);
    expect(activates({ type: 'keyDown', key: 'Enter' })).toBe(true);
    expect(activates({ type: 'keyDown', key: 'k' })).toBe(true);
  });

  it('leaves out Escape, the modifier keys, releases, moves and the wheel', () => {
    for (const input of [
      { type: 'keyDown', key: 'Escape' },
      // A shortcut such as Ctrl+T or Alt+Tab starts with its modifier, which no shortcut takes.
      { type: 'keyDown', key: 'Control' },
      { type: 'keyDown', key: 'Meta' },
      { type: 'keyDown', key: 'Alt' },
      { type: 'keyDown', key: 'AltGraph' },
      { type: 'keyDown', key: 'Shift' },
      { type: 'keyDown', key: 'CapsLock' },
      { type: 'keyDown', key: 'Fn' },
      { type: 'keyUp', key: 'Enter' },
      { type: 'mouseUp' },
      { type: 'mouseMove' },
      { type: 'mouseWheel' },
      { type: 'touchStart' },
      { type: 'char' },
    ]) {
      expect(activates(input)).toBe(false);
    }
  });
});

/** Activations on a clock that the test moves, and a page. */
function setup(): { activations: Activations<object>; page: object; at: { now: number } } {
  const at = { now: 1000 };
  return { activations: new Activations(() => at.now), page: {}, at };
}

describe('Activations', () => {
  it('lets a page open nothing without an input', () => {
    const { activations, page } = setup();
    expect(activations.consume(page)).toBe(false);
  });

  it('lets one input open one window', () => {
    const { activations, page } = setup();
    activations.activate(page);
    expect(activations.consume(page)).toBe(true);
    expect(activations.consume(page)).toBe(false);
    activations.activate(page);
    expect(activations.consume(page)).toBe(true);
  });

  it('lets an input open a window for five seconds', () => {
    const { activations, page, at } = setup();
    activations.activate(page);
    at.now += activationLifespan;
    expect(activations.consume(page)).toBe(true);
    activations.activate(page);
    at.now += activationLifespan + 1;
    expect(activations.consume(page)).toBe(false);
    // A window that comes too late uses nothing up that a later input gives.
    activations.activate(page);
    expect(activations.consume(page)).toBe(true);
  });

  it('forgets the input of a page that loads another document', () => {
    const { activations, page } = setup();
    activations.activate(page);
    activations.clear(page);
    expect(activations.consume(page)).toBe(false);
    activations.activate(page);
    expect(activations.consume(page)).toBe(true);
  });

  it('keeps the input of each page apart', () => {
    const { activations, page } = setup();
    const other = {};
    activations.activate(page);
    expect(activations.consume(other)).toBe(false);
    expect(activations.consume(page)).toBe(true);
  });
});
