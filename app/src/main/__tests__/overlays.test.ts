import { describe, expect, it, vi } from 'vitest';
import { windowCommands } from '../../shared/shortcuts.ts';
import { questionKeys } from '../overlays.ts';

vi.mock('electron', () => ({ WebContentsView: vi.fn() }));

describe('questionKeys', () => {
  it('lets a question take only the shortcuts of the command palette, so that every other one closes it and runs', () => {
    const taken = windowCommands.filter((command) => questionKeys.onCommand?.(command) === true);
    expect(taken).toEqual(['palette.open', 'tabs.search']);
    // Escape and Alt keep what the overlay does with them.
    expect(questionKeys.escape).toBeUndefined();
    expect(questionKeys.closeOnAlt).toBeUndefined();
  });
});
