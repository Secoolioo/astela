import * as v from 'valibot';
import { defineRequest, type RequestContract } from './contract.ts';
import { OverlayAnchor } from './overlay-anchor.ts';
import { Done, Empty, TabId } from './shell-contracts.ts';

// Requests of the shell that its first paint does not need. They load with the first of
// them, so the browser does not read them at its start; `shellLaterChannels` names them.

/** Reopens the most recently closed tab. */
export const ReopenClosedTab = defineRequest({
  channel: 'tabs.reopenClosed',
  request: Empty,
  response: Done,
  capability: 'shell',
});

/** Opens the browser menu below the menu button, at a point of the shell in CSS pixels. */
export const OpenMenu = defineRequest({
  channel: 'shell.openMenu',
  request: v.strictObject({
    x: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
    y: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
  }),
  response: Done,
  capability: 'shell',
});

/** Looks for text in the page of a tab, or for its next or previous match. */
export const FindInPage = defineRequest({
  channel: 'tabs.find',
  request: v.strictObject({
    tabId: TabId,
    query: v.pipe(v.string(), v.maxLength(1000)),
    forward: v.boolean(),
    next: v.boolean(),
  }),
  response: Done,
  capability: 'shell',
});

/** Closes the find bar and stops looking. */
export const StopFinding = defineRequest({
  channel: 'tabs.stopFind',
  request: v.strictObject({ tabId: TabId }),
  response: Done,
  capability: 'shell',
});

/** Sets the zoom of a tab's page back to the default zoom. */
export const ResetZoom = defineRequest({
  channel: 'tabs.resetZoom',
  request: v.strictObject({ tabId: TabId }),
  response: Done,
  capability: 'shell',
});

/** Accepts the certificate that a tab's page was refused, for this session, and reloads it. */
export const ProceedUnsafely = defineRequest({
  channel: 'tabs.proceedUnsafely',
  request: v.strictObject({ tabId: TabId }),
  response: Done,
  capability: 'shell',
});

/** Loads the insecure address of a site without a secure connection, for this session. */
export const ProceedInsecurely = defineRequest({
  channel: 'tabs.proceedInsecurely',
  request: v.strictObject({ tabId: TabId }),
  response: Done,
  capability: 'shell',
});

/** Opens the list of downloads at its button. */
export const OpenDownloads = defineRequest({
  channel: 'shell.openDownloads',
  request: OverlayAnchor,
  response: Done,
  capability: 'shell',
});

/** Opens the content blocker's popover for the active tab at its button. */
export const OpenBlockerPopover = defineRequest({
  channel: 'shell.openBlockerPopover',
  request: OverlayAnchor,
  response: Done,
  capability: 'shell',
});

/** Opens a menu with the contents of a folder of the bookmarks bar below its button. */
export const OpenBookmarkFolder = defineRequest({
  channel: 'shell.openBookmarkFolder',
  request: v.strictObject({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    // How many of the folder's first entries the menu leaves out, as the bar shows them.
    from: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
    x: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
    y: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
  }),
  response: Done,
  capability: 'shell',
});

/** Adds a bookmark for the page of the active tab, or removes its bookmarks. */
export const ToggleBookmark = defineRequest({
  channel: 'shell.toggleBookmark',
  request: Empty,
  response: Done,
  capability: 'shell',
});

/** The request contracts of the shell that load with the first of them. */
export const shellLaterRequests: readonly RequestContract<unknown, unknown>[] = [
  ReopenClosedTab,
  OpenMenu,
  FindInPage,
  StopFinding,
  ResetZoom,
  ProceedUnsafely,
  ProceedInsecurely,
  OpenDownloads,
  OpenBlockerPopover,
  OpenBookmarkFolder,
  ToggleBookmark,
];
