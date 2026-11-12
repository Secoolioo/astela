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

  it('lists the shortcut of every command in the order of the commands, after them the reset', () => {
    const shortcuts = settingsIndex.find((section) => section.id === 'shortcuts')?.rows ?? [];
    expect(shortcuts.map((candidate) => candidate.id)).toEqual([
      ...windowCommands.map((command) => shortcutRowId(command)),
      'shortcuts-reset',
    ]);
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
      'languages',
      'search',
      'privacy',
      'shortcuts',
      'default-browser',
      'import',
      'setup',
    ]);
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
