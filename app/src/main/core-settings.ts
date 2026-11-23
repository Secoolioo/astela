import {
  NewTabBackground,
  type NewTabBackground as NewTabBackgroundValue,
} from '../shared/ipc/newtab-contracts.ts';
import {
  CustomTheme,
  themeIds,
  type CustomTheme as CustomThemeColors,
  type ThemeChoice,
} from '../shared/themes.ts';
import {
  shortcutPattern,
  shortcutProblem,
  windowCommands,
  type ShortcutOverrides,
} from '../shared/shortcuts.ts';
import { secureDnsModes, areSecureDnsTemplates, type SecureDnsMode } from '../shared/secure-dns.ts';
import { isAbsolute } from 'node:path';
import * as v from 'valibot';
import { accentPresets } from '../domain/appearance/accent-presets.ts';
import {
  colorModes,
  densities,
  fontNamePattern,
  textSizes,
  type ColorMode,
  type Density,
  type TextSize,
  type WebFonts,
} from '../domain/appearance/appearance.ts';
import type { SitePermissions } from '../domain/permissions/site-permissions.ts';
import { defineSetting } from '../domain/settings/setting.ts';
import {
  tabStripPositions,
  toolbarItems,
  toolbarPlacements,
  type TabStripPosition,
  type ToolbarItem,
  type ToolbarPlacement,
} from '../shared/layout.ts';
import type { CustomSearchEngine } from '../shared/search-engines.ts';
import { readerFonts, type ReaderFont } from '../shared/page-tools.ts';
import { sleepAfterSeconds, type SleepAfter } from '../shared/tab-sleep.ts';
import {
  defaultWorkspaces,
  WorkspaceId,
  WorkspaceList,
  type Workspace,
} from '../shared/workspaces.ts';
import { zoomFactors } from '../shared/zoom.ts';

/**
 * The search address of an engine: https, with `%s` for the query. Chrome's `{searchTerms}`
 * becomes `%s`, so that its policy files and search addresses work as they are; the policy
 * reference describes the values that its policy takes (policy-inputs.ts).
 */
const SearchAddress = v.pipe(
  v.string(),
  v.transform((url) => url.replaceAll('{searchTerms}', '%s')),
  v.maxLength(2048),
  v.regex(/^https:\/\/[^\s]+%s[^\s]*$/, 'Must be an https URL with %s'),
);

/**
 * Search URL used by the address bar, with `%s` for the query. The default engine is a
 * plain search URL; no partnership or tracking parameter is involved.
 */
export const SearchUrlTemplate = defineSetting({
  key: 'search.urlTemplate',
  schema: SearchAddress,
  default: 'https://duckduckgo.com/?q=%s',
  scope: 'global',
  policy: { name: 'DefaultSearchProviderSearchURL', sensitive: true },
});

/**
 * Search engines that someone added, which their keyword picks in the address bar, such as
 * `ex` for `ex terms`. Keywords differ from each other and start with neither `!` nor `@`.
 */
export const SearchEnginesSetting = defineSetting<CustomSearchEngine[]>({
  key: 'search.engines',
  schema: v.pipe(
    v.array(
      v.strictObject({
        name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
        keyword: v.pipe(v.string(), v.regex(/^[^\s!@]\S{0,31}$/, 'Must be a word without ! or @')),
        url: SearchAddress,
      }),
    ),
    v.maxLength(50),
    v.check(
      (engines) =>
        new Set(engines.map((engine) => engine.keyword.toLowerCase())).size === engines.length,
      'Keywords must differ',
    ),
  ),
  default: [],
  scope: 'global',
});

/** Whether a `!bang` at the start or the end of a search, such as `!w`, searches its site. */
export const SearchBangsSetting = defineSetting<boolean>({
  key: 'search.bangs',
  schema: v.boolean(),
  default: true,
  scope: 'global',
});

