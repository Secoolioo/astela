import { windowCommands, type WindowCommand } from '../../shared/shortcuts.ts';

/** A tab of a window, as far as the commands that can run depend on it. */
export interface CommandTab {
  readonly url: string;
  readonly pinned: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly muted: boolean;
}

/** What decides which commands can run in a window now. */
export interface CommandContext {
  /** The tabs of the window, in the order of the tab strip. */
  readonly tabs: readonly CommandTab[];
  /** The place of the active tab among the tabs, or -1 without one. */
  readonly activeIndex: number;
  /** Whether a closed tab can be opened again. */
  readonly canReopen: boolean;
  /** Whether the find bar is open. */
  readonly finding: boolean;
  /** Whether the active tab shows a web page, which the page tools work on. */
  readonly webPage: boolean;
  /** Whether people may open private windows, which a policy can forbid. */
  readonly privateWindows: boolean;
  /** Whether people may open the developer tools, which a policy can forbid. */
  readonly developerTools: boolean;
}

/**
 * The commands that can run in a window now, in the order of the catalog, such as for the
 * items of a menu that are enabled.
 * @param context - The state of the window.
 */
export function availableCommands(context: CommandContext): WindowCommand[] {
  return windowCommands.filter((command) => canRun(command, context));
}

/**
 * Whether a command can run in a window now: Back needs a page to go back to, the page tools
 * need a web page, and moving a tab needs a place to move it to, among others.
 * @param command - The command.
 * @param context - The state of the window.
 */
export function canRun(command: WindowCommand, context: CommandContext): boolean {
  const { tabs, activeIndex } = context;
  const active = tabs[activeIndex];
  switch (command) {
    case 'tab.new':
    case 'window.new':
    case 'omnibox.focus':
    case 'window.fullscreen':
    case 'bookmarks.open':
    case 'bookmarks.toggleBar':
    case 'history.open':
    case 'downloads.open':
    case 'settings.open':
    case 'app.about':
    case 'app.quit':
      return true;
    case 'window.newPrivate':
      return context.privateWindows;
    case 'tab.reopen':
      return context.canReopen;
    case 'tab.close':
    case 'tab.duplicate':
    case 'tab.pin':
    case 'tab.mute':
    case 'page.reload':
    case 'page.home':
      return active !== undefined;
    case 'tab.closeOthers':
    case 'tab.closeRight':
      // Pinned tabs stay; they are closed one by one.
      return (
        active !== undefined &&
        tabs.some(
          (tab, place) =>
            !tab.pinned &&
            (command === 'tab.closeOthers' ? place !== activeIndex : place > activeIndex),
        )
      );
    case 'tab.next':
    case 'tab.previous':
    case 'tab.selectLast':
      return tabs.length >= 2;
    case 'tab.select1':
    case 'tab.select2':
    case 'tab.select3':
    case 'tab.select4':
    case 'tab.select5':
    case 'tab.select6':
    case 'tab.select7':
    case 'tab.select8':
      return tabs.length >= Number(command.slice(-1));
    case 'tab.moveLeft':
    case 'tab.moveRight': {
      if (active === undefined) return false;
      // Pinned tabs stay among the pinned tabs, the others after them.
      const pinned = tabs.filter((tab) => tab.pinned).length;
      const [first, last] = active.pinned ? [0, pinned - 1] : [pinned, tabs.length - 1];
      return command === 'tab.moveLeft' ? activeIndex > first : activeIndex < last;
    }
    case 'page.back':
      return active?.canGoBack === true;
    case 'page.forward':
      return active?.canGoForward === true;
    case 'bookmark.toggle':
      // Only web pages get bookmarks; the browser's own pages have their own commands.
      return active !== undefined && /^https?:/i.test(active.url);
    case 'page.reloadHard':
    case 'page.print':
    case 'page.save':
    case 'page.source':
    case 'zoom.in':
    case 'zoom.out':
    case 'zoom.reset':
    case 'find.open':
      return context.webPage;
    case 'find.next':
    case 'find.previous':
      return context.webPage && context.finding;
    case 'devtools.toggle':
      return context.webPage && context.developerTools;
    default:
      // Every command has its case above, which the lint checks.
      return true;
  }
}
