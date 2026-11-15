import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { shortcutTable } from '../../shared/shortcuts.ts';
import { macMenuBar, runFromMenuBar } from '../browser-menu.ts';

vi.mock('electron', () => ({
  app: { getLocale: () => 'de' },
  dialog: {},
  Menu: { buildFromTemplate: (template: unknown) => template },
}));

/** Every item of a menu template, with the items of its submenus. */
function items(template: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? items(item.submenu) : []),
  ]);
}

/** The shortcut that each item of the menu bar shows, by the item's text. */
function accelerators(table: ReturnType<typeof shortcutTable>): Record<string, unknown> {
  return Object.fromEntries(
    items(macMenuBar(() => undefined, table) as unknown as MenuItemConstructorOptions[])
      .filter((item) => item.label !== undefined)
      .map((item) => [String(item.label).replaceAll('&', ''), item.accelerator]),
  );
}

describe('macMenuBar', () => {
  it('names every item in the language of the system, also the standard ones of macOS', () => {
    const template = macMenuBar(
      () => undefined,
      shortcutTable('darwin'),
    ) as unknown as MenuItemConstructorOptions[];
    // macOS names the application menu after the application.
    const unnamed = items(template).filter(
      (item) => item.type !== 'separator' && item.role !== 'appMenu' && (item.label ?? '') === '',
    );
    expect(unnamed.map((item) => item.role)).toEqual([]);
    expect(template.map((item) => item.label?.replaceAll('&', ''))).toEqual([
      undefined,
      'Ablage',
      'Bearbeiten',
      'Darstellung',
      'Fenster',
    ]);
  });

  it('shows the shortcuts that the window uses, also those that people chose', () => {
    expect(accelerators(shortcutTable('darwin'))).toMatchObject({
      'Neuer Tab': 'Cmd+T',
      Vergrößern: 'Cmd+Plus',
      Einstellungen: 'Cmd+,',
    });
    const changed = accelerators(
      shortcutTable('darwin', { 'tab.new': ['Shift+Cmd+K'], 'settings.open': [] }),
    );
    expect(changed['Neuer Tab']).toBe('Shift+Cmd+K');
    expect(changed['Einstellungen']).toBeUndefined();
  });
});

/** The window used last, whose overlay shows a popover or the suggestions, and what it did. */
function front(coversWindow: boolean): {
  windows: Parameters<typeof runFromMenuBar>[0];
  done: string[];
} {
  const done: string[] = [];
  const window = {
    overlay: { coversWindow, close: () => void done.push('close') },
    execute: (command: string) => void done.push(command),
  };
  const windows = { lastUsed: window, open: () => window } as unknown as Parameters<
    typeof runFromMenuBar
  >[0];
  return { windows, done };
}

describe('runFromMenuBar', () => {
  it('closes a popover that covers the window before the command runs', () => {
    const { windows, done } = front(true);
    runFromMenuBar(windows, 'find.open', () => undefined);
    expect(done).toEqual(['close', 'find.open']);
  });

  it('leaves the suggestions of the address bar, which cover only a part of the window', () => {
    const { windows, done } = front(false);
    runFromMenuBar(windows, 'find.open', () => undefined);
    expect(done).toEqual(['find.open']);
  });
});
