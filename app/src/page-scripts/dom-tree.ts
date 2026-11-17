import type { ReaderAttribute, ReaderImage, ReaderTree } from '../domain/reader/extract.ts';

/** The attributes that hold addresses, which the tree gives as the document resolves them. */
const addresses: ReadonlySet<ReaderAttribute> = new Set([
  'href',
  'src',
  'data-src',
  'data-original',
]);

/**
 * The live DOM of the page as the extractor of the reader view reads it, from the browser's
 * isolated world: it only reads, so the page sees nothing of it. An element with an open shadow
 * root has the children of the root, and a slot the nodes that it shows. Whether an element
 * shows comes from `checkVisibility()`, once per element.
 */
export function domTree(): ReaderTree<Node> {
  const shown = new WeakMap<Element, boolean>();
  return {
    name: (node) =>
      node.nodeType === Node.TEXT_NODE ? '#text' : node instanceof Element ? node.localName : '',
    children: (node) => {
      if (node instanceof HTMLSlotElement) {
        const assigned = node.assignedNodes({ flatten: true });
        return assigned.length > 0 ? assigned : node.childNodes;
      }
      return node instanceof Element && node.shadowRoot !== null
        ? node.shadowRoot.childNodes
        : node.childNodes;
    },
    text: (node) => node.nodeValue ?? '',
    attribute: (node, name) => {
      if (!(node instanceof Element)) return null;
      const value = node.getAttribute(name);
      if (value === null || !addresses.has(name)) return value;
      try {
        return new URL(value, node.baseURI).href;
      } catch {
        return null;
      }
    },
    visible: (node) => {
      if (!(node instanceof Element)) return true;
      let visible = shown.get(node);
      if (visible === undefined) {
        visible = node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        shown.set(node, visible);
      }
      return visible;
    },
    image: (node): ReaderImage | undefined => {
      if (!(node instanceof HTMLImageElement)) return undefined;
      // A picture that tried to load and has no pixels was blocked or is broken.
      if (node.complete && node.naturalWidth === 0 && node.currentSrc !== '') return undefined;
      const { width, height } = node.getBoundingClientRect();
      return {
        src: node.currentSrc || node.src,
        width: Math.max(node.naturalWidth, width),
        height: Math.max(node.naturalHeight, height),
      };
    },
  };
}
