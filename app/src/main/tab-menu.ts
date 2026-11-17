import { Menu, type MenuItemConstructorOptions } from 'electron';
import { uiLocale } from './ui-language.ts';
import { labelLimit } from '../domain/menus/browser-menu.ts';
import { editGroups, groupsOf, type TabGroup } from '../domain/tabs/tab-groups.ts';
import type { Tab } from '../domain/tabs/tab-service.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { Translator } from '../shared/i18n/i18n.ts';
import type { Workspace } from '../shared/workspaces.ts';
import { acceleratorOf, shortcutsOf } from '../shared/menu-shortcuts.ts';
import type { WindowCommand } from '../shared/shortcuts.ts';
import { translatorFor, type MessageKey } from './i18n/i18n.ts';

/** What the menu of a tab needs from the window of the tab. */
export type TabMenuWindow = Pick<
  BrowserWindowController,
  'tabs' | 'tabAction' | 'setMuted' | 'canSleep' | 'shortcuts' | 'tabStripPosition' | 'splitView'
>;

/** What the menu of a tab needs besides its window. */
export interface TabMenuOptions {
  /** Opens the popover of a group at its chip, such as of the group that the menu made. */
  readonly editGroup?: (groupId: string) => void;
  /**
   * The workspaces that the tab can move into, and whether it loads again in each of them, as
   * its partition changes; none in private windows, popups and while workspaces are off.
   */
  readonly workspaces?: readonly { readonly workspace: Workspace; readonly reload: boolean }[];
  /** Moves the tab into a workspace. */
  readonly moveToWorkspace?: (workspaceId: string) => void;
}

/**
 * Shows the menu of a tab, at a point of the shell: a new tab next to it, split view, groups,
 * workspaces, reload, duplicate, pin, mute, sleep and the ways to close tabs.
 * @param window - The window of the tab.
 * @param tabId - The tab whose menu opens.
 * @param position - Where the menu opens, in the window's coordinates.
 * @param options - What the items of groups need.
 */
export function popupTabMenu(
  window: BrowserWindowController,
  tabId: string,
  position: { readonly x: number; readonly y: number },
  options: TabMenuOptions = {},
): void {
  const i18n = translatorFor(uiLocale(), process.platform);
  const template = tabMenuTemplate(window, tabId, i18n, options);
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
 * @param options - What the items of groups need.
 */
export function tabMenuTemplate(
  window: TabMenuWindow,
  tabId: string,
  i18n: Translator<MessageKey>,
  options: TabMenuOptions = {},
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
    ...groupItems(window, tab, i18n, whileOpen, options),
    ...workspaceItems(i18n, whileOpen, options),
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

/**
 * The items of groups in the menu of a tab that is not pinned: to put it in a new group, whose
 * popover opens, or in another group of the window, and to take it out of its group.
 * @param window - The window of the tab.
 * @param tab - The tab whose menu opens.
 * @param i18n - The texts of the browser process.
 * @param whileOpen - Runs an item only while the tab is open.
 * @param options - What the items of groups need.
 */
function groupItems(
  window: TabMenuWindow,
  tab: Tab,
  i18n: Translator<MessageKey>,
  whileOpen: (run: () => void) => () => void,
  options: TabMenuOptions,
): MenuItemConstructorOptions[] {
  if (tab.pinned) return [];
  const others = groupsOf(window.tabs.all).filter((group) => group.id !== tab.group?.id);
  const create = whileOpen(() => {
    const group = editGroups(window.tabs, (strip) => strip.createGroup(tab.id));
    if (group !== undefined) options.editGroup?.(group.id);
  });
  const nameOf = (group: TabGroup): string => {
    const first = window.tabs.all.find((other) => other.group?.id === group.id);
    return group.name !== ''
      ? menuLabel(group.name)
      : i18n.t('tabMenu.groupWith', { title: menuLabel(first?.title || (first?.url ?? '')) });
  };
  return [
    others.length === 0
      ? { label: i18n.t('tabMenu.addToNewGroup'), click: create }
      : {
          label: i18n.t('tabMenu.addToGroup'),
          submenu: [
            { label: i18n.t('tabMenu.newGroup'), click: create },
            { type: 'separator' },
            ...others.map((group): MenuItemConstructorOptions => ({
              label: nameOf(group),
              click: whileOpen(
                () => void editGroups(window.tabs, (strip) => strip.addToGroup(tab.id, group.id)),
              ),
            })),
          ],
        },
    ...(tab.group === null
      ? []
      : [
          {
            label: i18n.t('tabMenu.removeFromGroup'),
            click: whileOpen(
              () => void editGroups(window.tabs, (strip) => strip.removeFromGroup(tab.id)),
            ),
          },
        ]),
  ];
}

/**
 * The item that moves a tab into another workspace, with a submenu of the workspaces, while the
 * window has another one to move it into. A workspace whose partition differs says that the tab
 * loads again there.
 * @param i18n - The texts of the browser process.
 * @param whileOpen - Runs an item only while the tab is open.
 * @param options - The workspaces and the move.
 */
function workspaceItems(
  i18n: Translator<MessageKey>,
  whileOpen: (run: () => void) => () => void,
  options: TabMenuOptions,
): MenuItemConstructorOptions[] {
  const targets = options.workspaces ?? [];
  if (targets.length === 0) return [];
  return [
    {
      label: i18n.t('tabMenu.moveToWorkspace'),
      submenu: targets.map(({ workspace, reload }): MenuItemConstructorOptions => {
        const name =
          workspace.name === '' ? i18n.t('workspace.default') : menuLabel(workspace.name);
        return {
          label: reload ? i18n.t('tabMenu.workspaceReload', { name }) : name,
          click: whileOpen(() => options.moveToWorkspace?.(workspace.id)),
        };
      }),
    },
  ];
}

/** Splits text into the characters that a person sees, made with the first long title. */
let segmenter: Intl.Segmenter | undefined;

/**
 * A name of a group or a title of a page in the menu of a tab: no access key, as each `&` is
 * doubled, also on macOS, whose menus hide an `&` and show `&&` as one; and a long title cut
 * after {@link labelLimit} characters that a person sees, as in the menus of bookmarks. It
 * reads no further than that, as a page without a title shows its address, which can be
 * megabytes long.
 * @param text - The name or the title.
 */
function menuLabel(text: string): string {
  let shown = text;
  if (text.length > labelLimit) {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const { index } of segmenter.segment(text)) {
      if (count === labelLimit) {
        shown = `${text.slice(0, index).trimEnd()}…`;
        break;
      }
      count += 1;
    }
  }
  return shown.replaceAll('&', '&&');
}