/** Whether the browser follows the system's light or dark mode, or always uses one. */
export const ColorModeSetting = defineSetting<ColorMode>({
  key: 'appearance.colorMode',
  schema: v.picklist(colorModes),
  default: 'system',
  scope: 'global',
});

/** Accent color: a preset such as `blue`, or a custom `#rrggbb` color. */
export const AccentSetting = defineSetting({
  key: 'appearance.accent',
  schema: v.union([
    v.picklist(accentPresets),
    v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i, 'Must be a preset or a #rrggbb color')),
  ]),
  default: 'astela',
  scope: 'global',
});

/** The colors of the browser's own views: a built-in theme, or the colors that people chose. */
export const ThemeSetting = defineSetting<ThemeChoice>({
  key: 'appearance.theme',
  schema: v.picklist([...themeIds, 'custom']),
  default: 'astela',
  scope: 'global',
});

/** The colors of the custom theme, by color mode and token; others keep Astela's. */
export const CustomThemeSetting = defineSetting<CustomThemeColors>({
  key: 'appearance.customTheme',
  schema: CustomTheme,
  default: { light: {}, dark: {} },
  scope: 'global',
});

/** Size of the toolbar and the tabs. */
export const DensitySetting = defineSetting<Density>({
  key: 'appearance.density',
  schema: v.picklist(densities),
  default: 'normal',
  scope: 'global',
});

/** A font, by the name of its family; empty for the default. */
const FontName = v.pipe(v.string(), v.regex(fontNamePattern, 'Must be the name of a font'));

/** How large the text of the browser's own UI is; the density sets its spacing. */
export const TextSizeSetting = defineSetting<TextSize>({
  key: 'appearance.textSize',
  schema: v.picklist(textSizes),
  default: 'medium',
  scope: 'global',
});

/** The font of the browser's own UI, by its name; empty keeps the font of the system. */
export const UiFontSetting = defineSetting<string>({
  key: 'appearance.font',
  schema: FontName,
  default: '',
  scope: 'global',
});

/** The fonts of web pages that name none; new tabs use them. */
export const WebFontsSetting = defineSetting<WebFonts>({
  key: 'fonts.web',
  schema: v.strictObject({
    standard: FontName,
    serif: FontName,
    sansSerif: FontName,
    fixed: FontName,
  }),
  default: { standard: '', serif: '', sansSerif: '', fixed: '' },
  scope: 'global',
});

/** The size of the text of web pages that set none, in CSS pixels; new tabs use it. */
export const WebTextSizeSetting = defineSetting<number>({
  key: 'fonts.size',
  schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
  default: 16,
  scope: 'global',
});

/** The buttons of the toolbar that show next to the address bar, in their order. */
export const ToolbarItemsSetting = defineSetting<ToolbarItem[]>({
  key: 'toolbar.items',
  schema: v.pipe(
    v.array(v.picklist(toolbarItems)),
    v.check((items) => new Set(items).size === items.length, 'Each button can show once'),
  ),
  default: [...toolbarItems],
  scope: 'global',
});

/** Where the tab strip is; vertical positions show the tabs as a list at the side. */
export const TabStripPositionSetting = defineSetting<TabStripPosition>({
  key: 'tabs.position',
  schema: v.picklist(tabStripPositions),
  default: 'top',
  scope: 'global',
  policy: { name: 'TabStripPosition', recommended: true },
});

/**
 * Where the toolbar with the address bar is: in a row of its own, or in the row of the tabs,
 * which takes the place of the title bar. It works with the tabs at the top only; elsewhere
 * the toolbar keeps its own row. A policy can set or recommend it.
 */
export const ToolbarPlacementSetting = defineSetting<ToolbarPlacement>({
  key: 'toolbar.placement',
  schema: v.picklist(toolbarPlacements),
  default: 'own-row',
  scope: 'global',
  policy: { name: 'ToolbarPlacement', recommended: true },
});

