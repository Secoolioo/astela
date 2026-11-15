import { describe, expect, it } from 'vitest';
import { menuKey, parseLabel, type KeyEntry } from '../overlay/menu-keys.ts';

const item = (label: string, enabled = true): KeyEntry => ({ type: 'item', label, enabled });
const separator: KeyEntry = { type: 'separator' };

/** A menu like the browser menu: a disabled item, separators, a zoom row and a submenu. */
const menu: readonly KeyEntry[] = [
  item('New &tab'),
  item('New &window'),
  item('New pr&ivate window', false),
  separator,
  { type: 'zoom', label: '&Zoom', enabled: true },
  separator,
  item('&History'),
  { type: 'submenu', label: 'More t&ools', enabled: true },
  item('&Settings'),
];

const root = { mac: false, root: true };
const sub = { mac: false, root: false };

describe('parseLabel', () => {
  it('finds the access key after &, and writes && as &', () => {
    expect(parseLabel('New pr&ivate window', false)).toEqual({
      text: 'New private window',
      accessKey: 'i',
      at: 6,
    });
    expect(parseLabel('Tom && &Jerry', false)).toEqual({
      text: 'Tom & Jerry',
      accessKey: 'j',
      at: 6,
    });
    expect(parseLabel('R&&D', false)).toEqual({ text: 'R&D' });
    expect(parseLabel('&Über Astela', false)).toEqual({
      text: 'Über Astela',
      accessKey: 'ü',
      at: 0,
    });
    // Only the first mark counts, and a mark at the end marks nothing.
    expect(parseLabel('&a&b', false)).toEqual({ text: 'ab', accessKey: 'a', at: 0 });
    expect(parseLabel('End &', false)).toEqual({ text: 'End ' });
  });

  it('shows the texts of macOS as they are', () => {
    expect(parseLabel('Tom & Jerry', true)).toEqual({ text: 'Tom & Jerry' });
  });
});

describe('menuKey', () => {
  it('moves up and down around the ends, past separators and disabled items', () => {
    expect(menuKey(menu, -1, 'ArrowDown', root)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(menu, 1, 'ArrowDown', root)).toEqual({ kind: 'focus', index: 4 });
    expect(menuKey(menu, 8, 'ArrowDown', root)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(menu, 0, 'ArrowUp', root)).toEqual({ kind: 'focus', index: 8 });
    expect(menuKey(menu, 4, 'ArrowUp', root)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKey(menu, -1, 'ArrowUp', root)).toEqual({ kind: 'focus', index: 8 });
    expect(menuKey(menu, 6, 'Home', root)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(menu, 0, 'End', root)).toEqual({ kind: 'focus', index: 8 });
    expect(menuKey([separator, item('Gone', false)], -1, 'ArrowDown', root)).toEqual({
      kind: 'none',
    });
  });

  it('opens a submenu with Right, Enter or Space, and chooses items with Enter or Space', () => {
    for (const key of ['ArrowRight', 'Enter', ' ']) {
      expect(menuKey(menu, 7, key, root)).toEqual({ kind: 'openSubmenu', index: 7 });
    }
    expect(menuKey(menu, 6, 'ArrowRight', root)).toEqual({ kind: 'none' });
    expect(menuKey(menu, 6, 'Enter', root)).toEqual({ kind: 'activate', index: 6 });
    expect(menuKey(menu, 0, ' ', root)).toEqual({ kind: 'activate', index: 0 });
    expect(menuKey(menu, 2, 'Enter', root)).toEqual({ kind: 'none' });
    expect(menuKey(menu, -1, 'Enter', root)).toEqual({ kind: 'none' });
  });

  it('closes a submenu with Left or Escape, and the menu with Escape at its top or with Tab', () => {
    expect(menuKey(menu, 0, 'ArrowLeft', sub)).toEqual({ kind: 'closeSubmenu' });
    expect(menuKey(menu, 0, 'Escape', sub)).toEqual({ kind: 'closeSubmenu' });
    expect(menuKey(menu, 0, 'ArrowLeft', root)).toEqual({ kind: 'none' });
    expect(menuKey(menu, 0, 'Escape', root)).toEqual({ kind: 'closeMenu' });
    expect(menuKey(menu, 0, 'Tab', root)).toEqual({ kind: 'closeMenu' });
    expect(menuKey(menu, 0, 'Tab', sub)).toEqual({ kind: 'closeMenu' });
  });

  it('chooses the item of a unique access key, and only moves among items that share one', () => {
    expect(menuKey(menu, -1, 'h', root)).toEqual({ kind: 'activate', index: 6 });
    expect(menuKey(menu, -1, 'H', root)).toEqual({ kind: 'activate', index: 6 });
    expect(menuKey(menu, 0, 'o', root)).toEqual({ kind: 'openSubmenu', index: 7 });
    expect(menuKey(menu, 0, 'z', root)).toEqual({ kind: 'focus', index: 4 });
    // A disabled item does not take its access key.
    expect(menuKey(menu, 0, 'i', root)).toEqual({ kind: 'none' });
    const shared = [item('&Save'), item('&Stop'), item('&Quit')];
    expect(menuKey(shared, -1, 's', root)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(shared, 0, 's', root)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKey(shared, 1, 's', root)).toEqual({ kind: 'focus', index: 0 });
  });

  it('moves to the next item that starts with a letter on macOS and in folders', () => {
    const mac = [item('New Tab'), item('New Window'), item('History'), item('Settings…')];
    expect(menuKey(mac, -1, 'n', { mac: true, root: true })).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(mac, 0, 'n', { mac: true, root: true })).toEqual({ kind: 'focus', index: 1 });
    expect(menuKey(mac, 1, 'N', { mac: true, root: true })).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(mac, 0, 's', { mac: true, root: true })).toEqual({ kind: 'focus', index: 3 });
    expect(menuKey(mac, 0, 'x', { mac: true, root: true })).toEqual({ kind: 'none' });
    // The titles of bookmarks have no access keys; an & of a title is one of its own.
    const folder = [item('Tom && Jerry'), item('Travel'), item('(empty)', false)];
    expect(menuKey(folder, -1, 't', sub)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKey(folder, 0, 't', sub)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKey(folder, 1, '(', sub)).toEqual({ kind: 'none' });
    expect(menuKey(folder, 1, 'Shift', sub)).toEqual({ kind: 'none' });
  });
});
