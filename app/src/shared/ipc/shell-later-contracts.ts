import * as v from 'valibot';
import { defineEvent, defineRequest, type RequestContract } from './contract.ts';
import { PopoverAnchor } from './overlay-anchor.ts';
import { Done, Empty, FaviconKey, GroupId, SplitRatio, TabId } from './shell-contracts.ts';
import { WorkspaceId } from '../workspaces.ts';

// Requests of the shell that its first paint does not need. They load with the first of
// them, so the browser does not read them at its start; `shellLaterChannels` names them.

/** Reopens the most recently closed tab. */
export const ReopenClosedTab = defineRequest({
  channel: 'tabs.reopenClosed',
  request: Empty,
  response: Done,
  capability: 'shell',
});

/** Opens the browser menu in the overlay at the menu button, in CSS pixels of the shell. */
export const OpenMenu = defineRequest({
  channel: 'shell.openMenu',
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/**
 * Makes the overlay of the window ready before its first popover, as when the pointer reaches
 * the menu button, so that the popover opens without waiting for the overlay's page.
 */
export const PrepareOverlay = defineRequest({
  channel: 'shell.prepareOverlay',
  request: Empty,
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
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/** Opens the content blocker's popover for the active tab at its button. */
export const OpenBlockerPopover = defineRequest({
  channel: 'shell.openBlockerPopover',
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/**
 * Opens site information for the page of the active tab at the chip of its connection, in the
 * address bar.
 */
export const OpenSiteInfo = defineRequest({
  channel: 'shell.openSiteInfo',
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/** Opens a menu in the overlay with the contents of a folder of the bookmarks bar at its button. */
export const OpenBookmarkFolder = defineRequest({
  channel: 'shell.openBookmarkFolder',
  request: v.strictObject({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    // How many of the folder's first entries the menu leaves out, as the bar shows them.
    from: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
    ...PopoverAnchor.entries,
  }),
  response: Done,
  capability: 'shell',
});

/**
 * Opens the popover of the bookmark star for the page of the active tab, which adds the page
 * to the bookmarks bar first when it has no bookmark yet.
 */
export const OpenBookmarkPopover = defineRequest({
  channel: 'shell.openBookmarkPopover',
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/** The icon of a page by its key, as a `data:` address, or `null` if the browser has none. */
export const GetFavicon = defineRequest({
  channel: 'tabs.favicon',
  request: v.strictObject({ key: FaviconKey }),
  response: v.nullable(v.pipe(v.string(), v.startsWith('data:image/'), v.maxLength(200_000))),
  capability: 'shell',
});

/** Mutes the sound of a tab, or turns it on again. */
export const SetTabMuted = defineRequest({
  channel: 'tabs.setMuted',
  request: v.strictObject({ tabId: TabId, muted: v.boolean() }),
  response: Done,
  capability: 'shell',
});

/**
 * Shows or closes a tab with a key of the tab strip, Enter or Space and Delete, which keeps the
 * focus in the strip, also when the active tab changes with it.
 */
export const KeyOnTab = defineRequest({
  channel: 'tabs.key',
  request: v.strictObject({ tabId: TabId, action: v.picklist(['activate', 'close']) }),
  response: Done,
  capability: 'shell',
});

/**
 * Gives the page that the content area shows the focus, starting at its start, or at its end
 * with `reverse`, when Tab leaves the last control of the shell, or Shift+Tab its first.
 */
export const FocusContent = defineRequest({
  channel: 'tabs.focusContent',
  request: v.strictObject({ reverse: v.boolean() }),
  response: Done,
  capability: 'shell',
});

/**
 * Moves a tab to another place among the tabs of its window. While the window has groups of
 * tabs, `group` names the group that the tab joins there, or `null` for none; without it, a
 * place between two tabs of a group joins that group, and a tab keeps its group at its edges.
 */
export const MoveTab = defineRequest({
  channel: 'tabs.move',
  request: v.strictObject({
    tabId: TabId,
    index: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000)),
    group: v.optional(v.nullable(GroupId)),
  }),
  response: Done,
  capability: 'shell',
});

/**
 * Hides the tabs of a group behind its chip, or shows them again, as a click on the chip does;
 * `keyboard` when Enter or Space on the chip did it, which then keeps the focus, also when the
 * active tab changes with it.
 */
export const ToggleGroup = defineRequest({
  channel: 'groups.toggle',
  request: v.strictObject({ groupId: GroupId, keyboard: v.boolean() }),
  response: Done,
  capability: 'shell',
});

/**
 * Opens the popover of a group of tabs at its chip, in CSS pixels of the shell, where the
 * group gets its name and color, or a new tab, or ends or closes.
 */
export const OpenGroupEditor = defineRequest({
  channel: 'groups.openEditor',
  request: v.strictObject({ groupId: GroupId, ...PopoverAnchor.entries }),
  response: Done,
  capability: 'shell',
});

/**
 * Asks the shell to open the popover of a group at its chip, which only the shell knows, such
 * as for the group that the menu of a tab just made. The shell opens it once the chip shows,
 * as opened with the keyboard when the keyboard opened that menu, so that the focus goes back
 * to the shell when the popover closes.
 */
export const EditGroupRequested = defineEvent({
  channel: 'shell.editGroup',
  payload: v.strictObject({ groupId: GroupId, keyboard: v.boolean() }),
  capability: 'shell',
});

/** Opens the list of the workspaces at the button of the workspaces, in CSS pixels of the shell. */
export const OpenWorkspaces = defineRequest({
  channel: 'workspaces.open',
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/**
 * Moves a tab of the window into another workspace, as a drop of the tab on the workspace's
 * target does; a tab that changes its partition loads again there.
 */
export const MoveTabToWorkspace = defineRequest({
  channel: 'workspaces.moveTab',
  request: v.strictObject({ tabId: TabId, workspaceId: WorkspaceId }),
  response: Done,
  capability: 'shell',
});

/**
 * Moves the divider of the split view of a tab: while it moves, only the pages follow; once
 * it is let go, or moved by a key (`done`), the share counts for the state and the session.
 * Previews come once per frame and at most every `splitPreviewEvery` ms, fewer than the budget
 * gives back, so the share that counts always finds room in it.
 */
export const ResizeSplit = defineRequest({
  channel: 'tabs.resizeSplit',
  request: v.strictObject({ tabId: TabId, ratio: SplitRatio, done: v.boolean() }),
  response: Done,
  capability: 'shell',
  ratePerSecond: 240,
});

/**
 * Opens the menu of a tab at a point of the shell in CSS pixels; `keyboard` when the context
 * menu key or Shift+F10 opened it, which a popover that the menu opens takes over.
 */
export const OpenTabMenu = defineRequest({
  channel: 'tabs.openMenu',
  request: v.strictObject({
    tabId: TabId,
    x: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
    y: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
    keyboard: v.boolean(),
  }),
  response: Done,
  capability: 'shell',
});

/**
 * Shows the reader view of the active tab, or ends it, as the button next to the address bar
 * and the shortcut do.
 */
export const ToggleReader = defineRequest({
  channel: 'shell.toggleReader',
  request: Empty,
  response: Done,
  capability: 'shell',
});

/**
 * Shows a video of the active tab in picture in picture, or ends picture in picture, as the
 * button next to the address bar says.
 */
export const TogglePictureInPicture = defineRequest({
  channel: 'shell.togglePictureInPicture',
  request: Empty,
  response: Done,
  capability: 'shell',
});

/**
 * Tells the browser what holds the rows that hide open in the shell: the pointer over them, and
 * the focus in one of their controls; and whether the shell drew them hidden, a frame ago, so
 * that their regions move no window. The shell sends it when one of them changes; the browser
 * gives the page the keys when the focus leaves the rows and the shell keeps it, and lays the
 * page above the shell once the shell drew the rows hidden.
 */
export const HoldTopRows = defineRequest({
  channel: 'shell.holdTopRows',
  request: v.strictObject({ pointer: v.boolean(), focus: v.boolean(), hidden: v.boolean() }),
  response: Done,
  capability: 'shell',
  ratePerSecond: 30,
});

/** Shows the suggestions for text typed in the address bar, below the field. */
export const SuggestAddresses = defineRequest({
  channel: 'omnibox.suggest',
  request: v.strictObject({
    text: v.pipe(v.string(), v.maxLength(2000)),
    // The tab whose address bar the text is typed in, where a chosen suggestion opens; without
    // it, the tab that the shell asked for last, which the shell does not know yet.
    tabId: v.optional(TabId),
    x: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
    y: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000)),
    width: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20000)),
    rowHeight: v.pipe(v.number(), v.integer(), v.minValue(16), v.maxValue(120)),
  }),
  response: Done,
  capability: 'shell',
});

/**
 * Marks the next or the previous suggestion, as the arrow keys do; past the last or the first
 * one, none is marked. The response is the marked place, or -1.
 */
export const SelectSuggestion = defineRequest({
  channel: 'omnibox.select',
  request: v.strictObject({ step: v.picklist([-1, 1]) }),
  response: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(7)),
  capability: 'shell',
});

/**
 * Opens the marked suggestion, as Enter does; `false` when none is marked, and the shell opens
 * what was typed instead.
 */
export const AcceptSuggestion = defineRequest({
  channel: 'omnibox.accept',
  request: Empty,
  response: v.boolean(),
  capability: 'shell',
});

/** Closes the suggestions of the address bar. */
export const CloseSuggestions = defineRequest({
  channel: 'omnibox.close',
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
  OpenBookmarkPopover,
  PrepareOverlay,
  GetFavicon,
  SetTabMuted,
  KeyOnTab,
  FocusContent,
  MoveTab,
  OpenTabMenu,
  SuggestAddresses,
  SelectSuggestion,
  AcceptSuggestion,
  CloseSuggestions,
  ResizeSplit,
  ToggleGroup,
  OpenGroupEditor,
  OpenWorkspaces,
  MoveTabToWorkspace,
  ToggleReader,
  TogglePictureInPicture,
  HoldTopRows,
  OpenSiteInfo,
];
