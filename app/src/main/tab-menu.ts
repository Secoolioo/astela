import { Menu } from 'electron';
import { uiLocale } from './ui-language.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import { acceleratorOf, shortcutsOf, type WindowCommand } from '../shared/shortcuts.ts';
import { translatorFor } from './i18n/i18n.ts';

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
  const tab = window.tabs.all.find((candidate) => candidate.id === tabId);
  if (tab === undefined) return;
  const i18n = translatorFor(uiLocale(), process.platform);
  const table = window.shortcuts();
  const index = window.tabs.all.indexOf(tab);
  // The first shortcut of a command that Electron can write; menus show it for reference.
  const shortcut = (command: WindowCommand): { accelerator?: string } => {
    const accelerator = shortcutsOf(table, command)
      .map(acceleratorOf)
      .find((candidate) => candidate !== undefined);
    return accelerator === undefined ? {} : { accelerator };
  };
  const menu = Menu.buildFromTemplate([
    {
      label: i18n.t('tabMenu.newTabRight'),
      click: () => window.tabAction(tabId, 'newTabRight'),
    },
    { type: 'separator' },
    { label: i18n.t('tabMenu.reload'), click: () => window.tabs.run(tabId, 'reload') },
    { label: i18n.t('tabMenu.duplicate'), click: () => window.tabAction(tabId, 'duplicate') },
    {
      label: i18n.t(tab.pinned ? 'tabMenu.unpin' : 'tabMenu.pin'),
      click: () => window.tabs.pin(tabId, !tab.pinned),
    },
    {
      label: i18n.t(tab.muted ? 'tabMenu.unmute' : 'tabMenu.mute'),
      click: () => window.setMuted(tabId, !tab.muted),
    },
    { type: 'separator' },
    {
      label: i18n.t('tabMenu.close'),
      ...(tabId === window.tabs.active?.id ? shortcut('tab.close') : {}),
      registerAccelerator: false,
      click: () => window.tabs.close(tabId),
    },
    {
      label: i18n.t('tabMenu.closeOthers'),
      enabled: window.tabs.all.some((other) => other.id !== tabId && !other.pinned),
      click: () => window.tabAction(tabId, 'closeOthers'),
    },
    {
      label: i18n.t('tabMenu.closeRight'),
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
  ]);
  menu.popup({ window: window.window, x: position.x, y: position.y });
}
