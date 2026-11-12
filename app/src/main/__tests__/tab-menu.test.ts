import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { TabService, type TabViewPort } from '../../domain/tabs/tab-service.ts';
import type { TabStripPosition } from '../../shared/layout.ts';
import { shortcutTable } from '../../shared/shortcuts.ts';
import { translatorFor } from '../i18n/i18n.ts';
import { tabMenuTemplate, type TabMenuWindow } from '../tab-menu.ts';
import { accessKeyProblems } from './access-keys.ts';

// The items of the menu need nothing of Electron; showing the menu does.
vi.mock('electron', () => ({ app: {}, Menu: {} }));

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Views that only record what the tabs ask of them. */
class FakeViews implements TabViewPort {
  readonly log: string[] = [];
  create(): void {}
  show(): void {}
  destroy(id: string): void {
    this.log.push(`destroy ${id}`);
  }
  load(): void {}
  run(id: string, action: string): void {
    this.log.push(`${action} ${id}`);
  }
}

/** A window with three tabs, the second of them pinned or muted when asked, and its tab strip. */
function windowWith(
  position: TabStripPosition,
  tab: { readonly pinned?: boolean; readonly muted?: boolean } = {},
): { window: Mutable<TabMenuWindow>; views: FakeViews; ids: string[] } {
  const views = new FakeViews();
  const tabs = new TabService(views, 'about:blank');
  const ids = ['a', 'b', 'c'].map((name) => tabs.open(`https://${name}.example/`));
  const [, middle = ''] = ids;
  if (tab.pinned === true) tabs.pin(middle, true);
  if (tab.muted === true) tabs.update(middle, { muted: true });
  const window: Mutable<TabMenuWindow> = {
    tabs,
    tabAction: vi.fn(),
    setMuted: vi.fn(),
    shortcuts: () => shortcutTable('linux'),
    tabStripPosition: () => position,
  };
  return { window, views, ids };
}

/** The texts of the items of a menu template. */
function labels(template: readonly MenuItemConstructorOptions[] | undefined): string[] {
  return (template ?? []).flatMap((item) => (item.label === undefined ? [] : [item.label]));
}

/** Chooses an item of a menu template, as a click on it does. */
function choose(item: MenuItemConstructorOptions): void {
  (item.click as (() => void) | undefined)?.();
}

/** The texts without access keys of the menu of the second of three tabs. */
function texts(position: TabStripPosition, locale: string, platform: string): string[] {
  const { window, ids } = windowWith(position);
  return labels(tabMenuTemplate(window, ids[1] ?? '', translatorFor(locale, platform))).map(
    (label) => label.replaceAll('&', ''),
  );
}

