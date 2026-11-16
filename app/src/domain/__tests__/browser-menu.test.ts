import { describe, expect, it } from 'vitest';
import { shortcutTable } from '../../shared/shortcuts.ts';
import type { CommandContext } from '../commands/availability.ts';
import {
  browserMenu,
  folderLevel,
  moreTools,
  titleLabel,
  toContent,
  type BrowserMenuInput,
  type BrowserMenuText,
  type ModelEntry,
} from '../menus/browser-menu.ts';

/** A window with one web page, where every policy allows everything. */
const context = (change: Partial<CommandContext> = {}): CommandContext => ({
  tabs: [
    {
      url: 'https://example.com/',
      pinned: false,
      canGoBack: false,
      canGoForward: false,
      muted: false,
      split: null,
      group: null,
    },
  ],
  activeIndex: 0,
  canReopen: false,
  finding: false,
  webPage: true,
  privateWindows: true,
  developerTools: true,
  palette: true,
  splitView: true,
  ...change,
});

const input = (change: Partial<BrowserMenuInput> = {}): BrowserMenuInput => ({
  platform: 'linux',
  table: shortcutTable('linux'),
  context: context(),
  zoom: 1,
  fullScreen: false,
  ...change,
});

/** Each text by its name, so the tests read which item is where. */
const text = (name: BrowserMenuText): string => name;

/** The texts of a level's entries, `-` for a separator and `zoom` for the zoom row. */
function texts(items: readonly ModelEntry[]): string[] {
  return items.map((entry) =>
    entry.type === 'separator' ? '-' : entry.type === 'zoom' ? 'zoom' : entry.label,
  );
}

/** An entry of the menu by its text. */
function entryOf(items: readonly ModelEntry[], label: string): ModelEntry | undefined {
  return items.find((candidate) => 'label' in candidate && candidate.label === label);
}

/** The zoom row of the browser menu of a window. */
function zoomRow(change: Partial<BrowserMenuInput>): ModelEntry | undefined {
  return browserMenu(input(change), text).items.find((item) => item.type === 'zoom');
}

describe('browserMenu', () => {
  it('lists the commands of the browser in their order, with Exit on Windows and Quit elsewhere', () => {
    const order = [
      'newTab',
      'newWindow',
      'newPrivateWindow',
      '-',
      'zoom',
      '-',
      'history',
      'downloads',
      'bookmarks',
      '-',
      'commandPalette',
      'searchTabs',
      '-',
      'find',
      'print',
      'savePage',
      'moreTools',
      '-',
      'settings',
      'about',
    ];
    expect(texts(browserMenu(input(), text).items)).toEqual([...order, 'quit']);
    expect(texts(browserMenu(input({ platform: 'win32' }), text).items)).toEqual([
      ...order,
      'exit',
    ]);
    const mac = browserMenu(input({ platform: 'darwin', table: shortcutTable('darwin') }), text);
    expect(texts(mac.items)).toEqual([...order, 'quit']);
    // macOS quits with Command+Q, which its application menu gives the command.
    expect(entryOf(mac.items, 'quit')).toMatchObject({ shortcut: 'Cmd+Q', enabled: true });
    expect(browserMenu(input(), text)).toMatchObject({ parent: -1, label: 'menu' });
  });

  it('leaves out New private window and Developer tools where a policy forbids them', () => {
    const closed = input({ context: context({ privateWindows: false, developerTools: false }) });
    expect(texts(browserMenu(closed, text).items)).not.toContain('newPrivateWindow');
    expect(texts(moreTools(closed, text, 13).items)).toEqual(['viewSource']);
    expect(moreTools(input(), text, 13)).toMatchObject({ parent: 13, label: 'moreTools' });
    expect(texts(moreTools(input(), text, 13).items)).toEqual(['viewSource', 'developerTools']);
  });

  it('opens the command palette and tab search with their shortcuts, and has no items while the palette is off', () => {
    const items = browserMenu(input(), text).items;
    expect(entryOf(items, 'commandPalette')).toMatchObject({
      shortcut: 'Ctrl+K',
      enabled: true,
      action: { run: 'palette.open' },
    });
    expect(entryOf(items, 'searchTabs')).toMatchObject({
      shortcut: 'Ctrl+Shift+A',
      enabled: true,
      action: { run: 'tabs.search' },
    });
    const mac = browserMenu(input({ platform: 'darwin', table: shortcutTable('darwin') }), text);
    expect(entryOf(mac.items, 'commandPalette')).toMatchObject({ shortcut: 'Cmd+K' });
    expect(entryOf(mac.items, 'searchTabs')).toMatchObject({ shortcut: 'Shift+Cmd+A' });
    const off = texts(browserMenu(input({ context: context({ palette: false }) }), text).items);
    expect(off).not.toContain('commandPalette');
    expect(off).not.toContain('searchTabs');
    // The group goes with its separator.
    expect(off.filter((entry) => entry === '-')).toHaveLength(4);
  });

  it('offers the tools of the page only on web pages', () => {
    const internal = input({
      context: context({
        tabs: [
          {
            url: 'app://settings/',
            pinned: false,
            canGoBack: false,
            canGoForward: false,
            muted: false,
            split: null,
            group: null,
          },
        ],
        webPage: false,
      }),
      zoom: null,
    });
    const items = browserMenu(internal, text).items;
    const disabled = items.flatMap((item) =>
      item.type === 'item' && !item.enabled ? [item.label] : [],
    );
    expect(disabled).toEqual(['find', 'print', 'savePage']);
    expect(
      moreTools(internal, text, 13).items.every((item) => 'enabled' in item && !item.enabled),
    ).toBe(true);
    expect(items.find((item) => item.type === 'zoom')).toMatchObject({
      zoom: null,
      canZoomIn: false,
      canZoomOut: false,
    });
  });

  it('shows the zoom of the page in its row, and stops zooming at 25 and 500 %', () => {
    expect(zoomRow({ zoom: 1 })).toMatchObject({
      label: 'zoom',
      zoom: 1,
      canZoomIn: true,
      canZoomOut: true,
      fullScreen: false,
      labels: {
        zoomOut: 'zoomOut',
        reset: 'resetZoom',
        zoomIn: 'zoomIn',
        fullScreen: 'fullScreen',
      },
      shortcuts: { zoomOut: 'Ctrl+-', reset: 'Ctrl+0', zoomIn: 'Ctrl++', fullScreen: 'F11' },
    });
    expect(zoomRow({ zoom: 0.25 })).toMatchObject({ canZoomOut: false, canZoomIn: true });
    expect(zoomRow({ zoom: 5 })).toMatchObject({ canZoomOut: true, canZoomIn: false });
    expect(zoomRow({ zoom: null })).toMatchObject({
      zoom: null,
      canZoomOut: false,
      canZoomIn: false,
    });
    expect(zoomRow({ fullScreen: true })).toMatchObject({ fullScreen: true });
  });

  it('shows the shortcuts of the window, also those that people chose, and none for a command without one', () => {
    const own = input({
      table: shortcutTable('linux', { 'tab.new': ['Ctrl+Shift+K'], 'history.open': [] }),
    });
    const items = browserMenu(own, text).items;
    expect(entryOf(items, 'newTab')).toMatchObject({
      shortcut: 'Ctrl+Shift+K',
      action: { run: 'tab.new' },
    });
    expect(entryOf(items, 'history')).toMatchObject({ shortcut: null });
    expect(entryOf(items, 'about')).toMatchObject({ shortcut: null, action: { run: 'app.about' } });
    expect(entryOf(items, 'moreTools')).toMatchObject({
      type: 'submenu',
      source: { tools: 'more' },
    });
  });
});

