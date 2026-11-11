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
import { maxSites, type SitePermissions } from '../domain/permissions/site-permissions.ts';
import { defineSetting } from '../domain/settings/setting.ts';
import {
  tabStripPositions,
  toolbarItems,
  type TabStripPosition,
  type ToolbarItem,
} from '../shared/layout.ts';
import type { CustomSearchEngine } from '../shared/search-engines.ts';
import { zoomFactors } from '../shared/zoom.ts';

/** The search address of an engine: https, with `%s` for the query. */
const SearchAddress = v.pipe(
  v.string(),
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
  ui: { section: 'search', control: 'text' },
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
  ui: { section: 'search', control: 'list', order: 2 },
});

/** Whether a `!bang` at the start or the end of a search, such as `!w`, searches its site. */
export const SearchBangsSetting = defineSetting<boolean>({
  key: 'search.bangs',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  ui: { section: 'search', control: 'toggle', order: 3 },
});

/** Whether the browser follows the system's light or dark mode, or always uses one. */
export const ColorModeSetting = defineSetting<ColorMode>({
  key: 'appearance.colorMode',
  schema: v.picklist(colorModes),
  default: 'system',
  scope: 'global',
  ui: { section: 'appearance', control: 'select', order: 1 },
});

/** Accent color: a preset such as `blue`, or a custom `#rrggbb` color. */
export const AccentSetting = defineSetting({
  key: 'appearance.accent',
  schema: v.union([
    v.picklist(accentPresets),
    v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i, 'Must be a preset or a #rrggbb color')),
  ]),
  default: 'blue',
  scope: 'global',
  ui: { section: 'appearance', control: 'color', order: 2 },
});

/** Size of the toolbar and the tabs. */
export const DensitySetting = defineSetting<Density>({
  key: 'appearance.density',
  schema: v.picklist(densities),
  default: 'normal',
  scope: 'global',
  ui: { section: 'appearance', control: 'select', order: 3 },
});

/** A font, by the name of its family; empty for the default. */
const FontName = v.pipe(v.string(), v.regex(fontNamePattern, 'Must be the name of a font'));

/** How large the text of the browser's own UI is; the density sets its spacing. */
export const TextSizeSetting = defineSetting<TextSize>({
  key: 'appearance.textSize',
  schema: v.picklist(textSizes),
  default: 'medium',
  scope: 'global',
  ui: { section: 'appearance', control: 'select', order: 6 },
});

/** The font of the browser's own UI, by its name; empty keeps the font of the system. */
export const UiFontSetting = defineSetting<string>({
  key: 'appearance.font',
  schema: FontName,
  default: '',
  scope: 'global',
  ui: { section: 'appearance', control: 'text', order: 7 },
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
  ui: { section: 'appearance', control: 'text', order: 9 },
});

/** The size of the text of web pages that set none, in CSS pixels; new tabs use it. */
export const WebTextSizeSetting = defineSetting<number>({
  key: 'fonts.size',
  schema: v.pipe(v.number(), v.integer(), v.minValue(6), v.maxValue(72)),
  default: 16,
  scope: 'global',
  ui: { section: 'appearance', control: 'select', order: 8 },
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
  ui: { section: 'appearance', control: 'list', order: 11 },
});

/** Where the tab strip is; vertical positions show the tabs as a list at the side. */
export const TabStripPositionSetting = defineSetting<TabStripPosition>({
  key: 'tabs.position',
  schema: v.picklist(tabStripPositions),
  default: 'top',
  scope: 'global',
  policy: { name: 'TabStripPosition', recommended: true },
  ui: { section: 'appearance', control: 'select', order: 4 },
});

/** Whether the content blocker blocks ads, trackers and what pages load from known malware hosts. */
export const ContentBlockerSetting = defineSetting<boolean>({
  key: 'contentBlocker.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'ContentBlockerEnabled', recommended: true },
  ui: { section: 'privacy', control: 'toggle', order: 1 },
});

