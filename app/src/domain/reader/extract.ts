import {
  articleLimits,
  type Article,
  type ArticleBlock,
  type Inline,
  type PageInfo,
} from './article.ts';

/** The attributes that the extractor reads. */
export type ReaderAttribute =
  | 'id'
  | 'class'
  | 'role'
  | 'itemprop'
  | 'href'
  | 'src'
  | 'alt'
  | 'lang'
  | 'dir'
  | 'datetime'
  | 'rel'
  | 'aria-hidden'
  | 'hidden'
  | 'data-src'
  | 'data-original';

/** A picture as it shows: its address and its size in CSS pixels, the larger of drawn and natural. */
export interface ReaderImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The tree of a page as the extractor reads it: the DOM in the page, plain objects in the tests.
 * `href`, `src`, `data-src` and `data-original` are absolute addresses, as the document resolves
 * them.
 */
export interface ReaderTree<N> {
  /** The name of an element in lower case, such as `p`, `#text` for text, `''` for the rest. */
  name(node: N): string;
  /** The children of an element, those of its open shadow root in their place. */
  children(node: N): Iterable<N>;
  /** The text of a text node. */
  text(node: N): string;
  /**
   * An attribute of an element, or `null` when it has none; the attributes that hold
   * addresses come absolute, as the document resolves them.
   */
  attribute(node: N, name: ReaderAttribute): string | null;
  /** Whether an element shows, as `checkVisibility()` tells. */
  visible(node: N): boolean;
  /** The picture of an `img` element, or `undefined` for one that could not load. */
  image?(node: N): ReaderImage | undefined;
}

/** How long the extractor may take, by a clock in milliseconds. */
export interface ReaderBudget {
  /** The time of the clock at which the extractor stops reading the page. */
  readonly deadline: number;
  /** The time of the clock now. */
  now(): number;
}

/** Elements whose content is never part of an article. */
const skippedNames = new Set([
  'nav',
  'aside',
  'footer',
  'form',
  'dialog',
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'object',
  'embed',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'menu',
  'map',
  'head',
  'link',
  'meta',
  'title',
]);

/** Roles of parts of a page that are not its article. */
const skippedRoles = new Set([
  'navigation',
  'complementary',
  'dialog',
  'alertdialog',
  'banner',
  'contentinfo',
  'menu',
  'menubar',
]);

/** Classes and ids of parts that are not the article, such as comments or a sidebar. */
const negativeHints =
  /comment|footer|nav|menu|sidebar|share|social|related|promo|sponsor|advert|\bad-|\bads?\b|banner|cookie|consent|newsletter|subscribe|popup|modal|breadcrumb|pagination/i;

/** Classes and ids of the article itself. */
const positiveHints = /article|body|content|entry|main|post|story|text/i;

/** Elements whose content flows in a line of text. */
const inlineNames = new Set([
  '#text',
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'tt',
  'u',
  'var',
  'wbr',
  'font',
]);

/** Elements that are a block of text by themselves, for the scores. */
const textBlocks = new Set(['p', 'pre', 'blockquote', 'td', 'li', 'dd']);

/** The base score of a candidate by its element. */
const baseScores: Readonly<Record<string, number>> = {
  article: 10,
  main: 8,
  div: 5,
  section: 3,
  pre: 3,
  td: 3,
  blockquote: 3,
  ol: -3,
  ul: -3,
  dl: -3,
  li: -3,
  h1: -5,
  h2: -5,
  h3: -5,
  h4: -5,
  h5: -5,
  h6: -5,
  th: -5,
};

/** An element or a text of the page, with what the extractor learned of it. */
interface Item<N> {
  readonly node: N;
  readonly name: string;
  readonly parent: Item<N> | undefined;
  readonly kids: Item<N>[];
  /** The text of a text node, with its white space collapsed. */
  readonly text: string;
  /** Characters of text inside. */
  length: number;
  /** Characters of text inside links. */
  links: number;
  commas: number;
  /** Whether the element holds only content that flows in a line. */
  inline: boolean;
  /** Whether the element holds a `table`. */
  tables: boolean;
  /** The score as a candidate, once a block gave it one. */
  score: number | undefined;
  /** Whether the element left the article, such as the byline. */
  dropped: boolean;
}

/** What the conversion of one pass counts. */
interface Output {
  blocks: number;
  characters: number;
  images: number;
  /** Whether the article reached one of its limits, after which nothing joins it. */
  full: boolean;
  /** The text of the article for its words, at most 200,000 characters. */
  sample: string;
}

