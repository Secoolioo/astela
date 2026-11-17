import { describe, expect, it } from 'vitest';
import { systemFontStack } from '../../shared/fonts.ts';
import { builtInThemes, lineOpacity, paletteTokens } from '../../shared/themes.ts';
import { presetAccentColors } from '../appearance/accent-presets.ts';
import type { Article } from '../reader/article.ts';
import {
  fitReaderDocument,
  lineColor,
  longDate,
  readerColors,
  readerDocument,
  readerZoomCss,
  utf8Length,
  type ReaderLook,
  type ReaderTexts,
} from '../reader/document.ts';

const look: ReaderLook = {
  light: builtInThemes.forest.light,
  dark: builtInThemes.forest.dark,
  accent: presetAccentColors.blue,
  private: false,
  font: 'browser',
  uiFont: '',
};

const texts: ReaderTexts = {
  lang: 'en-US',
  readingTime: (minutes) => `${String(minutes)} min read`,
  truncated: 'This is the first part of the page.',
  date: (published) => longDate(published, 'en-US'),
};

const article: Article = {
  url: 'https://news.example/story',
  title: 'A story',
  site: 'news.example',
  byline: 'Ada Example',
  published: '2024-03-05',
  lang: 'de',
  dir: 'ltr',
  blocks: [
    { kind: 'paragraph', text: [{ text: 'Hello ' }, { text: 'world', bold: true }] },
    { kind: 'heading', level: 3, text: [{ text: 'Part' }], anchor: 'part' },
  ],
  words: 920,
  truncated: false,
};

/** The head of a document, up to its end tag. */
function head(html: string): string {
  return html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
}

