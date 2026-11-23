import type { WebContents } from 'electron';
import { BlockedPopups } from '../domain/navigation/blocked-popups.ts';
import { originOf } from '../domain/permissions/site-permissions.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { openForPopup } from '../platform/electron/popup-windows.ts';
import type { OverlayAnchor, PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  AllowPopups,
  blockedPopupLength,
  blockedPopupLimit,
  OpenBlockedPopup,
  type OverlayContent,
} from '../shared/ipc/overlay-contracts.ts';
import {
  existingOverlay,
  focusBackOf,
  overlayBySender,
  overlayOf,
  rectOf,
  track,
  windowOfOverlay,
} from './overlays.ts';

/** What the pop-up blocker needs from the code for web pages. */
export interface PopupBlockerOptions {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  /** Whether people allowed the site of a page to open pop-ups without a click, in its session. */
  readonly allows: (contents: WebContents) => boolean;
  /** Lets the site of a page open pop-ups without a click from now on, in its session. */
  readonly allow: (contents: WebContents) => void;
}

/** The pop-up blocker of the web pages. */
export interface PopupBlocker {
  /**
   * Decides about a window that a page opened without a click: it does not open, unless people
   * allowed the page's site to open pop-ups. The tab of the page lists it until the page goes to
   * another document, and its popover can open it in a tab.
   * @param url - The address of the window.
   * @param opener - The page whose script, or one of whose frames, opened it.
   * @returns Whether it was blocked.
   */
  block(url: string, opener: WebContents): boolean;
}

/** The pop-up blocker, once the code for web pages made it. */
let current:
  | {
      readonly options: PopupBlockerOptions;
      readonly blocked: WeakMap<WebContents, BlockedPopups>;
    }
  | undefined;

/**
 * Makes the pop-up blocker of the web pages. A page may open a window only within five seconds
 * of an input that a person gave it, which the window uses up (`popup-activation.ts`); the code
 * for web pages asks this blocker about the others. The first call connects the channels of its
 * popover.
 * @param options - The windows, the overlay and the permissions of the sites.
 */
export function popupBlocker(options: PopupBlockerOptions): PopupBlocker {
  const blocked = new WeakMap<WebContents, BlockedPopups>();
  current = { options, blocked };
  connect(options);
  return {
    block(url, opener) {
      if (options.allows(opener)) return false;
      let list = blocked.get(opener);
      if (list === undefined) {
        const made = new BlockedPopups(blockedPopupLimit, blockedPopupLength);
        list = made;
        blocked.set(opener, made);
        // The list belongs to one document, as the count of the tab does.
        opener.on('did-start-navigation', (details) => {
          if (details.isMainFrame && !details.isSameDocument && made.clear()) {
            show(options.windows, opener, made);
          }
        });
      }
      list.add(url);
      show(options.windows, opener, list);
      return true;
    },
  };
}

/**
 * Opens the popover of the pop-up blocker for the active tab of a window at its chip, which
 * lists the pop-ups that the tab's page opened without a click.
 * @param window - The window whose chip was clicked.
 * @param anchor - Where the chip is, in the window, and whether the keyboard opened it.
 */
export function openPopupsPopover(window: BrowserWindowController, anchor: PopoverAnchor): void {
  if (current === undefined) return;
  const content = popoverOf(window, rectOf(anchor));
  if (content === undefined) return;
  const overlay = overlayOf(window, current.options.overlay, current.options.router);
  overlay.open(content, {
    popover: { kind: 'popups', folder: null },
    focusBack: focusBackOf(window, anchor),
    yieldsToQuestions: true,
  });
  track(window, overlay);
}

/** Answers the buttons of the popover. */
function connect(options: PopupBlockerOptions): void {
  const { router, windows } = options;
  const popoverOfSender = (
    sender: WebContents,
  ): { window: BrowserWindowController; overlay: WindowOverlay } | undefined => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOfOverlay(windows.all, overlay);
    return window === undefined || overlay?.content?.kind !== 'popups'
      ? undefined
      : { window, overlay };
  };
  router.handle(OpenBlockedPopup, ({ url }, { sender }) => {
    const shown = popoverOfSender(sender);
    const contents = shown?.window.activeTabContents;
    const list = contents === undefined ? undefined : current?.blocked.get(contents);
    // What opens is no longer blocked: it leaves the list, and the tab counts one less.
    if (shown === undefined || contents === undefined || list?.open(url) !== true) return null;
    show(windows, contents, list);
    const { window } = shown;
    const id = window.tabIdOf(contents);
    // A popup shows only its page: the tab opens in a regular window.
    if (window.popup) openForPopup(window, url, true);
    else window.tabs.open(url, id === undefined ? {} : { after: id, opener: id });
    return null;
  });
  router.handle(AllowPopups, (_request, { sender }) => {
    const shown = popoverOfSender(sender);
    const contents = shown?.window.activeTabContents;
    if (shown === undefined || contents === undefined) return null;
    options.allow(contents);
    refresh(shown.window, shown.overlay);
    return null;
  });
}

/**
 * Tells the tab of a page how many pop-ups it blocked, and shows the change in its popover.
 * @param windows - The windows.
 * @param contents - The page.
 * @param list - Its blocked pop-ups.
 */
function show(windows: WindowManager, contents: WebContents, list: BlockedPopups): void {
  const window = windows.forTab(contents);
  const id = window?.tabIdOf(contents);
  if (window === undefined || id === undefined) return;
  window.tabs.update(id, { popups: list.count });
  const overlay = existingOverlay(window);
  if (overlay?.content?.kind === 'popups' && window.activeTabContents === contents) {
    refresh(window, overlay);
  }
}

/** Shows the pop-ups of the active tab in its open popover, or closes it once there are none. */
function refresh(window: BrowserWindowController, overlay: WindowOverlay): void {
  const shown = overlay.content;
  if (shown?.kind !== 'popups') return;
  const next = popoverOf(window, shown.anchor);
  if (next === undefined) overlay.close();
  else if (JSON.stringify(next) !== JSON.stringify(shown)) overlay.update(next);
}

/**
 * The popover for the active tab of a window, or `undefined` while its page blocked no pop-up.
 * It lists no address that is too long for its list, but still lets people allow the site.
 * @param window - The window.
 * @param anchor - Where the chip is.
 */
function popoverOf(
  window: BrowserWindowController,
  anchor: OverlayAnchor,
): OverlayContent | undefined {
  const contents = window.activeTabContents;
  const list = contents === undefined ? undefined : current?.blocked.get(contents);
  const origin = originOf(contents?.getURL() ?? '');
  if (current === undefined || contents === undefined || origin === undefined) return undefined;
  if (list === undefined || list.count === 0) return undefined;
  return {
    kind: 'popups',
    anchor,
    site: new URL(origin).host.slice(0, 300),
    popups: [...list.urls],
    allowed: current.options.allows(contents),
  };
}
