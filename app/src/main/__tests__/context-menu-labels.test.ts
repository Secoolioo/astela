import { describe, expect, it } from 'vitest';
import {
  buildContextMenu,
  type ContextMenuParams,
} from '../../domain/context-menu/context-menu.ts';
import { contextMenuLabels } from '../context-menu-labels.ts';
import { accessKeyProblems } from './access-keys.ts';

const nothing: ContextMenuParams = {
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  hasImageContents: false,
  selectionText: '',
  isEditable: false,
  formControlType: 'none',
  dictionarySuggestions: [],
  editFlags: {
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    canSelectAll: false,
  },
};

/** Selected text in a link around an image: every page item at once. */
const page: Partial<ContextMenuParams> = {
  linkURL: 'https://example.com/',
  mediaType: 'image',
  srcURL: 'https://example.com/i.png',
  hasImageContents: true,
  selectionText: 'text',
};

const textField: Partial<ContextMenuParams> = {
  isEditable: true,
  formControlType: 'input-text',
  selectionText: 'text',
};

/**
 * Clicks whose menus show the most items together. A link inside a text field also shows
 * Open link in new tab next to Cut, which share T in English, as in Chromium and Firefox.
 */
const clicks = { page, 'text field': textField, history: {} };

/** The texts of the menu that a click opens on a page. */
function texts(click: Partial<ContextMenuParams>, locale: string, platform: string): string[] {
  const entries = buildContextMenu(
    {
      surface: 'page',
      params: { ...nothing, ...click },
      canGoBack: true,
      canGoForward: true,
      canCopyImage: true,
      searchTemplate: 'https://search.example/?q=%s',
      // With Inspect, whose access key must not clash with the others either.
      canInspect: true,
    },
    contextMenuLabels(locale, platform),
    platform,
  );
  return entries.flatMap((entry) => (entry.type === 'item' ? [entry.label] : []));
}

describe('contextMenuLabels', () => {
  it.each(['en-US', 'de'])(
    'gives every item of a menu in %s its own access key on Windows and Linux',
    (locale) => {
      for (const platform of ['win32', 'linux']) {
        for (const [name, click] of Object.entries(clicks)) {
          expect([name, ...accessKeyProblems(texts(click, locale, platform))]).toEqual([name]);
        }
      }
    },
  );

  it('writes English menus on macOS in title case and without access keys', () => {
    expect(texts(page, 'en-US', 'darwin')).toEqual([
      'Open Link in New Tab',
      'Copy Link Address',
      'Open Image in New Tab',
      'Copy Image',
      'Copy Image Address',
      'Copy',
      'Search search.example for “text”',
      'Inspect',
    ]);
    expect(texts(textField, 'en-US', 'darwin')).toEqual([
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Search search.example for “text”',
      'Inspect',
    ]);
    expect(texts({}, 'en-US', 'darwin')).toEqual(['Back', 'Forward', 'Reload', 'Inspect']);
  });

  it('keeps the German texts on macOS, which hides their access keys itself', () => {
    for (const click of Object.values(clicks)) {
      expect(texts(click, 'de', 'darwin')).toEqual(texts(click, 'de', 'linux'));
    }
  });
});
