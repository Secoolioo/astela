import * as v from 'valibot';
import { accentPresets } from '../domain/appearance/accent.ts';
import {
  colorModes,
  densities,
  type ColorMode,
  type Density,
} from '../domain/appearance/appearance.ts';
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

/** Where the tab strip is; vertical positions show the tabs as a list at the side. */
export const TabStripPositionSetting = defineSetting<TabStripPosition>({
  key: 'tabs.position',
  schema: v.picklist(tabStripPositions),
  default: 'top',
  scope: 'global',
  policy: { name: 'TabStripPosition', recommended: true },
  ui: { section: 'appearance', control: 'select', order: 4 },
});

/** Whether the content blocker blocks ads, trackers and known malware. */
export const ContentBlockerSetting = defineSetting<boolean>({
  key: 'contentBlocker.enabled',
  schema: v.boolean(),
  default: true,
  scope: 'global',
  policy: { name: 'ContentBlockerEnabled', recommended: true },
  ui: { section: 'privacy', control: 'toggle', order: 1 },
});

/** Sites, by host name, on which the content blocker is off. */
export const BlockerAllowedSitesSetting = defineSetting<string[]>({
  key: 'contentBlocker.allowedSites',
  schema: v.pipe(
    v.array(v.pipe(v.string(), v.regex(/^[a-z0-9.:[\]-]{1,253}$/i, 'Must be a host name'))),
    v.maxLength(10_000),
  ),
  default: [],
  scope: 'global',
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

/** Settings that exist before any feature module contributes its own. */
export const coreSettings = [
  SearchUrlTemplate,
  ColorModeSetting,
  AccentSetting,
  DensitySetting,
  TabStripPositionSetting,
  ContentBlockerSetting,
  BlockerAllowedSitesSetting,
  StartupSetting,
  SetupShownSetting,
  BookmarksBarSetting,
];
