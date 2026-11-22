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

/**
 * The texts and shortcuts of the items of the View menu, while the palette, split view, the
 * reader view and picture in picture are on or off.
 */
function view(
  palette: boolean,
  splitView?: boolean,
  table: ReturnType<typeof shortcutTable> = shortcutTable('darwin'),
  reader?: boolean,
  pictureInPicture?: boolean,
): unknown[] {
  const template = macMenuBar(() => undefined, table, {
    palette,
    ...(splitView === undefined ? {} : { splitView }),
    ...(reader === undefined ? {} : { reader }),
    ...(pictureInPicture === undefined ? {} : { pictureInPicture }),
  }) as unknown as MenuItemConstructorOptions[];
  const menu = template.find((item) => item.label?.replaceAll('&', '') === 'Darstellung');
  return (Array.isArray(menu?.submenu) ? menu.submenu : []).map((item) =>
    item.type === 'separator' ? '-' : [item.label?.replaceAll('&', ''), item.accelerator],
  );
}

describe('the View menu of macOS', () => {
  it('starts with the command palette and tab search while the palette is on', () => {
    expect(view(true).slice(0, 4)).toEqual([
      ['Befehlspalette…', 'Cmd+K'],
      ['Tabs durchsuchen…', 'Shift+Cmd+A'],
      '-',
      ['Suchen…', 'Cmd+F'],
    ]);
  });

  it('opens or ends split view after full screen, with its shortcut, while split view is on', () => {
    const shown = view(true);
    const full = shown.findIndex((item) => Array.isArray(item) && item[0] === 'Vollbild');
    expect(shown[full + 1]).toEqual(['Geteilte Ansicht', 'Ctrl+Cmd+S']);
    expect(view(true, true)).toEqual(shown);
    const changed = view(true, true, shortcutTable('darwin', { 'split.toggle': ['Alt+Cmd+S'] }));
    expect(changed).toContainEqual(['Geteilte Ansicht', 'Alt+Cmd+S']);
    expect(JSON.stringify(view(true, false))).not.toContain('Geteilte Ansicht');
  });

  it('shows or ends the reader view after split view, with its shortcut, while the reader view is on', () => {
    const shown = view(true);
    const split = shown.findIndex((item) => Array.isArray(item) && item[0] === 'Geteilte Ansicht');
    expect(shown.slice(split + 1, split + 4)).toEqual([
      ['Leseansicht', 'Alt+Cmd+R'],
      ['Bild im Bild', undefined],
      '-',
    ]);
    expect(view(true, true, shortcutTable('darwin'), true)).toEqual(shown);
    const changed = view(true, true, shortcutTable('darwin', { 'reader.toggle': ['Ctrl+Cmd+R'] }));
    expect(changed).toContainEqual(['Leseansicht', 'Ctrl+Cmd+R']);
    const off = view(true, true, shortcutTable('darwin'), false);
    expect(JSON.stringify(off)).not.toContain('Leseansicht');
    expect(off).toHaveLength(shown.length - 1);
  });

  it('shows picture in picture after the reader view, with the shortcut that people give it, while it is on', () => {
    const shown = view(true);
    const reader = shown.findIndex((item) => Array.isArray(item) && item[0] === 'Leseansicht');
    expect(shown[reader + 1]).toEqual(['Bild im Bild', undefined]);
    expect(view(true, true, shortcutTable('darwin'), true, true)).toEqual(shown);
    const given = shortcutTable('darwin', { 'media.pictureInPicture': ['Ctrl+Cmd+P'] });
    expect(view(true, true, given)).toContainEqual(['Bild im Bild', 'Ctrl+Cmd+P']);
    const off = view(true, true, shortcutTable('darwin'), true, false);
    expect(JSON.stringify(off)).not.toContain('Bild im Bild');
    expect(off).toHaveLength(shown.length - 1);
  });

  it('has neither while the palette is off', () => {
    const shown = view(false);
    expect(shown[0]).toEqual(['Suchen…', 'Cmd+F']);
    expect(JSON.stringify(shown)).not.toContain('Befehlspalette');
    expect(JSON.stringify(shown)).not.toContain('Tabs durchsuchen');
  });
});

/**
 * The window used last, whose overlay shows a popover or the suggestions, and what it did; the
 * popover takes some commands, as the palette takes its own.
 */
function front(
  coversWindow: boolean,
  takes: readonly string[] = [],
): {
  windows: Parameters<typeof runFromMenuBar>[0];
  done: string[];
} {
  const done: string[] = [];
  const window = {
    overlay: {
      coversWindow,
      close: () => void done.push('close'),
      offer: (command: string) => takes.includes(command) && done.push(`took ${command}`) > 0,
    },
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

  it('lets the popover take a command, as the palette takes its own, which then does not run', () => {
    const { windows, done } = front(true, ['palette.open']);
    runFromMenuBar(windows, 'palette.open', () => undefined);
    expect(done).toEqual(['took palette.open']);
    runFromMenuBar(windows, 'find.open', () => undefined);
    expect(done).toEqual(['took palette.open', 'close', 'find.open']);
  });

  it('leaves the suggestions of the address bar, which cover only a part of the window', () => {
    const { windows, done } = front(false);
    runFromMenuBar(windows, 'find.open', () => undefined);
    expect(done).toEqual(['find.open']);
  });
});

describe('the File menu of macOS', () => {
  it('closes the window with Shift+Command+W, as other browsers do, before the tools of the page', () => {
    const template = macMenuBar(
      () => undefined,
      shortcutTable('darwin'),
    ) as unknown as MenuItemConstructorOptions[];
    const file = template.find((item) => item.label?.replaceAll('&', '') === 'Ablage');
    const submenu = Array.isArray(file?.submenu) ? file.submenu : [];
    const entries = submenu.map((item) =>
      item.type === 'separator' ? '-' : [item.label?.replaceAll('&', ''), item.accelerator],
    );
    expect(entries.slice(3, 6)).toEqual(['-', ['Fenster schließen', 'Shift+Cmd+W'], '-']);
    // The item closes the key window, as in other apps of macOS, rather than running the command
    // in the browser window used last: the key window can be one of the developer tools, and
    // there is none while every window is in the Dock, which turns the item off.
    const close = submenu[4];
    expect(close).toMatchObject({ role: 'close', registerAccelerator: false });
    expect(close?.click).toBeUndefined();
  });
});