/** The text of a page that has no article: less than this many characters. */
const minimumLength = 250;
/** How deep the extractor reads the elements of a page; deeper ones are left out. */
const maximumNesting = 200;
/** How many nodes the extractor visits between two looks at the clock. */
const clockEvery = 256;
/** How much text the words are counted in, before they are extrapolated. */
const wordSample = 200_000;

/**
 * Whether a page has an article, by the length of the text of its paragraphs and blocks of
 * code: the rule of Firefox, where the blocks of at least 140 characters add the square root of
 * their length beyond 140, and 20 is enough.
 * @param lengths - The length of the text of each block.
 */
export function readable(lengths: readonly number[]): boolean {
  let score = 0;
  for (const length of lengths) {
    if (length < 140) continue;
    score += Math.sqrt(length - 140);
    if (score >= 20) return true;
  }
  return false;
}

/**
 * Finds the article of a page and converts it into blocks: scores blocks of text by their
 * length and commas, gives the score to their parents, takes the best candidate with the
 * siblings that score high enough, and converts it, without what does not show or is not part
 * of an article. A first pass leaves out every part whose class or id hints that it is no
 * article, such as comments; a second pass, when the first finds too little, keeps those of at
 * least 500 characters.
 * @param tree - How to read the page.
 * @param body - The body of the document.
 * @param page - The address, title, language, direction and meta elements of the page.
 * @param budget - How long the extraction may take; past it, the article ends early.
 * @returns The article, or `undefined` for a page with less than 250 characters of text.
 */
export function findArticle<N>(
  tree: ReaderTree<N>,
  body: N,
  page: PageInfo,
  budget: ReaderBudget,
): Article | undefined {
  const first = extractPass(tree, body, page, budget, true);
  // Reading the page takes the time; once it is over, a second pass would find no more.
  return first.article !== undefined || first.late
    ? first.article
    : extractPass(tree, body, page, budget, false).article;
}

/**
 * One pass of the extraction: it reads the page until its time is over, and converts what it
 * read, within the limits of an article.
 */
function extractPass<N>(
  tree: ReaderTree<N>,
  body: N,
  page: PageInfo,
  budget: ReaderBudget,
  strict: boolean,
): { readonly article: Article | undefined; readonly late: boolean } {
  const clock = { visited: 0, late: false };
  const root = mirror(tree, body, undefined, { strict, clock, budget, level: 0 });
  const article = root === undefined ? undefined : convert(tree, root, page, strict, clock.late);
  return { article, late: clock.late };
}

/** The article of the items of a page. */
function convert<N>(
  tree: ReaderTree<N>,
  root: Item<N>,
  page: PageInfo,
  strict: boolean,
  late: boolean,
): Article | undefined {
  const title = titleOf(page, root);
  const byline = bylineOf(tree, root, page);
  const top = topCandidate(root) ?? root;
  const parts = joinedSiblings(top);
  const output: Output = { blocks: 0, characters: 0, images: 0, full: false, sample: '' };
  const context: Context<N> = {
    tree,
    page,
    strict,
    output,
    titleKey: normalized(title),
    anchors: anchorsOf(tree, parts),
  };
  const blocks = parts.flatMap((part) => blocksOf(part, context, 0, 0));
  if (output.characters < minimumLength) return undefined;
  return {
    url: page.url,
    title: cut(title, articleLimits.title),
    site: siteOf(page),
    byline,
    published: publishedOf(tree, root, page),
    lang: languageOf(page.lang || (tree.attribute(top.node, 'lang') ?? '')),
    dir: page.dir,
    blocks,
    words: wordsOf(output, page.lang),
    truncated: late || output.full,
  };
}

/**
 * Reads the page into items: elements that show and may be part of an article, with the
 * length of their text, the text in links and their commas.
 */
