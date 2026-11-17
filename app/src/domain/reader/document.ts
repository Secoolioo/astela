import { systemFontStack } from '../../shared/fonts.ts';
import type { ReaderFont } from '../../shared/page-tools.ts';
import { lineOpacity, paletteTokens, type Palette } from '../../shared/themes.ts';
import type { AccentColors } from '../appearance/accent-presets.ts';
import { fontNamePattern } from '../appearance/appearance.ts';
import type { Article, ArticleBlock, Inline } from './article.ts';
import { pictureAddress } from './extract.ts';

/** How the reader view looks: the colors of the theme and the accent, and its font. */
export interface ReaderLook {
  readonly light: Palette;
  readonly dark: Palette;
  readonly accent: AccentColors;
  /** A private window is dark in both modes. */
  readonly private: boolean;
  readonly font: ReaderFont;
  /** The font of the browser that the settings name, or empty for the font of the system. */
  readonly uiFont: string;
}

/** The texts of the browser in the reader view, in the language of the browser. */
export interface ReaderTexts {
  /** The language of the browser, such as `en-US`, for its texts in the document. */
  readonly lang: string;
  /** How long the article takes to read, such as `4 min read`. */
  readingTime(minutes: number): string;
  /** The note at the end of an article that ends early. */
  readonly truncated: string;
  /** The date of publication in the long form of the language, or empty for none. */
  date(published: string): string;
}

/**
 * How many bytes of HTML a reader document has at most: as a `data:` address in base64, it
 * stays below the 2 MiB that Chromium allows an address.
 */
export const readerBytes = 1_400_000;

/** How many words people read in a minute, for the reading time. */
const wordsPerMinute = 230;

/**
 * The radii of the browser's design tokens, `--radius-1` and `--radius-2` of `tokens.css`, which
 * the reader document cannot load, as it loads nothing of the browser.
 */
export const readerRadii = { 'radius-1': '6px', 'radius-2': '8px' } as const;

/**
 * `--line-1` as `tokens.css` mixes it from `--border-1`, which the reader document cannot load,
 * as it loads nothing of the browser.
 * @param opacity - How much of `--border-1` the line keeps, from `lineOpacity` of the themes.
 */
export function lineColor(opacity: number): string {
  return opacity >= 1
    ? 'var(--border-1)'
    : `color-mix(in oklch, var(--border-1) ${String(Math.round(opacity * 100))}%, transparent)`;
}

/**
 * The style of the reader document beside its colors and font: calm, and without motion. Its
 * spacing is in `em` and `rem`, so that it grows with the zoom of its text. Lines between parts,
 * such as rules, the cells of tables and the bar of a quote, take the calm `--line-1`.
 */
const baseCss =
  `:root{--radius-1:${readerRadii['radius-1']};--radius-2:${readerRadii['radius-2']}}` +
  'html{background:var(--surface-1);color:var(--text-1);font-family:var(--reader-font)}' +
  'body{margin:0;font-size:1.125rem;line-height:1.6;overflow-wrap:break-word}' +
  'main{padding:3rem 1.5rem 4rem}' +
  'article{max-width:42em;margin:0 auto}' +
  'header{margin-bottom:2.5rem}' +
  'header>p{margin:0;color:var(--text-2);font-size:0.875rem}' +
  'h1{font-size:2.25rem;line-height:1.2;margin:0.5rem 0 1rem}' +
  'h2{font-size:1.5rem;line-height:1.3;margin:2em 0 0.5em}' +
  'h3{font-size:1.25rem;line-height:1.3;margin:1.75em 0 0.5em}' +
  'h4{font-size:1.125rem;line-height:1.4;margin:1.5em 0 0.5em}' +
  'p,ul,ol,blockquote,pre,figure,table{margin:0 0 1.25em}' +
  'li>p{margin:0 0 0.5em}' +
  'a{color:var(--accent);text-underline-offset:0.15em}' +
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.9em;' +
  'background:var(--surface-2);border-radius:var(--radius-1);padding:0.1em 0.3em}' +
  'pre{background:var(--surface-2);border-radius:var(--radius-1);padding:1rem;overflow:auto}' +
  'pre code{background:none;padding:0}' +
  'blockquote{margin-inline:0;padding-inline-start:1.25em;' +
  'border-inline-start:3px solid var(--line-1);color:var(--text-2)}' +
  'figure{margin-inline:0}' +
  'img{max-width:100%;height:auto;border-radius:var(--radius-2)}' +
  'figcaption{margin-top:0.5rem;color:var(--text-2);font-size:0.875rem}' +
  'table{display:block;overflow:auto;border-collapse:collapse;font-size:0.9375rem}' +
  'th,td{border:1px solid var(--line-1);padding:0.375rem 0.625rem;text-align:start;' +
  'vertical-align:top}' +
  'th{background:var(--surface-2)}' +
  'hr{border:0;border-top:1px solid var(--line-1);margin:2em 0}' +
  'footer{margin-top:2.5rem;color:var(--text-2);font-style:italic}' +
  // Print is black on white, whatever the theme, also over the colors that the browser adds.
  '@media print{:root:root:root{--surface-1:#fff;--surface-2:#f2f2f2;--text-1:#000;--text-2:#333;' +
  '--border-1:#999;--line-1:#999;--accent:#000}main{padding:0}}';