describe('readerDocument', () => {
  it('starts its head with a policy that allows no script and upgrades pages of https', () => {
    const html = readerDocument(article, look, texts);
    expect(head(html)).toMatch(/^<head><meta http-equiv="Content-Security-Policy" content="/);
    const policy = /content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(policy).toBe(
      "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests",
    );
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).not.toMatch(/<script|<iframe|<form|<base|<object|<embed/i);
    const insecure = readerDocument({ ...article, url: 'http://news.example/story' }, look, texts);
    const insecurePolicy = /content="([^"]*)"/.exec(insecure)?.[1] ?? '';
    expect(insecurePolicy).toContain('img-src https: data: http:');
    expect(insecurePolicy).not.toContain('upgrade-insecure-requests');
  });

  it('escapes hostile titles, texts, pictures and links, and drops links of other schemes', () => {
    const hostile = '</title><script>alert(1)</script>"><img src=x onerror=alert(1)>\'';
    const html = readerDocument(
      {
        ...article,
        title: hostile,
        site: hostile,
        byline: hostile,
        lang: 'en',
        blocks: [
          { kind: 'paragraph', text: [{ text: hostile }] },
          { kind: 'paragraph', text: [{ text: 'script', link: 'javascript:alert(1)' }] },
          { kind: 'paragraph', text: [{ text: 'data', link: 'data:text/html,<script>' }] },
          { kind: 'paragraph', text: [{ text: 'quote', link: 'https://x.example/"onclick="' }] },
          { kind: 'figure', src: 'javascript:alert(1)', alt: hostile },
          { kind: 'figure', src: 'data:text/html;base64,PHNjcmlwdD4=', alt: '' },
          { kind: 'figure', src: 'https://cdn.example/a.png', alt: hostile },
          { kind: 'code', text: hostile },
          { kind: 'table', head: false, rows: [[[{ text: hostile }]]] },
        ],
      },
      look,
      texts,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;');
    expect(html).toContain('href="https://x.example/&quot;onclick=&quot;"');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('writes every kind of block, with the texts of the browser in its language', () => {
    const html = readerDocument(
      {
        ...article,
        blocks: [
          { kind: 'heading', level: 2, text: [{ text: 'Two' }], anchor: 'two' },
          {
            kind: 'paragraph',
            text: [
              { text: 'line', italic: true },
              { text: '\n' },
              { text: 'x', code: true },
              { text: '2', script: 'sub' },
              { text: 'up', link: '#two' },
            ],
          },
          { kind: 'list', ordered: false, items: [[{ kind: 'paragraph', text: [{ text: 'A' }] }]] },
          { kind: 'list', ordered: true, items: [[{ kind: 'rule' }]] },
          { kind: 'quote', blocks: [{ kind: 'paragraph', text: [{ text: 'Q' }] }] },
          {
            kind: 'figure',
            src: 'https://cdn.example/a.png',
            alt: 'Alt',
            width: 640,
            height: 400,
            caption: [{ text: 'Caption' }],
          },
          { kind: 'table', head: true, rows: [[[{ text: 'H' }]], [[{ text: 'D' }]]] },
        ],
        truncated: true,
      },
      look,
      texts,
    );
    expect(html).toContain('<html lang="de" dir="ltr">');
    expect(html).toContain('<h2 id="two">Two</h2>');
    expect(html).toContain('<p><em>line</em><br><code>x</code><sub>2</sub><a href="#two"');
    expect(html).toContain('<ul><li><p>A</p></li></ul><ol><li><hr></li></ol>');
    expect(html).toContain('<blockquote><p>Q</p></blockquote>');
    expect(html).toContain(
      '<figure><img src="https://cdn.example/a.png" alt="Alt" width="640" height="400" loading="lazy" decoding="async"><figcaption>Caption</figcaption></figure>',
    );
    expect(html).toContain('<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr>');
    // 920 words take 4 minutes; the date is long. Both are in the language of the browser,
    // which their elements say, inside an article in another language.
    expect(html).toContain(
      '<p>Ada Example · <span lang="en-US">March 5, 2024</span> · <span lang="en-US">4 min read</span></p>',
    );
    expect(html).toContain(
      '<footer lang="en-US"><p>This is the first part of the page.</p></footer>',
    );
    expect(readerDocument({ ...article, byline: '', published: '' }, look, texts)).toContain(
      '<p><span lang="en-US">4 min read</span></p>',
    );
  });

  it('has no class and no id of its own', () => {
    const html = readerDocument({ ...article, blocks: [] }, look, texts);
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/\sid=/);
    expect(readerDocument(article, look, texts).match(/\sid="([^"]*)"/g)).toEqual([' id="part"']);
  });

  it('takes the colors of the theme and the accent in both modes, and only dark ones in private', () => {
    const html = readerDocument(article, look, texts);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    for (const token of paletteTokens) {
      expect(html).toContain(`--${token}:${builtInThemes.forest.light[token]}`);
      expect(html).toContain(`--${token}:${builtInThemes.forest.dark[token]}`);
    }
    expect(html).toContain(`--accent:${presetAccentColors.blue.light}`);
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    // The calm line of the tokens, which the dark mode mixes at its opacity of the line.
    const light = html.slice(0, html.indexOf('@media (prefers-color-scheme: dark)'));
    const darkMode = html.slice(html.indexOf('@media (prefers-color-scheme: dark)'));
    expect(light).toContain(`--line-1:${lineColor(lineOpacity.light)}`);
    expect(darkMode).toContain(`--line-1:${lineColor(lineOpacity.dark)}`);
    expect(lineColor(lineOpacity.dark)).toBe(
      'color-mix(in oklch, var(--border-1) 60%, transparent)',
    );
    const dark = readerDocument(article, { ...look, private: true }, texts);
    expect(dark).toContain('<meta name="color-scheme" content="dark">');
    expect(dark).not.toContain(builtInThemes.forest.light['surface-1']);
    expect(dark).toContain(`--surface-1:${builtInThemes.forest.dark['surface-1']}`);
    expect(dark).toContain(`--accent:${presetAccentColors.blue.dark}`);
    expect(dark).toContain(`--line-1:${lineColor(lineOpacity.dark)}`);
    expect(dark).not.toContain('prefers-color-scheme');
    const broken = readerDocument(
      article,
      { ...look, light: { ...look.light, 'surface-1': 'red;}body{display:none' } },
      texts,
    );
    expect(broken).not.toContain('display:none');
    expect(broken).toContain('--surface-1:inherit');
  });

  it('uses the font of the browser, of the system or the serif font of web pages', () => {
    expect(readerDocument(article, look, texts)).toContain(`--reader-font:${systemFontStack}`);
    expect(readerDocument(article, { ...look, uiFont: 'Inter' }, texts)).toContain(
      `--reader-font:"Inter",${systemFontStack}`,
    );
    expect(readerDocument(article, { ...look, uiFont: 'Bad"};x{' }, texts)).toContain(
      `--reader-font:${systemFontStack}`,
    );
    expect(readerDocument(article, { ...look, font: 'serif' }, texts)).toContain(
      '--reader-font:serif',
    );
  });

  it('has no motion, takes the radii of the tokens and prints black on white', () => {
    const html = readerDocument(article, look, texts);
    expect(html).not.toMatch(/transition|animation/);
    expect(html).toContain(':root{--radius-1:6px;--radius-2:8px}');
    expect(html.match(/border-radius:[^;}]*/g)).toEqual([
      'border-radius:var(--radius-1)',
      'border-radius:var(--radius-1)',
      'border-radius:var(--radius-2)',
    ]);
    expect(html).toContain('@media print{:root:root:root{--surface-1:#fff;');
    // Lines between parts take the calm line, also in print.
    expect(html.match(/[\w,]+\{[^}]*solid var\(--[\w-]+\)/g)).toEqual([
      'blockquote{margin-inline:0;padding-inline-start:1.25em;border-inline-start:3px solid var(--line-1)',
      'th,td{border:1px solid var(--line-1)',
      'hr{border:0;border-top:1px solid var(--line-1)',
    ]);
    expect(html).toContain('--border-1:#999;--line-1:#999;');
  });
});

