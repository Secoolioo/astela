import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = resolve(import.meta.dirname, '../..');

/** The files of the browser below `app/src`, without tests, by their path from there. */
function files(extension: RegExp): string[] {
  return readdirSync(source, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && extension.test(entry.name))
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .filter((path) => !path.includes('__tests__'));
}

/** The files whose code does something, with the places where it does, and how often. */
function uses(pattern: RegExp): Record<string, number> {
  const found: Record<string, number> = {};
  for (const path of files(/\.ts$/)) {
    const count = [...readFileSync(join(source, path), 'utf8').matchAll(pattern)].length;
    if (count > 0) found[path] = count;
  }
  return found;
}

describe('native menus', () => {
  it('stay for context menus, the menu of a tab and the menu bar of macOS', () => {
    // The browser menu and the folders of the bookmarks bar are menus of the overlay.
    expect(uses(/Menu\.buildFromTemplate\(/g)).toEqual({
      'main/bootstrap.ts': 1,
      'main/browser-menu.ts': 1,
      'main/context-menu.ts': 1,
      'main/tab-menu.ts': 1,
    });
    expect(uses(/\.popup\(/g)).toEqual({ 'main/context-menu.ts': 1, 'main/tab-menu.ts': 1 });
    expect(uses(/setApplicationMenu\(/g)).toEqual({ 'main/bootstrap.ts': 2 });
    // The one menu of browser-menu.ts is the menu bar of macOS.
    const browserMenu = readFileSync(join(source, 'main/browser-menu.ts'), 'utf8');
    const macMenuBar = browserMenu.slice(browserMenu.indexOf('export function macMenuBar('));
    expect(macMenuBar).toContain('Menu.buildFromTemplate(');
  });

  it('do not open from the overlay, whose lists never open a menu of the system', () => {
    const selects = files(/\.ts$/)
      .filter((path) => path.startsWith('ui/overlay/'))
      .flatMap((path) =>
        [...readFileSync(join(source, path), 'utf8').matchAll(/<select\b[^>]*>/g)].flatMap(
          ([tag]) => (/\ssize=/.test(tag) ? [] : [`${path}: ${tag}`]),
        ),
      );
    expect(selects).toEqual([]);
  });
});