/**
 * The reader document of an article: an HTML document that starts with its policy, which
 * allows no script, no frame, no form and no base, and pictures only from `https`, `data:` and,
 * on pages of `http`, from `http`; on pages of `https`, it upgrades insecure requests. Every
 * text and attribute is escaped, every address is checked again by its scheme, and the document
 * has no class or id of its own, so that generic rules of filter lists cannot match it. The
 * texts of the browser carry its language.
 * @param article - The article.
 * @param look - The colors and the font.
 * @param texts - The texts of the browser.
 */
export function readerDocument(article: Article, look: ReaderLook, texts: ReaderTexts): string {
  const secure = /^https:/i.test(article.url);
  const policy = [
    "default-src 'none'",
    `img-src https: data:${secure ? '' : ' http:'}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const date = article.published === '' ? '' : texts.date(article.published);
  const minutes = Math.max(1, Math.round(article.words / wordsPerMinute));
  // The date and the reading time are written in the language of the browser.
  const browserText = (text: string): string =>
    `<span lang="${escape(texts.lang)}">${escape(text)}</span>`;
  const facts = [
    ...(article.byline === '' ? [] : [escape(article.byline)]),
    ...(date === '' ? [] : [browserText(date)]),
    browserText(texts.readingTime(minutes)),
  ].join(' · ');
  const lang = article.lang === '' ? '' : ` lang="${escape(article.lang)}"`;
  return (
    `<!doctype html><html${lang} dir="${article.dir}"><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<meta name="referrer" content="no-referrer">' +
    `<meta name="color-scheme" content="${look.private ? 'dark' : 'light dark'}">` +
    `<title>${escape(article.title)}</title>` +
    `<style>${colorsCss(look, ':root')}${baseCss}</style></head><body><main><article>` +
    `<header><p>${escape(article.site)}</p><h1>${escape(article.title)}</h1><p>${facts}</p></header>` +
    article.blocks.map(blockHtml).join('') +
    (article.truncated
      ? `<footer lang="${escape(texts.lang)}"><p>${escape(texts.truncated)}</p></footer>`
      : '') +
    '</article></main></body></html>'
  );
}

/**
 * The reader document of an article that fits into a `data:` address: an article that is too
 * long loses blocks at its end, and ends with the note that it does.
 * @param article - The article.
 * @param look - The colors and the font.
 * @param texts - The texts of the browser.
 * @param maxBytes - How many bytes of HTML the document may have.
 */
export function fitReaderDocument(
  article: Article,
  look: ReaderLook,
  texts: ReaderTexts,
  maxBytes: number = readerBytes,
): string {
  const whole = readerDocument(article, look, texts);
  if (utf8Length(whole) <= maxBytes) return whole;
  const cutAfter = (count: number): string =>
    readerDocument(
      { ...article, blocks: article.blocks.slice(0, count), truncated: true },
      look,
      texts,
    );
  // The largest number of blocks that fits, found by halving.
  let low = 0;
  let high = article.blocks.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Length(cutAfter(middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return cutAfter(low);
}

/**
 * The colors and the font of the reader view as a style sheet that the browser adds to an open
 * reader view, which wins over the document's own.
 * @param look - The colors and the font.
 */
export function readerColors(look: ReaderLook): string {
  return colorsCss(look, ':root:root');
}

/**
 * The text size of the reader view at a zoom, as a style sheet that the browser adds to it.
 * @param zoom - The zoom of the reader view itself, 1 for its first size.
 */
export function readerZoomCss(zoom: number): string {
  return `:root:root{font-size:${String(Math.round(zoom * 10_000) / 100)}%}`;
}

/**
 * A date of publication in the long form of a language, such as `5 March 2024`, or empty when
 * it is no date. A date without a time is a day of its own, in no time zone.
 * @param published - The date, as ISO.
 * @param locale - The language.
 */
export function longDate(published: string, locale: string): string {
  const time = Date.parse(published);
  if (Number.isNaN(time)) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(published);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'long',
      ...(day ? { timeZone: 'UTC' } : {}),
    }).format(time);
  } catch {
    return '';
  }
}