describe('fitReaderDocument', () => {
  it('keeps an article that fits, and cuts a long one below the limit with its note', () => {
    expect(fitReaderDocument(article, look, texts)).toBe(readerDocument(article, look, texts));
    const blocks = Array.from({ length: 400 }, (_, index) => ({
      kind: 'paragraph' as const,
      text: [{ text: `${String(index)} ${'é'.repeat(5000)}` }],
    }));
    const long = { ...article, blocks };
    const fitted = fitReaderDocument(long, look, texts, 1_000_000);
    expect(utf8Length(fitted)).toBeLessThanOrEqual(1_000_000);
    expect(utf8Length(fitted)).toBeGreaterThan(950_000);
    expect(fitted).toContain('This is the first part of the page.');
    expect(fitted).toContain('<p>0 é');
    expect(fitted).not.toContain('<p>399 é');
    // As a data: address in base64, the default limit stays below the 2 MiB of Chromium.
    const html = fitReaderDocument(long, look, texts);
    expect(Math.ceil(utf8Length(html) / 3) * 4 + 40).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('readerColors and readerZoomCss', () => {
  it('give style sheets that win over the document, for an open reader view', () => {
    const colors = readerColors(look);
    expect(colors.startsWith(':root:root{')).toBe(true);
    expect(colors).toContain(`--surface-1:${builtInThemes.forest.light['surface-1']}`);
    expect(colors).toContain('@media (prefers-color-scheme: dark){:root:root{');
    expect(readerColors({ ...look, private: true })).not.toContain('prefers-color-scheme');
    expect(readerZoomCss(1.1)).toBe(':root:root{font-size:110%}');
    expect(readerZoomCss(0.333_33)).toBe(':root:root{font-size:33.33%}');
  });
});

describe('longDate', () => {
  it('writes a date in the long form of a language, or nothing for no date', () => {
    expect(longDate('2024-03-05', 'de')).toBe('5. März 2024');
    expect(longDate('2024-03-05', 'en-US')).toBe('March 5, 2024');
    expect(longDate('2024-03-05T12:00:00Z', 'en-US')).toMatch(/^March [45], 2024$/);
    expect(longDate('not a date', 'en-US')).toBe('');
    expect(longDate('2024-03-05', 'not a language')).toBe('');
  });
});

describe('utf8Length', () => {
  it('counts the bytes of UTF-8', () => {
    expect(utf8Length('a')).toBe(1);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
    expect(utf8Length('a😀é')).toBe(7);
  });
});