/**
 * Whether the tabs and the toolbar hide until they are needed: the page then lies under an
 * edge, or under a title row with the site where the system draws the window controls into the
 * browser, and the rows show over the page for the pointer at the top edge, the focus, the find
 * bar, the menus and popovers of the toolbar and a moment after a tab shows another site. It
 * works with the tabs at the top only, and never in popups. A policy can set or recommend it.
 */
export const ToolbarAutoHideSetting = defineSetting<boolean>({
  key: 'toolbar.autoHide',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'AutoHideToolbar', recommended: true },
});

/** Where the window controls are: in the row of the tabs, or in a title bar of the system. */
export const titleBars = ['integrated', 'system'] as const;
/** Where the window controls are: `integrated` with the tabs, `system` above them. */
export type TitleBar = (typeof titleBars)[number];

/** Whether the window draws its own title bar with the tabs in it, or has the system's. */
export const TitleBarSetting = defineSetting<TitleBar>({
  key: 'appearance.titleBar',
  schema: v.picklist(titleBars),
  default: 'integrated',
  scope: 'global',
  restartRequired: true,
});

/** Whether the content blocker blocks ads, trackers and what pages load from known malware hosts. */
export const ContentBlockerSetting = defineSetting<boolean>({
  key: 'contentBlocker.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'ContentBlockerEnabled', recommended: true },
});

/**
 * Sites, by host name or domain, on which the content blocker is off; a domain covers its hosts.
 * A mandatory policy sets the list and keeps people from changing it, also from the shield.
 */
export const BlockerAllowedSitesSetting = defineSetting<string[]>({
  key: 'contentBlocker.allowedSites',
  schema: v.pipe(
    v.array(v.pipe(v.string(), v.regex(/^[a-z0-9.:[\]-]{1,253}$/i, 'Must be a host name'))),
    v.maxLength(10_000),
  ),
  default: [],
  scope: 'global',
  policy: { name: 'ContentBlockerAllowedSites', recommended: true },
});

/** Whether the content blocker also hides cookie notices, with the optional lists for them. */
export const BlockerCookieNoticesSetting = defineSetting<boolean>({
  key: 'contentBlocker.cookieNotices',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'ContentBlockerCookieNoticesEnabled', recommended: true },
});

/**
 * Whether the content blocker also hides annoyances, such as newsletter and chat boxes, with
 * the optional lists for them.
 */
export const BlockerAnnoyancesSetting = defineSetting<boolean>({
  key: 'contentBlocker.annoyances',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'ContentBlockerAnnoyancesEnabled', recommended: true },
});

/** The zoom of pages whose site has no zoom of its own, as a factor of their size. */
export const DefaultZoomSetting = defineSetting<number>({
  key: 'zoom.default',
  schema: v.picklist(zoomFactors),
  default: 1,
  scope: 'global',
});

/** The zoom factor of each site whose zoom someone changed, by host name. */
export const SiteZoomSetting = defineSetting<Record<string, number>>({
  key: 'zoom.sites',
  schema: v.pipe(
    v.record(
      v.pipe(v.string(), v.regex(/^[a-z0-9.:[\]-]{1,253}$/i, 'Must be a host name')),
      v.pipe(v.number(), v.minValue(0.25), v.maxValue(5)),
    ),
    v.check((sites) => Object.keys(sites).length <= 10_000, 'Too many sites'),
  ),
  default: {},
  scope: 'global',
});

const PermissionDecision = v.exactOptional(v.picklist(['allow', 'block']));

/**
 * Most sites with decisions, the `maxSites` of the site permissions. The setting checks it
 * without their code, which loads with the first web page.
 */
const maxSites = 10_000;

/**
 * What sites may use after the user answered their question, by origin, such as
 * `{"https://meet.example": {"camera": "allow", "notifications": "block"}}`, and whether their
 * pages may open pop-ups without a click (`popups`), which people allow from the popover of the
 * pop-up blocker.
 */
