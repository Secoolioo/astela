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
  });
});
