import type { WebContents } from 'electron';
import {
  DialogQueue,
  type DialogAnswer,
  type WaitingDialog,
} from '../domain/dialogs/dialog-queue.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { waitForAnswer } from '../platform/electron/unload.ts';
import { AnswerDialog, type PageDialog } from '../shared/ipc/overlay-contracts.ts';
import { dialogMessageLimit, dialogValueLimit } from '../shared/page-dialogs.ts';
import { existingOverlay, overlayBySender, overlayOf, questionKeys, track } from './overlays.ts';

/** What the dialogs of pages need from the composition root. */
export interface PageDialogOptions {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
}

/** A dialog that a frame of a page asks. */
export interface DialogRequest {
  readonly type: PageDialog['type'];
  /** The frame, such as its process and its id. */
  readonly frame: string;
  /** The origin of the frame. */
  readonly origin: string;
  /** Whether the frame is embedded in a page of another origin. */
  readonly embedded: boolean;
  readonly message: string;
  /** The text that the field of `prompt()` starts with. */
  readonly value: string;
}

type Dialog = WaitingDialog<WebContents, DialogRequest>;

const queue = new DialogQueue<WebContents, DialogRequest>();
/** The dialog that each overlay shows. */
const shown = new WeakMap<WindowOverlay, Dialog>();
const watchedPages = new WeakSet<WebContents>();
const watchedWindows = new WeakSet<BrowserWindowController>();
const watchedOverlays = new WeakSet<WindowOverlay>();
/** The dialogs whose question showed already. */
const seen = new WeakSet<Dialog>();
/** The windows whose question is to be looked at again, once the current task is done. */
const scheduled = new WeakSet<BrowserWindowController>();
let options: PageDialogOptions | undefined;

/**
 * Asks a dialog of a page over the page of its tab, in the window's overlay, which leaves the
 * tab strip, the window's controls and its shortcuts to people (ADR 0060). A page whose tab
 * does not show never waits for a question that nobody sees, as in Chromium, since that would
 * hold every page of its process: its alert gets OK at once and shows once the tab shows, and
 * its `confirm()` and `prompt()` get Cancel. A question that showed waits while its tab does
 * not show anymore, and while something else shows in the overlay, such as a menu that people
 * opened over it; it never takes the place of one. The page gets Cancel when it starts to load
 * another document, its tab closes or its renderer is gone. A page that is no tab gets Cancel at
 * once.
 * @param dependencies - The windows, the router and what the overlays share.
 * @param contents - The page.
 * @param request - The dialog.
 * @param answer - Gives the page its answer; called once.
 */
export function askPageDialog(
  dependencies: PageDialogOptions,
  contents: WebContents,
  request: DialogRequest,
  answer: DialogAnswer,
): void {
  options ??= connect(dependencies);
  const window = contents.isDestroyed() ? undefined : options.windows.forTab(contents);
  const tab = window?.tabIdOf(contents);
  if (window === undefined || tab === undefined) {
    answer(false, '');
    return;
  }
  const shows = window.tabs.shown.includes(tab);
  if (!shows) {
    answer(request.type === 'alert', '');
    if (request.type !== 'alert') return;
  }
  watchPage(contents);
  // The question shows the start of a long message, and nothing more is kept of it.
  const detail = {
    ...request,
    message: request.message.slice(0, dialogMessageLimit),
    value: request.value.slice(0, dialogValueLimit),
  };
  const asker = { frame: request.frame, origin: request.origin, detail };
  if (queue.add(contents, asker, shows ? answer : undefined)) {
    noteWaiting(contents);
    watchWindow(window);
    refresh(window);
  }
}

/**
 * Tells the code that closes tabs and asks about pages that hang whether a dialog of a page
 * waits: such a page can neither answer whether it may close nor respond.
 */
function noteWaiting(contents: WebContents): void {
  if (!contents.isDestroyed()) waitForAnswer(contents, queue.waits(contents));
}

/** Connects the answers of the overlay's page to the dialogs. */
function connect(dependencies: PageDialogOptions): PageDialogOptions {
  dependencies.router.handle(AnswerDialog, ({ id, ok, value, stop }, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const dialog = overlay === undefined ? undefined : shown.get(overlay);
    // An answer counts only for the dialog that the overlay shows, not for the one after it.
    if (overlay?.content?.kind === 'dialog' && dialog?.id === id) {
      shown.delete(overlay);
      queue.answer(dialog.page, id, ok, value, stop);
      noteWaiting(dialog.page);
      overlay.close();
    }
    return null;
  });
  return dependencies;
}

