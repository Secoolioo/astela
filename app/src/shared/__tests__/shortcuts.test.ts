import { describe, expect, it } from 'vitest';
import {
  acceleratorOf,
  displayShortcut,
  shortcutProblem,
  shortcutTable,
  shortcutsOf,
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
