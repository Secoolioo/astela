import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  articleLimits,
  type Article,
  type ArticleBlock,
  type Inline,
  type PageInfo,
} from '../reader/article.ts';
import { ReaderArticle } from '../reader/article-schema.ts';
import { findArticle, pictureAddress, readable } from '../reader/extract.ts';
import { noDeadline, parse, prose, testTree } from './reader-tree.ts';

const page: PageInfo = {
  url: 'https://news.example/2024/story',
  title: 'A story of the news - News Example',
  lang: 'en',
  dir: 'ltr',
  meta: {},
};

/** The article of a piece of HTML. */
function article(html: string, info: Partial<PageInfo> = {}): Article | undefined {
  return findArticle(testTree, parse(html), { ...page, ...info }, noDeadline);
}

/** The article of a piece of HTML, which must have one. */
function articleOf(html: string, info: Partial<PageInfo> = {}): Article {
  const found = article(html, info);
  if (found === undefined) throw new Error('No article');
  return found;
}

/** The text of the blocks of an article, block by block. */
function texts(blocks: readonly ArticleBlock[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        return [plain(block.text)];
      case 'code':
        return [block.text];
      case 'list':
        return block.items.flatMap(texts);
      case 'quote':
        return texts(block.blocks);
      case 'figure':
        return [`[${block.alt}]`];
      case 'table':
        return block.rows.map((row) => row.map(plain).join('|'));
      case 'rule':
      default:
        return ['---'];
    }
  });
}

function plain(runs: readonly Inline[]): string {
  return runs.map((run) => run.text).join('');
}

/** The runs of the first paragraph that contains a text. */
function runsWith(found: Article, text: string): readonly Inline[] {
  for (const block of found.blocks) {
    if (block.kind === 'paragraph' && plain(block.text).includes(text)) return block.text;
  }
  throw new Error(`No paragraph with ${text}`);
}

const story = (extra = ''): string =>
  `<body><nav><a href="https://news.example/">Home</a></nav>
  <article><h1>A story of the news</h1>
  <p>${prose(60, 'alpha')}</p><p>${prose(60, 'beta')}</p><p>${prose(60, 'gamma')}</p>${extra}
  </article>
  <div class="sidebar"><p>${prose(30, 'sidebar')}</p></div>
  <div id="comments"><p>${prose(40, 'comment')}</p></div>
  <footer><p>${prose(20, 'footer')}</p></footer></body>`;