export const SitePermissionsSetting = defineSetting<SitePermissions>({
  key: 'permissions.sites',
  schema: v.pipe(
    v.record(
      v.pipe(
        v.string(),
        v.maxLength(300),
        v.regex(/^https?:\/\/[a-z0-9.[\]:-]+$/i, 'Must be the origin of a web page'),
      ),
      v.strictObject({
        camera: PermissionDecision,
        microphone: PermissionDecision,
        location: PermissionDecision,
        notifications: PermissionDecision,
        clipboard: PermissionDecision,
        popups: PermissionDecision,
      }),
    ),
    v.check((sites) => Object.keys(sites).length <= maxSites, 'Too many sites'),
  ),
  default: {},
  scope: 'global',
});

/**
 * A web address, such as a page to open at start. One without a scheme gets `https://`, as
 * the settings page and Chrome's policies fix up `example.com`; another scheme than http and
 * https stays and is refused. A scheme followed by a port number, as in `intranet:8080`, is a
 * host (policy-inputs.ts).
 */
const WebAddress = v.pipe(
  v.string(),
  v.transform((address) => (/^\w[\w+.-]*:(?!\d)/.test(address) ? address : `https://${address}`)),
  v.maxLength(8192),
  v.regex(/^https?:\/\/\S+$/i, 'Must be a web address'),
);

/**
 * What the browser shows when it starts: the tabs of the last session, a new tab page, or
 * the pages of `startup.urls`. The policy takes Chromium's numbers: 1, 5 and 4.
 */
export const StartupSetting = defineSetting<'restore' | 'newtab' | 'pages'>({
  key: 'startup.page',
  schema: v.picklist(['restore', 'newtab', 'pages']),
  default: 'restore',
  scope: 'global',
  policy: {
    name: 'RestoreOnStartup',
    recommended: true,
    schema: v.pipe(
      v.picklist([1, 4, 5]),
      v.transform((value) => (value === 1 ? 'restore' : value === 4 ? 'pages' : 'newtab')),
    ),
  },
});

/** The pages that open at start when `startup.page` is `pages`, in this order. */
export const StartupPagesSetting = defineSetting<string[]>({
  key: 'startup.urls',
  schema: v.pipe(v.array(WebAddress), v.maxLength(100)),
  default: [],
  scope: 'global',
  policy: { name: 'RestoreOnStartupURLs', recommended: true },
});

/** Whether the browser loads sites over HTTPS and warns before an insecure connection. */
export const HttpsFirstSetting = defineSetting<boolean>({
  key: 'privacy.httpsFirst',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: {
    name: 'HttpsOnlyMode',
    // Chromium's values; `allowed` leaves the choice to the user, as no policy does.
    schema: v.pipe(
      v.picklist(['disallowed', 'force_enabled', 'force_balanced_enabled']),
      v.transform((value) => value !== 'disallowed'),
    ),
  },
});

