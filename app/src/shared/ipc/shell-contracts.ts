import * as v from 'valibot';
import { tabStripPositions, toolbarItems } from '../layout.ts';
import { defineEvent, defineRequest, type RequestContract } from './contract.ts';

/** The id of a tab. */
export const TabId = v.pipe(v.string(), v.regex(/^t[0-9a-z]{1,12}$/));
/** A request without a payload. */
export const Empty = v.strictObject({});
/** A response without a payload. */
export const Done = v.null();

/**
 * Why a tab shows no page: it could not be loaded (`error`), the certificate of its site is
 * not trusted (`certificate`), its site has no secure connection (`insecure`), or its
 * renderer is gone (`crashed`). `code` is Chromium's
 * name for the cause, such as `ERR_CONNECTION_REFUSED`; `proceed` tells whether the user
 * may continue to the page after the warning.
 */
export const TabProblem = v.strictObject({
  kind: v.picklist(['error', 'certificate', 'insecure', 'crashed']),
  code: v.pipe(v.string(), v.regex(/^[A-Z0-9_]{1,64}$/)),
  url: v.pipe(v.string(), v.maxLength(8192)),
  proceed: v.boolean(),
});
/** Why a tab shows no page. */
export type TabProblem = v.InferOutput<typeof TabProblem>;

/** The key of a page icon that the browser keeps; the shell asks for the icon by it. */
export const FaviconKey = v.pipe(v.string(), v.regex(/^[0-9a-f]{16}$/));

/**
 * One tab as the shell displays it. `blocked` counts the requests that the content blocker
 * blocked on the current page; `blocking` tells whether the blocker works on the page, with
 * `none` for pages it never touches; `bookmarked` tells whether the page has a bookmark;
 * `problem` why the tab shows no page, which the shell then shows in its place;
 * `certificateException` whether the page is from a site whose certificate was not trusted
 * and was accepted after the warning, so its connection does not count as secure;
 * `zoom` the zoom factor of the page, 1 for 100 %; `favicon` the key of the page's icon;
 * `audible` whether the page plays sound, `muted` whether its sound is muted, and `pinned`
 * whether the tab is pinned.
 */
export const TabView = v.strictObject({
  id: TabId,
  title: v.string(),
  url: v.string(),
  loading: v.boolean(),
  canGoBack: v.boolean(),
  canGoForward: v.boolean(),
  blocked: v.pipe(v.number(), v.integer(), v.minValue(0)),
  blocking: v.picklist(['on', 'off', 'none', 'failed']),
  bookmarked: v.boolean(),
  problem: v.nullable(TabProblem),
  certificateException: v.boolean(),
  zoom: v.pipe(v.number(), v.minValue(0.25), v.maxValue(5)),
  favicon: v.nullable(FaviconKey),
  audible: v.boolean(),
  muted: v.boolean(),
  pinned: v.boolean(),
});
/** One tab as the shell displays it. */
export type TabView = v.InferOutput<typeof TabView>;

/** A bookmark or folder of the bookmarks bar; folders have no address. */
export const BarItem = v.strictObject({
  id: v.number(),
  title: v.string(),
  url: v.nullable(v.string()),
});
/** A bookmark or folder of the bookmarks bar. */
export type BarItem = v.InferOutput<typeof BarItem>;

/** The find bar of the active tab: what it looks for, the current match and their number. */
export const FindState = v.strictObject({
  query: v.pipe(v.string(), v.maxLength(1000)),
  active: v.pipe(v.number(), v.integer(), v.minValue(0)),
  matches: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
/** The find bar of the active tab. */
export type FindState = v.InferOutput<typeof FindState>;

/**
 * Where the window controls lie in the top row when the browser draws the title bar: at its
 * start or end, how much room they take and how high the row is. The state has `null` with
 * the system's title bar and in full screen, where the system hides the controls. On Windows
 * and Linux, the shell takes their place and room from the window once the window reports them.
 */
const TitleBarArea = v.strictObject({
  side: v.picklist(['start', 'end']),
  size: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(400)),
  height: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(200)),
});

/**
 * The downloads button: how many downloads run and how much of them is done, from 0 to 1,
 * or `null` while a size is unknown. The button shows once the browser downloaded something.
 */
