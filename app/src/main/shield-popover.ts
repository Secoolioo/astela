import { exceptionFor, siteOf, toggleSite, type Blocking } from '../domain/blocker/blocking.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import type { OverlayAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  OpenBlockerSettings,
  ToggleSiteBlocking,
  type OverlayContent,
} from '../shared/ipc/overlay-contracts.ts';
import { BlockerAllowedSitesSetting, ContentBlockerSetting } from './core-settings.ts';
import { existingOverlay, overlayBySender, overlayOf, track, windowOfOverlay } from './overlays.ts';

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
 * @param window - The window whose shield was clicked.
 * @param anchor - Where the button is, in the window.
 * @param deps - What the popover needs.
 */
export function openShieldPopover(
  window: BrowserWindowController,
  anchor: OverlayAnchor,
  deps: ShieldPopoverDependencies,
): void {
  const overlay = overlayOf(window, deps.overlay, deps.router);
  if (dependencies === undefined) connect(deps);
  const content = shieldOf(deps, window, anchor);
  if (content === undefined) return;
  overlay.open(content);
  track(window, overlay);
}

function connect(deps: ShieldPopoverDependencies): void {
  dependencies = deps;
  const { router, windows } = deps;
  const windowOf = (overlay: WindowOverlay): BrowserWindowController | undefined =>
    windowOfOverlay(windows.all, overlay);
  router.handle(ToggleSiteBlocking, (_request, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOf(overlay);
    if (window !== undefined && overlay?.content?.kind === 'shield') {
      toggle(deps, window);
      refresh(window, overlay);
    }
    return null;
  });
  router.handle(OpenBlockerSettings, (_request, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOf(overlay);
    overlay?.close();
    window?.execute('settings.open');
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
  const site = siteOf(tab?.url ?? '');
  if (tab === undefined || site === undefined) return undefined;
  // An exception covers the whole registrable domain, such as example.co.uk.
  const domain = deps.blocker.domainOf(tab.url) ?? site;
  return {
    kind: 'shield',
    anchor,
    site: exceptionFor(site, deps.settings.get(BlockerAllowedSitesSetting)) ?? domain,
    blocked: tab.blocked,
    on: deps.blocking(tab.url) !== 'off',
    available: deps.settings.get(ContentBlockerSetting),
    failed: deps.blocker.status === 'failed',
  };
}

/** Turns blocking off or on for the site of a window's active tab and reloads it. */
function toggle(deps: ShieldPopoverDependencies, window: BrowserWindowController): void {
  const tab = window.tabs.active;
  const site = siteOf(tab?.url ?? '');
  if (tab === undefined || site === undefined) return;
  const domain = deps.blocker.domainOf(tab.url) ?? site;
  const saved = deps.settings.set(
    BlockerAllowedSitesSetting,
    toggleSite(deps.settings.get(BlockerAllowedSitesSetting), site, domain),
  );
  if (saved.ok) {
    window.tabs.run(tab.id, 'reload');
  } else {
    void import('./browser-menu.ts').then(({ showBlockerSaveError }) =>
      showBlockerSaveError(window, saved.error.kind === 'locked-by-policy'),
    );
  }
}

/** Shows the current state of the active tab in an open popover, or closes it. */
function refresh(window: BrowserWindowController, overlay: WindowOverlay): void {
  const shown = overlay.content;
  if (shown?.kind !== 'shield' || dependencies === undefined) return;
  const next = shieldOf(dependencies, window, shown.anchor);
  if (next === undefined) overlay.close();
  else if (JSON.stringify(next) !== JSON.stringify(shown)) overlay.update(next);
}
