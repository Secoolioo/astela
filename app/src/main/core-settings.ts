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
import { tabStripPositions, type TabStripPosition } from '../shared/layout.ts';

/**
 * Search URL used by the address bar, with `%s` for the query. The default engine is a
 * plain search URL; no partnership or tracking parameter is involved.
 */
export const SearchUrlTemplate = defineSetting({
  key: 'search.urlTemplate',
  schema: v.pipe(v.string(), v.regex(/^https:\/\/[^\s]+%s[^\s]*$/, 'Must be an https URL with %s')),
  default: 'https://duckduckgo.com/?q=%s',
  scope: 'global',
  policy: { name: 'DefaultSearchProviderSearchURL', sensitive: true },
  ui: { section: 'search', control: 'text' },
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

/** What the browser shows when it starts: the tabs of the last session, or a new tab page. */
export const StartupSetting = defineSetting<'restore' | 'newtab'>({
  key: 'startup.page',
  schema: v.picklist(['restore', 'newtab']),
  default: 'restore',
  scope: 'global',
  ui: { section: 'startup', control: 'select', order: 1 },
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
  ColorModeSetting,
  AccentSetting,
  DensitySetting,
  TextSizeSetting,
  UiFontSetting,
  WebTextSizeSetting,
  WebFontsSetting,
  TabStripPositionSetting,
  ContentBlockerSetting,
  BlockerAllowedSitesSetting,
  BlockerCookieNoticesSetting,
  BlockerAnnoyancesSetting,
  SiteZoomSetting,
  SitePermissionsSetting,
  StartupSetting,
  SetupShownSetting,
  BookmarksBarSetting,
  LanguageSetting,
];