/** The colors and the font, in light and dark mode, or only dark in a private window. */
function colorsCss(look: ReaderLook, root: string): string {
  const font = `--reader-font:${fontOf(look)}`;
  const dark = paletteCss(look.dark, look.accent.dark, lineOpacity.dark);
  if (look.private) return `${root}{color-scheme:dark;${dark};${font}}`;
  const light = paletteCss(look.light, look.accent.light, lineOpacity.light);
  return (
    `${root}{color-scheme:light dark;${light};${font}}` +
    `@media (prefers-color-scheme: dark){${root}{${dark}}}`
  );
}

/**
 * The design tokens of a palette and the accent, as declarations, with the calm line that
 * separates parts, which `tokens.css` mixes from the palette in each mode.
 */
function paletteCss(palette: Palette, accent: string, line: number): string {
  return [
    ...paletteTokens.map((token) => `--${token}:${safeValue(palette[token])}`),
    `--line-1:${lineColor(line)}`,
    `--accent:${safeValue(accent)}`,
  ].join(';');
}

/** A color as the style sheet may hold it: one without characters that could end a rule. */
function safeValue(value: string): string {
  return /^[\w\s#%.,()/+-]{1,100}$/.test(value) ? value : 'inherit';
}

/** The font of the reader view: that of the browser, or the generic serif font of web pages. */
function fontOf(look: ReaderLook): string {
  if (look.font === 'serif') return 'serif';
  const font = look.uiFont.trim();
  return font !== '' && fontNamePattern.test(font)
    ? `"${font}",${systemFontStack}`
    : systemFontStack;
}

/** A block as HTML. */
function blockHtml(block: ArticleBlock): string {
  switch (block.kind) {
    case 'heading': {
      const tag = `h${String(block.level)}`;
      return `<${tag}${idOf(block.anchor)}>${inlineHtml(block.text)}</${tag}>`;
    }
    case 'paragraph':
      return `<p${idOf(block.anchor)}>${inlineHtml(block.text)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${item.map(blockHtml).join('')}</li>`);
      return `<${tag}>${items.join('')}</${tag}>`;
    }
    case 'quote':
      return `<blockquote>${block.blocks.map(blockHtml).join('')}</blockquote>`;
    case 'code':
      return `<pre><code>${escape(block.text)}</code></pre>`;
    case 'figure': {
      if (!pictureAddress(block.src)) return '';
      const size =
        (block.width === undefined ? '' : ` width="${String(block.width)}"`) +
        (block.height === undefined ? '' : ` height="${String(block.height)}"`);
      const caption =
        block.caption === undefined || block.caption.length === 0
          ? ''
          : `<figcaption>${inlineHtml(block.caption)}</figcaption>`;
      return (
        `<figure><img src="${escape(block.src)}" alt="${escape(block.alt)}"${size}` +
        ` loading="lazy" decoding="async">${caption}</figure>`
      );
    }
    case 'table': {
      const row = (cells: readonly (readonly Inline[])[], cell: 'th' | 'td'): string =>
        `<tr>${cells.map((text) => `<${cell}>${inlineHtml(text)}</${cell}>`).join('')}</tr>`;
      const [first, ...rest] = block.rows;
      const head = block.head && first !== undefined ? `<thead>${row(first, 'th')}</thead>` : '';
      const body = (block.head ? rest : block.rows).map((cells) => row(cells, 'td'));
      return `<table>${head}<tbody>${body.join('')}</tbody></table>`;
    }
    case 'rule':
    default:
      return '<hr>';
  }
}

/** The id of a heading or a paragraph, for links inside the article. */
function idOf(anchor: string | undefined): string {
  return anchor !== undefined && /^[A-Za-z0-9_:.-]{1,128}$/.test(anchor) ? ` id="${anchor}"` : '';
}

/** Runs of text as HTML: links outside, then bold, italic, code and scripts. */
function inlineHtml(runs: readonly Inline[]): string {
  return runs
    .map((run) => {
      let html = escape(run.text).replaceAll('\n', '<br>');
      if (run.code === true) html = `<code>${html}</code>`;
      if (run.script !== undefined) html = `<${run.script}>${html}</${run.script}>`;
      if (run.italic === true) html = `<em>${html}</em>`;
      if (run.bold === true) html = `<strong>${html}</strong>`;
      const link = run.link;
      if (link !== undefined && linkAddress(link)) {
        html = `<a href="${escape(link)}" rel="noopener noreferrer">${html}</a>`;
      }
      return html;
    })
    .join('');
}

/** Whether a link may lead somewhere: to a web address, or to an anchor of the article. */
function linkAddress(link: string): boolean {
  return (
    (/^https?:\/\//i.test(link) && link.length <= 8192) || /^#[A-Za-z0-9_:.-]{1,128}$/.test(link)
  );
}

/** Text as HTML text or the value of an attribute. */
function escape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** How many bytes a text has in UTF-8. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
