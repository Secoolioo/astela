import { describe, expect, it } from 'vitest';
import { windowCommands, type WindowCommand } from '../../shared/shortcuts.ts';
import {
  availableCommands,
  canRun,
  type CommandContext,
  type CommandTab,
} from '../commands/availability.ts';

/** A tab of a web page that has no history. */
const page = (tab: Partial<CommandTab> = {}): CommandTab => ({
  url: 'https://example.com/',
  pinned: false,
  canGoBack: false,
  canGoForward: false,
  muted: false,
  ...tab,
});

/** A window with one web page, where every policy allows everything. */
const context = (change: Partial<CommandContext> = {}): CommandContext => ({
  tabs: [page()],
  activeIndex: 0,
  canReopen: false,
  finding: false,
  webPage: true,
  privateWindows: true,
  developerTools: true,
  ...change,
});

/** The commands of a list that cannot run in a window. */
const missing = (commands: readonly WindowCommand[], window: CommandContext): WindowCommand[] =>
  commands.filter((command) => !canRun(command, window));

describe('availableCommands', () => {
  it('keeps the order of the catalog, and runs the commands of the window and the browser always', () => {
    const available = availableCommands(context());
    expect(available).toEqual(windowCommands.filter((command) => available.includes(command)));
    const always: WindowCommand[] = [
      'tab.new',
      'window.new',
      'tab.close',
      'tab.duplicate',
      'tab.pin',
      'tab.mute',
      'page.reload',
      'page.home',
      'omnibox.focus',
      'window.fullscreen',
      'bookmarks.open',
      'bookmarks.toggleBar',
      'history.open',
      'downloads.open',
      'settings.open',
      'app.about',
      'app.quit',
    ];
    const internal = context({ tabs: [page({ url: 'app://settings/' })], webPage: false });
    expect(missing(always, internal)).toEqual([]);
  });

  it('goes back and forward only where the history of the tab goes', () => {
    expect(canRun('page.back', context())).toBe(false);
    expect(canRun('page.forward', context())).toBe(false);
    const middle = context({ tabs: [page({ canGoBack: true, canGoForward: true })] });
    expect(missing(['page.back', 'page.forward'], middle)).toEqual([]);
  });

  it('offers the tools of web pages only on web pages, and find steps only while finding', () => {
    const tools: WindowCommand[] = [
      'page.reloadHard',
      'page.print',
      'page.save',
      'page.source',
      'zoom.in',
      'zoom.out',
      'zoom.reset',
      'find.open',
      'devtools.toggle',
    ];
    expect(missing(tools, context())).toEqual([]);
    const internal = context({ tabs: [page({ url: 'app://history/' })], webPage: false });
    expect(availableCommands(internal).filter((command) => tools.includes(command))).toEqual([]);
    expect(canRun('bookmark.toggle', internal)).toBe(false);
    expect(canRun('bookmark.toggle', context())).toBe(true);
    expect(canRun('find.next', context())).toBe(false);
    expect(missing(['find.next', 'find.previous'], context({ finding: true }))).toEqual([]);
    expect(canRun('find.next', context({ finding: true, webPage: false }))).toBe(false);
  });

  it('follows the policies for private windows and developer tools', () => {
    expect(canRun('window.newPrivate', context())).toBe(true);
    expect(canRun('window.newPrivate', context({ privateWindows: false }))).toBe(false);
    expect(canRun('devtools.toggle', context({ developerTools: false }))).toBe(false);
  });

  it('chooses tabs by their place only where there are as many tabs', () => {
    const one = context();
    expect(canRun('tab.select1', one)).toBe(true);
    expect(missing(['tab.select2', 'tab.selectLast', 'tab.next', 'tab.previous'], one)).toEqual([
      'tab.select2',
      'tab.selectLast',
      'tab.next',
      'tab.previous',
    ]);
    const three = context({ tabs: [page(), page(), page()] });
    expect(missing(['tab.select3', 'tab.selectLast', 'tab.next', 'tab.previous'], three)).toEqual(
      [],
    );
    expect(canRun('tab.select4', three)).toBe(false);
    const eight = context({ tabs: Array.from({ length: 8 }, () => page()) });
    expect(canRun('tab.select8', eight)).toBe(true);
  });

  it('moves a tab only within its pinned or unpinned tabs, and not past the ends', () => {
    const tabs = [page({ pinned: true }), page({ pinned: true }), page(), page()];
    const moves = (activeIndex: number): string =>
      (['tab.moveLeft', 'tab.moveRight'] as const)
        .map((command) => (canRun(command, context({ tabs, activeIndex })) ? command : '-'))
        .join(' ');
    expect(moves(0)).toBe('- tab.moveRight');
    expect(moves(1)).toBe('tab.moveLeft -');
    expect(moves(2)).toBe('- tab.moveRight');
    expect(moves(3)).toBe('tab.moveLeft -');
    expect(moves(-1)).toBe('- -');
  });

  it('closes other tabs and those to the right only when an unpinned one is there', () => {
    const tabs = [page({ pinned: true }), page(), page()];
    expect(canRun('tab.closeOthers', context({ tabs, activeIndex: 1 }))).toBe(true);
    expect(canRun('tab.closeRight', context({ tabs, activeIndex: 1 }))).toBe(true);
    expect(canRun('tab.closeRight', context({ tabs, activeIndex: 2 }))).toBe(false);
    const pinnedOthers = [page({ pinned: true }), page({ pinned: true }), page()];
    expect(canRun('tab.closeOthers', context({ tabs: pinnedOthers, activeIndex: 2 }))).toBe(false);
    expect(canRun('tab.closeRight', context({ tabs: pinnedOthers, activeIndex: 0 }))).toBe(true);
    expect(canRun('tab.closeOthers', context())).toBe(false);
  });

  it('reopens a tab only after one closed, and acts on no tab without an active one', () => {
    expect(canRun('tab.reopen', context())).toBe(false);
    expect(canRun('tab.reopen', context({ canReopen: true }))).toBe(true);
    const none = context({ activeIndex: -1 });
    expect(
      missing(['tab.close', 'tab.duplicate', 'tab.pin', 'tab.mute', 'page.home'], none),
    ).toEqual(['tab.close', 'tab.duplicate', 'tab.pin', 'tab.mute', 'page.home']);
    expect(canRun('tab.closeOthers', context({ tabs: [page(), page()], activeIndex: -1 }))).toBe(
      false,
    );
  });
});
