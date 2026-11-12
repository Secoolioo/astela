import { bangs } from '../../shared/bangs.ts';
import { searchEngines } from '../../shared/search-engines.ts';
import { folded } from '../../shared/search-text.ts';
import { secureDnsProviders } from '../../shared/secure-dns.ts';
import { windowCommands, type WindowCommand } from '../../shared/shortcuts.ts';
import { themeIds } from '../../shared/themes.ts';
import { catalogs, isMessageKey, Translator, type MessageKey } from '../i18n/i18n.ts';

/** The options of the settings that the settings page offers as a choice between a few values. */
export const choices = {
  'appearance.colorMode': ['system', 'light', 'dark'],
  'appearance.density': ['compact', 'normal', 'comfortable'],
  'appearance.textSize': ['small', 'medium', 'large', 'larger'],
  'tabs.position': ['top', 'bottom', 'left', 'right'],
  'appearance.titleBar': ['integrated', 'system'],
  'startup.page': ['restore', 'newtab', 'pages'],
} as const;

/** A setting that the settings page offers as a choice between a few values. */
export type ChoiceKey = keyof typeof choices;

/** A row of the settings page: a setting, or a part such as the import. */
export interface SettingsRow {
  /**
   * The setting's key, or the part's name, such as `clear-data`. Links name the row after
   * `#`, such as `app://settings/#tabs.position`.
   */
  readonly id: string;
  /** The settings that the row shows, when they are more than the one its id names. */
  readonly settings?: readonly string[];
  /** The texts that find the row, in every language; the first one names it. */
  readonly keys: readonly MessageKey[];
  /** Words that find the row in every language, such as the names of search engines. */
  readonly words?: readonly string[];
  /** A setting and its value without which the page leaves the row out. */
  readonly when?: { readonly key: string; readonly value: unknown };
}

/** A section of the settings page, with its rows in their order. */
export interface SettingsSection {
  /** The name of the section; links name it after `#`, such as `app://settings/#privacy`. */
  readonly id: string;
  readonly title: MessageKey;
  /** Whether the page draws the rows of the section without a frame. */
  readonly plain?: boolean;
  readonly rows: readonly SettingsRow[];
}

/** The id of the row of a command in the list of keyboard shortcuts. */
export function shortcutRowId(command: WindowCommand): `shortcut-${WindowCommand}` {
  return `shortcut-${command}`;
}

/**
 * The key of the name of a command. With the tab strip at a side, the tabs to the right of a
 * tab are the tabs below it, as the menu of a tab says.
 * @param command - The command.
 * @param sideTabs - Whether the tab strip is at a side.
 */
export function commandNameKey(command: WindowCommand, sideTabs: boolean): MessageKey {
  return sideTabs && command === 'tab.closeRight'
    ? 'shortcut.tab.closeBelow'
    : `shortcut.${command}`;
}

/**
 * The name of a language in that language, such as Deutsch.
 * @param code - A language code, such as `de`.
 */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The keys of the names of the options of a choice. */
function optionKeys(key: ChoiceKey, label: MessageKey): MessageKey[] {
  return choices[key].map((option) => `${label}.${option}`).filter(isMessageKey);
}

/**
 * The sections and rows of the settings page, in their order, with the texts that find each
 * row. The settings page draws them, and other pages of the browser can search them. Each row
 * needs a view on the settings page, which finds it by the row's id.
 */