function mirror<N>(
  tree: ReaderTree<N>,
  node: N,
  parent: Item<N> | undefined,
  walk: {
    readonly strict: boolean;
    readonly clock: { visited: number; late: boolean };
    readonly budget: ReaderBudget;
    readonly level: number;
  },
): Item<N> | undefined {
  const { strict, clock, budget, level } = walk;
  clock.visited += 1;
  if (clock.visited % clockEvery === 0 && budget.now() > budget.deadline) clock.late = true;
  if (clock.late) return undefined;
  const name = tree.name(node);
  if (name === '') return undefined;
  if (name === '#text') {
    const text = tree.text(node).replace(/\s+/g, ' ');
    if (text === '') return undefined;
    const length = text.trim().length;
    const item: Item<N> = {
      node,
      name,
      parent,
      kids: [],
      text,
      length,
      links: 0,
      commas: (text.match(/[,，、]/g) ?? []).length,
      inline: true,
      tables: false,
      score: undefined,
      dropped: false,
    };
    return item;
  }
  if (level > maximumNesting) return undefined;
  if (parent !== undefined && skipped(tree, node, name, strict)) return undefined;
  const item: Item<N> = {
    node,
    name,
    parent,
    kids: [],
    text: '',
    length: 0,
    links: 0,
    commas: 0,
    inline: true,
    tables: false,
    score: undefined,
    dropped: false,
  };
  const deeper = { ...walk, level: level + 1 };
  for (const child of tree.children(node)) {
    const kid = mirror(tree, child, item, deeper);
    if (kid === undefined) continue;
    item.kids.push(kid);
    item.length += kid.length;
    item.links += kid.links;
    item.commas += kid.commas;
    item.inline &&= kid.inline && inlineNames.has(kid.name);
    item.tables ||= kid.name === 'table' || kid.tables;
  }
  if (name === 'a') item.links = item.length;
  return item;
}

/** Whether an element and its content are no part of an article. */
function skipped<N>(tree: ReaderTree<N>, node: N, name: string, strict: boolean): boolean {
  if (skippedNames.has(name)) return true;
  const role = tree.attribute(node, 'role');
  if (role !== null && skippedRoles.has(role.trim().toLowerCase())) return true;
  if (tree.attribute(node, 'aria-hidden') === 'true' || tree.attribute(node, 'hidden') !== null) {
    return true;
  }
  if (!tree.visible(node)) return true;
  return strict && hints(tree, node) < 0;
}

/**
 * Whether an element is no part of an article by itself: an element such as `nav` or `form`,
 * a role such as `navigation`, an element that is hidden or does not show, or one whose class
 * or id hints that it is none, such as comments.
 * @param tree - How to read the page.
 * @param node - The element.
 */
export function outsideArticle<N>(tree: ReaderTree<N>, node: N): boolean {
  return skipped(tree, node, tree.name(node), true);
}

/** What the class and the id of an element hint: -25 for no article, 25 for one, or 0. */
function hints<N>(tree: ReaderTree<N>, node: N): number {
  const names = `${tree.attribute(node, 'class') ?? ''} ${tree.attribute(node, 'id') ?? ''}`;
  const itemprop = tree.attribute(node, 'itemprop') ?? '';
  const positive = positiveHints.test(names) || /articleBody/i.test(itemprop);
  if (positive) return 25;
  return negativeHints.test(names) ? -25 : 0;
}

/** The share of the text of an item that is in links. */
function linkDensity<N>(item: Item<N>): number {
  return item.length === 0 ? 0 : item.links / item.length;
}

/** The elements of an item, without its texts. */
function elements<N>(item: Item<N>): Item<N>[] {
  return item.kids.filter((kid) => kid.name !== '#text');
}

/**
 * Scores the blocks of text and gives the score to their parents, and returns the candidate
 * with the best score, by the share of its text that is not in links.
 */
function topCandidate<N>(root: Item<N>): Item<N> | undefined {
  const candidates: Item<N>[] = [];
  const visit = (item: Item<N>): void => {
    for (const kid of elements(item)) visit(kid);
    if (item === root) return;
    const block =
      textBlocks.has(item.name) ||
      ((item.name === 'div' || item.name === 'section' || item.name === 'article') && item.inline);
    if (!block || item.length < 25) return;
    const score = 1 + item.commas + Math.min(3, Math.floor(item.length / 100));
    let ancestor = item.parent;
    for (const share of [1, 2, 3]) {
      if (ancestor === undefined) break;
      if (ancestor.score === undefined) {
        ancestor.score = baseScores[ancestor.name] ?? 0;
        candidates.push(ancestor);
      }
      ancestor.score += score / share;
      ancestor = ancestor.parent;
    }
  };
  visit(root);
  let best: Item<N> | undefined;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const final = finalScore(candidate);
    if (final > bestScore) {
      best = candidate;
      bestScore = final;
    }
  }
  return best;
}

/** The score of a candidate by the share of its text that is not in links. */
function finalScore<N>(item: Item<N>): number {
  return (item.score ?? 0) * (1 - linkDensity(item));
}

/**
 * The best candidate with its siblings that score at least a fifth of it, or 10, and the
 * paragraphs next to it of more than 80 characters with few links, in their order.
 */
