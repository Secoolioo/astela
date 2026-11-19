import { exceptionFor, siteOf, type Blocking } from '../domain/blocker/blocking.ts';
import { exceptionSite, toggleSite } from '../domain/blocker/allowed-sites.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { WindowOverlay } from '../platform/electron/overlay.ts';
import { ToggleSiteBlocking } from '../shared/ipc/overlay-contracts.ts';
import { BlockerAllowedSitesSetting, ContentBlockerSetting } from './core-settings.ts';
import { overlayBySender, windowOfOverlay } from './overlays.ts';

/** What the switch of the content blocker for a site needs from the browser process. */
export interface SiteBlockingDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly settings: SettingsService;
  readonly blocker: ContentBlocker;
  /** Whether the content blocker works on a page. */
  readonly blocking: (url: string) => Blocking;
}

/**
 * The content blocker on the page of a tab: the domain that an exception covers, such as
 * `example.com`, the requests blocked on the page, whether it blocks on the site, whether it
 * is on at all, and whether it has no usable filter data.
 */
export interface BlockerState {
  readonly site: string;
  readonly blocked: number;
  readonly on: boolean;
  readonly available: boolean;
  readonly failed: boolean;
}

/** The popovers with the switch of the content blocker for a site. */
type BlockerPopover = 'shield' | 'site';

/** How a popover with the switch takes part in it. */
interface BlockerPopoverHooks {
  /**
   * Whether the switch may act for what the popover shows, such as site information that still
   * shows the site of the active tab.
   */
  allows(window: BrowserWindowController, overlay: WindowOverlay, id: number | undefined): boolean;
  /** Shows the new state in the popover. */
  refresh(window: BrowserWindowController, overlay: WindowOverlay): void;
}

const popovers = new Map<BlockerPopover, BlockerPopoverHooks>();
let connected = false;

/**
 * The content blocker on the page of a tab, or `undefined` when it does not touch the page.
 * @param deps - The settings and the content blocker.
 * @param tab - The tab's address and the requests blocked on its page.
 */
export function blockerStateOf(
  deps: Pick<SiteBlockingDependencies, 'settings' | 'blocker' | 'blocking'>,
  tab: { readonly url: string; readonly blocked: number },
): BlockerState | undefined {
  const site = siteOf(tab.url);
  if (site === undefined) return undefined;
  // An exception covers the whole registrable domain, such as example.co.uk.
  const domain = exceptionSite(site, deps.blocker.domainOf(tab.url) ?? site);
  return {
    site: exceptionFor(site, deps.settings.get(BlockerAllowedSitesSetting)) ?? domain,
    blocked: tab.blocked,
    on: deps.blocking(tab.url) !== 'off',
    available: deps.settings.get(ContentBlockerSetting),
    failed: deps.blocker.status === 'failed',
  };
}

/**
 * Takes part in the switch of the content blocker for the site of the active tab, which the
 * shield's popover and site information both show. The request is handled once for both.
 * @param kind - The kind of the popover.
 * @param deps - What the switch needs.
 * @param hooks - Whether the switch may act for the popover, and how it shows the new state.
 */
export function connectBlockerSwitch(
  kind: BlockerPopover,
  deps: SiteBlockingDependencies,
  hooks: BlockerPopoverHooks,
): void {
  popovers.set(kind, hooks);
  if (connected) return;
  connected = true;
  deps.router.handle(ToggleSiteBlocking, ({ id }, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOfOverlay(deps.windows.all, overlay);
    const shown = overlay?.content?.kind;
    const popover = shown === 'shield' || shown === 'site' ? popovers.get(shown) : undefined;
    if (window === undefined || overlay === undefined || popover === undefined) return null;
    if (popover.allows(window, overlay, id)) toggleBlocking(deps, window);
    popover.refresh(window, overlay);
    return null;
  });
}

/** Turns blocking off or on for the site of a window's active tab and reloads it. */
function toggleBlocking(deps: SiteBlockingDependencies, window: BrowserWindowController): void {
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