describe('findArticle', () => {
  it('picks the article over a sidebar and comments with more links', () => {
    const links = Array.from(
      { length: 20 },
      (_, index) => `<a href="https://news.example/${String(index)}">${prose(5, 'link')}</a>`,
    ).join(' ');
    const found = articleOf(
      `<body><div class="related">${links}</div>
      <div id="main"><p>${prose(70, 'alpha')}</p><p>${prose(70, 'beta')}</p></div>
      <div><p>${links}</p><p>${links}</p></div></body>`,
    );
    const all = texts(found.blocks).join(' ');
    expect(all).toContain('alpha');
    expect(all).toContain('beta');
    expect(all).not.toContain('link');
  });

  it('leaves out navigation, sidebars, footers, forms, dialogs and what does not show', () => {
    const found = articleOf(
      story(`<aside><p>${prose(30, 'aside')}</p></aside>
      <form><p>${prose(30, 'form')}</p></form>
      <dialog><p>${prose(30, 'dialog')}</p></dialog>
      <div role="navigation"><p>${prose(30, 'role')}</p></div>
      <p aria-hidden="true">${prose(30, 'ariahidden')}</p>
      <p hidden>${prose(30, 'hiddenattr')}</p>
      <p data-invisible>${prose(30, 'invisible')}</p>
      <div class="cookie-notice"><p>${prose(30, 'cookie')}</p></div>
      <script>${prose(30, 'script')}</script>`),
    );
    const all = texts(found.blocks).join(' ');
    for (const left of [
      'Home',
      'sidebar',
      'comment',
      'footer',
      'aside',
      'form',
      'dialog',
      'role',
      'ariahidden',
      'hiddenattr',
      'invisible',
      'cookie',
      'script',
    ]) {
      expect(all).not.toContain(left);
    }
    expect(found.blocks.filter((block) => block.kind === 'paragraph')).toHaveLength(3);
  });

  it('keeps bold, italic, code, sup, sub and links of the web, and drops other links', () => {
    const found = articleOf(
      story(
        `<p>Text with <b>bold</b>, <em>italic</em>, <code>code</code>, x<sup>2</sup>, H<sub>2</sub>O,
        <a href="https://other.example/page">a link</a>, <a href="javascript:alert(1)">script</a>,
        <a href="data:text/html,x">data</a> and a line<br>break. ${prose(20)}</p>`,
      ),
    );
    const runs = runsWith(found, 'Text with');
    expect(runs).toContainEqual({ text: 'bold', bold: true });
    expect(runs).toContainEqual({ text: 'italic', italic: true });
    expect(runs).toContainEqual({ text: 'code', code: true });
    expect(runs).toContainEqual({ text: '2', script: 'sup' });
    expect(runs).toContainEqual({ text: '2', script: 'sub' });
    expect(runs).toContainEqual({ text: 'a link', link: 'https://other.example/page' });
    expect(runs.filter((run) => run.link !== undefined)).toHaveLength(1);
    expect(plain(runs)).toContain('script, data and a line\nbreak.');
  });

  it('keeps links inside the page only to anchors that the article keeps', () => {
    const found = articleOf(
      story(`<h2 id="later">Later</h2><p id="kept">${prose(20)}
      <a href="https://news.example/2024/story#later">to later</a>
      <a href="https://news.example/2024/story#gone">to gone</a></p>
      <div class="sidebar" id="gone"><p>${prose(10)}</p></div>`),
    );
    const runs = runsWith(found, 'to later');
    expect(runs).toContainEqual({ text: 'to later', link: '#later' });
    expect(runs.find((run) => run.text.includes('to gone'))?.link).toBeUndefined();
    expect(found.blocks).toContainEqual({
      kind: 'heading',
      level: 2,
      text: [{ text: 'Later' }],
      anchor: 'later',
    });
  });

  it('keeps pictures with their captions, also lazy ones, and drops small and broken ones', () => {
    const found = articleOf(
      story(`<figure><img src="https://cdn.example/a.png" alt="A picture" data-size="640x400">
      <figcaption>The <i>caption</i></figcaption></figure>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://cdn.example/lazy.jpg" alt="Lazy" data-size="300x200">
      <img src="https://cdn.example/icon.png" alt="Icon" data-size="16x16">
      <img src="https://cdn.example/blocked.png" alt="Blocked" data-broken>
      <img src="javascript:alert(1)" alt="Bad" data-size="300x200">`),
    );
    const figures = found.blocks.filter((block) => block.kind === 'figure');
    expect(figures).toEqual([
      {
        kind: 'figure',
        src: 'https://cdn.example/a.png',
        alt: 'A picture',
        width: 640,
        height: 400,
        caption: [{ text: 'The ' }, { text: 'caption', italic: true }],
      },
      { kind: 'figure', src: 'https://cdn.example/lazy.jpg', alt: 'Lazy', width: 300, height: 200 },
    ]);
  });

  it('nests lists at most four deep, and drops lists of links alone', () => {
    const nested = (depth: number): string =>
      depth === 0 ? 'deepest' : `<ul><li>level ${String(depth)}${nested(depth - 1)}</li></ul>`;
    const found = articleOf(
      story(`${nested(6)}<ul><li><a href="https://a.example/">Only</a></li>
      <li><a href="https://b.example/">links</a></li></ul>`),
    );
    const depthOf = (block: ArticleBlock | undefined): number =>
      block?.kind === 'list'
        ? 1 + Math.max(0, ...block.items.flatMap((item) => item.map(depthOf)))
        : 0;
    const lists = found.blocks.filter((block) => block.kind === 'list');
    expect(lists).toHaveLength(1);
    expect(depthOf(lists[0])).toBe(4);
    expect(texts(found.blocks).join(' ')).toContain('deepest');
    expect(texts(found.blocks).join(' ')).not.toContain('Only');
  });

  it('keeps data tables with their rows and reads layout tables as their content', () => {
    const found = articleOf(
      story(`<table><caption>Prices</caption><tr><th>Fruit</th><th>Price</th></tr>
      <tr><td>Apple</td><td>1</td></tr><tr><td>Pear</td><td>2</td></tr></table>
      <table><tr><td><p>${prose(20, 'layout')}</p></td><td>side</td></tr></table>`),
    );
    expect(found.blocks).toContainEqual({
      kind: 'table',
      head: true,
      rows: [
        [[{ text: 'Fruit' }], [{ text: 'Price' }]],
        [[{ text: 'Apple' }], [{ text: '1' }]],
        [[{ text: 'Pear' }], [{ text: '2' }]],
      ],
    });
    expect(found.blocks.filter((block) => block.kind === 'table')).toHaveLength(1);
    expect(texts(found.blocks).join(' ')).toContain('layout');
  });

  it('keeps the white space of code, maps headings and drops the heading of the title', () => {
    const found = articleOf(
      story(`<pre>  indented
    more</pre><h3>Three</h3><h5>Five</h5><h1>Another title</h1><hr>`),
    );
    expect(found.blocks).toContainEqual({ kind: 'code', text: '  indented\n    more' });
    expect(found.blocks).toContainEqual({ kind: 'heading', level: 3, text: [{ text: 'Three' }] });
    expect(found.blocks).toContainEqual({ kind: 'heading', level: 4, text: [{ text: 'Five' }] });
    expect(found.blocks).toContainEqual({
      kind: 'heading',
      level: 2,
      text: [{ text: 'Another title' }],
    });
    expect(found.blocks).toContainEqual({ kind: 'rule' });
    expect(texts(found.blocks)).not.toContain('A story of the news');
  });

  it('reads the title, the site, the byline, the date, the language and the direction', () => {
    const found = articleOf(
      `<body><article><h1>Heading of the page</h1>
      <p class="byline">By Ada Example</p><time datetime="2024-03-05">5 March</time>
      <p>${prose(60)}</p><p>${prose(60)}</p></article></body>`,
      { title: 'A long title of the story | News Example', lang: 'de-CH', dir: 'rtl' },
    );
    expect(found).toMatchObject({
      url: page.url,
      title: 'Heading of the page',
      site: 'news.example',
      byline: 'By Ada Example',
      published: '2024-03-05',
      lang: 'de-CH',
      dir: 'rtl',
      truncated: false,
    });
    expect(texts(found.blocks).join(' ')).not.toContain('Ada');
    const graph = articleOf(story(), {
      title: 'A long title of the story | News Example',
      meta: {
        'og:title': 'The title of Open Graph',
        'og:site_name': 'News Example',
        author: 'Grace Example',
        'article:published_time': '2024-03-05T10:00:00Z',
      },
    });
    expect(graph).toMatchObject({
      title: 'The title of Open Graph',
      site: 'News Example',
      byline: 'Grace Example',
      published: '2024-03-05T10:00:00Z',
    });
    const plainTitle = articleOf(`<body><div><p>${prose(60)}</p><p>${prose(60)}</p></div></body>`, {
      title: 'A long title of the story | News Example',
      lang: 'not a language',
    });
    expect(plainTitle.title).toBe('A long title of the story');
    expect(plainTitle.lang).toBe('');
    expect(plainTitle.site).toBe('news.example');
  });

  it('counts the words of the article', () => {
    const found = articleOf(
      `<body><article><p>${prose(100)}</p><p>${prose(100)}</p></article></body>`,
    );
    expect(found.words).toBe(200);
  });

  it('ends the article early at its limits and when its time is over', () => {
    const paragraphs = Array.from({ length: 6000 }, () => `<p>${prose(5)}</p>`).join('');
    const long = articleOf(`<body><article>${paragraphs}</article></body>`);
    expect(long.truncated).toBe(true);
    expect(long.blocks).toHaveLength(5000);
    let time = 0;
    const late = findArticle(
      testTree,
      parse(`<body><article>${paragraphs}</article></body>`),
      page,
      // The clock moves on with each look at it, every 256 nodes.
      { deadline: 20, now: () => (time += 1) },
    );
    expect(late?.truncated).toBe(true);
    expect((late?.blocks.length ?? 0) < 5000).toBe(true);
  });

  it('nests quotes at most six deep and keeps the text of figures without a picture', () => {
    const quotes = (depth: number): string =>
      depth === 0 ? `<p>innermost</p>` : `<blockquote>${quotes(depth - 1)}</blockquote>`;
    const found = articleOf(
      story(`${quotes(8)}<br><figure><img src="https://cdn.example/x.png" data-broken>
      <figcaption>Text of a figure</figcaption></figure>
      <p>Inline <img src="https://cdn.example/i.png" data-size="64x64"> picture</p>
      <table><thead><tr><th>H1</th><th>H2</th></tr></thead>
      <tbody><tr><td>a</td><td>b</td></tr></tbody></table>`),
    );
    const depthOf = (block: ArticleBlock | undefined): number =>
      block?.kind === 'quote' ? 1 + Math.max(0, ...block.blocks.map(depthOf)) : 0;
    expect(Math.max(...found.blocks.map(depthOf))).toBe(6);
    const all = texts(found.blocks);
    expect(all).toContain('innermost');
    expect(all).toContain('Text of a figure');
    expect(all).toContain('Inline picture');
    expect(all).toContain('H1|H2');
    expect(all).toContain('a|b');
  });

  it('keeps at most 200 pictures', () => {
    const pictures = Array.from(
      { length: 210 },
      (_, index) =>
        `<img src="https://cdn.example/${String(index)}.png" alt="p" data-size="64x64">`,
    ).join('');
    const found = articleOf(story(pictures));
    expect(found.blocks.filter((block) => block.kind === 'figure')).toHaveLength(200);
    expect(found.truncated).toBe(true);
  });

  it('keeps no link to an anchor that is no id and counts words without a segmenter', () => {
    const found = articleOf(
      story(
        `<p id="a">${prose(20)} <a href="https://news.example/2024/story#%E0%A4%A">bad</a></p>`,
      ),
      { lang: 'en-a' },
    );
    expect(runsWith(found, 'bad').find((run) => run.text.includes('bad'))?.link).toBeUndefined();
    expect(found.words).toBeGreaterThan(180);
  });

  it('finds no article on a page with less than 250 characters of text', () => {
    expect(article(`<body><p>${prose(20)}</p></body>`)).toBeUndefined();
  });

  it('reads parts with a hint against them in a second pass, when the first finds too little', () => {
    const found = articleOf(
      `<body><div class="layout-with-sidebar"><p>${prose(60)}</p><p>${prose(60)}</p></div></body>`,
    );
    expect(found.blocks.filter((block) => block.kind === 'paragraph')).toHaveLength(2);
  });

  it('leaves out elements nested deeper than it reads', () => {
    const deep = `${'<div>'.repeat(220)}<p>${prose(100, 'deep')}</p>${'</div>'.repeat(220)}`;
    const found = articleOf(`<body><p>${prose(60)}</p><p>${prose(60)}</p>${deep}</body>`);
    expect(texts(found.blocks).join(' ')).not.toContain('deep');
  });
});