export const settingsIndex: readonly SettingsSection[] = [
  {
    id: 'appearance',
    title: 'settings.appearance',
    rows: [
      {
        id: 'appearance.colorMode',
        keys: [
          'settings.colorMode',
          'settings.colorMode.keywords',
          ...optionKeys('appearance.colorMode', 'settings.colorMode'),
        ],
      },
      {
        id: 'appearance.theme',
        settings: ['appearance.theme', 'appearance.customTheme'],
        keys: [
          'settings.theme',
          'settings.themeNote',
          'settings.theme.keywords',
          ...[...themeIds, 'custom' as const].map((id) => `settings.theme.${id}` as const),
        ],
      },
      { id: 'appearance.accent', keys: ['settings.accent'] },
      {
        id: 'appearance.density',
        keys: [
          'settings.density',
          'settings.density.keywords',
          ...optionKeys('appearance.density', 'settings.density'),
        ],
      },
      {
        id: 'appearance.textSize',
        keys: [
          'settings.textSize',
          'settings.textSize.keywords',
          ...optionKeys('appearance.textSize', 'settings.textSize'),
        ],
      },
      {
        id: 'appearance.font',
        keys: ['settings.font', 'settings.fontNote', 'settings.font.keywords'],
      },
      {
        id: 'fonts.size',
        keys: [
          'settings.webTextSize',
          'settings.webTextSizeNote',
          'settings.webTextSize.keywords',
          'settings.webTextSize.9',
          'settings.webTextSize.12',
          'settings.webTextSize.16',
          'settings.webTextSize.20',
          'settings.webTextSize.24',
        ],
      },
      {
        id: 'fonts.web',
        keys: [
          'settings.webFonts',
          'settings.webFontsNote',
          'settings.webFonts.keywords',
          'settings.webFont.standard',
          'settings.webFont.serif',
          'settings.webFont.sansSerif',
          'settings.webFont.fixed',
        ],
      },
      {
        id: 'zoom.default',
        keys: ['settings.pageZoom', 'settings.pageZoomNote', 'settings.pageZoom.keywords'],
      },
      {
        id: 'toolbar.items',
        keys: [
          'settings.toolbar',
          'settings.toolbarNote',
          'settings.toolbar.keywords',
          'settings.toolbar.bookmark',
          'settings.toolbar.shield',
          'settings.toolbar.downloads',
        ],
      },
      {
        id: 'tabs.position',
        keys: [
          'settings.tabPosition',
          'settings.tabPosition.keywords',
          ...optionKeys('tabs.position', 'settings.tabPosition'),
        ],
      },
      {
        id: 'appearance.titleBar',
        keys: [
          'settings.titleBar',
          'settings.titleBar.keywords',
          ...optionKeys('appearance.titleBar', 'settings.titleBar'),
        ],
      },
      { id: 'bookmarks.bar', keys: ['settings.bookmarksBar', 'settings.bookmarksBarNote'] },
    ],
  },
  {
    id: 'startup',
    title: 'settings.startup',
    rows: [
      {
        id: 'startup.page',
        keys: [
          'settings.startupPage',
          'settings.startupPage.keywords',
          ...optionKeys('startup.page', 'settings.startupPage'),
        ],
      },
      // The list shows when the browser opens specific pages at start.
      {
        id: 'startup.urls',
        keys: ['settings.startupPages', 'settings.startupPagesNote'],
        when: { key: 'startup.page', value: 'pages' },
      },
      {
        id: 'home.button',
        keys: ['settings.homeButton', 'settings.homeButtonNote', 'settings.home.keywords'],
      },
      {
        id: 'home.page',
        keys: ['settings.homePage', 'settings.homePageNote', 'settings.home.keywords'],
      },
    ],
  },
  {
    id: 'newtab',
    title: 'settings.newTab',
    rows: [
      { id: 'newtab.search', keys: ['settings.newTabSearch', 'settings.newTabSearchNote'] },
      { id: 'newtab.clock', keys: ['settings.newTabClock', 'settings.newTabClockNote'] },
      {
        id: 'newtab.mostVisited',
        keys: ['settings.newTabMostVisited', 'settings.newTabMostVisitedNote'],
      },
      {
        id: 'newtab.background',
        keys: [
          'settings.newTabBackground',
          'settings.newTabBackgroundNote',
          'settings.newTabBackground.keywords',
        ],
      },
      {
        id: 'newtab.tiles',
        keys: ['settings.newTabTiles', 'settings.newTabTilesNote', 'settings.newTab.keywords'],
      },
    ],
  },
  {
    id: 'downloads',
    title: 'settings.downloads',
    rows: [
      {
        id: 'downloads.folder',
        keys: [
          'settings.downloadFolder',
          'settings.downloadFolder.keywords',
          'settings.downloadFolderSystem',
        ],
      },
      { id: 'downloads.ask', keys: ['settings.downloadAsk', 'settings.downloadAskNote'] },
    ],
  },
  {
    id: 'languages',
    title: 'settings.languages',
    rows: [
      {
        id: 'i18n.language',
        keys: [
          'settings.language',
          'settings.languageNote',
          'settings.language.keywords',
          'settings.language.system',
        ],
        words: Object.keys(catalogs).map((code) => languageName(code)),
      },
    ],
  },
  {
    id: 'search',
    title: 'settings.search',
    rows: [
      {
        id: 'search.urlTemplate',
        keys: ['settings.searchEngine', 'settings.searchEngine.keywords'],
        words: searchEngines.map((engine) => engine.name),
      },
      {
        id: 'search.engines',
        keys: [
          'settings.searchEngines',
          'settings.searchEnginesNote',
          'settings.searchEngines.keywords',
        ],
        words: searchEngines.map((engine) => engine.keyword),
      },
      {
        id: 'search.bangs',
        keys: ['settings.bangs', 'settings.bangsNote'],
        words: bangs.map((site) => site.name),
      },
    ],
  },
  {
    id: 'privacy',
    title: 'settings.privacy',
    rows: [
      {
        id: 'contentBlocker.enabled',
        keys: [
          'settings.contentBlocker',
          'settings.contentBlockerNote',
          'settings.contentBlocker.keywords',
        ],
      },
      {
        id: 'contentBlocker.cookieNotices',
        keys: [
          'settings.cookieNotices',
          'settings.cookieNoticesNote',
          'settings.contentBlocker.keywords',
        ],
      },
      {
        id: 'contentBlocker.annoyances',
        keys: [
          'settings.annoyances',
          'settings.annoyancesNote',
          'settings.contentBlocker.keywords',
        ],
      },
      {
        id: 'contentBlocker.allowedSites',
        keys: [
          'settings.allowedSites',
          'settings.allowedSitesNote',
          'settings.contentBlocker.keywords',
        ],
      },
      {
        id: 'privacy.blockThirdPartyCookies',
        keys: [
          'settings.thirdPartyCookies',
          'settings.thirdPartyCookiesNote',
          'settings.thirdPartyCookies.keywords',
        ],
      },
      {
        id: 'privacy.httpsFirst',
        keys: ['settings.httpsFirst', 'settings.httpsFirstNote', 'settings.httpsFirst.keywords'],
      },
      {
        id: 'network.secureDns',
        settings: ['network.secureDns', 'network.secureDnsTemplates'],
        keys: ['settings.secureDns', 'settings.secureDnsNote', 'settings.secureDns.keywords'],
        words: secureDnsProviders.map((provider) => provider.name),
      },
      {
        id: 'clear-data',
        keys: ['settings.clearData', 'settings.clearDataNote', 'settings.clearData.keywords'],
      },
      {
        id: 'permissions.sites',
        keys: [
          'settings.sitePermissions',
          'settings.sitePermissionsNote',
          'settings.sitePermissions.keywords',
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'settings.shortcuts',
    rows: [
      ...windowCommands.map((command): SettingsRow => ({
        id: shortcutRowId(command),
        // Both names of a command find its row, wherever the tab strip is.
        keys: [
          ...new Set([commandNameKey(command, false), commandNameKey(command, true)]),
          'settings.shortcuts',
        ],
      })),
      {
        id: 'shortcuts-reset',
        keys: ['settings.shortcuts', 'settings.shortcutsNote', 'settings.shortcuts.keywords'],
      },
    ],
  },
  {
    id: 'default-browser',
    title: 'defaultBrowser.title',
    rows: [{ id: 'default-browser', keys: ['defaultBrowser.title'] }],
  },
  {
    id: 'import',
    title: 'import.title',
    plain: true,
    rows: [{ id: 'import', keys: ['import.title', 'import.note'] }],
  },
  {
    id: 'setup',
    title: 'settings.setup',
    rows: [{ id: 'setup', keys: ['settings.setupGuide', 'settings.setupGuideNote'] }],
  },
];

/** The texts of the browser's pages in every shipped language: a word of each finds a row. */
const languages = Object.keys(catalogs).map((code) => new Translator(code));

/**
 * The texts of some keys in every shipped language, and some more words, folded for a search
 * with the functions of `shared/search-text.ts`.
 * @param keys - Message keys, such as those of a row.
 * @param words - Further words, such as the names of search engines.
 */
export function textOf(keys: readonly MessageKey[], words: readonly string[] = []): string {
  return folded(
    [...keys.flatMap((key) => languages.map((i18n) => i18n.t(key))), ...words].join(' '),
  );
}
