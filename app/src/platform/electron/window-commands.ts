import type { LaterWindowCommand, WindowCommands, WindowHost } from './browser-window.ts';
import { ShellCommand } from '../../shared/ipc/shell-contracts.ts';

/**
 * The commands of the windows that load later: those of the tabs, the pages and the browser
 * itself. The window runs the commands that move the focus at once, so that the keys typed
 * right after them follow the focus; this code loads with the first other command, or once the
 * shell of the first window has loaded. A command that comes while it loads waits for it, in
 * its order.
 */
export const windowCommands: WindowCommands = { run };

/**
 * Runs a window command that does not move the focus at once.
 * @param host - The window.
 * @param command - The command.
 */
function run(host: WindowHost, command: LaterWindowCommand): void {
  const { window, options } = host;
  const active = window.tabs.active;
  // The shortcuts that go to the next tab, or to a tab by its place, count the listed tabs.
  const listed = window.tabs.listed;
  const index = active === undefined ? -1 : listed.indexOf(active);
  switch (command) {
    case 'tab.close':
      if (active !== undefined) window.tabs.close(active.id);
      break;
    case 'tab.reopen':
      window.tabs.reopenClosed();
      break;
    case 'tab.duplicate':
      if (active !== undefined) window.tabAction(active.id, 'duplicate');
      break;
    case 'tab.closeOthers':
      if (active !== undefined) window.tabAction(active.id, 'closeOthers');
      break;
    case 'tab.closeRight':
      if (active !== undefined) window.tabAction(active.id, 'closeRight');
      break;
    case 'tab.next':
    case 'tab.previous': {
      const step = command === 'tab.next' ? 1 : -1;
      const next = listed[(index + step + listed.length) % listed.length];
      if (next !== undefined) window.tabs.activate(next.id);
      break;
    }
    case 'tab.select1':
    case 'tab.select2':
    case 'tab.select3':
    case 'tab.select4':
    case 'tab.select5':
    case 'tab.select6':
    case 'tab.select7':
    case 'tab.select8':
    case 'tab.selectLast': {
      const target =
        command === 'tab.selectLast' ? listed.at(-1) : listed[Number(command.slice(-1)) - 1];
      if (target !== undefined) window.tabs.activate(target.id);
      break;
    }
    case 'tab.moveLeft':
    case 'tab.moveRight':
      if (active !== undefined) window.tabs.step(active.id, command === 'tab.moveRight' ? 1 : -1);
      break;
    case 'tab.pin':
      if (active !== undefined) window.tabs.pin(active.id, !active.pinned);
      break;
    case 'tab.mute':
      if (active !== undefined) window.setMuted(active.id, !active.muted);
      break;
    case 'page.reload':
    case 'page.back':
    case 'page.forward':
      if (active !== undefined) {
        const action =
          command === 'page.reload' ? 'reload' : command === 'page.back' ? 'back' : 'forward';
        window.tabs.run(active.id, action);
      }
      break;
    case 'page.home':
      if (active !== undefined) window.goHome(active.id);
      break;
    case 'settings.open':
      window.openPage('settings');
      break;
    case 'history.open':
      window.openPage('history');
      break;
    case 'bookmarks.open':
      window.openPage('bookmarks');
      break;
    case 'bookmarks.toggleBar':
      options.toggleBookmarksBar?.();
      break;
    case 'downloads.open':
      options.showDownloads?.(window);
      break;
    case 'window.new':
      options.openWindow?.();
      break;
    case 'window.newPrivate':
      options.openPrivateWindow?.();
      break;
    case 'bookmark.toggle':
      // Only web pages get bookmarks; the browser's own pages have their own commands. The
      // shell opens the popover of the star at the star, or at the menu button without it.
      if (active !== undefined && /^https?:/i.test(active.url)) {
        options.router.publish(ShellCommand, window.shell.webContents, 'bookmark.edit');
      }
      break;
    case 'zoom.in':
    case 'zoom.out':
    case 'zoom.reset':
      if (active !== undefined) {
        window.zoom(active.id, command === 'zoom.in' ? 1 : command === 'zoom.out' ? -1 : 0);
      }
      break;
    case 'page.reloadHard':
    case 'page.print':
    case 'page.save':
    case 'page.source':
    case 'devtools.toggle': {
      // These work on web pages; the browser's own pages keep them to themselves.
      const contents = active === undefined ? undefined : host.webContentsOf(active.id);
      if (contents === undefined) break;
      if (command === 'page.reloadHard') contents.reloadIgnoringCache();
      else options.onPageCommand?.(window, command, contents);
      break;
    }
    case 'app.about':
    case 'app.quit':
      options.onAppCommand?.(window, command);
      break;
  }
}
