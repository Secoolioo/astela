import {
  articleLimits,
  type PageInfo,
  type ReaderCheck,
  type ReaderExtraction,
  type ReaderRequest,
} from '../domain/reader/article.ts';
import { findArticle, outsideArticle, readable } from '../domain/reader/extract.ts';
import { domTree } from './dom-tree.ts';

/** How long the extraction may take, in milliseconds. */
const extractionTime = 250;

/**
 * The reader view's script in the page, which the browser runs in its isolated world 1002. A
 * check tells whether the page has an article; an extraction reads it, unless its time is over
 * because the call waited for the page. Both only read the page.
 * @param request - What the browser asks.
 */
export function run(request: ReaderRequest): ReaderCheck | ReaderExtraction {
  if (request.kind === 'check') return { readable: check() };
  const body = document.body;
  if (Date.now() > request.until || body === null) return { article: null };
  const start = performance.now();
  const article = findArticle(domTree(), body, pageInfo(), {
    deadline: start + extractionTime,
    now: () => performance.now(),
  });
  return { article: article ?? null };
}

/**
 * Whether the page has an article, by the length of the text of its paragraphs, blocks of code
 * and articles that show, outside navigation, sidebars, footers and parts whose names hint that
 * they are no article, at most 2,000 of them.
 */
function check(): boolean {
  const tree = domTree();
  const lengths: number[] = [];
  let seen = 0;
  for (const element of document.querySelectorAll('p, pre, article')) {
    seen += 1;
    if (seen > articleLimits.checked) break;
    let outside = false;
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      if (outsideArticle(tree, node)) {
        outside = true;
        break;
      }
    }
    if (outside) continue;
    lengths.push((element.textContent ?? '').trim().length);
    if (readable(lengths)) return true;
  }
  return false;
}

/** The address, title, language, direction and meta elements of the page. */
function pageInfo(): PageInfo {
  const meta = new Map<string, string>();
  for (const element of document.querySelectorAll('head meta[property], head meta[name]')) {
    if (meta.size >= 100) break;
    const key = (element.getAttribute('property') ?? element.getAttribute('name') ?? '').trim();
    const content = element.getAttribute('content');
    if (key !== '' && content !== null && !meta.has(key.toLowerCase())) {
      meta.set(key.toLowerCase(), content.slice(0, articleLimits.title));
    }
  }
  const root = document.documentElement;
  const dir = root.dir.toLowerCase();
  const computed = document.body === null ? '' : getComputedStyle(document.body).direction;
  return {
    url: location.href,
    title: document.title,
    lang: root.lang,
    dir: dir === 'ltr' || dir === 'rtl' ? dir : computed === 'rtl' ? 'rtl' : 'auto',
    meta: Object.fromEntries(meta),
  };
}
