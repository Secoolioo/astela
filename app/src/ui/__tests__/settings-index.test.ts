import { describe, expect, it } from 'vitest';
import { windowCommands } from '../../shared/shortcuts.ts';
import de from '../i18n/de.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import { SettingsPage } from '../settings/settings-page.ts';
import { commandNameKey, settingsIndex, shortcutRowId, textOf } from '../ui-kit/settings-index.ts';

const rows = settingsIndex.flatMap((section) => section.rows);

/** The row of an id. */
function row(id: string): (typeof rows)[number] {
  const found = rows.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No row ${id}`);
  return found;
}

describe('settingsIndex', () => {
  it('gives every section and every row an id of its own that a link can name', () => {
    const sections = settingsIndex.map((section) => section.id);
    expect(new Set(sections).size).toBe(sections.length);
    const ids = rows.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...sections, ...ids]) expect(id).toMatch(/^[a-z][a-zA-Z0-9.-]{0,63}$/);
  });

  it('has a view on the settings page for every row, and a row for every view', () => {
    expect(Object.keys(SettingsPage.rowViews).toSorted()).toEqual(
      rows.map((candidate) => candidate.id).toSorted(),
    );
  });

  it('finds every row by texts that exist in English and German', () => {
    const keys = [
      ...settingsIndex.map((section) => section.title),
      ...rows.flatMap((candidate) => candidate.keys),
    ];
    const missing = keys.filter((key) => !Object.hasOwn(en, key) || !Object.hasOwn(de, key));
    expect(missing).toEqual([]);
    for (const candidate of rows) expect(candidate.keys.length).toBeGreaterThan(0);
  });

  it('lists the switch of the palette first, then the shortcut of every command in their order, after them the reset and Alt', () => {
    const shortcuts = settingsIndex.find((section) => section.id === 'shortcuts')?.rows ?? [];
    expect(shortcuts.map((candidate) => candidate.id)).toEqual([
      'commandPalette.enabled',
      ...windowCommands.map((command) => shortcutRowId(command)),
      'shortcuts-reset',
      'keys.altOpensMenu',
    ]);
    // macOS has no such setting, so the row shows only where the browser offers it.
    expect(row('keys.altOpensMenu').onlyWhereOffered).toBe(true);
    expect(rows.filter((candidate) => candidate.onlyWhereOffered === true)).toHaveLength(1);
  });

  it('names closing the tabs to the right after the tabs below with the tab strip at a side', () => {
    expect(commandNameKey('tab.closeRight', false)).toBe('shortcut.tab.closeRight');
    expect(commandNameKey('tab.closeRight', true)).toBe('shortcut.tab.closeBelow');
    for (const command of windowCommands.filter((other) => other !== 'tab.closeRight')) {
      expect(commandNameKey(command, true)).toBe(`shortcut.${command}`);
      expect(commandNameKey(command, false)).toBe(`shortcut.${command}`);
    }
    // Both names find the row, in every language, wherever the tab strip is.
    const closing = row(shortcutRowId('tab.closeRight'));
    const text = textOf(closing.keys, closing.words);
    for (const word of ['right', 'rechts', 'below', 'darunter']) expect(text).toContain(word);
    expect(closing.keys[0]).toBe('shortcut.tab.closeRight');
  });

  it('keeps the sections in the order of the page', () => {
    expect(settingsIndex.map((section) => section.id)).toEqual([
      'appearance',
      'startup',
      'newtab',
      'downloads',
      'pageTools',
      'performance',
      'languages',
      'search',
      'privacy',
      'shortcuts',
      'default-browser',
      'import',
      'setup',
    ]);
  });

  it('lists the switch of the reader view before its font, then picture in picture, in the section of page tools', () => {
    const tools = settingsIndex.find((section) => section.id === 'pageTools');
    expect(tools?.title).toBe('settings.pageTools');
    expect(tools?.rows.map((candidate) => candidate.id)).toEqual([
      'reader.enabled',
      'reader.font',
      'pictureInPicture.enabled',
    ]);
    // Words of both languages find the row of picture in picture.
    const pictureInPicture = row('pictureInPicture.enabled');
    const words = textOf(pictureInPicture.keys, pictureInPicture.words);
    for (const word of ['picture in picture', 'bild im bild', 'video'])
      expect(words).toContain(word);
    // Words of both languages find both rows, and the font row finds its choices.
    for (const id of ['reader.enabled', 'reader.font']) {
      const text = textOf(row(id).keys, row(id).words);
      for (const word of ['reader', 'leseansicht', 'article', 'artikel']) {
        expect(text).toContain(word);
      }
    }
    const font = textOf(row('reader.font').keys, row('reader.font').words);
    for (const word of ['serif', 'serifenschrift', 'font of the browser', 'schrift des browsers']) {
      expect(font).toContain(word);
    }
  });

  it('lists the layouts before the density, and the place and hiding of the toolbar after the tabs', () => {
    const appearance = (
      settingsIndex.find((section) => section.id === 'appearance')?.rows ?? []
    ).map((candidate) => candidate.id);
    expect(
      appearance.slice(appearance.indexOf('layout'), appearance.indexOf('layout') + 2),
    ).toEqual(['layout', 'appearance.density']);
    const tabs = appearance.indexOf('tabs.position');
    expect(appearance.slice(tabs, tabs + 3)).toEqual([
      'tabs.position',
      'toolbar.placement',
      'toolbar.autoHide',
    ]);
    // The layouts row shows the four settings that a preset sets, and words find each row.
    expect(row('layout').settings).toEqual([
      'tabs.position',
      'toolbar.placement',
      'toolbar.autoHide',
      'appearance.density',
    ]);
    const layout = textOf(row('layout').keys, row('layout').words);
    for (const word of ['layout', 'anordnung', 'kompakt', 'zen', 'vertical', 'vertikal']) {
      expect(layout).toContain(word);
    }
    const placement = textOf(row('toolbar.placement').keys, row('toolbar.placement').words);
    for (const word of ['address bar', 'adressleiste', 'next to the tabs', 'neben den tabs']) {
      expect(placement).toContain(word);
    }
    const hiding = textOf(row('toolbar.autoHide').keys, row('toolbar.autoHide').words);
    for (const word of ['hide', 'ausblenden', 'zen']) expect(hiding).toContain(word);
    // The note of the layouts names the density, which finds the row of the density only.
    expect(layout).not.toContain('dichte');
  });

  it('lists the switch of sleeping tabs before their time in the section of performance', () => {
    const performance = settingsIndex.find((section) => section.id === 'performance');
    expect(performance?.title).toBe('settings.performance');
    expect(performance?.rows.map((candidate) => candidate.id)).toEqual([
      'tabs.sleep',
      'tabs.sleepAfter',
    ]);
    // Words of both languages find both rows.
    for (const id of ['tabs.sleep', 'tabs.sleepAfter']) {
      const text = textOf(row(id).keys, row(id).words);
      for (const word of ['sleep', 'schlafen', 'memory', 'arbeitsspeicher']) {
        expect(text).toContain(word);
      }
    }
  });

  it('shows the list of pages to open at start only while the browser opens them', () => {
    expect(row('startup.urls').when).toEqual({ key: 'startup.page', value: 'pages' });
    expect(rows.filter((candidate) => candidate.when !== undefined)).toHaveLength(1);
  });
});

describe('textOf', () => {
  it('holds the texts of every shipped language, folded, and the words of a row', () => {
    const tabs = row('tabs.position');
    const text = textOf(tabs.keys, tabs.words);
    expect(text).toContain('vertical');
    expect(text).toContain('seitenleiste');
    expect(text).not.toMatch(/[A-ZÄÖÜß]/);
    const engines = row('search.urlTemplate');
    expect(textOf(engines.keys, engines.words)).toContain('duckduckgo');
    const language = row('i18n.language');
    expect(textOf(language.keys, language.words)).toContain('deutsch');
    expect(textOf(['settings.privacy'])).toBe('privacy datenschutz');
  });
});
