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
  split: null,
  group: null,
  reader: 'none',
  pictureInPicture: 'none',
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
  palette: true,
  splitView: true,
  reader: true,
  pictureInPicture: true,
  workspaces: 1,
  autoHide: true,
  ...change,
});

/** Which of the two moves of the active tab can run, `-` for one that cannot. */
const movesOf = (tabs: readonly CommandTab[], activeIndex: number): string =>
  (['tab.moveLeft', 'tab.moveRight'] as const)
    .map((command) => (canRun(command, context({ tabs, activeIndex })) ? command : '-'))
    .join(' ');

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

  it('shows and ends the reader view on pages with an article, while the reader view is on', () => {
    expect(canRun('reader.toggle', context())).toBe(false);
    expect(canRun('reader.toggle', context({ tabs: [page({ reader: 'available' })] }))).toBe(true);
    expect(canRun('reader.toggle', context({ tabs: [page({ reader: 'open' })] }))).toBe(true);
    expect(
      canRun('reader.toggle', context({ tabs: [page({ reader: 'available' })], reader: false })),
    ).toBe(false);
    expect(canRun('reader.toggle', context({ tabs: [], activeIndex: -1 }))).toBe(false);
    // The browser's own pages have no reader view, whatever their tab still says.
    expect(
      canRun(
        'reader.toggle',
        context({ tabs: [page({ url: 'app://newtab/', reader: 'available' })] }),
      ),
    ).toBe(false);
  });

  it('shows a video of a web page that plays in picture in picture, and ends it, while it is on', () => {
    expect(canRun('media.pictureInPicture', context())).toBe(false);
    for (const state of ['available', 'open'] as const) {
      expect(
        canRun('media.pictureInPicture', context({ tabs: [page({ pictureInPicture: state })] })),
      ).toBe(true);
    }
    expect(
      canRun(
        'media.pictureInPicture',
        context({ tabs: [page({ pictureInPicture: 'available' })], pictureInPicture: false }),
      ),
    ).toBe(false);
    expect(canRun('media.pictureInPicture', context({ tabs: [], activeIndex: -1 }))).toBe(false);
    // The browser's own pages show no video in it, whatever their tab still says.
    expect(
      canRun(
        'media.pictureInPicture',
        context({ tabs: [page({ url: 'app://newtab/', pictureInPicture: 'open' })] }),
      ),
    ).toBe(false);
  });

  it('turns hiding the toolbar on and off only with the tabs at the top, and no policy', () => {
    expect(canRun('toolbar.toggleAutoHide', context())).toBe(true);
    // The tabs at a side or at the bottom keep the toolbar showing, as does a mandatory policy.
    expect(canRun('toolbar.toggleAutoHide', context({ autoHide: false }))).toBe(false);
    // On the browser's own pages too, as it changes the window and no page.
    expect(
      canRun('toolbar.toggleAutoHide', context({ tabs: [page({ url: 'app://settings/' })] })),
    ).toBe(true);
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

  it('chooses tabs by their place and goes to the next one among the tabs that groups do not hide', () => {
    const hidden = { collapsed: true };
    // The active tab and a collapsed group of three tabs: only the active tab is listed.
    const one = context({
      tabs: [page(), page({ group: hidden }), page({ group: hidden }), page({ group: hidden })],
    });
    expect(canRun('tab.select1', one)).toBe(true);
    expect(
      missing(['tab.select2', 'tab.select4', 'tab.selectLast', 'tab.next', 'tab.previous'], one),
    ).toEqual(['tab.select2', 'tab.select4', 'tab.selectLast', 'tab.next', 'tab.previous']);
    // A group that shows its tabs counts them.
    const shown = { collapsed: false };
    const two = context({
      tabs: [page(), page({ group: hidden }), page({ group: shown }), page({ group: hidden })],
    });
    expect(missing(['tab.select2', 'tab.selectLast', 'tab.next', 'tab.previous'], two)).toEqual([]);
    expect(canRun('tab.select3', two)).toBe(false);
  });

  it('moves a tab of a group out of it at the ends of the strip, and passes collapsed groups', () => {
    const shown = { collapsed: false };
    const hidden = { collapsed: true };
    // A grouped tab at an end of the strip first leaves its group there.
    const grouped = [
      page({ pinned: true }),
      page({ group: shown }),
      page(),
      page({ group: shown }),
    ];
    expect(movesOf(grouped, 1)).toBe('tab.moveLeft tab.moveRight');
    expect(movesOf(grouped, 3)).toBe('tab.moveLeft tab.moveRight');
    // Both tabs of a split view in a group, at the end.
    const pair = [
      page(),
      page({ split: 'start', group: shown }),
      page({ split: 'end', group: shown }),
    ];
    expect(movesOf(pair, 2)).toBe('tab.moveLeft tab.moveRight');
    // A tab outside groups moves past a collapsed group, and stops at the ends as before.
    const past = [page({ group: hidden }), page({ group: hidden }), page()];
    expect(movesOf(past, 2)).toBe('tab.moveLeft -');
    // A pinned tab stays among the pinned tabs, whatever its group says.
    expect(movesOf([page({ pinned: true, group: shown }), page({ group: shown })], 0)).toBe('- -');
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

  it('opens or ends split view on a tab that is not pinned, swaps sides only in one, and nothing while it is off', () => {
    const tabs = [page({ pinned: true }), page({ split: 'start' }), page({ split: 'end' }), page()];
    const split = (activeIndex: number, splitView = true): string =>
      (['split.toggle', 'split.swap'] as const)
        .map((command) =>
          canRun(command, context({ tabs, activeIndex, splitView })) ? command : '-',
        )
        .join(' ');
    expect(split(0)).toBe('- -');
    expect(split(1)).toBe('split.toggle split.swap');
    expect(split(2)).toBe('split.toggle split.swap');
    expect(split(3)).toBe('split.toggle -');
    expect(split(-1)).toBe('- -');
    expect(split(2, false)).toBe('- -');
    expect(split(3, false)).toBe('- -');
  });

  it('chooses workspaces that the profile has, and starts a group on a tab that is not pinned', () => {
    const able = (workspaces: number): WindowCommand[] =>
      windowCommands.filter(
        (command) => command.startsWith('workspace.') && canRun(command, context({ workspaces })),
      );
    // A private window, a popup and a window while workspaces are off count none.
    expect(able(0)).toEqual([]);
    expect(able(1)).toEqual(['workspace.select1', 'workspace.open']);
    expect(able(3)).toEqual([
      'workspace.select1',
      'workspace.select2',
      'workspace.select3',
      'workspace.next',
      'workspace.previous',
      'workspace.open',
    ]);
    expect(able(20)).toHaveLength(12);
    const tabs = [page({ pinned: true }), page()];
    expect(canRun('tab.newGroup', context({ tabs, activeIndex: 1 }))).toBe(true);
    expect(canRun('tab.newGroup', context({ tabs, activeIndex: 0 }))).toBe(false);
    expect(canRun('tab.newGroup', context({ tabs, activeIndex: -1 }))).toBe(false);
  });

  it('moves and closes around the two tabs of a split view as one', () => {
    const tabs = [page(), page({ split: 'start' }), page({ split: 'end' })];
    const able = (command: WindowCommand, activeIndex: number): boolean =>
      canRun(command, context({ tabs, activeIndex }));
    // The pair is at the end: it moves only to the left, and has no tabs to its right.
    expect([able('tab.moveLeft', 2), able('tab.moveRight', 1)]).toEqual([true, false]);
    expect([able('tab.closeRight', 1), able('tab.closeOthers', 2)]).toEqual([false, true]);
    const pair = [page({ split: 'start' }), page({ split: 'end' })];
    expect(canRun('tab.closeOthers', context({ tabs: pair, activeIndex: 0 }))).toBe(false);
    expect(canRun('tab.moveLeft', context({ tabs: pair, activeIndex: 1 }))).toBe(false);
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
