import type { SettingUi } from '../domain/settings/setting.ts';

/**
 * Where each setting has its row on the settings page, by the key of the setting; a setting
 * without one has no row there and is not among the settings that the command palette finds,
 * and only the system's dialog sets a setting whose control is `folder`. Only the settings
 * page, the command palette and the settings file read it, so it loads with them and not with
 * the definitions, which every start reads.
 */
export const settingUi: ReadonlyMap<string, SettingUi> = new Map<string, SettingUi>([
  ['search.urlTemplate', { section: 'search', control: 'text' }],
  ['search.engines', { section: 'search', control: 'list', order: 2 }],
  ['search.bangs', { section: 'search', control: 'toggle', order: 3 }],
  ['appearance.colorMode', { section: 'appearance', control: 'select', order: 1 }],
  ['appearance.accent', { section: 'appearance', control: 'color', order: 2 }],
  ['appearance.theme', { section: 'appearance', control: 'select', order: 2 }],
  ['appearance.customTheme', { section: 'appearance', control: 'color', order: 2 }],
  ['appearance.density', { section: 'appearance', control: 'select', order: 3 }],
  ['appearance.textSize', { section: 'appearance', control: 'select', order: 6 }],
  ['appearance.font', { section: 'appearance', control: 'text', order: 7 }],
  ['fonts.web', { section: 'appearance', control: 'text', order: 9 }],
  ['fonts.size', { section: 'appearance', control: 'select', order: 8 }],
  ['toolbar.items', { section: 'appearance', control: 'list', order: 11 }],
  ['tabs.position', { section: 'appearance', control: 'select', order: 4 }],
  ['toolbar.placement', { section: 'appearance', control: 'select', order: 4 }],
  ['toolbar.autoHide', { section: 'appearance', control: 'toggle', order: 4 }],
  ['appearance.titleBar', { section: 'appearance', control: 'select', order: 5 }],
  ['contentBlocker.enabled', { section: 'privacy', control: 'toggle', order: 1 }],
  ['contentBlocker.allowedSites', { section: 'privacy', control: 'list', order: 4 }],
  ['contentBlocker.cookieNotices', { section: 'privacy', control: 'toggle', order: 2 }],
  ['contentBlocker.annoyances', { section: 'privacy', control: 'toggle', order: 3 }],
  ['zoom.default', { section: 'appearance', control: 'select', order: 10 }],
  ['permissions.sites', { section: 'privacy', control: 'list', order: 5 }],
  ['startup.page', { section: 'startup', control: 'select', order: 1 }],
  ['startup.urls', { section: 'startup', control: 'list', order: 2 }],
  ['privacy.httpsFirst', { section: 'privacy', control: 'toggle', order: 6 }],
  ['network.secureDns', { section: 'privacy', control: 'select', order: 7 }],
  ['network.secureDnsTemplates', { section: 'privacy', control: 'text', order: 8 }],
  ['commandPalette.enabled', { section: 'shortcuts', control: 'toggle', order: 0 }],
  ['keys.shortcuts', { section: 'shortcuts', control: 'list', order: 1 }],
  // macOS opens its menus from the menu bar, so Alt has no row there.
  ...(process.platform === 'darwin'
    ? []
    : [['keys.altOpensMenu', { section: 'shortcuts', control: 'toggle', order: 2 }] as const]),
  ['privacy.blockThirdPartyCookies', { section: 'privacy', control: 'toggle', order: 9 }],
  ['home.button', { section: 'startup', control: 'toggle', order: 3 }],
  ['home.page', { section: 'startup', control: 'text', order: 4 }],
  ['downloads.folder', { section: 'downloads', control: 'folder', order: 1 }],
  ['downloads.ask', { section: 'downloads', control: 'toggle', order: 2 }],
  ['tabs.sleep', { section: 'performance', control: 'toggle', order: 1 }],
  ['tabs.sleepAfter', { section: 'performance', control: 'select', order: 2 }],
  ['newtab.search', { section: 'newtab', control: 'toggle', order: 1 }],
  ['newtab.clock', { section: 'newtab', control: 'toggle', order: 2 }],
  ['newtab.tiles', { section: 'newtab', control: 'list', order: 3 }],
  ['newtab.mostVisited', { section: 'newtab', control: 'toggle', order: 4 }],
  ['newtab.background', { section: 'newtab', control: 'color', order: 5 }],
  ['bookmarks.bar', { section: 'appearance', control: 'toggle', order: 5 }],
  ['splitView.enabled', { section: 'appearance', control: 'toggle', order: 6 }],
  ['workspaces.enabled', { section: 'appearance', control: 'toggle', order: 7 }],
  ['reader.enabled', { section: 'pageTools', control: 'toggle', order: 1 }],
  ['reader.font', { section: 'pageTools', control: 'select', order: 2 }],
  ['pictureInPicture.enabled', { section: 'pageTools', control: 'toggle', order: 3 }],
  ['i18n.language', { section: 'languages', control: 'select', order: 1 }],
]);

/**
 * The keys of the settings that have no row on the settings page on this system, in the order of
 * their definitions: the command palette does not offer them.
 * @param definitions - The definitions of the settings.
 */
export function settingsWithoutRow(definitions: readonly { readonly key: string }[]): string[] {
  return definitions.flatMap((definition) =>
    settingUi.has(definition.key) ? [] : [definition.key],
  );
}
