/**
 * The article of a page as the reader view shows it: a tree of blocks of text, pictures, lists
 * and tables, which the reader's page script makes and the browser process checks against
 * `article-schema.ts`. Types and limits only, so that the page script needs no schema library.
 */

/** A run of text with its marks; a link has an address of `http` or `https`, or `#` and an anchor. */
export interface Inline {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
  readonly link?: string;
  readonly script?: 'sup' | 'sub';
}

/** A block of the article. Headings and paragraphs keep the id of their element as anchor. */
export type ArticleBlock =
  | {
      readonly kind: 'heading';
      readonly level: 2 | 3 | 4;
      readonly text: readonly Inline[];
      readonly anchor?: string;
    }
  | { readonly kind: 'paragraph'; readonly text: readonly Inline[]; readonly anchor?: string }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly ArticleBlock[])[];
    }
  | { readonly kind: 'quote'; readonly blocks: readonly ArticleBlock[] }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'figure';
      readonly src: string;
      readonly alt: string;
      readonly width?: number;
      readonly height?: number;
      readonly caption?: readonly Inline[];
    }
  | {
      readonly kind: 'table';
      /** Whether the first row is the head of the table. */
      readonly head: boolean;
      /** The rows, each with its cells. */
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly kind: 'rule' };

/** The article of a page. */
export interface Article {
  /** The address of the page. */
  readonly url: string;
  readonly title: string;
  /** The name of the site, or its host. */
  readonly site: string;
  /** Who wrote it, or empty. */
  readonly byline: string;
  /** When it was published, as an ISO date or time, or empty. */
  readonly published: string;
  /** The language of the article, such as `en` or `de-CH`, or empty. */
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl' | 'auto';
  readonly blocks: readonly ArticleBlock[];
  /** How many words the article has, for its reading time. */
  readonly words: number;
  /** Whether the article ends early, as it reached one of {@link articleLimits}. */
  readonly truncated: boolean;
}

/** What the page tells about itself, besides its elements. */
export interface PageInfo {
  readonly url: string;
  /** The title of the document. */
  readonly title: string;
  /** The language of the document element, or empty. */
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl' | 'auto';
  /**
   * The contents of the meta elements of the head, by their `property` or `name` in lower
   * case, such as `og:title` or `author`; the first of each counts.
   */
  readonly meta: Readonly<Record<string, string>>;
}

/** The limits of an article; past one of them, it ends early. */
export const articleLimits = {
  /** Blocks of every depth together. */
  blocks: 5000,
  /** Characters of text together. */
  characters: 600_000,
  /** How deep lists and quotes may nest. */
  depth: 6,
  images: 200,
  /** Characters of an address of a link or a picture. */
  url: 8192,
  /** Characters of a `data:` picture. */
  dataImage: 65_536,
  /** Characters of the title. */
  title: 1000,
  /** Characters of the byline. */
  byline: 100,
  /** Characters of one run of text. */
  run: 10_000,
  /** Runs of text of one heading, paragraph, caption or cell. */
  runs: 5000,
  /** How deep lists may nest. */
  listDepth: 4,
  /** Rows and columns of a table. */
  rows: 200,
  columns: 20,
  /** Elements that the reader's check measures at most. */
  checked: 2000,
} as const;

/** What the browser process asks the reader's page script. */
export type ReaderRequest =
  | { readonly kind: 'check' }
  /** Reads the article, unless the time `until` is over, which a late call reaches. */
  | { readonly kind: 'extract'; readonly until: number };

/** The answer of the reader's page script to a check. */
export interface ReaderCheck {
  readonly readable: boolean;
}

/** The answer of the reader's page script to an extraction; `null` without an article. */
export interface ReaderExtraction {
  readonly article: Article | null;
}
