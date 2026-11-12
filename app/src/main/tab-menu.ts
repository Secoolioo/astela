import { Menu, type MenuItemConstructorOptions } from 'electron';
import { uiLocale } from './ui-language.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { Translator } from '../shared/i18n/i18n.ts';
import { acceleratorOf, shortcutsOf, type WindowCommand } from '../shared/shortcuts.ts';
import { translatorFor, type MessageKey } from './i18n/i18n.ts';

/** What the menu of a tab needs from the window of the tab. */
export type TabMenuWindow = Pick<
  BrowserWindowController,
  'tabs' | 'tabAction' | 'setMuted' | 'shortcuts' | 'tabStripPosition'
>;

/**
 * Shows the menu of a tab, at a point of the shell: a new tab next to it, reload, duplicate,
 * pin, mute and the ways to close tabs.
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
  const index = window.tabs.all.indexOf(tab);
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
  return [
    {
      label: i18n.t(vertical ? 'tabMenu.newTabBelow' : 'tabMenu.newTabRight'),
      click: () => window.tabAction(tabId, 'newTabRight'),
    },
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
      enabled: window.tabs.all.some((other) => other.id !== tabId && !other.pinned),
      click: () => window.tabAction(tabId, 'closeOthers'),
    },
    {
      label: i18n.t(vertical ? 'tabMenu.closeBelow' : 'tabMenu.closeRight'),
      ...ofTab('tab.closeRight'),
      enabled: window.tabs.all.some((other, place) => place > index && !other.pinned),
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