function joinedSiblings<N>(top: Item<N>): Item<N>[] {
  const parent = top.parent;
  if (parent === undefined) return [top];
  const threshold = Math.max(10, finalScore(top) * 0.2);
  return elements(parent).filter(
    (sibling) =>
      sibling === top ||
      (sibling.score !== undefined && finalScore(sibling) >= threshold) ||
      (sibling.name === 'p' && sibling.length > 80 && linkDensity(sibling) < 0.25),
  );
}

/** What the conversion of a pass needs. */
interface Context<N> {
  readonly tree: ReaderTree<N>;
  readonly page: PageInfo;
  readonly strict: boolean;
  readonly output: Output;
  /** The title, to drop a heading that repeats it. */
  readonly titleKey: string;
  /** The ids of the elements that the article keeps, for links to them. */
  readonly anchors: ReadonlySet<string>;
}

/**
 * Whether the article is full, so nothing more joins it: it has as many blocks or characters as
 * it may, or a block or picture did not fit. The conversion reads only what the reading of the
 * page found, so it needs no clock.
 */
function full<N>(context: Context<N>): boolean {
  const { output } = context;
  if (output.blocks >= articleLimits.blocks || output.characters >= articleLimits.characters) {
    output.full = true;
  }
  return output.full;
}

/**
 * How many characters the text of a block may still take: what the limit of the article leaves.
 * The cells of a table take from one room together.
 */
interface Room {
  characters: number;
}

/** The room for the text of a new block. */
function roomOf<N>(context: Context<N>): Room {
  return { characters: Math.max(0, articleLimits.characters - context.output.characters) };
}

/**
 * A list or a quote with the blocks in it. It counts as a block before them, so that they stay
 * within the limit of blocks together with it; one that ends up empty counts no more.
 * @param context - What the conversion needs.
 * @param fill - Converts the blocks in it, and returns the list or quote, or nothing.
 */
function holding<N>(context: Context<N>, fill: () => ArticleBlock | undefined): ArticleBlock[] {
  context.output.blocks += 1;
  const block = fill();
  if (block !== undefined) return [block];
  context.output.blocks -= 1;
  return [];
}

/** Counts a block of the article. */
function counted<N>(context: Context<N>, block: ArticleBlock, text: string): ArticleBlock[] {
  const { output } = context;
  output.blocks += 1;
  output.characters += text.length;
  if (output.sample.length < wordSample) output.sample += ` ${text.slice(0, wordSample)}`;
  return [block];
}

/**
 * The blocks of an item of the article.
 * @param item - The item.
 * @param context - What the conversion needs.
 * @param depth - How deep lists and quotes nest here.
 * @param lists - How deep lists nest here.
 */
function blocksOf<N>(
  item: Item<N>,
  context: Context<N>,
  depth: number,
  lists: number,
): ArticleBlock[] {
  if (item.dropped || full(context)) return [];
  const { name } = item;
  switch (name) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = inlines(item, context);
      const plain = plainText(text);
      if (plain === '' || (name === 'h1' && normalized(plain) === context.titleKey)) return [];
      const level = name === 'h1' || name === 'h2' ? 2 : name === 'h3' ? 3 : 4;
      return counted(context, { kind: 'heading', level, text, ...anchorOf(item, context) }, plain);
    }
    case 'p':
      return paragraph(item, context);
    case 'pre': {
      const text = rawText(context.tree, item).replace(/\n$/, '');
      if (text.trim() === '') return [];
      return counted(context, { kind: 'code', text: cut(text, articleLimits.run) }, text);
    }
    case 'hr':
      return counted(context, { kind: 'rule' }, '');
    case 'blockquote': {
      if (depth >= articleLimits.depth) return paragraph(item, context);
      return holding(context, () => {
        const blocks = childBlocks(item, context, depth + 1, lists);
        return blocks.length === 0 ? undefined : { kind: 'quote', blocks };
      });
    }
    case 'ul':
    case 'ol':
      return list(item, context, depth, lists);
    case 'img':
    case 'picture':
    case 'figure':
      return figure(item, context, depth, lists);
    case 'table':
      return table(item, context, depth, lists);
    case 'br':
    case 'wbr':
      return [];
    default:
      return container(item, context, depth, lists);
  }
}

/** The blocks of a container, such as a `div`, or nothing for one that is no part of an article. */
function container<N>(
  item: Item<N>,
  context: Context<N>,
  depth: number,
  lists: number,
): ArticleBlock[] {
  if (item.kids.length === 0) return [];
  if (item.name !== '#text' && !inlineNames.has(item.name)) {
    // Lists of links, such as of related pages, and parts that hint that they are none.
    if (linkDensity(item) > 0.5 && item.length < 250) return [];
    if (!context.strict && hints(context.tree, item.node) < 0 && item.length < 500) return [];
  }
  if (item.inline) return paragraph(item, context);
  return childBlocks(item, context, depth, lists);
}