/** Whether the schema of an article accepts what the extractor found. */
function accepted(found: Article): boolean {
  return v.safeParse(ReaderArticle, found).success;
}

/** The blocks of every depth, as the schema of an article counts them. */
function allBlocks(blocks: readonly ArticleBlock[]): number {
  return blocks.reduce(
    (sum, block) =>
      sum +
      1 +
      (block.kind === 'list'
        ? block.items.reduce((items, item) => items + allBlocks(item), 0)
        : block.kind === 'quote'
          ? allBlocks(block.blocks)
          : 0),
    0,
  );
}

/** The runs of text of every heading and paragraph of an article. */
function allRuns(blocks: readonly ArticleBlock[]): Inline[] {
  return blocks.flatMap((block): Inline[] => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        return [...block.text];
      case 'list':
        return block.items.flatMap(allRuns);
      case 'quote':
        return allRuns(block.blocks);
      case 'code':
      case 'figure':
      case 'table':
      case 'rule':
      default:
        return [];
    }
  });
}

/** A guide of 600 parts, each a heading, six paragraphs and a list of a size. */
function guide(size: number): string {
  const list = Array.from({ length: size }, () => `<li>${prose(5)}</li>`).join('');
  const part = `<h2>Part</h2>${`<p>${prose(12)}</p>`.repeat(6)}<ul>${list}</ul>`;
  return `<body><article><h1>A guide</h1>${part.repeat(600)}</article></body>`;
}