/**
 * The page whose dialog the window shows: that of the active tab, or else that of the other
 * side of its split view.
 */
function askingPage(window: BrowserWindowController): WebContents | undefined {
  const active = window.activeTabContents;
  if (active !== undefined && queue.asks(active)) return active;
  for (const id of window.tabs.shown) {
    const contents = window.webContentsOf(id);
    if (contents !== undefined && queue.asks(contents)) return contents;
  }
  return undefined;
}

/**
 * Shows the dialog that a window is to show, or closes one that no longer waits. A question
 * waits while the overlay shows something else.
 */
function refresh(window: BrowserWindowController): void {
  if (options === undefined || window.window.isDestroyed()) return;
  const contents = askingPage(window);
  const dialog = contents === undefined ? undefined : queue.first(contents);
  // A window without a dialog to show needs no overlay of its own for it.
  const overlay =
    dialog === undefined
      ? existingOverlay(window)
      : overlayOf(window, options.overlay, options.router);
  if (overlay === undefined) return;
  const open = overlay.content?.kind === 'dialog' ? shown.get(overlay) : undefined;
  if (open !== undefined && open.id === dialog?.id) return;
  if (contents === undefined || dialog === undefined) {
    if (open !== undefined) overlay.close();
    return;
  }
  if (overlay.content !== null && open === undefined) return;
  watchOverlay(window, overlay);
  overlay.open(contentOf(dialog), {
    // Over the page alone, which follows it as the window changes; the tab strip, the window's
    // controls and the shortcuts stay with people.
    sheet: () => window.paneOf(contents) ?? window.pageArea(),
    // A question that shows again, after its tab showed again or a menu over it closed, takes the
    // focus only when its page has it, and leaves it where people work, such as in the other side
    // of a split view.
    focus: !seen.has(dialog) || contents.isFocused(),
    // The overlay's page answers Escape with Cancel.
    keys: { ...questionKeys, escape: 'page' },
    // Closed without an answer, such as by another tab or a menu: the dialog waits.
    onClose: () => {
      if (shown.get(overlay) === dialog) shown.delete(overlay);
    },
  });
  shown.set(overlay, dialog);
  seen.add(dialog);
  track(window, overlay);
}

/** Looks at the dialogs of a window again once the current task is done. */
function schedule(window: BrowserWindowController): void {
  if (scheduled.has(window)) return;
  scheduled.add(window);
  setTimeout(() => {
    scheduled.delete(window);
    refresh(window);
  }, 0);
}

/** Looks at the dialogs of every window again, such as after a page that asked has gone. */
function scheduleAll(): void {
  for (const window of options?.windows.all ?? []) schedule(window);
}

/** What the overlay shows of a dialog. */
function contentOf(dialog: Dialog): PageDialog {
  const request = dialog.detail;
  return {
    kind: 'dialog',
    id: dialog.id,
    type: request.type,
    site: hostOf(request.origin),
    embedded: request.embedded,
    message: request.message,
    value: request.value,
    stop: dialog.offersStop,
  };
}

/**
 * The host of an origin with its port, as the question names a site, or nothing for a page
 * without one, such as a file.
 */
function hostOf(origin: string): string {
  try {
    const url = new URL(origin);
    return /^https?:$/.test(url.protocol) ? url.host.slice(0, 300) : '';
  } catch {
    return '';
  }
}

/** Ends the dialogs of a page when it loads another document, closes or crashes. */
function watchPage(contents: WebContents): void {
  if (watchedPages.has(contents)) return;
  watchedPages.add(contents);
  const cancel = (): void => {
    if (!queue.cancel(contents)) return;
    noteWaiting(contents);
    scheduleAll();
  };
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) cancel();
  });
  // A dialog that came while the navigation ran belongs to the document that has gone now.
  contents.on('did-navigate', () => {
    if (!queue.newDocument(contents)) return;
    noteWaiting(contents);
    scheduleAll();
  });
  contents.on('render-process-gone', cancel);
  contents.once('destroyed', cancel);
}

/** Shows the dialog of a tab once the tab shows. */
function watchWindow(window: BrowserWindowController): void {
  if (watchedWindows.has(window)) return;
  watchedWindows.add(window);
  const listener = window.tabs.onDidChange(() => schedule(window));
  window.window.once('closed', () => listener.dispose());
}

/** Shows a dialog again once what took its place in the overlay has closed. */
function watchOverlay(window: BrowserWindowController, overlay: WindowOverlay): void {
  if (watchedOverlays.has(overlay)) return;
  watchedOverlays.add(overlay);
  overlay.onDidClose(() => schedule(window));
}
