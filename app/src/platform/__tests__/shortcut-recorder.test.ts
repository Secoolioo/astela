import { EventEmitter } from 'node:events';
import type { Input, WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import { ShortcutRecorder } from '../electron/shortcuts.ts';

const key = (input: Partial<Input>): Input =>
  ({
    type: 'keyDown',
    key: 'k',
    code: 'KeyK',
    control: false,
    alt: false,
    shift: false,
    meta: false,
    isComposing: false,
    ...input,
  }) as Input;

const view = (id: number): WebContents =>
  Object.assign(new EventEmitter(), { id }) as unknown as WebContents;

describe('ShortcutRecorder', () => {
  it('takes the next key press of a view as a shortcut, after modifiers alone', async () => {
    const recorder = new ShortcutRecorder();
    const recorded = recorder.record(view(3));
    expect(recorder.take(4, key({ control: true }), 'linux')).toBe(false);
    expect(recorder.take(3, key({ key: 'Control', control: true }), 'linux')).toBe(true);
    expect(recorder.take(3, key({ control: true, shift: true }), 'linux')).toBe(true);
    await expect(recorded).resolves.toBe('Ctrl+Shift+K');
    expect(recorder.take(3, key({ control: true }), 'linux')).toBe(false);
  });

  it('ends without a shortcut on Escape, on a new wait and when the view goes', async () => {
    const recorder = new ShortcutRecorder();
    const escaped = recorder.record(view(1));
    recorder.take(1, key({ key: 'Escape', code: 'Escape' }), 'linux');
    await expect(escaped).resolves.toBeUndefined();
    const contents = view(2);
    const first = recorder.record(contents);
    const second = recorder.record(contents);
    await expect(first).resolves.toBeUndefined();
    contents.emit('destroyed');
    await expect(second).resolves.toBeUndefined();
  });

  it('leaves no listener on the view once a wait ends, and names the space bar', async () => {
    const recorder = new ShortcutRecorder();
    const contents = view(5);
    for (let round = 0; round < 12; round += 1) {
      const recorded = recorder.record(contents);
      recorder.take(5, key({ key: ' ', code: 'Space', control: true }), 'linux');
      await expect(recorded).resolves.toBe('Ctrl+Space');
    }
    expect((contents as unknown as EventEmitter).listenerCount('destroyed')).toBe(0);
  });
});
