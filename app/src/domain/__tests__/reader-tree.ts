import type { ReaderImage, ReaderTree } from '../reader/extract.ts';

/**
 * A node of a page for the tests of the reader: an element with its attributes and children,
 * or a text. `data-invisible` makes an element invisible, `data-size="320x200"` gives a picture
 * its size, and `data-broken` a picture that could not load.
 */
export interface TestNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: TestNode[];
  readonly text: string;
}

/** Elements without an end tag. */
const voids = new Set(['br', 'hr', 'img', 'wbr', 'meta', 'link', 'input']);

/**
 * Reads a small piece of HTML into test nodes: tags with attributes in double quotes or
 * without a value, end tags, elements without an end tag and text. Enough for the tests.
 * @param html - The HTML.
 * @returns The `body`: the first element of the HTML.
 */
export function parse(html: string): TestNode {
  const root: TestNode = { name: '#root', attributes: {}, children: [], text: '' };
  const open: TestNode[] = [root];
  const tokens = /<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  for (const match of html.matchAll(tokens)) {
    const [, end, start, attributes, text] = match;
    const parent = open.at(-1) ?? root;
    if (end !== undefined) {
      const index = open.findLastIndex((node) => node.name === end.toLowerCase());
      if (index > 0) open.length = index;
    } else if (start !== undefined) {
      const element: TestNode = {
        name: start.toLowerCase(),
        attributes: Object.fromEntries(
          [...(attributes ?? '').matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)].map(([, name, value]) => [
            (name ?? '').toLowerCase(),
            value ?? '',
          ]),
        ),
        children: [],
        text: '',
      };
      parent.children.push(element);
      if (!voids.has(element.name)) open.push(element);
    } else if (text !== undefined) {
      parent.children.push({ name: '#text', attributes: {}, children: [], text });
    }
  }
  const body = root.children.find((node) => node.name !== '#text');
  if (body === undefined) throw new Error('No element in the HTML');
  return body;
}

/** The tree of test nodes, as the extractor reads it. */
export const testTree: ReaderTree<TestNode> = {
  name: (node) => (node.name === '#comment' ? '' : node.name),
  children: (node) => node.children,
  text: (node) => node.text,
  attribute: (node, name) => node.attributes[name] ?? null,
  visible: (node) => node.attributes['data-invisible'] === undefined,
  image: (node): ReaderImage | undefined => {
    if (node.attributes['data-broken'] !== undefined) return undefined;
    const [width = 0, height = 0] = (node.attributes['data-size'] ?? '0x0').split('x').map(Number);
    return { src: node.attributes['src'] ?? '', width, height };
  },
};

/** A clock that never runs out. */
export const noDeadline = { deadline: Number.POSITIVE_INFINITY, now: (): number => 0 };

/** A paragraph of about `words` words with a few commas, as articles have. */
export function prose(words: number, word = 'word'): string {
  return Array.from({ length: words }, (_, index) => (index % 12 === 11 ? `${word},` : word)).join(
    ' ',
  );
}
