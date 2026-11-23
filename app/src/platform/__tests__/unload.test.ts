import type { WebContents } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  isLeaving,
  leave,
  unloaded,
  unloadReason,
  unloading,
  waitForAnswer,
  waitsForAnswer,
} from '../electron/unload.ts';

/** A page, as far as the notes need one. */
const page = (): WebContents => ({}) as WebContents;

describe('the reasons why pages unload', () => {
  it('names the reload and the close that the browser noted, once, and else leaving', () => {
    const contents = page();
    expect(unloadReason(contents)).toBe('leave');
    unloading(contents, 'reload');
    expect(unloadReason(contents)).toBe('reload');
    expect(unloadReason(contents)).toBe('leave');
    unloading(contents, 'close');
    // Another page has no note of its own.
    expect(unloadReason(page())).toBe('leave');
    expect(unloadReason(contents)).toBe('close');
    // A page that started to load another document without asking forgets its note.
    unloading(contents, 'reload');
    unloaded(contents);
    expect(unloadReason(contents)).toBe('leave');
  });

  it('keeps which pages people left after they asked to stay, and which wait for a dialog', () => {
    const contents = page();
    expect(isLeaving(contents)).toBe(false);
    leave(contents);
    expect(isLeaving(contents)).toBe(true);
    expect(waitsForAnswer(contents)).toBe(false);
    waitForAnswer(contents, true);
    expect(waitsForAnswer(contents)).toBe(true);
    expect(waitsForAnswer(page())).toBe(false);
    waitForAnswer(contents, false);
    expect(waitsForAnswer(contents)).toBe(false);
  });
});