/**
 * The blocks of the children of an item: blocks of their own, and paragraphs of the content
 * between them that flows in a line.
 */
function childBlocks<N>(
  item: Item<N>,
  context: Context<N>,
  depth: number,
  lists: number,
): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  let run: Item<N>[] = [];
  const flush = (): void => {
    const parts = run;
    run = [];
    // White space between blocks makes no paragraph; text that comes after a full article
    // makes none either.
    if (parts.every((part) => part.length === 0) || full(context)) return;
    const text = trimmed(
      parts.flatMap((part) => inlineOf(part, context, {})),
      context,
      roomOf(context),
    );
    const plain = plainText(text);
    if (plain !== '') blocks.push(...counted(context, { kind: 'paragraph', text }, plain));
  };
  for (const kid of item.kids) {
    if (kid.dropped) continue;
    if (kid.name === '#text' || (inlineNames.has(kid.name) && kid.inline)) {
      run.push(kid);
      continue;
    }
    flush();
    blocks.push(...blocksOf(kid, context, depth, lists));
    if (context.output.full) break;
  }
  flush();
  return blocks;
}

/** A paragraph of the text of an item, or nothing when it has none or the article is full. */
function paragraph<N>(item: Item<N>, context: Context<N>): ArticleBlock[] {
  if (full(context)) return [];
  const text = inlines(item, context);
  const plain = plainText(text);
  if (plain === '') return [];
  return counted(context, { kind: 'paragraph', text, ...anchorOf(item, context) }, plain);
}

/**
 * A list, or nothing for a list of links alone, such as of related pages. Its items end where
 * the article is full.
 */
function list<N>(item: Item<N>, context: Context<N>, depth: number, lists: number): ArticleBlock[] {
  if (item.length > 0 && item.links >= item.length) return [];
  if (depth >= articleLimits.depth || lists >= articleLimits.listDepth) {
    return childBlocks(item, context, depth, lists);
  }
  return holding(context, () => {
    const items: ArticleBlock[][] = [];
    for (const kid of elements(item)) {
      if (kid.name !== 'li' || kid.dropped) continue;
      if (full(context)) break;
      const blocks = kid.inline
        ? paragraph(kid, context)
        : childBlocks(kid, context, depth + 1, lists + 1);
      if (blocks.length > 0) items.push(blocks);
    }
    return items.length === 0 ? undefined : { kind: 'list', ordered: item.name === 'ol', items };
  });
}

/** A picture with its caption, or the content of a figure without a picture. */
function figure<N>(
  item: Item<N>,
  context: Context<N>,
  depth: number,
  lists: number,
): ArticleBlock[] {
  const image = item.name === 'img' ? item : firstOf(item, 'img');
  const picture = image === undefined ? undefined : pictureOf(context, image);
  if (picture === undefined) {
    return item.name === 'figure' ? childBlocks(withoutImages(item), context, depth, lists) : [];
  }
  const { output } = context;
  if (output.images >= articleLimits.images) {
    output.full = true;
    return [];
  }
  output.images += 1;
  const captionItem = item.name === 'figure' ? firstOf(item, 'figcaption') : undefined;
  const caption = captionItem === undefined ? [] : inlines(captionItem, context);
  const alt = cut((context.tree.attribute(image?.node ?? item.node, 'alt') ?? '').trim(), 1000);
  return counted(
    context,
    {
      kind: 'figure',
      src: picture.src,
      alt,
      ...(picture.width > 0 ? { width: Math.round(picture.width) } : {}),
      ...(picture.height > 0 ? { height: Math.round(picture.height) } : {}),
      ...(caption.length > 0 ? { caption } : {}),
    },
    `${alt} ${plainText(caption)}`,
  );
}

/** A figure without its pictures, for the text of a figure whose picture cannot show. */
function withoutImages<N>(item: Item<N>): Item<N> {
  return { ...item, kids: item.kids.filter((kid) => kid.name !== 'img' && kid.name !== 'picture') };
}

/**
 * The picture of an `img` element as the article shows it: from `currentSrc` or `src`, or from
 * `data-src` or `data-original` when the source is empty or a small placeholder of `data:`; an
 * address of `http` or `https`, or a `data:` picture of at most 64 KiB. Pictures that could not
 * load, or are smaller than 32 by 32 pixels, are left out.
 */
