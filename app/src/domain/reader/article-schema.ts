import * as v from 'valibot';
import { articleLimits, type Article, type ArticleBlock } from './article.ts';
import { pictureAddress } from './extract.ts';

/** An address of the web. */
const WebAddress = v.pipe(v.string(), v.maxLength(articleLimits.url), v.regex(/^https?:\/\//i));

/** An anchor of the article: the id of a heading or a paragraph. */
const Anchor = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_:.-]{1,128}$/));

/** A run of text with its marks. */
const Inline = v.strictObject({
  text: v.pipe(v.string(), v.maxLength(articleLimits.run)),
  bold: v.exactOptional(v.boolean()),
  italic: v.exactOptional(v.boolean()),
  code: v.exactOptional(v.boolean()),
  link: v.exactOptional(
    v.union([WebAddress, v.pipe(v.string(), v.regex(/^#[A-Za-z0-9_:.-]{1,128}$/))]),
  ),
  script: v.exactOptional(v.picklist(['sup', 'sub'])),
});

/** The runs of a line of text. */
const Inlines = v.pipe(v.array(Inline), v.maxLength(articleLimits.runs));

/** The source of a picture: an address of the web, or a small `data:` picture. */
const PictureSource = v.pipe(v.string(), v.check(pictureAddress));

/** A size of a picture in CSS pixels. */
const Size = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100_000));

/** A heading of the article. */
const Heading = v.strictObject({
  kind: v.literal('heading'),
  level: v.picklist([2, 3, 4]),
  text: Inlines,
  anchor: v.exactOptional(Anchor),
});

/** A paragraph of the article. */
const Paragraph = v.strictObject({
  kind: v.literal('paragraph'),
  text: Inlines,
  anchor: v.exactOptional(Anchor),
});

/** A block of code. */
const Code = v.strictObject({
  kind: v.literal('code'),
  text: v.pipe(v.string(), v.maxLength(articleLimits.run)),
});

/** A picture with its caption. */
const Figure = v.strictObject({
  kind: v.literal('figure'),
  src: PictureSource,
  alt: v.pipe(v.string(), v.maxLength(1000)),
  width: v.exactOptional(Size),
  height: v.exactOptional(Size),
  caption: v.exactOptional(Inlines),
});

/** A table with its rows of cells. */
const Table = v.strictObject({
  kind: v.literal('table'),
  head: v.boolean(),
  rows: v.pipe(
    v.array(v.pipe(v.array(Inlines), v.maxLength(articleLimits.columns))),
    v.maxLength(articleLimits.rows),
  ),
});

/** A line between parts of the article. */
const Rule = v.strictObject({ kind: v.literal('rule') });

/**
 * The blocks of a part of the article, in which lists and quotes nest at most `depth` levels
 * deeper; the schema is written out level by level, so that it needs no recursion.
 * @param depth - How many levels lists and quotes may still nest.
 */
function blocksAt(depth: number): v.GenericSchema<readonly ArticleBlock[]> {
  const inner = depth > 0 ? blocksAt(depth - 1) : undefined;
  const block: v.GenericSchema<ArticleBlock> =
    inner === undefined
      ? v.variant('kind', [Heading, Paragraph, Code, Figure, Table, Rule])
      : v.variant('kind', [
          Heading,
          Paragraph,
          Code,
          Figure,
          Table,
          Rule,
          v.strictObject({
            kind: v.literal('list'),
            ordered: v.boolean(),
            items: v.pipe(v.array(inner), v.maxLength(articleLimits.blocks)),
          }),
          v.strictObject({ kind: v.literal('quote'), blocks: inner }),
        ]);
  return v.pipe(v.array(block), v.maxLength(articleLimits.blocks));
}

/** The blocks of the article, with lists and quotes nested as deep as its limit. */
const Blocks = blocksAt(articleLimits.depth);

/** What the blocks of an article hold together. */
interface Totals {
  blocks: number;
  characters: number;
  images: number;
  depth: number;
}

/** Counts the blocks, the characters, the pictures and the nesting of blocks. */
function totals(blocks: readonly ArticleBlock[], depth = 1, earlier?: Totals): Totals {
  const counted = earlier ?? { blocks: 0, characters: 0, images: 0, depth: 0 };
  counted.depth = Math.max(counted.depth, depth);
  for (const block of blocks) {
    counted.blocks += 1;
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        counted.characters += block.text.reduce((sum, run) => sum + run.text.length, 0);
        break;
      case 'code':
        counted.characters += block.text.length;
        break;
      case 'figure':
        counted.images += 1;
        break;
      case 'table':
        for (const row of block.rows) {
          for (const cell of row) {
            counted.characters += cell.reduce((sum, run) => sum + run.text.length, 0);
          }
        }
        break;
      case 'quote':
        totals(block.blocks, depth + 1, counted);
        break;
      case 'list':
        for (const item of block.items) totals(item, depth + 1, counted);
        break;
      case 'rule':
        break;
    }
  }
  return counted;
}

/**
 * Whether the blocks of an article stay within the limits of `articleLimits`: blocks of every
 * depth, characters, pictures and nesting.
 * @param blocks - The blocks.
 */
export function withinLimits(blocks: readonly ArticleBlock[]): boolean {
  const counted = totals(blocks);
  return (
    counted.blocks <= articleLimits.blocks &&
    counted.characters <= articleLimits.characters + articleLimits.run &&
    counted.images <= articleLimits.images &&
    counted.depth <= articleLimits.depth + 1
  );
}

/**
 * The article of a page as the reader's page script returns it, which the browser process
 * checks before it writes anything of it: only known blocks without other keys, addresses of
 * the web or small `data:` pictures, a language code, and the limits of `articleLimits`.
 */
export const ReaderArticle: v.GenericSchema<Article> = v.pipe(
  v.strictObject({
    url: WebAddress,
    title: v.pipe(v.string(), v.maxLength(articleLimits.title)),
    site: v.pipe(v.string(), v.maxLength(253)),
    byline: v.pipe(v.string(), v.maxLength(articleLimits.byline)),
    published: v.pipe(v.string(), v.maxLength(64)),
    lang: v.union([
      v.literal(''),
      v.pipe(v.string(), v.maxLength(35), v.regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/)),
    ]),
    dir: v.picklist(['ltr', 'rtl', 'auto']),
    blocks: v.pipe(Blocks, v.check(withinLimits, 'The article is too large')),
    words: v.pipe(v.number(), v.integer(), v.minValue(0)),
    truncated: v.boolean(),
  }),
);