/** Hosts that HTTPS-First leaves on their insecure address, such as sites of an intranet. */
export const HttpAllowlistSetting = defineSetting<string[]>({
  key: 'privacy.httpAllowlist',
  schema: v.pipe(
    v.array(v.pipe(v.string(), v.regex(/^(?:\[\*\.\]|\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i))),
    v.maxLength(1000),
  ),
  default: [],
  scope: 'global',
  policy: { name: 'HttpAllowlist' },
});

/** How the browser looks up the addresses of sites: with DNS over HTTPS or without. */
export const SecureDnsSetting = defineSetting<SecureDnsMode>({
  key: 'network.secureDns',
  schema: v.picklist(secureDnsModes),
  default: 'automatic',
  scope: 'global',
  // A policy of the user could send every look-up elsewhere, so only the machine's counts.
  policy: { name: 'DnsOverHttpsMode', sensitive: true },
});

/** The addresses of the DNS over HTTPS services, separated by spaces; empty for the system's. */
export const SecureDnsTemplatesSetting = defineSetting<string>({
  key: 'network.secureDnsTemplates',
  schema: v.pipe(
    v.string(),
    v.maxLength(2048),
    v.check(areSecureDnsTemplates, 'Must be addresses of DNS over HTTPS services'),
  ),
  default: '',
  scope: 'global',
  policy: { name: 'DnsOverHttpsTemplates', sensitive: true },
});

/**
 * Whether the command palette and tab search are on: `Ctrl+K` and `Ctrl+Shift+A`, or `Cmd+K`
 * and `Shift+Cmd+A` on macOS, open them, and the menus have their items. While it is off, the
 * two shortcuts reach web pages. A policy can set or recommend it.
 */
export const CommandPaletteSetting = defineSetting<boolean>({
  key: 'commandPalette.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'CommandPaletteEnabled', recommended: true },
});

/** The keyboard shortcuts that people chose, by command; other commands keep their defaults. */
export const ShortcutsSetting = defineSetting<ShortcutOverrides>({
  key: 'keys.shortcuts',
  schema: v.pipe(
    v.record(
      v.picklist(windowCommands),
      v.pipe(v.array(v.pipe(v.string(), v.regex(shortcutPattern))), v.maxLength(4)),
    ),
    v.check(
      (overrides) =>
        Object.values(overrides).every((list) =>
          list.every((shortcut) => shortcutProblem(shortcut, process.platform) === undefined),
        ),
      'A shortcut types text or belongs to the system',
    ),
  ),
  default: {},
  scope: 'global',
});

/**
 * Whether Alt pressed and released alone opens the browser menu, as F10 does, on Windows and
 * Linux. macOS opens its menus from the menu bar, so the setting has no place on its settings
 * page. A keyboard preference without a policy, like the shortcuts.
 */
export const AltOpensMenuSetting = defineSetting<boolean>({
  key: 'keys.altOpensMenu',
  schema: v.boolean(),
  default: true,
  scope: 'global',
});

/** Whether pages keep the cookies of other sites away, in requests, responses and frames. */
export const BlockThirdPartyCookiesSetting = defineSetting<boolean>({
  key: 'privacy.blockThirdPartyCookies',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'BlockThirdPartyCookies', recommended: true },
  // Chromium reads its own blocking as it starts; see cookie-blocking.ts.
  restartRequired: true,
});

/** Whether the toolbar has a home button, which opens the home page. */
export const HomeButtonSetting = defineSetting<boolean>({
  key: 'home.button',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'ShowHomeButton', recommended: true },
});

/** The page of the home button; empty for the new tab page. */
export const HomePageSetting = defineSetting<string>({
  key: 'home.page',
  schema: v.union([v.literal(''), WebAddress]),
  default: '',
  scope: 'global',
  policy: { name: 'HomepageLocation', recommended: true },
});

/**
 * The folder where downloads are saved; empty for the downloads folder of the system. A
 * relative path would land wherever the browser was started from. Of Chrome's variables, it
 * takes those that every system knows, which the browser replaces where it uses the folder
 * (download-folder.ts); another variable refuses the folder.
 */
export const DownloadFolderSetting = defineSetting<string>({
  key: 'downloads.folder',
  schema: v.pipe(
    v.string(),
    v.maxLength(4096),
    v.check((folder) => folder === '' || isAbsolute(folder), 'Must be an absolute path'),
    v.regex(/^(?!.*\$\{(?!(user_name|machine_name)\}))/, 'Must use only known variables'),
  ),
  default: '',
  scope: 'global',
  policy: { name: 'DownloadDirectory', recommended: true },
});

/** Whether the browser asks where to save each download. */
export const AskDownloadSetting = defineSetting<boolean>({
  key: 'downloads.ask',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'PromptForDownloadLocation', recommended: true },
});

/**
 * Whether tabs that were not used for a while go to sleep by themselves: their page closes and
 * loads again with its history when the tab is shown. Tabs that people put to sleep from their
 * menu sleep also while it is off. A policy can set or recommend it.
 */
