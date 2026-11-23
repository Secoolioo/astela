import type { Blocking } from '../domain/blocker/blocking.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import type { OverlayAnchor, PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import { OpenBlockerSettings, type OverlayContent } from '../shared/ipc/overlay-contracts.ts';
import { ContentBlockerSetting } from './core-settings.ts';
import {
  existingOverlay,
  focusBackOf,
  overlayBySender,
  overlayOf,
  rectOf,
  track,
  windowOfOverlay,
} from './overlays.ts';
import { blockerStateOf, connectBlockerSwitch } from './site-blocking.ts';

/** What the content blocker's popover needs from the browser process. */
export interface ShieldPopoverDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  readonly settings: SettingsService;
  readonly blocker: ContentBlocker;
  /** Whether the content blocker works on a page. */
  readonly blocking: (url: string) => Blocking;
}

let dependencies: ShieldPopoverDependencies | undefined;

/**
 * Opens the content blocker's popover of a window's active tab at the shield button. The
 * first call connects the overlay's channels.
 * A question of a site may take its place.
 * @param window - The window whose shield was clicked.
 * @param anchor - Where the button is, in the window, and whether the keyboard opened it.
 * @param deps - What the popover needs.
 */
export function openShieldPopover(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  deps: ShieldPopoverDependencies,
): void {
  const overlay = overlayOf(window, deps.overlay, deps.router);
  if (dependencies === undefined) connect(deps);
  const content = shieldOf(deps, window, rectOf(anchor));
  if (content === undefined) return;
  overlay.open(content, {
    popover: { kind: 'shield', folder: null },
    focusBack: focusBackOf(window, anchor),
    yieldsToQuestions: true,
  });
  track(window, overlay);
}

function connect(deps: ShieldPopoverDependencies): void {
  dependencies = deps;
  const { router, windows } = deps;
  const windowOf = (overlay: WindowOverlay): BrowserWindowController | undefined =>
    windowOfOverlay(windows.all, overlay);
  // The switch for the site acts for the active tab, whose state the popover shows; a refused
  // change sends the popover again, so that its switch goes back.
  connectBlockerSwitch('shield', deps, { allows: () => true, refresh });
  router.handle(OpenBlockerSettings, (_request, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOf(overlay);
    overlay?.close();
    window?.openPage('settings', `#${ContentBlockerSetting.key}`);
    return null;
  });
  // The popover counts along while the page loads, at most every 50 ms.
  let timer: ReturnType<typeof setTimeout> | undefined;
  windows.onDidChange(() => {
    timer ??= setTimeout(() => {
      timer = undefined;
      for (const window of windows.all) {
        const overlay = existingOverlay(window);
        if (overlay?.content?.kind === 'shield') refresh(window, overlay);
      }
    }, 50);
  });
}

/**
 * The popover for a window's active tab, or `undefined` when the blocker does not touch the
 * tab's page.
 */
function shieldOf(
  deps: ShieldPopoverDependencies,
  window: BrowserWindowController,
  anchor: OverlayAnchor,
): OverlayContent | undefined {
  const tab = window.tabs.active;
  const state = tab === undefined ? undefined : blockerStateOf(deps, tab);
  return state === undefined ? undefined : { kind: 'shield', anchor, ...state };
}

/**
 * Shows the current state of the active tab in an open popover, or closes it.
 * @param again - Sends the state also when it did not change, as after a refused change.
 */
function refresh(window: BrowserWindowController, overlay: WindowOverlay, again = false): void {
  const shown = overlay.content;
  if (shown?.kind !== 'shield' || dependencies === undefined) return;
  const next = shieldOf(dependencies, window, shown.anchor);
  if (next === undefined) overlay.close();
  else if (again || JSON.stringify(next) !== JSON.stringify(shown)) overlay.update(next);
}