describe('tabMenuTemplate', () => {
  it.each(['en-US', 'de'])(
    'gives every item of the tab menu in %s its own access key on Windows and Linux',
    (locale) => {
      for (const platform of ['win32', 'linux']) {
        const i18n = translatorFor(locale, platform);
        for (const position of ['top', 'left'] as const) {
          for (const state of [{}, { pinned: true }, { muted: true }]) {
            const { window, ids } = windowWith(position, state);
            const items = labels(tabMenuTemplate(window, ids[1] ?? '', i18n));
            const name = `${platform} ${position} ${JSON.stringify(state)}`;
            expect(items).toHaveLength(9);
            expect([name, ...accessKeyProblems(items)]).toEqual([name]);
          }
        }
      }
    },
  );

  it('names the tabs below a tab in a tab strip at a side, and to its right otherwise', () => {
    for (const position of ['top', 'bottom'] as const) {
      expect(texts(position, 'en-US', 'linux')).toEqual(
        expect.arrayContaining(['New tab to the right', 'Close tabs to the right']),
      );
      expect(texts(position, 'de', 'win32')).toEqual(
        expect.arrayContaining(['Neuer Tab rechts', 'Tabs rechts schließen']),
      );
    }
    for (const position of ['left', 'right'] as const) {
      const english = texts(position, 'en-US', 'linux');
      expect(english).toEqual(expect.arrayContaining(['New tab below', 'Close tabs below']));
      expect(english.join()).not.toMatch(/right/i);
      const german = texts(position, 'de', 'win32');
      expect(german).toEqual(
        expect.arrayContaining(['Neuer Tab darunter', 'Tabs darunter schließen']),
      );
      expect(german.join()).not.toMatch(/rechts/i);
      expect(texts(position, 'en-US', 'darwin')).toEqual(
        expect.arrayContaining(['New Tab Below', 'Close Tabs Below']),
      );
    }
  });

  it('does nothing for a tab that closed while its menu was open', () => {
    const { window, views, ids } = windowWith('top');
    const [first = '', middle = '', last = ''] = ids;
    const template = tabMenuTemplate(window, middle, translatorFor('en-US', 'linux')) ?? [];
    // A page closes its own tab, such as a sign-in page after its redirect.
    window.tabs.close(middle);
    const kept = window.tabs.all.map((tab) => tab.id);
    for (const item of template) {
      if (item.type === 'separator' || item.label === 'R&eopen closed tab') continue;
      expect(() => choose(item)).not.toThrow();
    }
    expect(window.tabs.all.map((tab) => tab.id)).toEqual(kept);
    expect(kept).toEqual([first, last]);
    expect(views.log).toEqual([`destroy ${middle}`]);
    expect(tabMenuTemplate(window, middle, translatorFor('en-US', 'linux'))).toBeUndefined();
  });

  it('shows the shortcuts that people gave the commands of a tab in the menu of the active tab', () => {
    const { window, ids } = windowWith('top');
    const [first = '', , last = ''] = ids;
    window.shortcuts = () =>
      shortcutTable('linux', {
        'tab.duplicate': ['Ctrl+Shift+Y'],
        'tab.pin': ['Alt+P'],
        'tab.mute': ['Alt+M'],
        'tab.closeOthers': ['Ctrl+Shift+O'],
        'tab.closeRight': ['Ctrl+Shift+K'],
      });
    const accelerators = (tabId: string): Record<string, string> =>
      Object.fromEntries(
        (tabMenuTemplate(window, tabId, translatorFor('en-US', 'linux')) ?? []).flatMap((item) =>
          item.label === undefined || item.accelerator === undefined
            ? []
            : [[item.label.replaceAll('&', ''), item.accelerator]],
        ),
      );
    // The last tab that opened is the active one.
    expect(window.tabs.active?.id).toBe(last);
    expect(accelerators(last)).toEqual({
      Duplicate: 'Ctrl+Shift+Y',
      Pin: 'Alt+P',
      'Mute tab': 'Alt+M',
      Close: 'Ctrl+W',
      'Close other tabs': 'Ctrl+Shift+O',
      'Close tabs to the right': 'Ctrl+Shift+K',
      'Reopen closed tab': 'Ctrl+Shift+T',
    });
    expect(accelerators(first)).toEqual({ 'Reopen closed tab': 'Ctrl+Shift+T' });
  });

  it('runs its items on the tab while it is open', () => {
    const { window, views, ids } = windowWith('top');
    const [, middle = ''] = ids;
    const template = tabMenuTemplate(window, middle, translatorFor('en-US', 'linux')) ?? [];
    const item = (label: string): MenuItemConstructorOptions => {
      const found = template.find((candidate) => candidate.label === label);
      if (found === undefined) throw new Error(`No item ${label}`);
      return found;
    };
    choose(item('&Reload'));
    expect(views.log).toEqual([`reload ${middle}`]);
    choose(item('&Pin'));
    expect(window.tabs.all.find((tab) => tab.id === middle)?.pinned).toBe(true);
    choose(item('&Close'));
    expect(window.tabs.all.some((tab) => tab.id === middle)).toBe(false);
  });
});