const DownloadsSummary = v.strictObject({
  active: v.pipe(v.number(), v.integer(), v.minValue(0)),
  progress: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
});

/**
 * Everything the shell renders. Sent as a whole after changes, at most once per frame.
 * `bookmarksBar` is `null` while the bookmarks bar is hidden, `find` while the find bar is
 * closed, and `downloads` until the browser downloaded something; `private` tells whether
 * the window is a private window, `home` whether the toolbar has a home button,
 * `defaultZoom` the zoom of sites without a zoom of their own, `toolbar` the buttons next
 * to the address bar in their order, and `covered` whether the overlay covers the window, as a
 * popover or a question does, so that a click next to it reaches the overlay instead of moving
 * the window.
 */
export const ShellState = v.strictObject({
  tabs: v.array(TabView),
  activeTabId: v.nullable(TabId),
  tabStrip: v.picklist(tabStripPositions),
  bookmarksBar: v.nullable(v.array(BarItem)),
  find: v.nullable(FindState),
  downloads: v.nullable(DownloadsSummary),
  private: v.boolean(),
  home: v.boolean(),
  defaultZoom: v.number(),
  toolbar: v.array(v.picklist(toolbarItems)),
  titleBar: v.nullable(TitleBarArea),
  covered: v.boolean(),
});
/** Everything the shell renders. */
export type ShellState = v.InferOutput<typeof ShellState>;

const TabRequest = v.strictObject({ tabId: TabId });

/** Returns the current state; the shell calls it once at startup. */
export const GetShellState = defineRequest({
  channel: 'shell.getState',
  request: Empty,
  response: ShellState,
  capability: 'shell',
});

/** Opens a new tab, optionally with a URL or search input. */
export const OpenTab = defineRequest({
  channel: 'tabs.open',
  request: v.strictObject({ input: v.optional(v.pipe(v.string(), v.maxLength(8192))) }),
  response: v.strictObject({ tabId: TabId }),
  capability: 'shell',
});

/** Shows a tab. */
export const ActivateTab = defineRequest({
  channel: 'tabs.activate',
  request: TabRequest,
  response: Done,
  capability: 'shell',
});

/** Closes a tab. */
export const CloseTab = defineRequest({
  channel: 'tabs.close',
  request: TabRequest,
  response: Done,
  capability: 'shell',
});

/** Navigates a tab to what the user typed in the address bar. */
export const NavigateTab = defineRequest({
  channel: 'tabs.navigate',
  request: v.strictObject({
    tabId: TabId,
    input: v.pipe(v.string(), v.minLength(1), v.maxLength(8192)),
  }),
  response: Done,
  capability: 'shell',
});

/** History and loading actions of a tab; `home` opens the home page in it. */
export const TabAction = defineRequest({
  channel: 'tabs.action',
  request: v.strictObject({
    tabId: TabId,
    action: v.picklist(['back', 'forward', 'reload', 'stop', 'home']),
  }),
  response: Done,
  capability: 'shell',
});

/** Space the shell occupies at the window edges, in CSS pixels; web content fills the rest. */
export const SetShellInsets = defineRequest({
  channel: 'shell.setInsets',
  request: v.strictObject({
    top: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
    right: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
    bottom: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
    left: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2000)),
  }),
  response: Done,
  capability: 'shell',
  ratePerSecond: 120,
});

/** Sent to the shell when its state changed. */
export const ShellStateChanged = defineEvent({
  channel: 'shell.stateChanged',
  payload: ShellState,
  capability: 'shell',
});

/** Asks the shell to run a UI command, such as focusing the address bar after a shortcut. */
export const ShellCommand = defineEvent({
  channel: 'shell.command',
  payload: v.picklist(['omnibox.focus', 'omnibox.done', 'find.focus', 'downloads.open']),
  capability: 'shell',
});

/**
 * The request contracts of the shell that its first paint needs; the others are in
 * `shell-later-contracts.ts`.
 */
export const shellRequests: readonly RequestContract<unknown, unknown>[] = [
  GetShellState,
  OpenTab,
  ActivateTab,
  CloseTab,
  NavigateTab,
  TabAction,
  SetShellInsets,
];