describe('folderLevel', () => {
  const options = { label: 'Work', empty: '(empty)', mac: false, parent: -1, depth: 0 };

  it('lists bookmarks and folders, leaves out the ones the bar shows and stops at 500', () => {
    const entries = Array.from({ length: 600 }, (_, index) =>
      index % 100 === 0
        ? { id: index + 10, title: `Folder ${index}`, url: null }
        : { id: index + 10, title: `Page ${index}`, url: `https://example.com/${index}` },
    );
    const level = folderLevel(entries, { ...options, skip: 3 });
    expect(level.items).toHaveLength(500);
    expect(level.items[0]).toMatchObject({ type: 'item', label: 'Page 3', icon: 'bookmark' });
    expect(level.items[97]).toMatchObject({
      type: 'submenu',
      label: 'Folder 100',
      enabled: true,
      icon: 'folder',
      source: { folder: 110, title: 'Folder 100' },
    });
    expect(level.items.at(-1)).toMatchObject({ label: 'Page 502' });
  });

  it('opens folders only down to 20 levels', () => {
    const folder = [{ id: 3, title: 'Deep', url: null }];
    expect(folderLevel(folder, { ...options, depth: 19 }).items[0]).toMatchObject({
      enabled: true,
    });
    expect(folderLevel(folder, { ...options, depth: 20 }).items[0]).toMatchObject({
      enabled: false,
    });
  });

  it('shows titles as they are: & stays &, long ones are cut, and pages without one show their address', () => {
    const level = folderLevel(
      [
        { id: 3, title: 'Tom & Jerry', url: 'https://example.com/a' },
        { id: 4, title: '', url: 'https://example.com/b' },
        { id: 5, title: 'x'.repeat(400), url: 'https://example.com/c' },
      ],
      options,
    );
    expect(texts(level.items)).toEqual(['Tom && Jerry', 'https://example.com/b', 'x'.repeat(300)]);
    expect(
      folderLevel([{ id: 3, title: 'Tom & Jerry', url: null }], { ...options, mac: true }).items[0],
    ).toMatchObject({ label: 'Tom & Jerry' });
    // A cut between the two marks of an & leaves neither.
    expect(titleLabel(`${'x'.repeat(149)}${'&'.repeat(100)}`, false)).toBe(
      `${'x'.repeat(149)}${'&&'.repeat(75)}`,
    );
    expect(titleLabel(`${'x'.repeat(150)}${'&'.repeat(100)}`, false)).toBe(
      `${'x'.repeat(150)}${'&&'.repeat(75)}`,
    );
  });

  it('says that an empty folder is empty, with an item that cannot be chosen', () => {
    expect(folderLevel([], options)).toEqual({
      parent: -1,
      label: 'Work',
      items: [
        {
          type: 'item',
          label: '(empty)',
          shortcut: null,
          enabled: false,
          icon: null,
          action: null,
        },
      ],
    });
  });
});

describe('toContent', () => {
  it('keeps nothing of what the items do, such as commands and the addresses of bookmarks', () => {
    const levels = [
      browserMenu(input(), text),
      folderLevel([{ id: 3, title: 'Secret', url: 'https://example.com/secret' }], {
        label: 'Work',
        empty: '(empty)',
        mac: false,
        parent: 0,
        depth: 1,
      }),
    ];
    const content = JSON.stringify(toContent(levels));
    expect(content).not.toMatch(/"action"|"source"|tab\.new|https:\/\/example\.com\/secret/);
    expect(toContent(levels)[1]).toEqual({
      parent: 0,
      label: 'Work',
      items: [{ type: 'item', label: 'Secret', shortcut: null, enabled: true, icon: 'bookmark' }],
    });
  });
});
