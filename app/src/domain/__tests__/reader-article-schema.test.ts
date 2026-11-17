import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { articleLimits, type Article, type ArticleBlock } from '../reader/article.ts';
import { ReaderArticle } from '../reader/article-schema.ts';
import { findArticle } from '../reader/extract.ts';
import { noDeadline, parse, prose, testTree } from './reader-tree.ts';

const typical: Article = {
  url: 'https://news.example/story',
  title: 'A story',
  site: 'news.example',
  byline: 'Ada Example',
  published: '2024-03-05',
  lang: 'en-GB',
  dir: 'ltr',
  blocks: [
    { kind: 'heading', level: 2, text: [{ text: 'Part' }], anchor: 'part' },
    {
      kind: 'paragraph',
      text: [
        { text: 'Text with ' },
        { text: 'bold', bold: true },
        { text: ', a link', link: 'https://other.example/' },
        { text: ' and ' },
        { text: 'an anchor', link: '#part' },
        { text: '2', script: 'sup' },
      ],
    },
    { kind: 'list', ordered: true, items: [[{ kind: 'paragraph', text: [{ text: 'One' }] }]] },
    { kind: 'quote', blocks: [{ kind: 'paragraph', text: [{ text: 'Quoted', italic: true }] }] },
    { kind: 'code', text: '  code();' },
    {
      kind: 'figure',
      src: 'https://cdn.example/a.png',
      alt: 'A picture',
      width: 640,
      height: 400,
      caption: [{ text: 'Caption' }],
    },
    { kind: 'figure', src: 'data:image/png;base64,iVBORw0KGgo=', alt: '' },
    { kind: 'table', head: true, rows: [[[{ text: 'A' }], [{ text: 'B' }]]] },
    { kind: 'rule' },
  ],
  words: 12,
  truncated: false,
};

/** Whether the schema accepts an article. */
function accepts(article: unknown): boolean {
  return v.safeParse(ReaderArticle, article).success;
}

/** The typical article with other blocks. */
function withBlocks(blocks: unknown): unknown {
  return { ...typical, blocks };
}

describe('ReaderArticle', () => {
  it('accepts a typical article, and what the extractor finds', () => {
    expect(accepts(typical)).toBe(true);
    const found = findArticle(
      testTree,
      parse(`<body><article><h2 id="a">Part</h2><p>${prose(60)}</p><ul><li>${prose(30)}</li></ul>
      <table><caption>C</caption><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
      </article></body>`),
      { url: typical.url, title: 'A story', lang: 'en', dir: 'ltr', meta: {} },
      noDeadline,
    );
    expect(found).toBeDefined();
    expect(accepts(found)).toBe(true);
  });

  it('refuses too many blocks, too much text and blocks nested too deep', () => {
    const paragraph: ArticleBlock = { kind: 'paragraph', text: [{ text: 'x' }] };
    expect(
      accepts(withBlocks(Array.from({ length: articleLimits.blocks + 1 }, () => paragraph))),
    ).toBe(false);
    const text = 'x'.repeat(articleLimits.run);
    const long = Array.from({ length: 62 }, () => ({ kind: 'paragraph', text: [{ text }] }));
    expect(accepts(withBlocks(long))).toBe(false);
    let deep: ArticleBlock = paragraph;
    for (let depth = 0; depth < articleLimits.depth + 1; depth += 1) {
      deep = { kind: 'quote', blocks: [deep] };
    }
    expect(accepts(withBlocks([deep]))).toBe(false);
    const images = Array.from({ length: articleLimits.images + 1 }, () => ({
      kind: 'figure',
      src: 'https://cdn.example/a.png',
      alt: '',
    }));
    expect(accepts(withBlocks(images))).toBe(false);
    expect(accepts(withBlocks([{ kind: 'paragraph', text: [{ text: 'x'.repeat(10_001) }] }]))).toBe(
      false,
    );
  });

  it('refuses other schemes for pictures and links', () => {
    for (const src of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'file:///etc/passwd',
      'app://settings/',
    ]) {
      expect(accepts(withBlocks([{ kind: 'figure', src, alt: '' }]))).toBe(false);
    }
    for (const link of ['javascript:alert(1)', 'data:text/html,x', '#a b', 'app://settings/']) {
      expect(accepts(withBlocks([{ kind: 'paragraph', text: [{ text: 'x', link }] }]))).toBe(false);
    }
    expect(accepts({ ...typical, url: 'file:///etc/passwd' })).toBe(false);
  });

  it('refuses a language that is no code, unknown blocks and keys of their own', () => {
    expect(accepts({ ...typical, lang: 'en"><script>' })).toBe(false);
    expect(accepts({ ...typical, lang: '' })).toBe(true);
    expect(accepts(withBlocks([{ kind: 'script', text: 'alert(1)' }]))).toBe(false);
    expect(accepts(withBlocks([{ kind: 'paragraph', text: [{ text: 'x' }], style: 'x' }]))).toBe(
      false,
    );
    expect(accepts({ ...typical, extra: true })).toBe(false);
    expect(accepts(withBlocks([{ kind: 'heading', level: 1, text: [] }]))).toBe(false);
    expect(accepts(withBlocks([{ kind: 'heading', level: 2, text: [], anchor: 'a b' }]))).toBe(
      false,
    );
  });
});
