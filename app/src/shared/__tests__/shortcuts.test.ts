import { describe, expect, it } from 'vitest';
import {
  acceleratorOf,
  defaultShortcuts,
  displayShortcut,
  shortcutProblem,
  shortcutTable,
  shortcutsOf,
  systemShortcutsOf,
  windowCommands,
} from '../shortcuts.ts';

describe('shortcutTable', () => {
  it('uses the defaults of each system', () => {
    expect(shortcutTable('win32').get('Ctrl+T')).toBe('tab.new');
    expect(shortcutTable('darwin').get('Cmd+T')).toBe('tab.new');
    expect(shortcutTable('darwin').get('Ctrl+T')).toBeUndefined();
    expect(shortcutsOf(shortcutTable('linux'), 'zoom.in')[0]).toBe('Ctrl++');
  });

  it('replaces the shortcuts of a command and takes them from other commands', () => {
    const table = shortcutTable('linux', { 'tab.new': ['Ctrl+D'], 'devtools.toggle': [] });
    expect(table.get('Ctrl+T')).toBeUndefined();
    expect(table.get('Ctrl+D')).toBe('tab.new');
    expect(shortcutsOf(table, 'bookmark.toggle')).toEqual([]);
    expect(shortcutsOf(table, 'devtools.toggle')).toEqual([]);
    expect(shortcutsOf(table, 'history.open')).toEqual(['Ctrl+H']);
  });
});

describe('defaultShortcuts', () => {
  it.each(['darwin', 'win32', 'linux'])(
    'gives no key on %s to two commands, and only keys that can be shortcuts',
    (platform) => {
      const defaults = defaultShortcuts(platform);
      const keys = defaults.map(([shortcut]) => shortcut);
      expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
      const refused = defaults.filter(
        ([shortcut]) => shortcutProblem(shortcut, platform) !== undefined,
      );
      expect(refused).toEqual([]);
      expect(shortcutTable(platform).size).toBe(defaults.length);
    },
  );

  it('leaves the commands of the menus without a default, until people give them one', () => {
    const menuOnly = [
      'tab.duplicate',
      'tab.closeOthers',
      'tab.closeRight',
      'tab.mute',
      'app.about',
      'app.quit',
    ] as const;
    for (const platform of ['darwin', 'win32', 'linux']) {
      const table = shortcutTable(platform);
      for (const command of menuOnly) expect(shortcutsOf(table, command)).toEqual([]);
    }
    const reopen = windowCommands.indexOf('tab.reopen');
    expect(windowCommands.slice(reopen, reopen + 4)).toEqual([
      'tab.reopen',
      'tab.duplicate',
      'tab.closeOthers',
      'tab.closeRight',
    ]);
    expect(windowCommands.at(windowCommands.indexOf('tab.pin') + 1)).toBe('tab.mute');
    expect(windowCommands.slice(-2)).toEqual(['app.about', 'app.quit']);
    const own = shortcutTable('linux', { 'tab.duplicate': ['Ctrl+Shift+Y'], 'app.quit': ['F9'] });
    expect(own.get('Ctrl+Shift+Y')).toBe('tab.duplicate');
    expect(shortcutsOf(own, 'app.quit')).toEqual(['F9']);
  });
});

describe('systemShortcutsOf', () => {
  it('gives Quit Astela Command+Q on macOS only, which nobody can take for a shortcut', () => {
    expect(systemShortcutsOf('darwin', 'app.quit')).toEqual(['Cmd+Q']);
    for (const platform of ['darwin', 'win32', 'linux']) {
      const given = windowCommands.flatMap((command) =>
        systemShortcutsOf(platform, command).map((shortcut) => [command, shortcut]),
      );
      expect(given).toEqual(platform === 'darwin' ? [['app.quit', 'Cmd+Q']] : []);
      // The window never runs them itself: the system's own menu does.
      for (const [, shortcut = ''] of given) {
        expect(shortcutProblem(shortcut, platform)).toBe('system');
        expect(shortcutTable(platform).has(shortcut)).toBe(false);
      }
    }
  });
});

