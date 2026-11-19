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

/** Selected text in a link around a video: the items of a video with those of a link. */
const video: Partial<ContextMenuParams> = {
  linkURL: 'https://example.com/',
  mediaType: 'video',
  srcURL: 'https://example.com/clip.webm',
  selectionText: 'text',
  mediaFlags: { canShowPictureInPicture: true, isShowingPictureInPicture: false },
};

/** The same video while it shows in picture in picture. */
const shownVideo: Partial<ContextMenuParams> = {
  ...video,
  mediaFlags: { canShowPictureInPicture: true, isShowingPictureInPicture: true },
};

/**
 * Clicks whose menus show the most items together. A link inside a text field also shows
 * Open link in new tab next to Cut, which share T in English, as in Chromium and Firefox.
 */
const clicks = {
  page,
  'text field': textField,
  history: {},
  video,
  'video in picture in picture': shownVideo,
};

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
      pictureInPicture: true,
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
    expect(texts(video, 'en-US', 'darwin')).toEqual([
      'Open Link in New Tab',
      'Copy Link Address',
      'Picture in Picture',
      'Copy',
      'Search search.example for “text”',
      'Inspect',
    ]);
    expect(texts(shownVideo, 'en-US', 'darwin')).toContain('Exit Picture in Picture');
  });

  it('offers picture in picture for a video with the access keys of the plan', () => {
    expect(texts(video, 'en-US', 'linux')).toContain('&Picture in picture');
    expect(texts(shownVideo, 'en-US', 'linux')).toContain('E&xit picture in picture');
    expect(texts(video, 'de', 'win32')).toContain('&Bild im Bild');
    expect(texts(shownVideo, 'de', 'win32')).toContain('Bild im Bild &beenden');
  });

  it('keeps the German texts on macOS, which hides their access keys itself', () => {
    for (const click of Object.values(clicks)) {
      expect(texts(click, 'de', 'darwin')).toEqual(texts(click, 'de', 'linux'));
    }
  });
});
