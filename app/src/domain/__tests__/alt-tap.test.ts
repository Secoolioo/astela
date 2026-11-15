import { describe, expect, it } from 'vitest';
import { AltTap, type AltTapInput } from '../windows/alt-tap.ts';

/** A key press, with nothing else held. */
function press(
  type: 'keyDown' | 'keyUp',
  key: string,
  held: Partial<Omit<AltTapInput, 'type' | 'key'>> = {},
): AltTapInput {
  return {
    type,
    key,
    control: false,
    shift: false,
    meta: false,
    isAutoRepeat: false,
    isComposing: false,
    ...held,
  };
}

/** What a tap makes of a row of key presses, in their order. */
function results(inputs: readonly AltTapInput[], tap = new AltTap()): string[] {
  return inputs.map((input) => tap.key(input));
}

describe('AltTap', () => {
  it('opens when Alt is pressed and released alone, also after holding it', () => {
    expect(results([press('keyDown', 'Alt'), press('keyUp', 'Alt')])).toEqual(['arm', 'open']);
    expect(
      results([
        press('keyDown', 'Alt'),
        press('keyDown', 'Alt', { isAutoRepeat: true }),
        press('keyDown', 'Alt', { isAutoRepeat: true }),
        press('keyUp', 'Alt'),
      ]),
    ).toEqual(['arm', 'none', 'none', 'open']);
  });

  it('does not open after another key, such as Alt+Left, Alt+Shift or AltGr', () => {
    const none = ['arm', 'none', 'none', 'none'];
    expect(
      results([
        press('keyDown', 'Alt'),
        press('keyDown', 'ArrowLeft'),
        press('keyUp', 'ArrowLeft'),
        press('keyUp', 'Alt'),
      ]),
    ).toEqual(none);
    // Alt+Shift switches the keyboard layout.
    expect(
      results([
        press('keyDown', 'Alt'),
        press('keyDown', 'Shift', { shift: true }),
        press('keyUp', 'Shift'),
        press('keyUp', 'Alt'),
      ]),
    ).toEqual(none);
    expect(
      results([
        press('keyDown', 'Shift', { shift: true }),
        press('keyDown', 'Alt', { shift: true }),
        press('keyUp', 'Alt'),
      ]),
    ).toEqual(['none', 'none', 'none']);
    // Windows reports AltGr as Ctrl and Alt, Linux as AltGraph.
    expect(
      results([
        press('keyDown', 'Control', { control: true }),
        press('keyDown', 'Alt', { control: true }),
        press('keyUp', 'Alt', { control: true }),
      ]),
    ).toEqual(['none', 'none', 'none']);
    expect(results([press('keyDown', 'AltGraph'), press('keyUp', 'AltGraph')])).toEqual([
      'none',
      'none',
    ]);
    expect(results([press('keyDown', 'Alt', { meta: true }), press('keyUp', 'Alt')])).toEqual([
      'none',
      'none',
    ]);
  });

  it('does not open while an input method composes text', () => {
    expect(
      results([
        press('keyDown', 'Alt'),
        press('keyDown', 'Process', { isComposing: true }),
        press('keyUp', 'Alt'),
      ]),
    ).toEqual(['arm', 'none', 'none']);
    expect(
      results([press('keyDown', 'Alt'), press('keyUp', 'Alt', { isComposing: true })]),
    ).toEqual(['arm', 'none']);
  });

  it('does not open after a reset, as for the loss of the focus', () => {
    const tap = new AltTap();
    expect(tap.key(press('keyDown', 'Alt'))).toBe('arm');
    expect(tap.waiting).toBe(true);
    tap.reset();
    expect(tap.waiting).toBe(false);
    expect(tap.key(press('keyUp', 'Alt'))).toBe('none');
  });

  it('does not open when the pointer is pressed, released, turns its wheel or drags while Alt is down', () => {
    for (const type of ['mouseDown', 'mouseUp', 'mouseWheel', 'contextMenu', 'touchStart']) {
      const tap = new AltTap();
      expect(tap.key(press('keyDown', 'Alt'))).toBe('arm');
      tap.pointer({ type, modifiers: ['alt'] });
      expect([type, tap.key(press('keyUp', 'Alt'))]).toEqual([type, 'none']);
    }
    // A drag that started before Alt went down, as to draw a shape from its center.
    const drag = new AltTap();
    expect(drag.key(press('keyDown', 'Alt'))).toBe('arm');
    drag.pointer({ type: 'mouseMove', modifiers: ['alt', 'leftbuttondown'] });
    expect(drag.waiting).toBe(false);
    expect(drag.key(press('keyUp', 'Alt'))).toBe('none');
    // Moving the pointer without a button, and the keys that reach the view, leave it armed.
    const moving = new AltTap();
    expect(moving.key(press('keyDown', 'Alt'))).toBe('arm');
    for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'keyDown', 'rawKeyDown', 'char']) {
      moving.pointer({ type, modifiers: ['alt'] });
    }
    moving.pointer({ type: 'mouseMove' });
    expect(moving.key(press('keyUp', 'Alt'))).toBe('open');
  });

  it('does not arm while a button of the pointer is held', () => {
    for (const button of ['leftbuttondown', 'middleButtonDown', 'rightbuttondown']) {
      expect(
        results([
          press('keyDown', 'Alt', { modifiers: ['alt', button] }),
          press('keyUp', 'Alt', { modifiers: [button] }),
        ]),
      ).toEqual(['none', 'none']);
    }
    expect(
      results([press('keyDown', 'Alt', { modifiers: ['alt', 'capslock'] }), press('keyUp', 'Alt')]),
    ).toEqual(['arm', 'open']);
  });

  it('does not open for a release of Alt without its press, as remote desktops send them', () => {
    expect(results([press('keyUp', 'Alt')])).toEqual(['none']);
    // Holding Alt after another key does not arm it again.
    expect(
      results([
        press('keyDown', 'Alt'),
        press('keyDown', 'F'),
        press('keyDown', 'Alt', { isAutoRepeat: true }),
        press('keyUp', 'Alt'),
      ]),
    ).toEqual(['arm', 'none', 'none', 'none']);
  });
});
