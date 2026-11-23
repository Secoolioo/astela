import type { PictureInPictureState, ReaderState } from '../../shared/page-tools.ts';
import { windowCommands, type WindowCommand } from '../../shared/shortcuts.ts';

/** A tab of a window, as far as the commands that can run depend on it. */
export interface CommandTab {
  readonly url: string;
  readonly pinned: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly muted: boolean;
  /** Which side of a split view the tab is, or `null` for a tab that is in none. */
  readonly split: 'start' | 'end' | null;
  /**
   * The group of the tab, and whether it hides its tabs, or `null` for a tab in none. The
   * commands that go to a tab skip the tabs that a group hides.
   */
  readonly group: { readonly collapsed: boolean } | null;
  /** Whether the page has an article for the reader view, and whether it shows. */
  readonly reader: ReaderState;
  /** Whether a video of the page plays, which picture in picture can show, or shows in it. */
  readonly pictureInPicture: PictureInPictureState;
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
  /** Whether the command palette is on, which a setting or a policy can turn off. */
  readonly palette: boolean;
  /** Whether split view is on, which a setting or a policy can turn off. */
  readonly splitView: boolean;
  /** Whether the reader view is on, which a setting or a policy can turn off. */
  readonly reader: boolean;
  /** Whether picture in picture is on, which a setting or a policy can turn off. */
  readonly pictureInPicture: boolean;
  /**
   * How many workspaces the window can show, or 0 without workspaces: in private windows, in
   * popups and while a setting or a policy turns them off.
   */
  readonly workspaces: number;
  /**
   * Whether turning the hiding of the tabs and the toolbar on or off changes them: the tab strip
   * is at the top, and no mandatory policy sets it.
   */
  readonly autoHide: boolean;
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
  // The commands that go to the next tab, or to a tab by its place, count the tabs that the
  // strip lists: all but those of collapsed groups, which never hold the active tab.
  const listed = tabs.filter((tab) => tab.group?.collapsed !== true).length;
  // The active tab moves with the other tab of its split view, and the tabs to its right
  // start after the pair.
  const [first, last] =
    active?.split === 'start'
      ? [activeIndex, activeIndex + 1]
      : active?.split === 'end'
        ? [activeIndex - 1, activeIndex]
        : [activeIndex, activeIndex];
  switch (command) {
    case 'tab.new':
    case 'window.new':
    case 'window.close':
    case 'omnibox.focus':
    case 'focus.nextPane':
    case 'focus.previousPane':
    case 'menu.open':
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
    case 'toolbar.toggleAutoHide':
      return context.autoHide;
    case 'palette.open':
    case 'tabs.search':
      return context.palette;
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
      // Pinned tabs stay; they are closed one by one. The other tab of a split view stays too.
      return (
        active !== undefined &&
        tabs.some(
          (tab, place) =>
            !tab.pinned &&
            (command === 'tab.closeOthers' ? place < first || place > last : place > last),
        )
      );
    case 'tab.next':
    case 'tab.previous':
    case 'tab.selectLast':
      return listed >= 2;
    case 'tab.select1':
    case 'tab.select2':
    case 'tab.select3':
    case 'tab.select4':
    case 'tab.select5':
    case 'tab.select6':
    case 'tab.select7':
    case 'tab.select8':
      return listed >= Number(command.slice(-1));
    case 'tab.moveLeft':
    case 'tab.moveRight': {
      if (active === undefined) return false;
      // A tab of a group that shows its tabs moves within the group, or first leaves it at
      // its edge, also at an end of the strip.
      if (!active.pinned && active.group?.collapsed === false) return true;
      // Pinned tabs stay among the pinned tabs, the others after them.
      const pinned = tabs.filter((tab) => tab.pinned).length;
      const [low, high] = active.pinned ? [0, pinned - 1] : [pinned, tabs.length - 1];
      return command === 'tab.moveLeft' ? first > low : last < high;
    }
    case 'split.toggle':
      // A pinned tab is never a side of a split view.
      return context.splitView && active !== undefined && (active.split !== null || !active.pinned);
    case 'split.swap':
      return context.splitView && active !== undefined && active.split !== null;
    case 'tab.newGroup':
      // Pinned tabs are never in a group.
      return active !== undefined && !active.pinned;
    case 'reader.toggle':
      // The reader view opens on web pages with an article, and closes where it shows.
      return (
        context.reader &&
        active !== undefined &&
        active.reader !== 'none' &&
        /^https?:/i.test(active.url)
      );
    case 'media.pictureInPicture':
      // Picture in picture shows a video of a web page that plays, and ends where it shows.
      return (
        context.pictureInPicture &&
        active !== undefined &&
        active.pictureInPicture !== 'none' &&
        /^https?:/i.test(active.url)
      );
    case 'workspace.select1':
    case 'workspace.select2':
    case 'workspace.select3':
    case 'workspace.select4':
    case 'workspace.select5':
    case 'workspace.select6':
    case 'workspace.select7':
    case 'workspace.select8':
    case 'workspace.select9':
      return context.workspaces >= Number(command.slice(-1));
    case 'workspace.next':
    case 'workspace.previous':
      return context.workspaces >= 2;
    case 'workspace.open':
      return context.workspaces >= 1;
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
    case 'page.savePdf':
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