/** A text of 2,000 words, of 10,000 characters for a word of four letters. */
function chunk(word: string): string {
  return `${word} `.repeat(2000).trim();
}

/** The characters of an article, as the schema of an article counts them. */
function characters(blocks: readonly ArticleBlock[]): number {
  return allRuns(blocks).reduce((sum, run) => sum + run.text.length, 0);
}

describe('findArticle within the limits of an article', () => {
  it('keeps every run within the length of a run, without losing text', () => {
    // A post whose lines a `<br>` separates, as some editors write them, and a poem with a line
    // break after each line: their text nodes are one paragraph together.
    const lines = Array.from({ length: 30 }, (_, index) => `${String(index)} ${prose(110)}`);
    const post = articleOf(
      `<body><article><h1>A post</h1><div class="post-body">${lines.join('<br><br>')}</div></article></body>`,
    );
    const poem = Array.from({ length: 400 }, (_, index) => `Line ${String(index)} ${prose(6)}`);
    const spans = Array.from({ length: 20 }, () => `<span>${prose(100)}</span>`);
    const node = 'x'.repeat(25_000);
    for (const [found, text] of [
      [post, lines.join('\n\n')],
      [articleOf(`<body><article><p>${poem.join('<br>')}</p></article></body>`), poem.join('\n')],
      [articleOf(`<body><article><p>${spans.join(' ')}</p></article></body>`), spans.join(' ')],
      [articleOf(`<body><article><p>${node}</p></article></body>`), node],
    ] as const) {
      const runs = allRuns(found.blocks);
      expect(found.blocks).toHaveLength(1);
      expect(runs.length).toBeGreaterThan(1);
      for (const run of runs) expect(run.text.length).toBeLessThanOrEqual(articleLimits.run);
      expect(texts(found.blocks)).toEqual([text.replace(/<\/?span>/g, '')]);
      expect(found.truncated).toBe(false);
      expect(accepted(found)).toBe(true);
    }
  });

  it('keeps as many runs in a block as an article may, and ends the article there', () => {
    const marked = Array.from({ length: 6000 }, () => '<b>bold</b> plain').join(' ');
    const found = articleOf(`<body><article><p>${marked}</p><p>${prose(60)}</p></article></body>`);
    expect(found.blocks).toHaveLength(1);
    expect(allRuns(found.blocks)).toHaveLength(articleLimits.runs);
    expect(found.truncated).toBe(true);
    expect(accepted(found)).toBe(true);
  });

  it('ends the article at its limit of blocks, also in a long list and after its last block', () => {
    const items = Array.from({ length: 6000 }, (_, index) => `<li>Item ${String(index)}</li>`);
    const paragraphs = Array.from({ length: 5000 }, () => `<p>${prose(10)}</p>`).join('');
    for (const html of [
      `<body><article><p>${prose(60)}</p><p>${prose(60)}</p><ul>${items.join('')}</ul></article></body>`,
      `<body><article>${paragraphs}Text after the last paragraph</article></body>`,
      ...[4, 7, 10, 13].map(guide),
    ]) {
      const found = articleOf(html);
      expect(allBlocks(found.blocks)).toBeLessThanOrEqual(articleLimits.blocks);
      expect(allBlocks(found.blocks)).toBeGreaterThan(articleLimits.blocks - 10);
      expect(found.truncated).toBe(true);
      expect(accepted(found)).toBe(true);
    }
    // An article with as many blocks as it may and only white space after them is complete.
    const exact = articleOf(`<body><article>${paragraphs}  </article></body>`);
    expect(allBlocks(exact.blocks)).toBe(articleLimits.blocks);
    expect(exact.truncated).toBe(false);
  });

  it('ends the article at its limit of characters, also in a paragraph or a table', () => {
    const nodes = Array.from({ length: 70 }, () => `<span>${chunk('long')}</span>`).join(' ');
    const paragraphs = Array.from({ length: 59 }, () => `<p>${chunk('word')}</p>`).join('');
    const cell = `<td>${chunk('cell')}</td>`;
    for (const html of [
      `<body><article><p>${nodes}</p><p>${prose(60)}</p></article></body>`,
      `<body><article>${paragraphs}<table><caption>Big</caption><tr><th>A</th><th>B</th></tr>
      <tr>${cell}${cell}</tr><tr>${cell}${cell}</tr></table><p>${prose(60)}</p></article></body>`,
    ]) {
      const found = articleOf(html);
      const tables = found.blocks.flatMap((block) => (block.kind === 'table' ? [block] : []));
      const cells = tables
        .flatMap((table) => table.rows.flat(2))
        .reduce((sum, run) => sum + run.text.length, 0);
      expect(characters(found.blocks) + cells).toBeLessThanOrEqual(articleLimits.characters);
      expect(characters(found.blocks) + cells).toBeGreaterThan(articleLimits.characters - 100);
      expect(found.truncated).toBe(true);
      expect(accepted(found)).toBe(true);
    }
  });
});

describe('pictureAddress', () => {
  it('allows web addresses and small data pictures of known types', () => {
    expect(pictureAddress('https://cdn.example/a.png')).toBe(true);
    expect(pictureAddress('http://cdn.example/a.png')).toBe(true);
    expect(pictureAddress('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(pictureAddress(`https://cdn.example/${'a'.repeat(9000)}`)).toBe(false);
    expect(pictureAddress(`data:image/png;base64,${'A'.repeat(70_000)}`)).toBe(false);
    expect(pictureAddress('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(pictureAddress('javascript:alert(1)')).toBe(false);
    expect(pictureAddress('file:///etc/passwd')).toBe(false);
  });
});

describe('readable', () => {
  it('counts blocks of at least 140 characters until their score reaches 20', () => {
    // sqrt(240 - 140) = 10: two such blocks reach 20.
    expect(readable([240, 240])).toBe(true);
    expect(readable([240, 239])).toBe(false);
    expect(readable([139, 139, 139, 139, 139, 139, 139, 139, 139, 139])).toBe(false);
    expect(readable([140, 240, 240])).toBe(true);
    expect(readable([])).toBe(false);
  });
});
