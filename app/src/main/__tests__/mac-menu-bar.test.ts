import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { macMenuBar } from '../browser-menu.ts';

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

describe('macMenuBar', () => {
  it('names every item in the language of the system, also the standard ones of macOS', () => {
    const template = macMenuBar(() => undefined) as unknown as MenuItemConstructorOptions[];
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
});
