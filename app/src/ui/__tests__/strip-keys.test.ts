import { describe, expect, it } from 'vitest';
import { stripKey, type StripKeyPress } from '../shell/strip-keys.ts';

/** A key press without modifiers, or with those given. */
const press = (key: string, modifiers: Partial<StripKeyPress> = {}): StripKeyPress => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  ...modifiers,
});

describe('stripKey', () => {
  it('moves with Left and Right in a strip at the top or the bottom, and with Up and Down at a side', () => {
    expect(stripKey(press('ArrowLeft'), false, false)).toBe('previous');
    expect(stripKey(press('ArrowRight'), false, false)).toBe('next');
    expect(stripKey(press('ArrowUp'), false, false)).toBeUndefined();
    expect(stripKey(press('ArrowUp'), true, false)).toBe('previous');
    expect(stripKey(press('ArrowDown'), true, false)).toBe('next');
    expect(stripKey(press('ArrowLeft'), true, false)).toBeUndefined();
    expect(stripKey(press('Home'), true, false)).toBe('first');
    expect(stripKey(press('End'), false, false)).toBe('last');
  });

  it('shows a tab with Enter and Space and closes it with Delete', () => {
    expect(stripKey(press('Enter'), false, false)).toBe('show');
    expect(stripKey(press(' '), false, true)).toBe('show');
    expect(stripKey(press('Delete'), false, false)).toBe('close');
    expect(stripKey(press('Delete'), false, true)).toBe('close');
  });

  it('closes a tab with the delete key of macOS, which types Backspace, and only there', () => {
    expect(stripKey(press('Backspace'), false, true)).toBe('close');
    expect(stripKey(press('Backspace'), true, true)).toBe('close');
    expect(stripKey(press('Backspace'), false, false)).toBeUndefined();
  });

  it('leaves alone keys with modifiers, which may be shortcuts, and those of an input method', () => {
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing'] as const) {
      expect(stripKey(press('Backspace', { [modifier]: true }), false, true)).toBeUndefined();
      expect(stripKey(press('ArrowLeft', { [modifier]: true }), false, false)).toBeUndefined();
    }
    expect(stripKey(press('a'), false, false)).toBeUndefined();
  });
});