function pictureOf<N>(context: Context<N>, item: Item<N>): ReaderImage | undefined {
  const { tree } = context;
  const image = tree.image?.(item.node);
  if (image === undefined) return undefined;
  let src = image.src;
  if (src === '' || (src.startsWith('data:') && src.length < 1024)) {
    src =
      tree.attribute(item.node, 'data-src') ?? tree.attribute(item.node, 'data-original') ?? src;
  }
  if (!pictureAddress(src)) return undefined;
  if (image.width < 32 || image.height < 32) return undefined;
  return { src, width: image.width, height: image.height };
}

/** Whether an address may be the source of a picture of the article. */
export function pictureAddress(src: string): boolean {
  if (/^https?:\/\//i.test(src)) return src.length <= articleLimits.url;
  return (
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(src) &&
    src.length <= articleLimits.dataImage
  );
}

/**
 * A table with its rows: one that has a head or a caption, at least two rows and two columns,
 * no table inside, and at most 200 rows of 20 cells. Other tables, as for the layout of a
 * page, are containers of their content.
 */
function table<N>(
  item: Item<N>,
  context: Context<N>,
  depth: number,
  lists: number,
): ArticleBlock[] {
  const rows = rowsOf(item);
  const heads = rows.some((row) => elements(row).some((cell) => cell.name === 'th'));
  const caption = elements(item).some((kid) => kid.name === 'caption');
  const columns = Math.max(0, ...rows.map((row) => cellsOf(row).length));
  const data =
    (heads || caption) &&
    !item.tables &&
    rows.length >= 2 &&
    columns >= 2 &&
    rows.length <= articleLimits.rows &&
    columns <= articleLimits.columns;
  if (!data) return container(item, context, depth, lists);
  // The cells share the room of the table.
  const room = roomOf(context);
  const cells = rows.map((row) => cellsOf(row).map((cell) => inlines(cell, context, room)));
  const head = cellsOf(rows[0]).every((cell) => cell.name === 'th');
  return counted(
    context,
    { kind: 'table', head, rows: cells },
    cells.flat().map(plainText).join(' '),
  );
}

/** The rows of a table, also those inside its head, body and foot. */
function rowsOf<N>(item: Item<N>): Item<N>[] {
  return elements(item).flatMap((kid) =>
    kid.name === 'tr'
      ? [kid]
      : kid.name === 'thead' || kid.name === 'tbody' || kid.name === 'tfoot'
        ? elements(kid).filter((row) => row.name === 'tr')
        : [],
  );
}

/** The cells of a row. */
function cellsOf<N>(row: Item<N> | undefined): Item<N>[] {
  return row === undefined
    ? []
    : elements(row).filter((cell) => cell.name === 'td' || cell.name === 'th');
}

/** The first element of a name inside an item, depth first. */
function firstOf<N>(item: Item<N>, name: string): Item<N> | undefined {
  for (const kid of elements(item)) {
    if (kid.name === name) return kid;
    const found = firstOf(kid, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The marks of a run of text. */
type Marks = Omit<Inline, 'text'>;

/**
 * The runs of text of an item, without white space at their ends, within the room of its block.
 * @param item - The item, such as a paragraph.
 * @param context - What the conversion needs.
 * @param room - What its text may take; that of a new block when left out.
 */
function inlines<N>(item: Item<N>, context: Context<N>, room: Room = roomOf(context)): Inline[] {
  return trimmed(children(item, context, {}), context, room);
}

/**
 * The runs of text of an item in a line of text, with the marks of its elements. A text longer
 * than a run takes several runs.
 */
function inlineOf<N>(item: Item<N>, context: Context<N>, marks: Marks): Inline[] {
  if (item.dropped) return [];
  switch (item.name) {
    case '#text': {
      const runs: Inline[] = [];
      for (const text of pieces(item.text, articleLimits.run)) runs.push({ text, ...marks });
      return runs;
    }
    case 'br':
      return [{ text: '\n', ...marks }];
    case 'img':
    case 'picture':
    case 'wbr':
      return [];
    case 'b':
    case 'strong':
      return children(item, context, { ...marks, bold: true });
    case 'i':
    case 'em':
    case 'cite':
    case 'dfn':
      return children(item, context, { ...marks, italic: true });
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      return children(item, context, { ...marks, code: true });
    case 'sup':
    case 'sub':
      return children(item, context, { ...marks, script: item.name });
    case 'a': {
      const link = linkOf(item, context);
      return children(item, context, link === undefined ? marks : { ...marks, link });
    }
    default:
      return children(item, context, marks);
  }
}

/** The runs of text of the children of an item. */
function children<N>(item: Item<N>, context: Context<N>, marks: Marks): Inline[] {
  return item.kids.flatMap((kid) => inlineOf(kid, context, marks));
}

/**
 * The address of a link that the article keeps: one of `http` or `https`, or `#` and the id of
 * an element that the article keeps for a link inside the page.
 */
function linkOf<N>(item: Item<N>, context: Context<N>): string | undefined {
  const href = context.tree.attribute(item.node, 'href');
  if (href === null || !/^https?:\/\//i.test(href) || href.length > articleLimits.url) {
    return undefined;
  }
  const hash = href.indexOf('#');
  if (hash !== -1 && withoutHash(href) === withoutHash(context.page.url)) {
    const anchor = decodedAnchor(href.slice(hash + 1));
    return anchor !== undefined && context.anchors.has(anchor) ? `#${anchor}` : undefined;
  }
  return href;
}

/** The anchor of a fragment, when it can be the id of an element of the article. */
function decodedAnchor(fragment: string): string | undefined {
  let anchor: string;
  try {
    anchor = decodeURIComponent(fragment);
  } catch {
    return undefined;
  }
  return /^[A-Za-z0-9_:.-]{1,128}$/.test(anchor) ? anchor : undefined;
}

/** The ids of the headings and paragraphs that the article keeps, for links inside the page. */
function anchorsOf<N>(tree: ReaderTree<N>, parts: readonly Item<N>[]): Set<string> {
  const anchors = new Set<string>();
  const visit = (item: Item<N>): void => {
    if (/^(?:h[1-6]|p)$/.test(item.name)) {
      const id = decodedAnchor(tree.attribute(item.node, 'id') ?? '');
      if (id !== undefined) anchors.add(id);
    }
    for (const kid of elements(item)) visit(kid);
  };
  for (const part of parts) visit(part);
  return anchors;
}

/** The anchor of a heading or a paragraph, when links of the article may lead to it. */
function anchorOf<N>(item: Item<N>, context: Context<N>): { anchor?: string } {
  const id = decodedAnchor(context.tree.attribute(item.node, 'id') ?? '');
  return id !== undefined && context.anchors.has(id) ? { anchor: id } : {};
}

/**
 * Runs of text without white space at the ends of the line and without empty runs. Runs next to
 * each other with the same marks join as long as they fit into one run. A block keeps as many
 * runs and characters as the limits of the article leave it; what does not fit ends the article.
 * @param runs - The runs of the line.
 * @param context - What the conversion needs.
 * @param room - What the text of the block may take, which the kept runs use up.
 */
function trimmed<N>(runs: readonly Inline[], context: Context<N>, room: Room): Inline[] {
  const merged: Inline[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    const joined =
      last !== undefined && sameMarks(last, run) ? collapse(last.text + run.text) : undefined;
    if (last !== undefined && joined !== undefined && joined.length <= articleLimits.run) {
      merged[merged.length - 1] = { ...last, text: joined };
    } else {
      merged.push(run);
    }
  }
  const first = merged[0];
  if (first !== undefined) merged[0] = { ...first, text: first.text.replace(/^[ \n]+/, '') };
  const last = merged.at(-1);
  if (last !== undefined)
    merged[merged.length - 1] = { ...last, text: last.text.replace(/[ \n]+$/, '') };
  const kept: Inline[] = [];
  for (const run of merged) {
    if (run.text === '') continue;
    if (kept.length >= articleLimits.runs || room.characters <= 0) {
      context.output.full = true;
      break;
    }
    const text = cut(run.text, room.characters);
    room.characters -= text.length;
    kept.push(text === run.text ? run : { ...run, text });
    if (text !== run.text) {
      context.output.full = true;
      break;
    }
  }
  return kept;
}

/**
 * A text in pieces of at most a number of characters, the last one shorter; a character that
 * takes two code units stays in one piece.
 */
function pieces(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + size);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && end - 1 > start && code >= 0xd800 && code <= 0xdbff) end -= 1;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

/** Two spaces in a row as one. */
function collapse(text: string): string {
  return text.replace(/ {2,}/g, ' ');
}

/** Whether two runs have the same marks. */
function sameMarks(a: Inline, b: Inline): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.link === b.link &&
    a.script === b.script
  );
}

/** The text of runs. */
function plainText(runs: readonly Inline[]): string {
  return runs.map((run) => run.text).join('');
}

/** The text of an item with its white space, for a block of code. */
function rawText<N>(tree: ReaderTree<N>, item: Item<N>): string {
  if (item.name === '#text') return tree.text(item.node);
  if (item.name === 'br') return '\n';
  return item.kids.map((kid) => rawText(tree, kid)).join('');
}

/** Text in lower case with its white space collapsed, to compare titles. */
function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Text cut to a number of characters. */
function cut(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

/**
 * The title of the article: that of Open Graph, or the first heading of the page, or the
 * title of the document without the name of the site after a separator.
 */
function titleOf<N>(page: PageInfo, root: Item<N>): string {
  const graph = page.meta['og:title']?.trim();
  if (graph !== undefined && graph !== '') return graph;
  const heading = firstOf(root, 'h1');
  const text = heading === undefined ? '' : heading.kids.map(textOf).join('').trim();
  if (text !== '') return text.replace(/\s+/g, ' ');
  const title = page.title.replace(/\s+/g, ' ').trim();
  const parts = title.split(/\s[|\-–—·:]\s/);
  const first = parts[0]?.trim() ?? '';
  return parts.length > 1 && first.split(' ').length >= 3 ? first : title;
}

/** The text inside an item. */
function textOf<N>(item: Item<N>): string {
  return item.name === '#text' ? item.text : item.kids.map(textOf).join('');
}

/** The name of the site: that of Open Graph, or the host of the page without `www.`. */
function siteOf(page: PageInfo): string {
  const graph = page.meta['og:site_name']?.trim();
  if (graph !== undefined && graph !== '') return cut(graph, 253);
  const host = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(page.url)?.[1] ?? '';
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Who wrote the article: the meta element `author`, or the text of a link to the author, of
 * an element of the author or of an element with `byline` in its class or id, if it is shorter
 * than 100 characters. Such an element leaves the text of the article.
 */
function bylineOf<N>(tree: ReaderTree<N>, root: Item<N>, page: PageInfo): string {
  const element = findItem(root, (item) => {
    const rel = tree.attribute(item.node, 'rel') ?? '';
    const itemprop = tree.attribute(item.node, 'itemprop') ?? '';
    const names = `${tree.attribute(item.node, 'class') ?? ''} ${tree.attribute(item.node, 'id') ?? ''}`;
    return (
      /(?:^|\s)author(?:\s|$)/i.test(rel) ||
      /(?:^|\s)author(?:\s|$)/i.test(itemprop) ||
      /byline/i.test(names)
    );
  });
  const text = element === undefined ? '' : textOf(element).replace(/\s+/g, ' ').trim();
  const usable = text !== '' && text.length < articleLimits.byline;
  if (usable && element !== undefined) element.dropped = true;
  const meta = page.meta['author']?.replace(/\s+/g, ' ').trim() ?? '';
  if (meta !== '' && meta.length < articleLimits.byline) return meta;
  return usable ? text : '';
}

/** The first item that matches, depth first. */
function findItem<N>(item: Item<N>, match: (item: Item<N>) => boolean): Item<N> | undefined {
  for (const kid of elements(item)) {
    if (match(kid)) return kid;
    const found = findItem(kid, match);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** When the article was published: from Open Graph, or the first `time` with a date. */
function publishedOf<N>(tree: ReaderTree<N>, root: Item<N>, page: PageInfo): string {
  const iso = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  const graph = page.meta['article:published_time']?.trim() ?? '';
  if (iso.test(graph)) return graph;
  const time = findItem(
    root,
    (item) => item.name === 'time' && iso.test(tree.attribute(item.node, 'datetime')?.trim() ?? ''),
  );
  return time === undefined ? '' : (tree.attribute(time.node, 'datetime')?.trim() ?? '');
}

/** A language code that the reader document may name, or empty. */
function languageOf(lang: string): string {
  const code = lang.trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(code) && code.length <= 35 ? code : '';
}

/**
 * How many words the article has: those of its first 200,000 characters, by the segmenter of
 * its language, and as many again for the rest of its text.
 */
function wordsOf(output: Output, lang: string): number {
  const sample = output.sample.slice(0, wordSample);
  let words = 0;
  let locale: string | undefined;
  try {
    locale = languageOf(lang) || undefined;
    for (const segment of new Intl.Segmenter(locale, { granularity: 'word' }).segment(sample)) {
      if (segment.isWordLike === true) words += 1;
    }
  } catch {
    words = sample.split(/\s+/).filter((word) => word !== '').length;
  }
  return sample.length === 0
    ? 0
    : Math.round(words * Math.max(1, output.characters / Math.max(1, sample.length)));
}

/** An address without its fragment. */
function withoutHash(address: string): string {
  const hash = address.indexOf('#');
  return hash === -1 ? address : address.slice(0, hash);
}