describe('shortcutProblem', () => {
  it('refuses keys that type text and those of the system', () => {
    expect(shortcutProblem('K', 'linux')).toBe('text');
    expect(shortcutProblem('Shift+K', 'win32')).toBe('text');
    expect(shortcutProblem('Ctrl+Alt+K', 'win32')).toBe('altgr');
    expect(shortcutProblem('Alt+F4', 'win32')).toBe('system');
    expect(shortcutProblem('Cmd+K', 'linux')).toBe('system');
    expect(shortcutProblem('Alt+K', 'darwin')).toBe('text');
    expect(shortcutProblem('Cmd+Q', 'darwin')).toBe('system');
  });

  it('refuses keys that edit text or move in it, which pages need', () => {
    for (const key of ['Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+Z', 'Ctrl+ArrowLeft', 'Ctrl+Backspace']) {
      expect({ key, problem: shortcutProblem(key, 'win32') }).toEqual({ key, problem: 'text' });
    }
    for (const key of ['Cmd+ArrowLeft', 'Shift+Cmd+ArrowRight', 'Cmd+V', 'Cmd+Z', 'Ctrl+E']) {
      expect({ key, problem: shortcutProblem(key, 'darwin') }).toEqual({ key, problem: 'text' });
    }
    // Shortcuts that other browsers give to their own commands stay possible.
    expect(shortcutProblem('Ctrl+Shift+C', 'linux')).toBeUndefined();
    expect(shortcutProblem('Ctrl+Shift+A', 'win32')).toBeUndefined();
    expect(shortcutProblem('Shift+Cmd+C', 'darwin')).toBeUndefined();
    expect(shortcutProblem('Alt+Cmd+ArrowLeft', 'darwin')).toBeUndefined();
    expect(shortcutProblem('Ctrl+Space', 'linux')).toBeUndefined();
    expect(shortcutProblem('Cmd+Space', 'darwin')).toBe('system');
    expect(shortcutProblem('Alt+Space', 'win32')).toBe('system');
  });

  it('accepts shortcuts with Ctrl, Alt or Command and function keys', () => {
    expect(shortcutProblem('Ctrl+Shift+K', 'linux')).toBeUndefined();
    expect(shortcutProblem('Alt+K', 'win32')).toBeUndefined();
    expect(shortcutProblem('F7', 'win32')).toBeUndefined();
    expect(shortcutProblem('BrowserBack', 'linux')).toBeUndefined();
    expect(shortcutProblem('Ctrl+Alt+K', 'darwin')).toBeUndefined();
    expect(shortcutProblem('Shift+Cmd+K', 'darwin')).toBeUndefined();
  });
});

describe('displayShortcut and acceleratorOf', () => {
  it('write shortcuts as each system does and as menus need them', () => {
    expect(displayShortcut('Ctrl+Shift+T', false)).toBe('Ctrl+Shift+T');
    expect(displayShortcut('Shift+Cmd+T', true)).toBe('⇧⌘T');
    expect(displayShortcut('Alt+ArrowLeft', false)).toBe('Alt+←');
    expect(displayShortcut('Ctrl++', false)).toBe('Ctrl+Plus');
    expect(acceleratorOf('Ctrl++')).toBe('Ctrl+Plus');
    expect(acceleratorOf('Alt+Cmd+ArrowRight')).toBe('Alt+Cmd+Right');
    expect(acceleratorOf('Ctrl+PageDown')).toBe('Ctrl+PageDown');
    expect(acceleratorOf('BrowserBack')).toBeUndefined();
    expect(displayShortcut('Ctrl+Space', false)).toBe('Ctrl+Space');
    expect(displayShortcut('Shift+Cmd++', true)).toBe('⇧⌘+');
    const german = {
      ctrl: 'Strg',
      alt: 'Alt',
      shift: 'Umschalt',
      win: 'Win',
      keys: { PageDown: 'Bild ab', BrowserBack: 'Zurück', '+': 'Plus' },
    };
    expect(displayShortcut('Ctrl+Shift+PageDown', false, german)).toBe('Strg+Umschalt+Bild ab');
    expect(displayShortcut('BrowserBack', false, german)).toBe('Zurück');
    expect(displayShortcut('Ctrl++', false, german)).toBe('Strg+Plus');
    expect(acceleratorOf('Ctrl+Space')).toBe('Ctrl+Space');
  });
});
