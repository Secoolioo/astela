import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../../domain/commands/availability.ts';
import {
  browserMenu,
  moreTools,
  toContent,
  type ModelLevel,
} from '../../domain/menus/browser-menu.ts';
import { OverlayContent } from '../../shared/ipc/overlay-contracts.ts';
import { shortcutTable } from '../../shared/shortcuts.ts';
import { translatorFor } from '../i18n/i18n.ts';
import { menuText } from '../menu-popover.ts';
import { accessKeyProblems } from './access-keys.ts';

// The texts of the menus need nothing of Electron; the overlay that shows them does.
vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' }, WebContentsView: vi.fn() }));

/** A window with one web page, where every policy allows everything. */
const context: CommandContext = {
  tabs: [
    {
      url: 'https://example.com/',
      pinned: false,
      canGoBack: true,
      canGoForward: false,
      muted: false,
      split: null,
      group: null,
      reader: 'none',
    },
  ],
  activeIndex: 0,
  canReopen: true,
  finding: false,
  webPage: true,
  privateWindows: true,
  developerTools: true,
  palette: true,
  splitView: true,
  reader: false,
  workspaces: 1,
};

/** The browser menu and its submenu with more tools, in a language on a system. */
function levels(locale: string, platform: string, reader = false): ModelLevel[] {
  const input = {
    platform,
    table: shortcutTable(platform),
    context: { ...context, reader },
    zoom: 1,
    fullScreen: false,
  };
  const text = menuText(translatorFor(locale, platform), platform);
  const root = browserMenu(input, text);
  const tools = root.items.findIndex((entry) => entry.type === 'submenu');
  return [root, moreTools(input, text, tools)];
}

/** The texts of a level that take access keys: its items, its submenus and its zoom row. */
function labels(level: ModelLevel): string[] {
  return level.items.flatMap((entry) => (entry.type === 'separator' ? [] : [entry.label]));
}

/** The access keys of the items of the browser menu, in their order. */
function keys(locale: string, platform: string, reader = false): string[] {
  return labels(levels(locale, platform, reader)[0] ?? { parent: -1, label: '', items: [] }).map(
    (label) => /&(.)/u.exec(label.replaceAll('&&', ''))?.[1]?.toLowerCase() ?? '',
  );
}

describe('the texts of the browser menu', () => {
  it.each(['en-US', 'de'])(
    'give every item in %s its own access key on Windows and Linux',
    (locale) => {
      for (const platform of ['win32', 'linux']) {
        for (const reader of [false, true]) {
          for (const [depth, level] of levels(locale, platform, reader).entries()) {
            const name = `${platform} level ${depth}${reader ? ' with the reader view' : ''}`;
            expect([name, ...accessKeyProblems(labels(level))]).toEqual([name]);
          }
        }
      }
    },
  );

  it('use the agreed access keys, which other menus of the browser keep free', () => {
    expect(keys('en-US', 'linux').join('')).toBe('twizhdbcrfpvosaq');
    expect(keys('en-US', 'win32').join('')).toBe('twizhdbcrfpvosax');
    expect(keys('de', 'linux').join('')).toBe('tfpzvdlarsuhweüb');
    // The reader view comes after Find, with E in English and N in German.
    expect(keys('en-US', 'linux', true).join('')).toBe('twizhdbcrfepvosaq');
    expect(keys('de', 'linux', true).join('')).toBe('tfpzvdlarsnuhweüb');
  });

  it('write German without the marks of access keys on macOS', () => {
    const [root, tools] = levels('de', 'darwin', true);
    const texts = [
      ...labels(root ?? { parent: -1, label: '', items: [] }),
      ...labels(tools ?? { parent: 0, label: '', items: [] }),
    ];
    expect(texts.filter((label) => label.includes('&'))).toEqual([]);
    expect(texts).toEqual(
      expect.arrayContaining([
        'Neuer Tab',
        'Neues Fenster',
        'Verlauf',
        'Seite speichern unter…',
        'Weitere Tools',
        'Beenden',
        'Quelltext anzeigen',
        'Leseansicht',
      ]),
    );
    const zoom = root?.items.find((entry) => entry.type === 'zoom');
    expect(zoom?.type === 'zoom' ? [zoom.label, zoom.labels] : []).toEqual([
      'Zoom',
      {
        zoomOut: 'Verkleinern',
        reset: 'Zoom zurücksetzen',
        zoomIn: 'Vergrößern',
        fullScreen: 'Vollbild',
      },
    ]);
    expect(root?.label).toBe('Menü');
  });

  it('write English in title case without access keys on macOS', () => {
    const [root, tools] = levels('en-US', 'darwin', true);
    const texts = [
      ...labels(root ?? { parent: -1, label: '', items: [] }),
      ...labels(tools ?? { parent: 0, label: '', items: [] }),
    ];
    expect(texts.filter((label) => label.includes('&'))).toEqual([]);
    expect(texts).toEqual(
      expect.arrayContaining([
        'New Tab',
        'New Private Window',
        'Save Page As…',
        'More Tools',
        'Quit Astela',
        'Developer Tools',
        'Reader View',
      ]),
    );
    expect(root?.label).toBe('Menu');
  });

  it('fit the contract of the overlay in every language and on every system', () => {
    for (const locale of ['en-US', 'de']) {
      for (const platform of ['win32', 'linux', 'darwin']) {
        for (const reader of [false, true]) {
          const content = {
            kind: 'menu',
            align: 'auto',
            anchor: { x: 1000, y: 8, width: 28, height: 28 },
            keyboard: false,
            mac: platform === 'darwin',
            levels: toContent(levels(locale, platform, reader)),
          };
          expect(v.safeParse(OverlayContent, content).success).toBe(true);
        }
      }
    }
  });
});
