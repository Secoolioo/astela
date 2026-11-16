import { Menu, type MenuItemConstructorOptions } from 'electron';
import { uiLocale } from './ui-language.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { Translator } from '../shared/i18n/i18n.ts';
import { acceleratorOf, shortcutsOf } from '../shared/menu-shortcuts.ts';
import type { WindowCommand } from '../shared/shortcuts.ts';
import { translatorFor, type MessageKey } from './i18n/i18n.ts';

/** What the menu of a tab needs from the window of the tab. */
export type TabMenuWindow = Pick<
  BrowserWindowController,
  'tabs' | 'tabAction' | 'setMuted' | 'canSleep' | 'shortcuts' | 'tabStripPosition' | 'splitView'
>;

/**
 * Shows the menu of a tab, at a point of the shell: a new tab next to it, split view, reload,
 * duplicate, pin, mute, sleep and the ways to close tabs.
 * @param window - The window of the tab.
 * @param tabId - The tab whose menu opens.
 * @param position - Where the menu opens, in the window's coordinates.
 */
export function popupTabMenu(
  window: BrowserWindowController,
  tabId: string,
  position: { readonly x: number; readonly y: number },
): void {
  const template = tabMenuTemplate(window, tabId, translatorFor(uiLocale(), process.platform));
  if (template === undefined) return;
  Menu.buildFromTemplate(template).popup({ window: window.window, x: position.x, y: position.y });
}

/**
 * The items of the menu of a tab, or `undefined` when the tab is gone. The menu keeps the
 * event loop running while it is open, so the tab can close meanwhile: then the items that
 * act on the tab do nothing.
 * @param window - The window of the tab.
 * @param tabId - The tab whose menu opens.
 * @param i18n - The texts of the browser process, in the language of its menus.
 */
export function tabMenuTemplate(
  window: TabMenuWindow,
  tabId: string,
  i18n: Translator<MessageKey>,
): MenuItemConstructorOptions[] | undefined {
  const tab = window.tabs.all.find((candidate) => candidate.id === tabId);
  if (tab === undefined) return undefined;
  const table = window.shortcuts();
  // A tab strip at a side lists the tabs from top to bottom.
  const position = window.tabStripPosition();
  const vertical = position === 'left' || position === 'right';
  // The first shortcut of a command that Electron can write; menus show it for reference.
  const shortcut = (command: WindowCommand): { accelerator?: string } => {
    const accelerator = shortcutsOf(table, command)
      .map(acceleratorOf)
      .find((candidate) => candidate !== undefined);
    return accelerator === undefined ? {} : { accelerator };
  };
  // The shortcuts of the commands of the tab act on the active tab, so only its menu shows them.
  const active = tabId === window.tabs.active?.id;
  const ofTab = (command: WindowCommand): { accelerator?: string; registerAccelerator?: false } =>
    active ? { ...shortcut(command), registerAccelerator: false } : {};
  // Runs an item only while the tab is open.
  const whileOpen =
    (run: () => void): (() => void) =>
    () => {
      if (window.tabs.all.some((candidate) => candidate.id === tabId)) run();
    };
  // The other tab of a split view stays with the tab, and the tabs to its right start after it.
  const unit = window.tabs.unitOf(tabId);
  const end = Math.max(...unit.map((id) => window.tabs.all.findIndex((other) => other.id === id)));
  return [
    {
      label: i18n.t(vertical ? 'tabMenu.newTabBelow' : 'tabMenu.newTabRight'),
      click: () => window.tabAction(tabId, 'newTabRight'),
    },
    ...splitItems(window, tab, i18n, ofTab, whileOpen),
    { type: 'separator' },
    {
      label: i18n.t('tabMenu.reload'),
      click: whileOpen(() => window.tabs.run(tabId, 'reload')),
    },
    {
      label: i18n.t('tabMenu.duplicate'),
      ...ofTab('tab.duplicate'),
      click: () => window.tabAction(tabId, 'duplicate'),
    },
    {
      label: i18n.t(tab.pinned ? 'tabMenu.unpin' : 'tabMenu.pin'),
      ...ofTab('tab.pin'),
      click: whileOpen(() => window.tabs.pin(tabId, !tab.pinned)),
    },
    {
      label: i18n.t(tab.muted ? 'tabMenu.unmute' : 'tabMenu.mute'),
      ...ofTab('tab.mute'),
      click: () => window.setMuted(tabId, !tab.muted),
    },
    // A tab that shows, sleeps already or is busy, such as with sound or a camera, stays awake.
    {
      label: i18n.t('tabMenu.sleep'),
      enabled: window.canSleep(tabId, 'manual'),
      click: whileOpen(() => void window.tabs.sleep(tabId, 'manual')),
    },
    { type: 'separator' },
    {
      label: i18n.t('tabMenu.close'),
      ...ofTab('tab.close'),
      registerAccelerator: false,
      click: whileOpen(() => window.tabs.close(tabId)),
    },
    {
      label: i18n.t('tabMenu.closeOthers'),
      ...ofTab('tab.closeOthers'),
      enabled: window.tabs.all.some((other) => !unit.includes(other.id) && !other.pinned),
      click: () => window.tabAction(tabId, 'closeOthers'),
    },
    {
      label: i18n.t(vertical ? 'tabMenu.closeBelow' : 'tabMenu.closeRight'),
      ...ofTab('tab.closeRight'),
      enabled: window.tabs.all.some((other, place) => place > end && !other.pinned),
      click: () => window.tabAction(tabId, 'closeRight'),
    },
    { type: 'separator' },
    {
      label: i18n.t('tabMenu.reopen'),
      ...shortcut('tab.reopen'),
      registerAccelerator: false,
      click: () => window.tabs.reopenClosed(),
    },
  ];
}

/**
 * The items of split view in the menu of a tab, while windows may show two tabs side by side:
 * to end the split view of a tab and swap its sides, or else to open the tab beside the active
 * tab, or a new tab beside the active tab itself. Pinned tabs are never a side.
 * @param window - The window of the tab.
 * @param tab - The tab whose menu opens.
 * @param i18n - The texts of the browser process.
 * @param ofTab - The shortcut that the item of a command of the active tab shows.
 * @param whileOpen - Runs an item only while the tab is open.
 */
function splitItems(
  window: TabMenuWindow,
  tab: { readonly id: string; readonly pinned: boolean },
  i18n: Translator<MessageKey>,
  ofTab: (command: WindowCommand) => { accelerator?: string; registerAccelerator?: false },
  whileOpen: (run: () => void) => () => void,
): MenuItemConstructorOptions[] {
  if (!window.splitView()) return [];
  const active = window.tabs.active;
  if (window.tabs.splitOf(tab.id) !== undefined) {
    return [
      {
        label: i18n.t('tabMenu.splitEnd'),
        ...ofTab('split.toggle'),
        click: whileOpen(() => window.tabAction(tab.id, 'endSplit')),
      },
      {
        label: i18n.t('tabMenu.splitSwap'),
        ...ofTab('split.swap'),
        click: whileOpen(() => window.tabAction(tab.id, 'swapSplit')),
      },
    ];
  }
  const own = tab.id === active?.id;
  return [
    {
      label: i18n.t(own ? 'tabMenu.splitNew' : 'tabMenu.splitWith'),
      ...ofTab('split.toggle'),
      enabled: !tab.pinned && active !== undefined && !active.pinned,
      click: whileOpen(() => window.tabAction(tab.id, 'split')),
    },
  ];
}