/** Sites, by host name or domain, on which the content blocker is off; a domain covers its hosts. */
export const BlockerAllowedSitesSetting = defineSetting<string[]>({
  key: 'contentBlocker.allowedSites',
  schema: v.pipe(
    v.array(v.pipe(v.string(), v.regex(/^[a-z0-9.:[\]-]{1,253}$/i, 'Must be a host name'))),
    v.maxLength(10_000),
  ),
  default: [],
  scope: 'global',
  ui: { section: 'privacy', control: 'list', order: 4 },
});

/** Whether the content blocker also hides cookie notices, with the optional lists for them. */
export const BlockerCookieNoticesSetting = defineSetting<boolean>({
  key: 'contentBlocker.cookieNotices',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'ContentBlockerCookieNoticesEnabled', recommended: true },
  ui: { section: 'privacy', control: 'toggle', order: 2 },
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
  ui: { section: 'privacy', control: 'toggle', order: 3 },
});

/** The zoom of pages whose site has no zoom of its own, as a factor of their size. */
export const DefaultZoomSetting = defineSetting<number>({
  key: 'zoom.default',
  schema: v.picklist(zoomFactors),
  default: 1,
  scope: 'global',
  ui: { section: 'appearance', control: 'select', order: 10 },
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
 * What sites may use after the user answered their question, by origin, such as
 * `{"https://meet.example": {"camera": "allow", "notifications": "block"}}`.
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
      }),
    ),
    v.check((sites) => Object.keys(sites).length <= maxSites, 'Too many sites'),
  ),
  default: {},
  scope: 'global',
  ui: { section: 'privacy', control: 'list', order: 5 },
});

/** A web address, such as a page to open at start. */
const WebAddress = v.pipe(
  v.string(),
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
  ui: { section: 'startup', control: 'select', order: 1 },
});

/** The pages that open at start when `startup.page` is `pages`, in this order. */
export const StartupPagesSetting = defineSetting<string[]>({
  key: 'startup.urls',
  schema: v.pipe(v.array(WebAddress), v.maxLength(100)),
  default: [],
  scope: 'global',
  policy: { name: 'RestoreOnStartupURLs', recommended: true },
  ui: { section: 'startup', control: 'list', order: 2 },
});

/** Whether the toolbar has a home button, which opens the home page. */
export const HomeButtonSetting = defineSetting<boolean>({
  key: 'home.button',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'ShowHomeButton', recommended: true },
  ui: { section: 'startup', control: 'toggle', order: 3 },
});

/** The page of the home button; empty for the new tab page. */
export const HomePageSetting = defineSetting<string>({
  key: 'home.page',
  schema: v.union([v.literal(''), WebAddress]),
  default: '',
  scope: 'global',
  policy: { name: 'HomepageLocation', recommended: true },
  ui: { section: 'startup', control: 'text', order: 4 },
});

/** The folder where downloads are saved; empty for the downloads folder of the system. */
export const DownloadFolderSetting = defineSetting<string>({
  key: 'downloads.folder',
  schema: v.pipe(v.string(), v.maxLength(4096)),
  default: '',
  scope: 'global',
  policy: { name: 'DownloadDirectory', recommended: true },
  ui: { section: 'downloads', control: 'folder', order: 1 },
});

/** Whether the browser asks where to save each download. */
export const AskDownloadSetting = defineSetting<boolean>({
  key: 'downloads.ask',
  schema: v.boolean(),
  default: false,
  scope: 'global',
  policy: { name: 'PromptForDownloadLocation', recommended: true },
  ui: { section: 'downloads', control: 'toggle', order: 2 },
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
  ui: { section: 'appearance', control: 'toggle', order: 5 },
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
  ui: { section: 'languages', control: 'select', order: 1 },
});

/** Settings that exist before any feature module contributes its own. */
export const coreSettings = [
  SearchUrlTemplate,
  SearchEnginesSetting,
  SearchBangsSetting,
  ColorModeSetting,
  AccentSetting,
  DensitySetting,
  TextSizeSetting,
  UiFontSetting,
  WebTextSizeSetting,
  WebFontsSetting,
  ToolbarItemsSetting,
  TabStripPositionSetting,
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
  HomeButtonSetting,
  HomePageSetting,
  SetupShownSetting,
  BookmarksBarSetting,
  LanguageSetting,
];