export const TabSleepSetting = defineSetting<boolean>({
  key: 'tabs.sleep',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'SleepingTabsEnabled', recommended: true },
});

/**
 * How long a tab stays unused in the background before it goes to sleep, in seconds. The
 * values are those of Microsoft Edge's `SleepingTabsTimeout`; 30 seconds is only for policies
 * and the settings file.
 */
export const TabSleepAfterSetting = defineSetting<SleepAfter>({
  key: 'tabs.sleepAfter',
  schema: v.picklist(sleepAfterSeconds),
  default: 3600,
  scope: 'global',
  policy: { name: 'SleepingTabsTimeout', recommended: true },
});

/** Whether the new tab page shows the search field. */
export const NewTabSearchSetting = defineSetting<boolean>({
  key: 'newtab.search',
  schema: v.boolean(),
  default: true,
  scope: 'global',
});

/** Whether the new tab page shows a clock. */
export const NewTabClockSetting = defineSetting<boolean>({
  key: 'newtab.clock',
  schema: v.boolean(),
  default: false,
  scope: 'global',
});

/** The tiles of the new tab page: web pages with a title, in their order. */
export const NewTabTilesSetting = defineSetting<{ title: string; url: string }[]>({
  key: 'newtab.tiles',
  schema: v.pipe(
    v.array(
      v.strictObject({
        title: v.pipe(v.string(), v.maxLength(64)),
        url: v.pipe(v.string(), v.maxLength(8192), v.regex(/^https?:\/\/\S+$/i)),
      }),
    ),
    v.maxLength(12),
  ),
  default: [],
  scope: 'global',
});

/** Whether the new tab page shows the sites opened most often, from the history. */
export const NewTabMostVisitedSetting = defineSetting<boolean>({
  key: 'newtab.mostVisited',
  schema: v.boolean(),
  default: false,
  scope: 'global',
});

/** The background of the new tab page. */
export const NewTabBackgroundSetting = defineSetting<NewTabBackgroundValue>({
  key: 'newtab.background',
  schema: NewTabBackground,
  default: { kind: 'none' },
  scope: 'global',
});

/** Whether this profile has shown the setup guide; it opens once per profile. */
export const SetupShownSetting = defineSetting<boolean>({
  key: 'setup.shown',
  schema: v.boolean(),
  default: false,
  scope: 'global',
});

/** Whether the bookmarks bar shows the bookmarks of its folder below the toolbar. */
export const BookmarksBarSetting = defineSetting<boolean>({
  key: 'bookmarks.bar',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'BookmarkBarEnabled', recommended: true },
});

/**
 * Whether a window may show two tabs side by side in a split view. Turned off, the split views
 * that show end, and the items of the menus and the shortcut of split view are gone.
 */
export const SplitViewSetting = defineSetting<boolean>({
  key: 'splitView.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'SplitViewEnabled', recommended: true },
});

/**
 * The workspaces of the profile, each with its name, icon and color, and whether it keeps its
 * cookies and sign-ins apart. Profile data like the zoom of sites, which the list of workspaces
 * writes: the settings page neither shows nor exports nor imports it, so that an import never
 * takes a workspace with tabs away.
 */
export const WorkspacesSetting = defineSetting<Workspace[]>({
  key: 'workspaces.list',
  schema: WorkspaceList,
  default: [...defaultWorkspaces],
  scope: 'global',
});

/**
 * Whether windows keep sets of tabs in workspaces. Turned off, the button of the workspaces and
 * their shortcuts are gone, and every window shows the tabs of all its workspaces together. A
 * policy can set or recommend it.
 */
export const WorkspacesEnabledSetting = defineSetting<boolean>({
  key: 'workspaces.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'WorkspacesEnabled', recommended: true },
});

/**
 * Whether the browser offers the reader view on pages with an article, which it finds in the
 * page itself. Turned off, open reader views close, no page is checked, and the button, the
 * items of the menus and the shortcut are gone. A policy can set or recommend it.
 */
