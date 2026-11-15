import { describe, expect, it } from 'vitest';
import { HeldTyping, heldLimit, holdTime, type HeldKey } from '../palette/held-typing.ts';

/** A key press without modifiers. */
const press = (key: string, change: Partial<HeldKey> = {}): HeldKey => ({
  type: 'keyDown',
  key,
  control: false,
  alt: false,
  meta: false,
  isComposing: false,
  ...change,
});

/** A hold with a clock that the test moves, which holds from now on. */
function held(platform = 'linux'): { typing: HeldTyping; clock: { now: number } } {
  const clock = { now: 1000 };
  const typing = new HeldTyping(() => clock.now, platform);
  typing.hold();
  return { typing, clock };
}

/** Types each character of a text, with its release. */
function type(typing: HeldTyping, text: string): boolean[] {
  return text
    .split('')
    .flatMap((key) => [typing.take(press(key)), typing.take(press(key, { type: 'keyUp' }))]);
}

describe('HeldTyping', () => {
  it('holds letters, letters with Shift and spaces, and their releases', () => {
    const { typing } = held();
    expect(type(typing, 'Zoom in').every(Boolean)).toBe(true);
    expect(typing.release()).toEqual({ text: 'Zoom in', enter: false, cancelled: false });
  });

  it('leaves keys alone while it does not hold, and after it let them go', () => {
    const typing = new HeldTyping(() => 0, 'linux');
    expect(typing.active).toBe(false);
    expect(typing.take(press('a'))).toBe(false);
    expect(typing.release()).toEqual({ text: '', enter: false, cancelled: false });
    typing.hold();
    expect(typing.active).toBe(true);
    typing.release();
    expect(typing.take(press('a'))).toBe(false);
  });

  it('leaves shortcuts with Ctrl or Command to their view', () => {
    const { typing } = held();
    expect(typing.take(press('t', { control: true }))).toBe(false);
    expect(typing.take(press('t', { meta: true }))).toBe(false);
    expect(typing.take(press('t', { control: true, type: 'keyUp' }))).toBe(false);
    expect(typing.release().text).toBe('');
  });

  it('holds AltGr, which Windows reports as Ctrl with Alt, but not Ctrl with Alt on macOS', () => {
    const windows = held('win32').typing;
    expect(windows.take(press('@', { control: true, alt: true }))).toBe(true);
    expect(windows.release().text).toBe('@');
    const mac = held('darwin').typing;
    expect(mac.take(press('@', { control: true, alt: true }))).toBe(false);
    expect(mac.release().text).toBe('');
  });

  it('holds the characters of Option on macOS', () => {
    const { typing } = held('darwin');
    expect(typing.take(press('ø', { alt: true }))).toBe(true);
    expect(typing.release().text).toBe('ø');
  });

  it('leaves dead keys and the keys of an input method to the view', () => {
    const { typing } = held();
    expect(typing.take(press('Dead'))).toBe(false);
    expect(typing.take(press('k', { isComposing: true }))).toBe(false);
    expect(typing.take(press('Enter', { isComposing: true }))).toBe(false);
    expect(typing.release()).toEqual({ text: '', enter: false, cancelled: false });
  });

  it('leaves keys that type nothing, such as Tab, the arrows and the modifiers, to the view', () => {
    const { typing } = held();
    for (const key of ['Tab', 'ArrowDown', 'Shift', 'Control', 'F5', 'Unidentified']) {
      expect(typing.take(press(key))).toBe(false);
    }
    expect(typing.take(press('Enter', { alt: true }))).toBe(false);
    expect(typing.take(press('Backspace', { control: true }))).toBe(false);
  });

  it('holds a character that a person sees as one, also when it is made of several', () => {
    const { typing } = held();
    expect(typing.take(press('👍🏽'))).toBe(true);
    expect(typing.take(press('é'))).toBe(true);
    expect(typing.take(press('Backspace'))).toBe(true);
    expect(typing.release().text).toBe('👍🏽');
    typing.hold();
    expect(typing.take(press('👍🏽'))).toBe(true);
    expect(typing.take(press('Backspace'))).toBe(true);
    expect(typing.release().text).toBe('');
  });

  it('deletes the last character with Backspace, chooses with Enter and cancels with Escape', () => {
    const { typing } = held();
    type(typing, 'zoon');
    expect(typing.take(press('Backspace'))).toBe(true);
    type(typing, 'm');
    expect(typing.wasCancelled).toBe(false);
    expect(typing.take(press('Enter'))).toBe(true);
    expect(typing.release()).toEqual({ text: 'zoom', enter: true, cancelled: false });
    typing.hold();
    expect(typing.take(press('Backspace'))).toBe(true);
    expect(typing.take(press('Escape'))).toBe(true);
    expect(typing.wasCancelled).toBe(true);
    expect(typing.release()).toEqual({ text: '', enter: false, cancelled: true });
    expect(typing.wasCancelled).toBe(false);
  });

  it('takes no new keys after its time, but keeps what it holds', () => {
    const { typing, clock } = held();
    type(typing, 'ab');
    clock.now += holdTime;
    expect(typing.take(press('c'))).toBe(true);
    clock.now += 1;
    expect(typing.take(press('d'))).toBe(false);
    expect(typing.take(press('Enter'))).toBe(false);
    expect(typing.release()).toEqual({ text: 'abc', enter: false, cancelled: false });
  });

  it('goes on with what it holds when the shortcut comes again, for another time', () => {
    const { typing, clock } = held();
    type(typing, 'ab');
    clock.now += holdTime;
    typing.hold();
    clock.now += holdTime;
    expect(typing.take(press('c'))).toBe(true);
    expect(typing.release().text).toBe('abc');
  });

  it('gives the keys back at once when it is given up, and the palette gets nothing', () => {
    const { typing } = held();
    type(typing, 'ab');
    typing.cancel();
    expect(typing.active).toBe(true);
    expect(typing.wasCancelled).toBe(true);
    expect(typing.take(press('c'))).toBe(false);
    expect(typing.take(press('Enter'))).toBe(false);
    expect(typing.take(press('Escape'))).toBe(false);
    expect(typing.release()).toEqual({ text: '', enter: false, cancelled: true });
    expect(typing.active).toBe(false);
    // Without a hold, there is nothing to give up.
    typing.cancel();
    expect(typing.wasCancelled).toBe(false);
    expect(typing.active).toBe(false);
  });

  it('holds anew with nothing when the shortcut comes again after the hold was given up', () => {
    const { typing } = held();
    type(typing, 'ab');
    typing.cancel();
    typing.hold();
    expect(typing.wasCancelled).toBe(false);
    expect(typing.take(press('c'))).toBe(true);
    expect(typing.release()).toEqual({ text: 'c', enter: false, cancelled: false });
  });

  it(`keeps at most ${String(heldLimit)} characters`, () => {
    const { typing } = held();
    type(typing, 'x'.repeat(heldLimit + 20));
    expect(typing.release().text).toBe('x'.repeat(heldLimit));
  });
});
