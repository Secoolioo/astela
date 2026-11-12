/**
 * The elements and the pseudo-elements with a box of their own that a web page can style.
 * Pseudo-elements of the browser's own parts of an element, such as `::file-selector-button`,
 * are elements of its shadow tree, which `*` covers in a user style sheet.
 */
const selectors = [
  '*',
  '::before',
  '::after',
  '::backdrop',
  '::column',
  '::scroll-marker',
  '::scroll-marker-group',
  '::scroll-button(*)',
  '::picker-icon',
  '::checkmark',
  '::view-transition',
  '::view-transition-group(*)',
  '::view-transition-image-pair(*)',
  '::view-transition-old(*)',
  '::view-transition-new(*)',
] as const;

/**
 * The properties that mark regions, each at its initial value: the prefixed name of
 * `app-region` as well, for an engine that knows only that one, and its standard successor.
 */
const declarations = [
  '-webkit-app-region:initial!important',
  'app-region:initial!important',
  'window-drag:initial!important',
].join(';');

/**
 * A user style sheet that keeps web pages from moving the window. With the title bar of the
 * browser, Electron moves the window where any page of it marks a region with `app-region:
 * drag`, `-webkit-app-region: drag` or `window-drag: move`, whatever lies above the region:
 * the tabs, the address bar or a question of the overlay. A declaration of the user with
 * `!important` wins over every declaration of the page, also over its own `!important`
 * ones and its animations, so every element keeps the initial value, `none`. That value marks
 * no region at all, so Chromium has no regions to collect; `no-drag` would make every element
 * a region. Each selector has a rule of its own, so that a pseudo-element that Chromium does
 * not know drops only its own rule.
 */
export const noAppRegionCss = selectors
  .map((selector) => `${selector}{${declarations}}`)
  .join('\n');