export const ReaderEnabledSetting = defineSetting<boolean>({
  key: 'reader.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'ReaderViewEnabled', recommended: true },
});

/** The font of the reader view: that of the browser, or the serif font of web pages. */
export const ReaderFontSetting = defineSetting<ReaderFont>({
  key: 'reader.font',
  schema: v.picklist(readerFonts),
  default: 'browser',
  scope: 'global',
});

/**
 * Whether the browser offers picture in picture for a video that plays, with a button next to
 * the address bar and items in the menus. Turned off, the button and the items are gone and the
 * browser looks at the videos of a page only before its tab goes to sleep, and while it shows a
 * video in picture in picture when a window gets the focus; a video that shows in picture in
 * picture stays, and pages that offer picture in picture themselves keep it, with their tabs
 * awake. A policy can set or recommend it.
 */
export const PictureInPictureEnabledSetting = defineSetting<boolean>({
  key: 'pictureInPicture.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'PictureInPictureEnabled', recommended: true },
});

/**
 * The deleted workspaces with cookies and sign-ins of their own whose folder is still in the
 * profile, as Chromium holds its files while it runs; the folders go at the next start.
 */
export const WorkspacesRemovedSetting = defineSetting<string[]>({
  key: 'workspaces.removed',
  schema: v.pipe(v.array(WorkspaceId), v.maxLength(100)),
  default: [],
  scope: 'global',
});

/**
 * The language of the browser's menus, dialogs and own pages: `system` follows the language
 * of the system, a language code such as `de` sets one. It takes effect after a restart.
 */
export const LanguageSetting = defineSetting<string>({
  key: 'i18n.language',
  schema: v.pipe(
    v.string(),
    v.regex(/^(?:system|[a-z]{2,3})$/, 'Must be system or a language code'),
  ),
  default: 'system',
  scope: 'global',
  policy: { name: 'ApplicationLocaleValue', recommended: true },
  restartRequired: true,
});

/** Settings that exist before any feature module contributes its own. */
export const coreSettings = [
  SearchUrlTemplate,
  SearchEnginesSetting,
  SearchBangsSetting,
  ColorModeSetting,
  ThemeSetting,
  CustomThemeSetting,
  AccentSetting,
  DensitySetting,
  TextSizeSetting,
  UiFontSetting,
  WebTextSizeSetting,
  WebFontsSetting,
  ToolbarItemsSetting,
  TabStripPositionSetting,
  ToolbarPlacementSetting,
  ToolbarAutoHideSetting,
  TitleBarSetting,
  ContentBlockerSetting,
  BlockerAllowedSitesSetting,
  BlockerCookieNoticesSetting,
  BlockerAnnoyancesSetting,
  DefaultZoomSetting,
  SiteZoomSetting,
  SitePermissionsSetting,
  StartupSetting,
  StartupPagesSetting,
  DownloadFolderSetting,
  AskDownloadSetting,
  TabSleepSetting,
  TabSleepAfterSetting,
  NewTabSearchSetting,
  NewTabClockSetting,
  NewTabTilesSetting,
  NewTabMostVisitedSetting,
  NewTabBackgroundSetting,
  HomeButtonSetting,
  HomePageSetting,
  HttpsFirstSetting,
  HttpAllowlistSetting,
  SecureDnsSetting,
  SecureDnsTemplatesSetting,
  CommandPaletteSetting,
  ShortcutsSetting,
  AltOpensMenuSetting,
  BlockThirdPartyCookiesSetting,
  SetupShownSetting,
  BookmarksBarSetting,
  SplitViewSetting,
  WorkspacesSetting,
  WorkspacesEnabledSetting,
  WorkspacesRemovedSetting,
  ReaderEnabledSetting,
  ReaderFontSetting,
  PictureInPictureEnabledSetting,
  LanguageSetting,
];
