import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { easingOf, motionOf } from '../ui-kit/motion.ts';
import { percent } from '../ui-kit/percent.ts';
import { sameZoom } from '../../shared/zoom.ts';
import { bookmarkRoots } from '../../shared/bookmarks.ts';
import { newTabUrl } from '../../shared/internal-pages.ts';
import type { PopoverAnchor } from '../../shared/ipc/overlay-anchor.ts';
import type { BarItem, ShellState, TabView } from '../../shared/ipc/shell-contracts.ts';
import { controlsRoom } from '../../shared/window-controls.ts';
import {
  clampRatio,
  ratioAt,
  splitDivider,
  splitMarker,
  splitPanes,
  splitPreviewEvery,
  splitRatio,
  type PaneRect,
} from '../../shared/split-view.ts';
import type { Translator } from '../i18n/i18n.ts';
import type { ShellBridge } from './bridge.ts';
import { siteLabel } from './site-label.ts';
import {
  chipKey,
  dropGroup,
  dropPlace,
  inside,
  spanning,
  workspaceDrops,
  workspaceTarget,
  spanOf,
  stripItems,
  tabCounts,
  unitsOf,
  type Span,
  type StripItem,
  type StripUnit,
} from './strip-items.ts';
import { TabIcons } from '../ui-kit/tab-icons.ts';
import { workspaceIconSvg } from '../ui-kit/workspace-icons.ts';

/**
 * The browser shell: tab strip, navigation buttons and the address bar. It renders the
 * state that the browser process sends and reports the space it needs, so web content
 * fills the rest of the window.
 */
export class AppShell extends LitElement {
  static override properties = {
    state: { state: true },
    drafts: { state: true },
    addressFocused: { state: true },
    drops: { state: true },
  };

  /** Styles of the shell, scoped to its shadow root. */
  static override styles = css`
    /*
     * The shell fills the window; the page covers the content area, whose position tells the
     * browser where the page goes. The tab strip sits above or below the toolbar and page,
     * or as a vertical list at a side.
     */
    :host {
      position: fixed;
      inset: 0;
      display: grid;
      grid-template: 'tabs' auto 'nav' auto 'bar' auto 'find' auto 'content' 1fr / 1fr;
      background: var(--surface-0);
      user-select: none;
    }
    :host([data-tabs='bottom']) {
      grid-template: 'nav' auto 'bar' auto 'find' auto 'content' 1fr 'tabs' auto / 1fr;
    }
    :host([data-tabs='left']) {
      grid-template:
        'nav nav' auto 'bar bar' auto 'find find' auto 'tabs content' 1fr / var(
          --sidebar-width,
          240px
        )
        1fr;
    }
    :host([data-tabs='right']) {
      grid-template:
        'nav nav' auto 'bar bar' auto 'find find' auto 'content tabs' 1fr / 1fr
        var(--sidebar-width, 240px);
    }
    /*
     * The toolbar in the row of the tabs: one row of the toolbar's height, the toolbar with the
     * address bar first, which takes 42 % of the width but never less than its buttons and a
     * narrow field, and the tabs after it as rounded chips, with the New tab and Menu buttons at
     * their end. The tabs always keep their buttons, the free room that moves the window, the
     * room of the window controls and two narrow tabs. The row is the title bar, in the window's
     * color with a line below it; the bookmarks bar and the find bar stay below it. A window too
     * narrow for both (data-narrow) puts the tabs in a row of their own above the toolbar, as
     * high as the one row, where the window controls stay.
     */
    :host([data-toolbar='tab-row']:not([data-narrow])) {
      grid-template:
        'nav tabs' auto 'bar bar' auto 'find find' auto 'content content' 1fr / minmax(
          min-content,
          42%
        )
        minmax(
          calc(
            var(--titlebar-end, 0px) + 3 * var(--control-height) + 3 * var(--space-7) + 4 *
              var(--space-1) + 2 * var(--space-2)
          ),
          1fr
        );
    }
    :host([data-toolbar='tab-row']) :is([role='tablist'], nav) {
      box-sizing: border-box;
      height: var(--toolbar-height);
      border-bottom: 1px solid var(--line-1);
      background: var(--surface-0);
    }
    :host([data-toolbar='tab-row']) .address {
      min-width: 96px;
    }
    /* The field gives way down to the narrow address bar: its text alone sets no width. */
    :host([data-toolbar='tab-row']) .address input {
      width: 0;
    }
    :host([data-toolbar='tab-row']) [role='tablist'] {
      align-items: center;
      padding-block: 0;
    }
    :host([data-toolbar='tab-row']) .tabs {
      height: var(--control-large);
    }
    :host([data-toolbar='tab-row']) :is(.tab, .indicator) {
      border-end-start-radius: var(--radius-2);
      border-end-end-radius: var(--radius-2);
    }
    :host([data-toolbar='tab-row']) .tab[data-split='start'] {
      border-end-end-radius: 0;
    }
    :host([data-toolbar='tab-row']) .tab[data-split='end'] {
      border-end-start-radius: 0;
    }
    .content {
      position: relative;
      grid-area: content;
      overflow: auto;
    }
    /*
     * Two tabs side by side: the line above the side with the focus, the two sides, where the
     * pages lie or the problems of their tabs show, and the divider between them. The browser
     * process lays the pages out with the same sizes (shared/split-view.ts), which the shell
     * sets as --split-start, --split-divider and --split-marker.
     */
    .split {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: var(--split-marker) 1fr;
      grid-template-columns: var(--split-start) var(--split-divider) 1fr;
    }
    .split .marker {
      grid-row: 1;
      background: transparent;
      transition: background-color var(--motion-fast) var(--ease-standard);
    }
    .split .marker[data-focused] {
      background: var(--focus-ring);
    }
    .split .pane {
      grid-row: 2;
      min-width: 0;
      overflow: auto;
    }
    .split [data-side='start'] {
      grid-column: 1;
    }
    .split [data-side='end'] {
      grid-column: 3;
    }
    .split .divider {
      position: relative;
      grid-row: 1 / 3;
      grid-column: 2;
      cursor: col-resize;
      touch-action: none;
      transition: background-color var(--motion-instant) var(--ease-standard);
    }
    /* The grip in the middle of the divider. */
    .split .divider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 2px;
      height: var(--control-large);
      border-radius: var(--radius-pill);
      background: var(--border-1);
      transform: translate(-50%, -50%);
      transition: background-color var(--motion-instant) var(--ease-standard);
    }
    .split .divider:hover,
    .split .divider:focus-visible,
    .split .divider[data-dragging] {
      background: var(--surface-hover);
    }
    .split .divider:hover::before,
    .split .divider:focus-visible::before,
    .split .divider[data-dragging]::before {
      background: var(--accent);
    }
    .split .divider:focus-visible {
      outline-offset: -2px;
    }
    @media (forced-colors: active) {
      .split .marker[data-focused] {
        background: Highlight;
      }
      .split .divider::before {
        background: CanvasText;
      }
    }
    /*
     * The find bar of the active tab, between the toolbar and the page, which in a split view
     * ends where the side with the focus ends. A side narrower than the bar's controls leaves
     * them at the start of the window: the room after them makes the bar no wider than the
     * window, so the rows of the shell keep its width.
     */
    .find {
      grid-area: find;
      display: flex;
      align-items: center;
      justify-content: safe flex-end;
      gap: var(--space-1);
      min-width: 0;
      padding: 2px var(--space-2);
      padding-inline-end: calc(var(--find-end, 0px) + var(--space-2));
      border-bottom: 1px solid var(--line-1);
      background: var(--surface-1);
    }
    .find input {
      flex: none;
      width: 240px;
      height: var(--control-small);
      padding: 0 var(--space-2);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-0);
      color: var(--text-1);
      font: inherit;
    }
    /* The bar has its own close button. */
    .find input::-webkit-search-cancel-button {
      display: none;
    }
    .find .count {
      min-width: 64px;
      color: var(--text-2);
      font-size: var(--font-size-small);
      text-align: end;
    }
    .downloads {
      position: relative;
    }
    /* The progress of the running downloads, around the downloads icon. */
    .downloads .ring {
      position: absolute;
      inset: 2px;
      width: auto;
      height: auto;
      transform: rotate(-90deg);
    }
    .downloads .ring circle {
      fill: none;
      stroke: var(--accent-secondary);
      stroke-width: 2;
    }
    /* Tells a private window apart; its colors come from tokens.css. */
    .private {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      height: var(--control-small);
      padding: 0 var(--space-2);
      border-radius: var(--radius-1);
      background: var(--surface-2);
      color: var(--text-1);
      font-size: var(--font-size-small);
      white-space: nowrap;
    }
    .zoom {
      height: var(--control-small);
      padding: 0 var(--space-2);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-1);
      color: var(--text-1);
      font: inherit;
      font-size: var(--font-size-small);
    }
    /* What a tab shows when it could not load its page or lost it. */
    .problem {
      max-width: 520px;
      margin: 15vh auto 0;
      padding: 0 var(--space-3);
    }
    .problem h1 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-size-title);
      line-height: var(--line-height-title);
      font-weight: 600;
    }
    .problem p {
      margin: 0 0 var(--space-2);
      color: var(--text-2);
      overflow-wrap: anywhere;
    }
    .problem .code {
      font-size: var(--font-size-small);
    }
    .problem button {
      margin-top: var(--space-2);
      height: var(--control-large);
      padding: 0 var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-2);
      color: var(--text-1);
      font: inherit;
    }
    .problem button:hover {
      background: var(--surface-hover);
    }
    .problem details {
      margin-top: var(--space-3);
    }
    .problem summary {
      color: var(--text-2);
      cursor: pointer;
    }
    .problem details p {
      margin-top: var(--space-2);
    }
    /* The bookmarks bar belongs to the toolbar: the line below the toolbar moves below it. */
    nav:has(+ .bookmarks) {
      border-bottom: 0;
    }
    .bookmarks {
      grid-area: bar;
      border-bottom: 1px solid var(--line-1);
      background: var(--surface-1);
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      height: calc(var(--control-small) + 4px);
      padding: 0 var(--space-2);
      overflow: hidden;
      font-size: var(--font-size-small);
    }
    .bookmarks .items {
      display: flex;
      align-items: center;
      gap: 2px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    /* Bookmarks that do not fit keep their place but are hidden; the » button lists them. */
    .bookmarks [data-hidden] {
      visibility: hidden;
    }
    .bookmarks button {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      flex: none;
      max-width: 180px;
      height: var(--control-small);
      padding: 0 var(--space-2);
      border: 0;
      border-radius: var(--radius-1);
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .bookmarks button:hover,
    .bookmarks button[aria-expanded='true'] {
      background: var(--surface-hover);
    }
    .bookmarks span {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .bookmarks .hint {
      color: var(--text-2);
    }
    [role='tablist'] {
      position: relative;
      grid-area: tabs;
      display: flex;
      gap: var(--space-1);
      min-width: 0;
      height: var(--tab-height);
      padding: var(--space-1) var(--space-2) 0;
    }
    /* The tabs scroll when they do not fit; a line marks a side with hidden tabs. */
    .tabs {
      position: relative;
      display: flex;
      flex: 0 1 auto;
      gap: var(--space-1);
      min-width: 0;
      overflow: auto hidden;
      scrollbar-width: none;
      border-inline: 1px solid transparent;
    }
    .tabs[data-before] {
      border-inline-start-color: var(--line-1);
    }
    .tabs[data-after] {
      border-inline-end-color: var(--line-1);
    }
    /* The active tab's surface, which slides from tab to tab. */
    .indicator {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      border-radius: var(--radius-2) var(--radius-2) 0 0;
      background: var(--surface-1);
      pointer-events: none;
    }
    :host([data-tabs='bottom']) .indicator {
      border-radius: 0 0 var(--radius-2) var(--radius-2);
    }
    [aria-orientation='vertical'] .indicator {
      border-radius: var(--radius-2);
    }
    /* While a tab is dragged, the others and the chips make room for it, and it has its own
       surface. */
    .tabs[data-dragging] > :is(.tab, .group):not([data-dragged]) {
      transition: transform var(--motion-base) var(--ease-standard);
    }
    .tabs[data-dragging] .indicator {
      opacity: 0;
    }
    .tabs[data-dragging] .tab[aria-selected='true'] {
      background: var(--surface-1);
    }
    .tab[data-dragged] {
      z-index: 1;
    }
    /* Tabs and chips that left, while they fade where they were. */
    .ghosts {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }
    .ghosts > :is(.tab, .group) {
      position: absolute;
    }
    :host([data-tabs='bottom']) [role='tablist'] {
      padding: 0 var(--space-2) var(--space-1);
      border-top: 1px solid var(--line-1);
    }
    [role='tablist'][aria-orientation='vertical'] {
      flex-direction: column;
      height: auto;
      min-height: 0;
      padding: var(--space-2);
    }
    [aria-orientation='vertical'] .tabs {
      flex-direction: column;
      overflow: hidden auto;
      scrollbar-width: thin;
      border-inline: 0;
      border-block: 1px solid transparent;
    }
    [aria-orientation='vertical'] .tabs[data-before] {
      border-block-start-color: var(--line-1);
    }
    [aria-orientation='vertical'] .tabs[data-after] {
      border-block-end-color: var(--line-1);
    }
    :host([data-tabs='left']) [role='tablist'] {
      border-right: 1px solid var(--line-1);
    }
    :host([data-tabs='right']) [role='tablist'] {
      border-left: 1px solid var(--line-1);
    }
    [aria-orientation='vertical'] .tab {
      flex: none;
      width: auto;
      height: var(--tab-height);
      border-radius: var(--radius-2);
    }
    :host([data-tabs='bottom']) .tab {
      border-radius: 0 0 var(--radius-2) var(--radius-2);
    }
    .tab {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--space-1);
      /* An explicit width: a tab's content does not size it, as the tab is a size container. */
      box-sizing: border-box;
      width: 220px;
      min-width: 40px;
      flex: 0 1 auto;
      padding: 0 var(--space-1) 0 var(--space-2);
      border: 0;
      border-radius: var(--radius-2) var(--radius-2) 0 0;
      background: transparent;
      color: var(--text-2);
      font: inherit;
      text-align: start;
      container-type: inline-size;
      touch-action: none;
      transition:
        background-color var(--motion-instant) var(--ease-standard),
        color var(--motion-instant) var(--ease-standard);
    }
    .tab:hover:not([aria-selected='true']) {
      background: var(--surface-hover);
    }
    .tab[aria-selected='true'] {
      color: var(--text-1);
    }
    /* Narrow tabs show their icon only; the active one shows its close button instead. */
    @container (max-width: 72px) {
      .tab .title,
      .tab .close,
      .tab .sound {
        display: none;
      }
      .tab .favicon {
        margin-inline: auto;
      }
      .tab[aria-selected='true']:not([data-pinned]) .favicon {
        display: none;
      }
      .tab[aria-selected='true']:not([data-pinned]) .close {
        display: grid;
        margin-inline: auto;
      }
    }
    /* Pinned tabs come first and show their icon only; at a side, they keep their title. */
    .tab[data-pinned] {
      flex: none;
      width: 40px;
    }
    .tab[data-pinned] .title,
    .tab[data-pinned] .close {
      display: none;
    }
    .tab[data-pinned] .favicon {
      margin-inline: auto;
    }
    [aria-orientation='vertical'] .tab[data-pinned] {
      width: auto;
    }
    [aria-orientation='vertical'] .tab[data-pinned] .title {
      display: block;
    }
    [aria-orientation='vertical'] .tab[data-pinned] .favicon {
      margin-inline: 0;
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    /* The page's icon, or a turning ring while the page loads. */
    .favicon {
      display: grid;
      place-items: center;
      flex: none;
      width: 16px;
      height: 16px;
      color: var(--text-2);
      transition: opacity var(--motion-fast) var(--ease-standard);
    }
    /* A tab that sleeps shows its icon faded; its title stays as it is. */
    .tab[data-sleeping] .favicon {
      opacity: 0.7;
    }
    /*
     * The two tabs of a split view stand together: without the gap between them, rounded only
     * at their outer corners, and on a surface of their own where the active tab's surface does
     * not lie.
     */
    .tab[data-split='end'] {
      margin-inline-start: calc(-1 * var(--space-1));
    }
    [aria-orientation='vertical'] .tab[data-split='end'] {
      margin-inline-start: 0;
      margin-block-start: calc(-1 * var(--space-1));
    }
    .tab[data-split]:not([aria-selected='true']) {
      background: var(--surface-2);
    }
    .tab[data-split]:hover:not([aria-selected='true']) {
      background: var(--surface-hover);
    }
    .tab[data-split='start'] {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }
    .tab[data-split='end'] {
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
    [aria-orientation='vertical'] .tab[data-split='start'] {
      border-start-end-radius: var(--radius-2);
      border-end-start-radius: 0;
    }
    [aria-orientation='vertical'] .tab[data-split='end'] {
      border-start-start-radius: 0;
      border-start-end-radius: 0;
      border-end-start-radius: var(--radius-2);
    }
    /*
     * Groups of tabs: a chip before the first tab of each group, with a dot in the group's
     * color and its name, and a 2 px line in that color along the edge of each of its tabs that
     * faces the page. The line is a border, which forced colors keep.
     */
    [data-color='blue'] {
      --group-color: var(--swatch-blue);
    }
    [data-color='teal'] {
      --group-color: var(--swatch-teal);
    }
    [data-color='green'] {
      --group-color: var(--swatch-green);
    }
    [data-color='orange'] {
      --group-color: var(--swatch-orange);
    }
    [data-color='red'] {
      --group-color: var(--swatch-red);
    }
    [data-color='graphite'] {
      --group-color: var(--swatch-graphite);
    }
    .group {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      flex: none;
      align-self: center;
      box-sizing: border-box;
      max-width: 120px;
      height: var(--control-small);
      padding: 0 var(--space-2);
      border: 0;
      border-radius: var(--radius-1);
      background: transparent;
      color: var(--text-1);
      font: inherit;
      font-size: var(--font-size-small);
      touch-action: none;
      transition: background-color var(--motion-instant) var(--ease-standard);
    }
    .group:hover,
    .group[data-joining] {
      background: var(--surface-hover);
    }
    .group .dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: var(--radius-pill);
      background: var(--group-color);
    }
    .group .name {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .group .count {
      color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }
    .tab[data-group] {
      border-bottom: 2px solid var(--group-color);
    }
    :host([data-tabs='bottom']) .tab[data-group] {
      border-bottom: 0;
      border-top: 2px solid var(--group-color);
    }
    /* At a side, the chip is a row of the list, and the tabs of its group are indented. */
    [aria-orientation='vertical'] .group {
      align-self: stretch;
      max-width: none;
      height: var(--control-height);
      padding-inline: var(--space-1) var(--space-2);
    }
    [aria-orientation='vertical'] .group .name {
      flex: 1;
      text-align: start;
    }
    .group .chevron {
      display: grid;
      transition: transform var(--motion-fast) var(--ease-standard);
    }
    .group[aria-expanded='false'] .chevron {
      transform: rotate(-90deg);
    }
    [aria-orientation='vertical'] .tab[data-group] {
      margin-inline-start: var(--space-3);
      border-bottom: 0;
      border-inline-start: 2px solid var(--group-color);
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
    /* While a dragged tab points at the button of the workspaces, the targets of the other
       workspaces lie over the tabs next to the button, and fade in. */
    .drops {
      position: absolute;
      z-index: 2;
      display: flex;
      gap: var(--space-1);
      margin-inline-start: var(--space-1);
      animation: drops-in var(--motion-fast) var(--ease-out);
    }
    [aria-orientation='vertical'] .drops {
      flex-direction: column;
      margin-inline-start: 0;
      margin-block-start: var(--space-1);
    }
    @keyframes drops-in {
      from {
        opacity: 0;
      }
    }
    .drop {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      box-sizing: border-box;
      max-width: 240px;
      height: var(--control-height);
      padding: 0 var(--space-2);
      border: 1px solid var(--line-1);
      border-radius: var(--radius-2);
      background: var(--surface-raised);
      box-shadow: var(--shadow-popover);
      color: var(--text-1);
      font-size: var(--font-size-small);
      white-space: nowrap;
    }
    .drop span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .drop svg {
      flex: none;
      color: var(--group-color);
    }
    .drop[data-over] {
      border-color: var(--accent);
      background: var(--surface-hover);
    }
    @media (forced-colors: active) {
      .drop[data-over] {
        outline: 2px solid Highlight;
      }
    }
    /* The button of the workspaces shows the icon of the workspace in its color, and its name
       at a side of the window. */
    .workspace {
      align-self: center;
    }
    .workspace svg {
      color: var(--group-color);
    }
    .workspace .name {
      min-width: 0;
      overflow: hidden;
      color: var(--text-1);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    [aria-orientation='vertical'] .workspace {
      display: flex;
      align-self: stretch;
      justify-content: flex-start;
      gap: var(--space-2);
      width: auto;
      padding-inline: var(--space-2);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (forced-colors: active) {
      .group .dot {
        border: 1px solid CanvasText;
      }
      .group[data-joining] {
        outline: 2px solid Highlight;
      }
    }
    .favicon img {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }
    .spinner {
      animation: turn var(--motion-loop) var(--ease-linear) infinite;
    }
    .spinner circle {
      stroke: var(--accent-secondary);
      stroke-width: 2;
    }
    @keyframes turn {
      to {
        transform: rotate(1turn);
      }
    }
    .sound {
      width: var(--control-small);
      height: var(--control-small);
    }
    .sound[aria-pressed='true'] {
      color: var(--text-2);
    }
    button {
      cursor: default;
    }
    .icon {
      display: grid;
      place-items: center;
      width: var(--control-height);
      height: var(--control-height);
      flex: none;
      border: 0;
      border-radius: var(--radius-1);
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .icon:hover:not(:disabled) {
      background: var(--surface-hover);
    }
    /* A button whose popover is open looks pressed. */
    .icon[aria-expanded='true'] {
      background: var(--surface-hover);
    }
    /* Buttons give way a little while they are pressed. */
    .icon {
      transition:
        background-color var(--motion-instant) var(--ease-standard),
        transform var(--motion-instant) var(--ease-standard);
    }
    .icon:active:not(:disabled) {
      transform: scale(0.92);
    }
    /* The star pops when the page becomes a bookmark. */
    .bookmark[aria-pressed='true'] svg {
      animation: pop var(--motion-base) var(--ease-out);
    }
    @keyframes pop {
      50% {
        transform: scale(1.3);
      }
    }
    .icon:disabled {
      opacity: 0.4;
    }
    .close {
      width: var(--control-small);
      height: var(--control-small);
    }
    .blocker {
      position: relative;
      width: auto;
      min-width: var(--control-height);
      gap: 2px;
      grid-auto-flow: column;
      padding: 0 var(--space-1);
    }
    .blocker[data-state='on'] svg {
      color: var(--accent);
    }
    .blocker[data-state='off'] svg {
      color: var(--text-2);
    }
    .blocker[data-state='failed'] svg {
      color: var(--danger);
    }
    .bookmark[aria-pressed='true'] svg {
      color: var(--accent);
      fill: currentColor;
    }
    /*
     * The buttons of the reader view and of picture in picture fade in once the page turns out
     * to have an article, or a video that plays.
     */
    .reader,
    .pip {
      animation: appear var(--motion-fast) var(--ease-out);
    }
    .reader[aria-pressed='true'] svg,
    .pip[aria-pressed='true'] svg {
      color: var(--accent);
    }
    @keyframes appear {
      from {
        opacity: 0;
      }
    }
    .count {
      font-size: var(--font-size-tiny);
      line-height: var(--line-height-ui);
      color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }
    nav {
      position: relative;
      grid-area: nav;
      border-bottom: 1px solid var(--line-1);
      display: flex;
      align-items: center;
      gap: var(--space-1);
      height: var(--toolbar-height);
      padding: 0 var(--space-2);
      background: var(--surface-1);
    }
    /* The address bar: a quiet field that shows the site first and a soft ring with focus. */
    .address {
      position: relative;
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      height: var(--control-large);
      border-radius: var(--radius-field);
      background: var(--surface-2);
      transition:
        background-color var(--motion-instant) var(--ease-standard),
        box-shadow var(--motion-fast) var(--ease-standard);
    }
    .address:hover {
      background: var(--surface-hover);
    }
    .address:focus-within {
      background: var(--surface-1);
      box-shadow: 0 0 0 2px var(--focus-ring);
    }
    .address input {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0 var(--space-3) 0 var(--space-2);
      border: 0;
      background: transparent;
      color: var(--text-1);
      font: inherit;
    }
    .address input:focus-visible {
      outline: none;
    }
    .address input::placeholder {
      color: var(--text-2);
    }
    /* Until the field is edited, the address shows with its host first and without https. */
    .address[data-formatted] input {
      color: transparent;
    }
    .field {
      position: relative;
      display: flex;
      flex: 1;
      min-width: 0;
      height: 100%;
    }
    .url {
      position: absolute;
      inset: 0;
      padding: 0 var(--space-3) 0 var(--space-2);
      display: flex;
      align-items: center;
      overflow: hidden;
      white-space: nowrap;
      pointer-events: none;
    }
    .url .host {
      color: var(--text-1);
    }
    .url .rest {
      color: var(--text-2);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .security {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      flex: none;
      height: var(--control-small);
      margin-inline-start: var(--space-1);
      padding: 0 var(--space-1);
      border-radius: var(--radius-pill);
      color: var(--text-2);
      font-size: var(--font-size-small);
      white-space: nowrap;
    }
    .security[data-kind='insecure'] {
      padding-inline-end: var(--space-2);
      background: var(--surface-1);
      color: var(--danger);
    }
    /* The loading of the active tab, along the bottom of the toolbar. */
    .progress {
      position: absolute;
      inset: auto 0 -1px;
      height: 2px;
      overflow: hidden;
      pointer-events: none;
    }
    .progress::after {
      content: '';
      display: block;
      width: 40%;
      height: 100%;
      border-radius: var(--radius-pill);
      background: var(--accent-secondary);
      animation: progress var(--motion-loop) var(--ease-standard) infinite;
    }
    @keyframes progress {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(250%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .progress::after {
        width: 100%;
        opacity: 0.5;
      }
    }
    /* With the browser's title bar, the top row moves the window and leaves room for the
       window controls where the window has them; what can be clicked in it stays clickable. */
    :host([data-titlebar]) .top-row {
      -webkit-app-region: drag;
      padding-inline: calc(var(--titlebar-start, 0px) + var(--space-2))
        calc(var(--titlebar-end, 0px) + var(--space-2));
    }
    :host([data-titlebar]) .top-row :is(button, input, [role='tab'], .address) {
      -webkit-app-region: no-drag;
    }
    /* In one row, the toolbar leaves room for the controls at the start, the tabs at the end. */
    :host([data-titlebar][data-toolbar='tab-row']) nav.top-row {
      padding-inline-end: var(--space-2);
    }
    :host([data-titlebar][data-toolbar='tab-row']) nav.top-row::after {
      content: none;
    }
    :host([data-titlebar][data-toolbar='tab-row']:not([data-narrow])) [role='tablist'].top-row {
      padding-inline-start: var(--space-2);
    }
    /* In a narrow window, the tabs above the toolbar leave the room of the controls, and the
       toolbar below them moves no window, as in a row of its own. */
    :host([data-titlebar][data-toolbar='tab-row'][data-narrow]) nav.top-row {
      -webkit-app-region: no-drag;
      padding-inline: var(--space-2);
    }
    /* A click next to a popover of the overlay closes it instead of moving the window. */
    :host([data-titlebar][data-covered]) .top-row {
      -webkit-app-region: no-drag;
    }
    /*
     * Rows that hide until they are needed. While they hide, the page covers them below what
     * stays of them, an edge or a title row: they take no clicks, and they move no window, as
     * the regions of a view below win over the views above it. The browser shows them over the
     * page, which neither moves nor changes its size, and they fade in.
     */
    :host([data-rows='hidden']) :is([role='tablist'], nav, .bookmarks, .find) {
      pointer-events: none;
    }
    :host([data-rows='hidden']) .top-row,
    :host([data-rows='hidden']) .top-row :is(button, input, [role='tab'], .address) {
      -webkit-app-region: no-drag;
    }
    :host([data-rows='revealed']) :is([role='tablist'], nav, .bookmarks, .find) {
      animation: appear var(--motion-fast) var(--ease-out);
    }
    .reveal {
      position: fixed;
      inset: 0 0 auto;
      z-index: 3;
      box-sizing: border-box;
      height: var(--reveal-height);
      background: var(--surface-0);
      -webkit-app-region: no-drag;
    }
    /* What stays takes the pointer, which shows the rows: a region that moves the window would
       get no events of the pointer. The title row keeps the room of the window controls and
       shows the site. */
    .reveal[data-rest='title'] {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding-inline: calc(var(--titlebar-start, 0px) + var(--space-3))
        calc(var(--titlebar-end, 0px) + var(--space-3));
      border-bottom: 1px solid var(--line-1);
      color: var(--text-2);
      font-size: var(--font-size-small);
    }
    .reveal .site {
      flex: none;
      max-width: 50%;
      color: var(--text-1);
    }
    .reveal :is(.site, .page) {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .reveal svg {
      flex: none;
    }
    /* A split view below rows that hide starts where its pages start, below what stays of them. */
    :host([data-rows='hidden']) .split {
      position: fixed;
      inset: var(--reveal-height) 0 0;
      background: var(--surface-0);
    }
    /* Free room after the last button moves the window also when the tabs fill the row or the
       address bar fills the toolbar. */
    :host([data-titlebar]) [role='tablist'].top-row::after {
      content: '';
      flex: 1 0 var(--space-7);
    }
    :host([data-titlebar]) nav.top-row::after {
      content: '';
      flex: none;
      width: var(--space-7);
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
    svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;

  declare state: ShellState;
  /**
   * What was typed in the address bar of each tab and not yet entered. It stays when the focus
   * leaves the field, and goes when it is entered, with a second Escape, or when the tab's page
   * changes its address while the field does not have the focus.
   */
  declare drafts: ReadonlyMap<string, string>;
  /** The address of each tab's page at the last update, to notice when a page moves on. */
  private readonly addresses = new Map<string, string>();
  /**
   * The tabs that left the tab strip with a switch of the workspace, by their workspace: their
   * drafts and addresses wait for them until they show again or their workspace is gone.
   */
  private readonly away = new Map<string, string>();
  /** Whether suggestions for what was typed may be showing. */
  private suggesting = false;
  /** The suggestion that the arrow keys marked, or -1. */
  private suggestion = -1;
  /** The address bar that suggestions were asked for last, which a click on one leaves. */
  private suggestionsFor: AddressOwner = null;
  /**
   * The address bar of a suggestion chosen with Enter, or of the list that the focus may have
   * gone to for a click, until the browser opened the suggestion. A click on New tab may give
   * the address bar to the new tab meanwhile.
   */
  private chosenFor: AddressOwner | undefined;
  declare addressFocused: boolean;
  /**
   * The targets of the workspaces while a dragged tab points at the button of the workspaces:
   * the workspace that the pointer is over, or `null` for none yet, and where the targets start
   * in the tab strip, next to the button; `undefined` while they hide.
   */
  declare drops:
    { readonly over: string | null; readonly x: number; readonly y: number } | undefined;
  /** Whether the focused address bar had all of its text selected before an update. */
  private addressSelected = false;
  bridge: ShellBridge | undefined;
  i18n: Translator | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private unsubscribers: (() => void)[] = [];
  /** The active tab that the shell last handled focus for. */
  private focusedTabId: string | undefined;
  private findFocusPending = false;
  /** Whether the list of downloads opens at its button once the button is there. */
  private downloadsPending = false;
  /**
   * The group whose popover opens at its chip once the chip shows, such as a group that the
   * menu of a tab just made, when the browser asked for it, and whether the keyboard opened
   * that menu.
   */
  private groupEditorPending:
    { readonly id: string; readonly at: number; readonly keyboard: boolean } | undefined;
  /**
   * The group whose chip the keyboard showed or hid, and whether the group was collapsed then,
   * until the state that this brings: the chip keeps the focus, also when a new tab page
   * becomes the active tab with it.
   */
  private toggledByKeys: { readonly id: string; readonly collapsed: boolean } | undefined;
  /** The insets last sent to the browser. */
  private reportedInsets = '';
  /** What the hidden status says after the window showed another workspace. */
  private workspaceShown = '';
  /** Index of the first bookmark of the bookmarks bar that does not fit. */
  private barOverflow = 0;
  /** The icons of the pages of the tabs. */
  private readonly favicons = new TabIcons(
    (key) => this.bridge?.invoke('tabs.favicon', { key }) ?? Promise.resolve(null),
    () => this.requestUpdate(),
  );
  /** Where each tab and the active tab's surface were before a change, to move them from. */
  private readonly tabsBefore = new Map<string, { element: HTMLElement; rect: DOMRect }>();
  private indicatorBefore: DOMRect | undefined;
  /** The slide of the active tab's surface while it runs, and the place where it ends. */
  private indicatorSlide: { readonly animation: Animation; readonly to: Place } | undefined;
  /**
   * The tab that the pointer drags, with the items of the strip that move with it, where the
   * drag started and where the items of the strip were.
   */
  private dragging:
    | {
        readonly id: string;
        /** The dragged unit: the tab and the items that move with it. */
        readonly unit: StripUnit;
        /** The items of the strip when the drag started, in their order. */
        readonly items: readonly StripItem[];
        /** The units of the strip when the drag started, in their order. */
        readonly units: readonly StripUnit[];
        /** How many tabs each item stands for, by key. */
        readonly counts: ReadonlyMap<string, number>;
        readonly pointer: number;
        readonly start: number;
        /** Where each item of the strip was along the strip, by its key. */
        readonly spans: ReadonlyMap<string, Span>;
        /** The space between two items of the strip. */
        readonly gap: number;
        /** How many tabs came before the dragged unit. */
        readonly index: number;
        /** The group of the dragged tab, and whether the window has groups at all. */
        readonly group: string | null;
        readonly grouped: boolean;
        moved: boolean;
        target: number;
        /** The group that the tab joins where it is now, or `null`. */
        joins: string | null;
      }
    | undefined;
  /** Whether a drag just ended, so that its click does not activate the tab. */
  private dragEnded = false;
  /** Whether a dropped tab waits for the browser to move it. */
  private dropPending = false;
  /**
   * The tab that the New tab button opens, from the click until the browser named the tab
   * and its state has it. Meanwhile the address bar is that tab's: what is typed there is
   * kept for it, and what is entered loads in it, not in the tab that was active before. A
   * further click replaces it, as the tab of the last click is the one that ends up active.
   * The tab of the earlier click loses nothing: what was typed for it stays with it, as when
   * the focus leaves the address bar, and what was entered loads in the tab of its own click.
   */
  private opening: Opening | undefined;
  /**
   * Tabs of earlier clicks on New tab that a further click replaced after something was typed
   * for them. Each gets what was typed for it once the browser named it and the state has it.
   */
  private readonly replacedOpenings = new Set<Opening>();
  /**
   * The tab that the New tab button opened, when the address bar took input for it while
   * the shell waited for the tab. The address bar keeps that input when the tab shows.
   */
  private openedWithInput: string | undefined;
  /** Where Electron draws the window controls, on Windows and Linux. */
  private windowControls: WindowControls | undefined;
  /** The room for the window controls that the top row has, to change it only when it moves. */
  private titleBarRoom = '';
  /** Whether the browser made the overlay ready for the menu, which it does once. */
  private overlayPrepared = false;
  /** Whether the pointer holds rows that hide open: it reached them and did not leave them. */
  private rowPointer = false;
  /**
   * Whether a control of the shell has its focus for the keys, which holds rows that hide open
   * while the shell has the focus of the window; the browser knows that.
   */
  private rowFocus = false;
  /** Whether the shell drew rows that hide hidden a frame ago, so that they move no window. */
  private rowsDrawnHidden = false;
  /** The frames that the shell waits for before it tells that it drew the rows hidden. */
  private drawnFrame: number | undefined;
  /** What holds rows that hide open, and how the shell drew them, as the browser last heard it. */
  private sentHolds: {
    readonly pointer: boolean;
    readonly focus: boolean;
    readonly hidden: boolean;
  } = { pointer: false, focus: false, hidden: false };
  /** Shows the rows once the pointer stayed on the title row, or hides them once it left. */
  private rowsTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether Escape brought back the address of the page in the address bar, until it changes. */
  private escapedOnce = false;
  /**
   * The divider of the split view while the pointer drags it, or after a change of the
   * divider until the state brings it: the share of the left side and the pair it belongs to.
   */
  private splitDrag:
    | {
        /** The left and the right tab of the pair. */
        readonly start: string;
        readonly end: string;
        readonly pointer: number;
        ratio: number;
        /** The animation frame that lets the pages follow, while one is due. */
        frame: number | undefined;
        /** When the pages last got a share to follow, in the time of the frames. */
        sent: number;
        /** Whether the divider was let go, or moved by a key, and waits for the state. */
        done: boolean;
        /** Gives up the wait for a state that does not bring the share. */
        timer: ReturnType<typeof setTimeout> | undefined;
      }
    | undefined;

  constructor() {
    super();
    this.state = {
      tabs: [],
      activeTabId: null,
      tabStrip: 'top',
      bookmarksBar: null,
      find: null,
      downloads: null,
      private: false,
      home: false,
      defaultZoom: 1,
      toolbar: ['reader', 'pictureInPicture', 'bookmark', 'shield', 'downloads'],
      titleBar: null,
      covered: false,
      popover: null,
      split: null,
      workspace: null,
      workspaces: [],
      layout: { toolbar: 'own-row', hiding: null },
    };
    this.drafts = new Map();
    this.addressFocused = false;
    this.drops = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('mouseup', this.onMouseUp);
    this.addEventListener('pointerenter', this.onShellEnter);
    this.addEventListener('pointerleave', this.onShellLeave);
    this.addEventListener('focusin', this.onFocusMove);
    this.addEventListener('focusout', this.onFocusMove);
    this.windowControls = windowControls();
    this.windowControls?.addEventListener('geometrychange', this.onControlsMove);
    const bridge = this.bridge;
    if (bridge === undefined) {
      return;
    }
    this.unsubscribers.push(
      bridge.on('shell.stateChanged', (state) => (this.state = state)),
      bridge.on('shell.command', (command) => {
        if (command === 'find.focus') this.focusFind();
        else if (command === 'downloads.open') this.openDownloadsAtButton();
        else if (command === 'omnibox.done') this.leaveAddress();
        else if (command === 'menu.open') this.openMenuAtButton();
        else if (command === 'bookmark.edit') this.editBookmark();
        else if (command === 'workspaces.open') this.openWorkspacesAtButton();
        else this.focusAddress();
      }),
      bridge.on('shell.editGroup', ({ groupId, keyboard }) => {
        this.groupEditorPending = { id: groupId, at: performance.now(), keyboard };
        this.takeGroupEditorOpening();
      }),
    );
    void bridge.invoke('shell.getState', {}).then((state) => (this.state = state));
    this.resizeObserver = new ResizeObserver(() => {
      this.placeTitleBar();
      this.fitTopRow();
      this.reportInsets();
      this.layoutBookmarksBar();
      this.placeIndicator(false);
      this.markHiddenTabs();
      this.placeSplit();
    });
    this.resizeObserver.observe(this);
  }

  protected override firstUpdated(): void {
    // The content area also changes size without the window, for example with the density.
    const content = this.renderRoot.querySelector('.content');
    if (content !== null) this.resizeObserver?.observe(content);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('mouseup', this.onMouseUp);
    this.removeEventListener('pointerenter', this.onShellEnter);
    this.removeEventListener('pointerleave', this.onShellLeave);
    this.removeEventListener('focusin', this.onFocusMove);
    this.removeEventListener('focusout', this.onFocusMove);
    clearTimeout(this.rowsTimer);
    if (this.drawnFrame !== undefined) cancelAnimationFrame(this.drawnFrame);
    this.windowControls?.removeEventListener('geometrychange', this.onControlsMove);
    this.resizeObserver?.disconnect();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('state')) {
      this.settleOpening();
      // The state that brings the share of the divider, or another split view, ends the share
      // that the shell drew meanwhile. A drag goes on, and a state that the browser made
      // before it took the share, such as of a page that loads, leaves the share as it is.
      const drag = this.splitDrag;
      const split = this.state.split;
      if (
        drag !== undefined &&
        (split === null ||
          split.start !== drag.start ||
          split.end !== drag.end ||
          (drag.done && split.ratio === drag.ratio))
      ) {
        this.dropSplitDrag();
      }
      this.dataset['tabs'] = this.state.tabStrip;
      this.placeRows();
      // The shell keeps the icons of its tabs only.
      this.favicons.keep(this.state.tabs.flatMap((tab) => tab.favicon ?? []));
      this.toggleAttribute('data-covered', this.state.covered);
      this.placeTitleBar();
      // Tabs move from where they were, unless the whole strip moved to another side or the
      // window shows the tabs of another workspace.
      const before = changed.get('state');
      const switched = before !== undefined && before.workspace?.id !== this.state.workspace?.id;
      if (
        this.hasUpdated &&
        this.dragging?.moved !== true &&
        before?.tabStrip === this.state.tabStrip &&
        !switched
      ) {
        this.measureTabs();
      }
      // A screen reader hears which workspace shows after a switch.
      const workspace = this.state.workspace;
      if (switched && before.workspace !== null && workspace !== null) {
        this.workspaceShown = this.tp('shell.workspaceShown', {
          name: this.workspaceName(workspace),
        });
      }
    }
    // Typing replaces an address that is selected as a whole, also when the page changes its
    // address meanwhile; setting the new address would put the caret at its end instead.
    const input = this.renderRoot.querySelector('input');
    this.addressSelected =
      input !== null &&
      this.draft === undefined &&
      this.shadowRoot?.activeElement === input &&
      input.selectionStart === 0 &&
      input.selectionEnd === input.value.length;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (this.addressSelected) {
      this.renderRoot.querySelector('input')?.select();
    }
    if (changed.has('state')) {
      // The buttons of the toolbar change with the page, and with them the room it needs.
      this.fitTopRow();
      if (this.dragging?.moved !== true) {
        // The surface learns where the active tab goes before the tabs start to move there.
        this.placeIndicator(true);
        this.animateTabs();
      }
      this.markHiddenTabs();
      this.reportInsets();
      this.layoutBookmarksBar();
      this.placeSplit();
      this.takeFindFocus();
      this.takeDownloadsOpening();
      this.takeGroupEditorOpening();
    }
    if (changed.has('state')) this.dropStaleDrafts(changed.get('state'));
    // An element that had the focus and left the page, such as the field of the find bar that
    // closed, gave it up without an event.
    if (this.rowFocus) this.noteFocus();
    this.noteRowsDrawn();
    if (changed.has('drops')) this.placeDrops();
    // Enter or Space on a chip leave the focus there, also when the change of the group makes
    // a new tab page the active tab.
    const keysOnChip = changed.has('state') && this.keysStayOnChip();
    // A tab that becomes active on the new tab page waits for input in the address bar,
    // unless the address bar took input for a tab that the New tab button opens: selecting
    // it would let the next key replace that input.
    const active = this.active;
    if (changed.has('state') && active?.id !== this.focusedTabId) {
      this.focusedTabId = active?.id;
      const keepsInput =
        (this.opening !== undefined && tookInput(this.opening)) ||
        (active !== undefined && active.id === this.openedWithInput);
      // Suggestions belong to what was typed in the tab that was active. Those for what was
      // typed for a tab that the New tab button opens stay while that tab comes up.
      if (!keepsInput) this.closeSuggestions();
      this.renderRoot
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      // A new tab page that took the focus in the side of a split view keeps it for its own
      // field, so there the shell takes it only while it has the focus of the window. Alone,
      // the new tab page leaves the keys to the address bar also in a window in the
      // background, which gets them once it comes to the front.
      if (
        active?.url === newTabUrl &&
        !keepsInput &&
        !keysOnChip &&
        (this.state.split === null || document.hasFocus())
      ) {
        this.focusAddress();
      }
    }
    if (changed.has('state')) this.openedWithInput = undefined;
  }

  /**
   * Whether the state brings the change of a group that Enter or Space on its chip asked for,
   * while the chip has the focus, which it then keeps.
   */
  private keysStayOnChip(): boolean {
    const toggled = this.toggledByKeys;
    if (toggled === undefined) return false;
    const group = this.state.tabs.find((tab) => tab.group?.id === toggled.id)?.group;
    // Another change of the state can come before the one of the group.
    if (group?.collapsed === toggled.collapsed) return false;
    this.toggledByKeys = undefined;
    return this.shadowRoot?.activeElement?.getAttribute('data-id') === chipKey(toggled.id);
  }

  protected override render(): TemplateResult {
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    const tabRow = this.state.layout.toolbar === 'tab-row';
    const hiding = this.state.layout.hiding;
    // In one row, the toolbar comes first, as it shows, and the keys reach it in that order.
    const rows = tabRow
      ? html`${this.renderToolbar(t, true)}${this.renderTabStrip(t, true)}`
      : html`${this.renderTabStrip(t, false)}${this.renderToolbar(t, false)}`;
    return html`
      ${rows} ${this.renderBookmarksBar(t)} ${this.renderFind()}
      <div class="visually-hidden" role="status">${this.workspaceShown}</div>
      <div class="content">
        ${
          this.state.split === null
            ? this.active?.problem
              ? this.renderProblem(this.active)
              : nothing
            : this.renderSplit(this.state.split, t)
        }
      </div>
      ${hiding === null || hiding.shown ? nothing : this.renderReveal(hiding.rest)}
    `;
  }

  /**
   * The tab strip, with the New tab button after the tabs, and the menu button after it when
   * the toolbar shares the row of the tabs.
   */
  private renderTabStrip(
    t: (key: Parameters<Translator['t']>[0]) => string,
    tabRow: boolean,
  ): TemplateResult {
    const vertical = this.state.tabStrip === 'left' || this.state.tabStrip === 'right';
    return html`
      <div
        role="tablist"
        class=${this.state.tabStrip === 'top' ? 'top-row' : ''}
        aria-label=${t('shell.tabs')}
        aria-orientation=${vertical ? 'vertical' : 'horizontal'}
      >
        ${this.renderWorkspaceButton()} ${this.renderDrops()}
        <div
          class="tabs"
          @scroll=${this.markHiddenTabs}
          @wheel=${this.onTabsWheel}
          @pointermove=${this.onDragMove}
          @pointerup=${this.endDrag}
          @pointercancel=${this.endDrag}
        >
          <div class="indicator" aria-hidden="true"></div>
          ${repeat(
            stripItems(this.state),
            (item) => item.key,
            (item) =>
              item.kind === 'tab' ? this.renderTab(item.tab, t) : this.renderChip(item, t),
          )}
          <div class="ghosts" aria-hidden="true"></div>
        </div>
        <button
          class="icon"
          title=${t('shell.newTab')}
          aria-label=${t('shell.newTab')}
          @click=${this.newTab}
        >
          ${icons.plus}
        </button>
        ${tabRow ? this.renderMenuButton(t) : nothing}
      </div>
    `;
  }

  /**
   * The toolbar: the buttons of the history, the address bar and the buttons after it, with
   * the menu button at its end unless the toolbar shares the row of the tabs.
   */
  private renderToolbar(
    t: (key: Parameters<Translator['t']>[0]) => string,
    tabRow: boolean,
  ): TemplateResult {
    const active = this.active;
    return html`
      <nav
        class=${tabRow || this.state.tabStrip !== 'top' ? 'top-row' : ''}
        aria-label=${t('shell.toolbar')}
      >
        <button
          class="icon"
          title=${t('shell.back')}
          aria-label=${t('shell.back')}
          ?disabled=${active?.canGoBack !== true}
          @click=${() => this.action('back')}
        >
          ${icons.back}
        </button>
        <button
          class="icon"
          title=${t('shell.forward')}
          aria-label=${t('shell.forward')}
          ?disabled=${active?.canGoForward !== true}
          @click=${() => this.action('forward')}
        >
          ${icons.forward}
        </button>
        ${
          active?.loading === true
            ? html`<button
                class="icon"
                title=${t('shell.stop')}
                aria-label=${t('shell.stop')}
                @click=${() => this.action('stop')}
              >
                ${icons.stop}
              </button>`
            : html`<button
                class="icon"
                title=${t('shell.reload')}
                aria-label=${t('shell.reload')}
                @click=${() => this.action('reload')}
              >
                ${icons.reload}
              </button>`
        }
        ${
          this.state.home
            ? html`<button
                class="icon"
                title=${t('shell.home')}
                aria-label=${t('shell.home')}
                @click=${() => this.action('home')}
              >
                ${icons.home}
              </button>`
            : nothing
        }
        ${this.renderAddress(this.addressTab, t)}
        ${
          active === undefined || sameZoom(active.zoom, this.state.defaultZoom)
            ? nothing
            : html`<button
                class="zoom"
                title=${this.tp('shell.zoom', {
                  zoom: percent(active.zoom, this.i18n?.language),
                  reset: percent(this.state.defaultZoom, this.i18n?.language),
                })}
                aria-label=${this.tp('shell.zoom', {
                  zoom: percent(active.zoom, this.i18n?.language),
                  reset: percent(this.state.defaultZoom, this.i18n?.language),
                })}
                @click=${() => void this.bridge?.invoke('tabs.resetZoom', { tabId: active.id })}
              >
                ${percent(active.zoom, this.i18n?.language)}
              </button>`
        }
        ${this.state.toolbar.map((item) =>
          item === 'reader'
            ? this.renderReaderButton(active)
            : item === 'pictureInPicture'
              ? this.renderPictureInPictureButton(active)
              : item === 'bookmark'
                ? this.renderBookmarkButton(active)
                : item === 'shield'
                  ? this.renderShieldButton(active)
                  : this.renderDownloadsButton(),
        )}
        ${
          this.state.private
            ? html`<span class="private" title=${t('shell.privateHint')}
                >${icons.private}<span>${t('shell.private')}</span></span
              >`
            : nothing
        }
        ${tabRow ? nothing : this.renderMenuButton(t)}
        ${active?.loading === true ? html`<div class="progress" aria-hidden="true"></div>` : nothing}
      </nav>
    `;
  }

  /** The button of the browser menu. */
  private renderMenuButton(t: (key: Parameters<Translator['t']>[0]) => string): TemplateResult {
    return html`<button
      class="icon menu-button"
      title=${t('shell.menu')}
      aria-label=${t('shell.menu')}
      aria-haspopup="menu"
      aria-expanded=${this.state.popover?.kind === 'menu' ? 'true' : 'false'}
      @click=${this.openMenu}
      @keydown=${this.onMenuKey}
      @pointerenter=${this.prepareOverlay}
      @focus=${this.prepareOverlay}
    >
      ${icons.menu}
    </button>`;
  }

  /**
   * What stays of rows that hide, above the page: an edge, or a title row where the system
   * draws the window controls into the top row, with the connection, the site and the title of
   * the page. Every web page names its site there, also an empty page or one that a site made
   * itself, with a globe where the connection has no icon. The pointer that reaches it shows
   * the rows: at once on the edge, and after a moment on the title row, which the pointer
   * crosses on its way to the window controls. It moves no window, as a region that moves the
   * window gets no events of the pointer; the free room of the rows that it shows does.
   */
  private renderReveal(rest: 'edge' | 'title'): TemplateResult {
    const tab = this.active;
    const security = tab === undefined ? 'none' : securityOf(tab);
    const site = tab === undefined ? '' : siteLabel(tab.url);
    const icon =
      security !== 'none' ? securityIcons[security] : site === '' ? nothing : icons.globe;
    return html`<div
      class="reveal"
      data-rest=${rest}
      aria-hidden="true"
      @pointerenter=${this.onRevealEnter}
      @pointerleave=${this.onRevealLeave}
    >
      ${
        rest === 'title' && tab !== undefined
          ? html`${icon} ${site === '' ? nothing : html`<span class="site">${site}</span>`}
              <span class="page">${tab.title}</span>`
          : nothing
      }
    </div>`;
  }

  /**
   * The two sides of a split view: the line above the side with the focus, the problem of the
   * tab of a side, which shows in place of its page, and the divider between them. The pages
   * lie above the sides, where the browser process puts them.
   */
  private renderSplit(
    split: NonNullable<ShellState['split']>,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult {
    const sides = [
      { side: 'start', tab: this.state.tabs.find((tab) => tab.id === split.start) },
      { side: 'end', tab: this.state.tabs.find((tab) => tab.id === split.end) },
    ] as const;
    return html`<div class="split">
      ${sides.map(
        ({ side, tab }) =>
          html`<div
            class="marker"
            data-side=${side}
            ?data-focused=${tab?.id === this.state.activeTabId}
          ></div>`,
      )}
      ${sides.map(
        ({ side, tab }) =>
          html`<div
            class="pane"
            data-side=${side}
            data-id=${tab?.id ?? nothing}
            @pointerdown=${() => this.focusSide(tab?.id)}
          >
            ${tab?.problem ? this.renderProblem(tab) : nothing}
          </div>`,
      )}
      <div
        class="divider"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-valuemin=${Math.round(splitRatio.min * 100)}
        aria-valuemax=${Math.round(splitRatio.max * 100)}
        aria-label=${t('shell.splitDivider')}
        title=${t('shell.splitDividerHint')}
        @pointerdown=${this.startSplitDrag}
        @pointermove=${this.moveSplitDrag}
        @pointerup=${this.endSplitDrag}
        @pointercancel=${this.endSplitDrag}
        @lostpointercapture=${this.endSplitDrag}
        @keydown=${this.onDividerKey}
        @dblclick=${() => this.commitSplit(splitRatio.even)}
      ></div>
    </div>`;
  }

  /** Gives the side of a split view that was clicked the focus, as a click into its page does. */
  private focusSide(tabId: string | undefined): void {
    if (tabId !== undefined && tabId !== this.state.activeTabId) {
      void this.bridge?.invoke('tabs.activate', { tabId });
    }
  }

  /**
   * The content area as the browser process lays the pages out in it, in the coordinates of
   * the shell: its edges as whole pixels, as the shell reports them.
   */
  private splitArea(): PaneRect | undefined {
    const box = this.renderRoot.querySelector('.content')?.getBoundingClientRect();
    if (box === undefined) return undefined;
    const left = Math.round(box.left);
    const right = Math.round(window.innerWidth - box.right);
    return { x: left, y: box.top, width: window.innerWidth - left - right, height: box.height };
  }

  /**
   * Puts the divider and the line of the side with the focus where the browser process puts
   * the pages, with the share of the drag while one runs, and lets the find bar end where the
   * side with the focus ends.
   */
  private placeSplit(): void {
    const split = this.state.split;
    const element = this.renderRoot.querySelector<HTMLElement>('.split');
    const area = this.splitArea();
    if (split === null || element === null || area === undefined) {
      this.style.removeProperty('--find-end');
      return;
    }
    const ratio = this.splitDrag?.ratio ?? split.ratio;
    const { start, end } = splitPanes(area, ratio);
    element.style.setProperty('--split-start', `${String(start.width)}px`);
    element.style.setProperty('--split-divider', `${String(splitDivider)}px`);
    element.style.setProperty('--split-marker', `${String(splitMarker)}px`);
    const left = Math.round(ratio * 100);
    const divider = element.querySelector<HTMLElement>('.divider');
    divider?.setAttribute('aria-valuenow', String(left));
    divider?.setAttribute(
      'aria-valuetext',
      this.tp('shell.splitShare', {
        start: percent(left / 100, this.i18n?.language),
        end: percent((100 - left) / 100, this.i18n?.language),
      }),
    );
    const focusedEnd =
      split.start === this.state.activeTabId ? start.x + start.width : end.x + end.width;
    this.style.setProperty(
      '--find-end',
      `${String(Math.max(0, window.innerWidth - focusedEnd))}px`,
    );
  }

  /** Starts to drag the divider of the split view with the primary button. */
  private readonly startSplitDrag = (event: PointerEvent): void => {
    const split = this.state.split;
    const divider = event.currentTarget;
    if (event.button !== 0 || split === null || !(divider instanceof HTMLElement)) return;
    divider.setPointerCapture(event.pointerId);
    divider.toggleAttribute('data-dragging', true);
    // The drag starts where the divider is drawn, also while a change waits for the state.
    const ratio = this.splitDrag?.ratio ?? split.ratio;
    this.dropSplitDrag();
    this.splitDrag = {
      start: split.start,
      end: split.end,
      pointer: event.pointerId,
      ratio,
      frame: undefined,
      sent: Number.NEGATIVE_INFINITY,
      done: false,
      timer: undefined,
    };
  };

  /**
   * Moves the divider with the pointer: the shell draws it at once, and the pages follow with
   * one request per frame at most.
   */
  private readonly moveSplitDrag = (event: PointerEvent): void => {
    const drag = this.splitDrag;
    const area = this.splitArea();
    if (drag === undefined || drag.done || event.pointerId !== drag.pointer || area === undefined) {
      return;
    }
    // The button was released where the divider did not see it.
    if ((event.buttons & 1) === 0) {
      this.endSplitDrag(event);
      return;
    }
    drag.ratio = ratioAt(area, event.clientX);
    this.placeSplit();
    drag.frame ??= requestAnimationFrame(this.previewSplit);
  };

  /**
   * Lets the pages follow the divider while it moves: in a frame, and once
   * {@link splitPreviewEvery} ms passed since the last time, so that a display faster than
   * 120 Hz sends no more and leaves room in the budget of the channel for the share that
   * counts when the divider is let go.
   */
  private readonly previewSplit = (time: number): void => {
    const drag = this.splitDrag;
    if (drag === undefined || drag.done) return;
    if (time - drag.sent < splitPreviewEvery) {
      drag.frame = requestAnimationFrame(this.previewSplit);
      return;
    }
    drag.frame = undefined;
    drag.sent = time;
    void this.bridge?.invoke('tabs.resizeSplit', {
      tabId: drag.start,
      ratio: drag.ratio,
      done: false,
    });
  };

  /** Forgets the share of the divider that the shell drew, with what waits for it. */
  private dropSplitDrag(): void {
    const drag = this.splitDrag;
    if (drag === undefined) return;
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
    clearTimeout(drag.timer);
    this.splitDrag = undefined;
  }

  /** Lets the divider go where the pointer left it. */
  private readonly endSplitDrag = (event: PointerEvent): void => {
    const drag = this.splitDrag;
    if (drag === undefined || drag.done || event.pointerId !== drag.pointer) return;
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.removeAttribute('data-dragging');
    }
    this.commitSplit(drag.ratio);
  };

  /** Moves the divider with the keys: the arrows by a step, Home and End to the limits. */
  private readonly onDividerKey = (event: KeyboardEvent): void => {
    const split = this.state.split;
    if (split === null || event.altKey || event.ctrlKey || event.metaKey) return;
    const ratio = this.splitDrag?.ratio ?? split.ratio;
    const next =
      event.key === 'ArrowLeft'
        ? ratio - splitRatio.step
        : event.key === 'ArrowRight'
          ? ratio + splitRatio.step
          : event.key === 'Home'
            ? splitRatio.min
            : event.key === 'End'
              ? splitRatio.max
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    this.commitSplit(next);
  };

  /**
   * Gives the left side of the split view a share of the width, which counts for the browser,
   * and draws it until the state brings it.
   */
  private commitSplit(ratio: number): void {
    const split = this.state.split;
    if (split === null) return;
    const next = clampRatio(ratio);
    const waiting = this.splitDrag?.done === true;
    this.dropSplitDrag();
    // A share that the state has already, with no other change that waits for the state,
    // needs no drawing of its own.
    if (next !== split.ratio || waiting) {
      const drag = {
        start: split.start,
        end: split.end,
        pointer: -1,
        ratio: next,
        frame: undefined,
        sent: Number.NEGATIVE_INFINITY,
        done: true,
        // A state that never brings the share, as when the browser did not take it, lets the
        // divider show the share of the state again.
        timer: setTimeout(() => {
          if (this.splitDrag !== drag) return;
          this.splitDrag = undefined;
          this.placeSplit();
        }, splitEchoWait),
      };
      this.splitDrag = drag;
    }
    this.placeSplit();
    void this.bridge?.invoke('tabs.resizeSplit', { tabId: split.start, ratio: next, done: true });
  }

  private renderTab(
    tab: TabView,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult {
    const selected = tab.id === this.state.activeTabId;
    const title = tab.title || displayUrl(tab.url) || t('shell.untitled');
    return html`
      <div
        class="tab"
        role="tab"
        data-id=${tab.id}
        ?data-pinned=${tab.pinned}
        ?data-sleeping=${tab.sleeping}
        data-split=${tab.split ?? nothing}
        data-group=${tab.group?.id ?? nothing}
        data-color=${tab.group?.color ?? nothing}
        tabindex=${selected ? 0 : -1}
        aria-selected=${selected ? 'true' : 'false'}
        aria-label=${title}
        aria-description=${this.tabDescription(tab, t) ?? nothing}
        title=${title}
        @pointerdown=${(e: PointerEvent) => this.startDrag(e, tab.id)}
        @contextmenu=${(e: MouseEvent) => this.openTabMenu(e, tab.id)}
        @click=${() => this.activateTab(tab.id)}
        @auxclick=${(e: MouseEvent) => e.button === 1 && this.close(tab.id)}
      >
        ${this.renderTabIcon(tab, t)}
        <span class="title">${title}</span>
        ${
          tab.audible || tab.muted
            ? html`<button
                class="icon sound"
                tabindex="-1"
                title=${t(tab.muted ? 'shell.unmuteTab' : 'shell.muteTab')}
                aria-label=${t(tab.muted ? 'shell.unmuteTab' : 'shell.muteTab')}
                aria-pressed=${tab.muted ? 'true' : 'false'}
                @click=${(e: Event) => (e.stopPropagation(), this.setMuted(tab.id, !tab.muted))}
              >
                ${tab.muted ? icons.soundOff : icons.sound}
              </button>`
            : nothing
        }
        <button
          class="icon close"
          tabindex="-1"
          aria-label=${t('shell.closeTab')}
          @click=${(e: Event) => (e.stopPropagation(), this.close(tab.id))}
        >
          ${icons.close}
        </button>
      </div>
    `;
  }

  /**
   * What a screen reader says of a tab besides its title: the group that it is in, the side of
   * a split view that it is, and that it sleeps.
   */
  private tabDescription(
    tab: TabView,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): string | undefined {
    const group = tab.group;
    const parts = [
      group === null
        ? undefined
        : group.name === ''
          ? t('shell.inUnnamedGroup')
          : this.tp('shell.inGroup', { name: group.name }),
      tab.split === null
        ? undefined
        : t(tab.split === 'start' ? 'shell.splitStart' : 'shell.splitEnd'),
      tab.sleeping ? t('shell.tabSleeping') : undefined,
    ].filter((part) => part !== undefined);
    return parts.length === 0 ? undefined : parts.join(', ');
  }

  /**
   * The chip of a group of tabs, before its first tab: a dot in the group's color and its
   * name, and the number of its tabs while it hides them. A click, Enter or Space shows or
   * hides the tabs; the context menu, from the pointer or the keyboard, opens the popover of
   * the group. At a side of the window, the chip is a row of the list with a chevron.
   */
  private renderChip(
    item: Extract<StripItem, { kind: 'group' }>,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult {
    const { group, tabs } = item;
    const name =
      group.name === ''
        ? t('shell.groupUnnamed')
        : this.tp('shell.groupNamed', { name: group.name });
    return html`<button
      class="group"
      data-id=${item.key}
      data-color=${group.color}
      aria-expanded=${group.collapsed ? 'false' : 'true'}
      aria-label=${name}
      aria-description=${
        group.collapsed ? this.tp('shell.groupTabs', { count: String(tabs.length) }) : nothing
      }
      title=${t('shell.groupHint')}
      @click=${(event: MouseEvent) => this.toggleGroup(group, event.detail === 0)}
      @contextmenu=${(event: MouseEvent) => this.editGroup(event, group.id)}
    >
      ${this.vertical ? html`<span class="chevron">${icons.down}</span>` : nothing}
      <span class="dot" aria-hidden="true"></span>
      ${group.name === '' ? nothing : html`<span class="name">${group.name}</span>`}
      ${
        group.collapsed
          ? html`<span class="count" aria-hidden="true">${tabs.length}</span>`
          : nothing
      }
    </button>`;
  }

  /**
   * The button of the workspaces at the start of the tab strip, with the icon of the workspace
   * that shows in its color, and its name at a side of the window; a click opens the list of
   * the workspaces. Private windows, popups and windows while workspaces are off have none.
   */
  private renderWorkspaceButton(): TemplateResult | typeof nothing {
    const workspace = this.state.workspace;
    if (workspace === null) return nothing;
    const name = this.workspaceName(workspace);
    const label = this.tp('shell.workspace', { name });
    return html`<button
      class="icon workspace"
      data-color=${workspace.color}
      title=${label}
      aria-label=${label}
      aria-haspopup="dialog"
      aria-expanded=${this.state.popover?.kind === 'workspaces' ? 'true' : 'false'}
      @click=${this.openWorkspaces}
      @pointerenter=${this.prepareOverlay}
      @focus=${this.prepareOverlay}
    >
      ${workspaceIconSvg[workspace.icon]}
      ${this.vertical ? html`<span class="name">${name}</span>` : nothing}
    </button>`;
  }

  /**
   * The targets of the other workspaces, while a dragged tab points at the button of the
   * workspaces: a tab dropped on one of them moves into that workspace, and loads again there
   * when its partition changes. Only the pointer uses them; the menu of a tab does the same.
   */
  private renderDrops(): TemplateResult | typeof nothing {
    const drops = this.drops;
    if (drops === undefined) return nothing;
    return html`<div class="drops" aria-hidden="true">
      ${workspaceDrops(this.state).map(({ workspace, reload }) => {
        const name = this.workspaceName(workspace);
        return html`<div
          class="drop"
          data-id=${workspace.id}
          data-color=${workspace.color}
          ?data-over=${drops.over === workspace.id}
        >
          ${workspaceIconSvg[workspace.icon]}
          <span
            >${this.tp(reload ? 'shell.moveToWorkspaceReload' : 'shell.moveToWorkspace', { name })}</span
          >
        </div>`;
      })}
    </div>`;
  }

  /**
   * Shows the targets of the workspaces while a dragged tab points at their button or at them,
   * marks the target under the pointer, and hides them once the pointer leaves both.
   * @param point - Where the pointer is.
   */
  private followDrops(point: { readonly x: number; readonly y: number }): void {
    const button = this.renderRoot.querySelector('.workspace');
    const strip = button === null ? null : button.parentElement;
    if (button === null || strip === null || workspaceDrops(this.state).length === 0) {
      this.drops = undefined;
      return;
    }
    // The button and the targets count as one area, so the gap between them hides nothing.
    const box = button.getBoundingClientRect();
    const container = this.renderRoot.querySelector('.drops');
    const area = container === null ? box : spanning([box, container.getBoundingClientRect()]);
    if (!inside(area, point)) {
      this.drops = undefined;
      return;
    }
    const targets = new Map(
      [...this.renderRoot.querySelectorAll<HTMLElement>('.drop')].map((element) => [
        element.dataset['id'] ?? '',
        element.getBoundingClientRect(),
      ]),
    );
    const over = workspaceTarget(targets, point) ?? null;
    const origin = strip.getBoundingClientRect();
    const vertical = this.vertical;
    const x = (vertical ? box.left : box.right) - origin.left;
    const y = (vertical ? box.bottom : box.top) - origin.top;
    const drops = this.drops;
    if (drops?.over !== over || drops.x !== x || drops.y !== y) this.drops = { over, x, y };
  }

  /** Puts the targets of the workspaces next to the button of the workspaces. */
  private placeDrops(): void {
    const drops = this.drops;
    const container = this.renderRoot.querySelector<HTMLElement>('.drops');
    if (drops === undefined || container === null) return;
    container.style.setProperty('left', `${String(drops.x)}px`);
    container.style.setProperty('top', `${String(drops.y)}px`);
  }

  /** The name of a workspace; the default one is called Default until it is renamed. */
  private workspaceName(workspace: { readonly name: string }): string {
    return workspace.name === '' ? (this.i18n?.t('shell.workspaceDefault') ?? '') : workspace.name;
  }

  /** Opens the list of the workspaces at its button; Enter or Space give a click without a count. */
  private readonly openWorkspaces = (event: MouseEvent): void => {
    if (event.currentTarget instanceof Element) {
      void this.bridge?.invoke(
        'workspaces.open',
        this.anchorAt(event.currentTarget, event.detail === 0),
      );
    }
  };

  /**
   * Opens the list of the workspaces for its shortcut: at its button, or at the menu button
   * while the tab strip shows no button, or at a corner of the window without either.
   */
  private openWorkspacesAtButton(): void {
    const button = this.renderRoot.querySelector('.workspace');
    void this.bridge?.invoke(
      'workspaces.open',
      this.anchorAt(
        button !== null && laidOut(button) ? button : this.renderRoot.querySelector('.menu-button'),
        true,
      ),
    );
  }

  /**
   * Shows or hides the tabs of a group, unless the click ends a drag. Enter or Space on the
   * chip keep the focus there, also when the active tab changes with it.
   * @param group - The group, and whether it hides its tabs now.
   * @param keyboard - Whether Enter or Space did it, rather than the pointer.
   */
  private toggleGroup(
    group: { readonly id: string; readonly collapsed: boolean },
    keyboard: boolean,
  ): void {
    if (this.dragEnded) {
      this.dragEnded = false;
      return;
    }
    this.toggledByKeys = keyboard ? { id: group.id, collapsed: group.collapsed } : undefined;
    void this.bridge?.invoke('groups.toggle', { groupId: group.id, keyboard });
  }

  /** Opens the popover of a group at its chip, for its context menu. */
  private editGroup(event: MouseEvent, groupId: string): void {
    event.preventDefault();
    this.cancelDrag();
    // The popover gives the focus back here when the keyboard opened it.
    if (event.currentTarget instanceof Element)
      this.openGroupEditor(event.currentTarget, groupId, menuByKeyboard(event));
  }

  private openGroupEditor(chip: Element, groupId: string, keyboard: boolean): void {
    void this.bridge?.invoke('groups.openEditor', { groupId, ...anchorOf(chip, keyboard) });
  }

  /**
   * Opens the popover of the group that the browser asked for once its chip shows; a request
   * whose group did not show within a second is dropped.
   */
  private takeGroupEditorOpening(): void {
    const pending = this.groupEditorPending;
    if (pending === undefined) return;
    const chip = this.tabStrip?.querySelector(`:scope > [data-id="${chipKey(pending.id)}"]`);
    if (chip === null || chip === undefined || !laidOut(chip)) {
      if (performance.now() - pending.at > 1000) this.groupEditorPending = undefined;
      return;
    }
    this.groupEditorPending = undefined;
    chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.openGroupEditor(chip, pending.id, pending.keyboard);
  }

  private get tabStrip(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.tabs');
  }

  private get vertical(): boolean {
    return this.state.tabStrip === 'left' || this.state.tabStrip === 'right';
  }

  /** The elements of the items of the tab strip, in their order, each with its key as `data-id`. */
  private stripElements(): HTMLElement[] {
    return [...(this.tabStrip?.querySelectorAll<HTMLElement>(':scope > [data-id]') ?? [])];
  }

  private activateTab(tabId: string): void {
    // The click that ends a drag only drops the tab.
    if (this.dragEnded) {
      this.dragEnded = false;
      return;
    }
    void this.bridge?.invoke('tabs.activate', { tabId });
  }

  /** Remembers where the tabs are before the browser's state changes them. */
  private measureTabs(): void {
    this.tabsBefore.clear();
    for (const element of this.stripElements()) {
      this.tabsBefore.set(element.dataset['id'] ?? '', {
        element,
        rect: element.getBoundingClientRect(),
      });
    }
    // While a tab is dragged, the active tab draws its surface itself; the surface moves on
    // from there.
    const strip = this.tabStrip;
    const surface =
      strip?.hasAttribute('data-dragging') === true
        ? strip.querySelector(':scope > .tab[aria-selected="true"]')
        : strip?.querySelector('.indicator');
    this.indicatorBefore = surface?.getBoundingClientRect();
    // A dropped tab moves from where it was dropped, not from where the drag left it.
    if (this.dropPending) {
      this.dropPending = false;
      this.clearDrag();
    }
  }

  /**
   * Moves the tabs from where they were to where they are, fades new tabs in and closed tabs
   * out where they were. Nothing moves when the system asks for reduced motion.
   */
  private animateTabs(): void {
    const strip = this.tabStrip;
    const length = motionOf(this, '--motion-base');
    if (strip === null || this.tabsBefore.size === 0 || length === 0) return;
    const present = new Set<string>();
    for (const element of this.stripElements()) {
      const id = element.dataset['id'] ?? '';
      present.add(id);
      const before = this.tabsBefore.get(id)?.rect;
      const now = element.getBoundingClientRect();
      if (before === undefined) {
        element.animate(
          [
            { opacity: 0, transform: 'scale(0.9)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: length, easing: easingOf(this, '--ease-out') },
        );
      } else if (before.left !== now.left || before.top !== now.top) {
        element.animate(
          [
            { transform: `translate(${before.left - now.left}px, ${before.top - now.top}px)` },
            { transform: 'none' },
          ],
          { duration: length, easing: easingOf(this, '--ease-standard') },
        );
      }
    }
    const ghosts = strip.querySelector<HTMLElement>('.ghosts');
    const origin = ghosts?.getBoundingClientRect();
    for (const [id, { element, rect }] of this.tabsBefore) {
      if (present.has(id) || ghosts === null || origin === undefined) continue;
      // The element that the tab had leaves the page; it fades out above where it was.
      element.removeAttribute('role');
      element.removeAttribute('data-id');
      element.inert = true;
      Object.assign(element.style, {
        left: `${rect.left - origin.left}px`,
        top: `${rect.top - origin.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      ghosts.append(element);
      element
        .animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'scale(0.9)' },
          ],
          { duration: length, easing: easingOf(this, '--ease-in') },
        )
        .finished.finally(() => element.remove())
        .catch(() => undefined);
    }
    this.tabsBefore.clear();
  }

  /**
   * Puts the active tab's surface under the active tab, where the tab stays once it has
   * moved, sliding it from the tab that was active before when `animate` is set.
   */
  private placeIndicator(animate: boolean): void {
    const strip = this.tabStrip;
    const indicator = strip?.querySelector<HTMLElement>('.indicator');
    const active = strip?.querySelector<HTMLElement>(':scope > .tab[aria-selected="true"]');
    if (strip === null || strip === undefined || indicator === null || indicator === undefined) {
      return;
    }
    if (active === null || active === undefined) {
      indicator.hidden = true;
      return;
    }
    indicator.hidden = false;
    const box = strip.getBoundingClientRect();
    const rect = layoutRect(active);
    const x = rect.left - box.left - strip.clientLeft + strip.scrollLeft;
    const y = rect.top - box.top - strip.clientTop + strip.scrollTop;
    indicator.style.width = `${rect.width}px`;
    indicator.style.height = `${rect.height}px`;
    indicator.style.transform = `translate(${x}px, ${y}px)`;
    const before = this.indicatorBefore;
    this.indicatorBefore = undefined;
    const to: Place = { x, y, width: rect.width, height: rect.height };
    const slide = this.indicatorSlide;
    if (slide !== undefined && slide.animation.playState === 'running') {
      // The browser publishes its state again and again, such as while a page loads: a slide
      // to the same place goes on instead of starting again from where it is.
      if (samePlace(slide.to, to)) return;
      slide.animation.cancel();
    }
    this.indicatorSlide = undefined;
    const length = motionOf(this, '--motion-slow');
    if (
      !animate ||
      before === undefined ||
      length === 0 ||
      rect.width === 0 ||
      rect.height === 0 ||
      (near(before.left, rect.left) && near(before.top, rect.top) && near(before.width, rect.width))
    ) {
      return;
    }
    const from = `translate(${x + before.left - rect.left}px, ${y + before.top - rect.top}px)`;
    const animation = indicator.animate(
      [
        {
          transform: `${from} scale(${before.width / rect.width}, ${before.height / rect.height})`,
        },
        { transform: `translate(${x}px, ${y}px)` },
      ],
      { duration: length, easing: easingOf(this, '--ease-standard') },
    );
    this.indicatorSlide = { animation, to };
  }

  /** Marks the sides of the tab strip behind which tabs are hidden. */
  private readonly markHiddenTabs = (): void => {
    const strip = this.tabStrip;
    if (strip === null) return;
    const [scrolled, size, visible] = this.vertical
      ? [strip.scrollTop, strip.scrollHeight, strip.clientHeight]
      : [Math.abs(strip.scrollLeft), strip.scrollWidth, strip.clientWidth];
    strip.toggleAttribute('data-before', scrolled > 0);
    strip.toggleAttribute('data-after', scrolled + visible < size - 1);
  };

  /** The mouse wheel scrolls a horizontal tab strip sideways. */
  private readonly onTabsWheel = (event: WheelEvent): void => {
    const strip = this.tabStrip;
    if (strip === null || this.vertical || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
      return;
    }
    if (strip.scrollWidth <= strip.clientWidth) return;
    event.preventDefault();
    strip.scrollLeft += event.deltaY;
  };

  /** Starts to drag a tab with the primary button, unless a button of the tab is pressed. */
  private startDrag(event: PointerEvent, id: string): void {
    const target = event.target;
    if (
      event.button !== 0 ||
      !(event.currentTarget instanceof HTMLElement) ||
      (target instanceof Element && target.closest('button') !== null)
    ) {
      return;
    }
    // A drag whose release never came ends before the next one starts, and the tabs go back
    // at once, so the next drag measures them where they are.
    if (this.dragging?.moved === true) {
      this.clearDrag();
      this.placeIndicator(false);
    }
    const vertical = this.vertical;
    const elements = this.stripElements();
    const items = stripItems(this.state);
    const units = unitsOf(items);
    const unit = units.find((candidate) => candidate.includes(id)) ?? [id];
    const group = this.state.tabs.find((tab) => tab.id === id)?.group ?? null;
    this.dragging = {
      id,
      unit,
      items,
      units,
      counts: tabCounts(items),
      pointer: event.pointerId,
      start: vertical ? event.clientY : event.clientX,
      spans: new Map(
        elements.map((element) => [
          element.dataset['id'] ?? '',
          spanOf(element.getBoundingClientRect(), vertical),
        ]),
      ),
      gap: this.tabGap(),
      index: this.state.tabs.findIndex((tab) => tab.id === unit[0]),
      group: group?.id ?? null,
      grouped: this.state.tabs.some((tab) => tab.group !== null),
      moved: false,
      target: -1,
      joins: group?.id ?? null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** Moves the dragged tab with the pointer, and the other tabs out of its way. */
  private readonly onDragMove = (event: PointerEvent): void => {
    const drag = this.dragging;
    const strip = this.tabStrip;
    if (drag === undefined || strip === null || event.pointerId !== drag.pointer) return;
    // The button was released where the tab strip did not see it, such as in a menu.
    if ((event.buttons & 1) === 0) {
      this.cancelDrag();
      return;
    }
    const vertical = this.vertical;
    const offset = (vertical ? event.clientY : event.clientX) - drag.start;
    if (!drag.moved && Math.abs(offset) < 4) return;
    drag.moved = true;
    strip.toggleAttribute('data-dragging', true);
    // Pointing at the button of the workspaces shows the targets of the other workspaces.
    this.followDrops({ x: event.clientX, y: event.clientY });
    const place = dropPlace(drag.units, drag.unit, offset, drag.spans, drag.gap, drag.counts);
    if (place === undefined) return;
    drag.target = place.index;
    // Over the span of a group, the tab joins it; the chip of a group that it would join shows.
    drag.joins = drag.grouped ? dropGroup(drag.items, drag.unit, offset, drag.spans) : null;
    const joining = drag.joins === null || drag.joins === drag.group ? '' : chipKey(drag.joins);
    for (const element of this.stripElements()) {
      const key = element.dataset['id'] ?? '';
      if (!drag.spans.has(key)) continue;
      const dragged = drag.unit.includes(key);
      const shift = dragged ? offset : (place.shifts.get(key) ?? 0);
      element.toggleAttribute('data-dragged', dragged);
      element.toggleAttribute('data-joining', key === joining);
      element.style.transform = vertical ? `translateY(${shift}px)` : `translateX(${shift}px)`;
    }
  };

  /** Drops the dragged tab at its new place, which the browser then gives it. */
  private readonly endDrag = (event: PointerEvent): void => {
    const drag = this.dragging;
    if (drag === undefined || event.pointerId !== drag.pointer) return;
    this.dragging = undefined;
    if (!drag.moved) return;
    this.dragEnded = true;
    // A drag that ends outside the tab sends no click that would clear this.
    setTimeout(() => (this.dragEnded = false));
    // A tab dropped on the target of a workspace moves into it, and keeps its place here until
    // the browser takes it away.
    const into = event.type === 'pointerup' ? this.drops?.over : undefined;
    this.drops = undefined;
    if (into !== undefined && into !== null) {
      void this.bridge?.invoke('workspaces.moveTab', { tabId: drag.id, workspaceId: into });
      this.putTabsBack();
      return;
    }
    const moves = drag.target !== drag.index || drag.joins !== drag.group;
    if (event.type === 'pointerup' && drag.target !== -1 && moves) {
      this.dropPending = true;
      // A window with groups learns which group the tab joins, or that it joins none.
      void this.bridge?.invoke('tabs.move', {
        tabId: drag.id,
        index: drag.target,
        ...(drag.grouped ? { group: drag.joins } : {}),
      });
      // Should the browser not move the tab, it goes back to its place.
      setTimeout(() => {
        if (!this.dropPending) return;
        this.dropPending = false;
        this.clearDrag();
        this.placeIndicator(false);
      }, 1000);
      return;
    }
    this.putTabsBack();
  };

  /**
   * Ends a drag whose release went elsewhere, such as to the menu that a Control-click opens
   * on macOS, and puts the tabs back.
   */
  private cancelDrag(): void {
    const drag = this.dragging;
    this.dragging = undefined;
    this.drops = undefined;
    if (drag?.moved === true) this.putTabsBack();
  }

  /** Moves the tabs from where a drag left them back to their places, with the surface. */
  private putTabsBack(): void {
    this.measureTabs();
    this.clearDrag();
    // The surface learns where the active tab goes before the tabs start to move there.
    this.placeIndicator(true);
    this.animateTabs();
  }

  /** The space between two tabs. */
  private tabGap(): number {
    const strip = this.tabStrip;
    return strip === null ? 0 : Number.parseFloat(getComputedStyle(strip).gap) || 0;
  }

  private clearDrag(): void {
    this.tabStrip?.removeAttribute('data-dragging');
    for (const element of this.stripElements()) {
      element.removeAttribute('data-dragged');
      element.removeAttribute('data-joining');
      element.style.transform = '';
    }
  }

  /**
   * What was typed in the address bar of the active tab, or of the tab that the New tab
   * button opens, and not yet entered.
   */
  private get draft(): string | undefined {
    if (this.opening !== undefined) return this.opening.draft;
    const id = this.state.activeTabId;
    return id === null ? undefined : this.drafts.get(id);
  }

  private setDraft(text: string | undefined): void {
    if (this.opening !== undefined) {
      this.opening.draft = text;
      this.requestUpdate();
      return;
    }
    const id = this.state.activeTabId;
    if (id === null) return;
    const drafts = new Map(this.drafts);
    if (text === undefined) drafts.delete(id);
    else drafts.set(id, text);
    this.drafts = drafts;
  }

  /** The tab that the address bar shows: the active tab, or none while a new tab opens. */
  private get addressTab(): TabView | undefined {
    return this.opening === undefined ? this.active : undefined;
  }

  /** Whose address bar it is: the tab that the New tab button opens, or the active tab. */
  private get addressOwner(): AddressOwner {
    return this.opening ?? this.state.activeTabId;
  }

  /**
   * Whose address bar of earlier it is now: a tab that the New tab button opened is a tab like
   * the others once the shell has it.
   */
  private ownerNow(owner: AddressOwner): AddressOwner {
    const waiting =
      isOpening(owner) && (owner === this.opening || this.replacedOpenings.has(owner));
    return isOpening(owner) && !waiting && owner.id !== undefined ? owner.id : owner;
  }

  /** Forgets what was typed in the address bar of a tab, as its input opened. */
  private dropInput(owner: AddressOwner): void {
    if (isOpening(owner)) {
      owner.draft = undefined;
      this.requestUpdate();
    } else if (owner !== null && this.drafts.has(owner)) {
      const drafts = new Map(this.drafts);
      drafts.delete(owner);
      this.drafts = drafts;
    }
  }

  /**
   * Gives the tabs that the New tab button opens what was typed for them, each once the
   * browser named the tab and the state has it. Only the answer names a tab: a state can also
   * make another tab active that the shell did not know at the click, such as the tab of an
   * earlier click.
   */
  private settleOpening(): void {
    const drafts = new Map(this.drafts);
    let settled = false;
    for (const replaced of this.replacedOpenings) {
      const id = replaced.id;
      if (id === undefined || !this.hasTab(id)) continue;
      this.replacedOpenings.delete(replaced);
      if (replaced.draft !== undefined) drafts.set(id, replaced.draft);
      settled = true;
    }
    const opening = this.opening;
    const id = opening?.id;
    if (opening !== undefined && id !== undefined && this.hasTab(id)) {
      this.opening = undefined;
      this.openedWithInput = tookInput(opening) && id === this.state.activeTabId ? id : undefined;
      if (opening.draft === undefined) drafts.delete(id);
      else drafts.set(id, opening.draft);
      settled = true;
    }
    if (settled) this.drafts = drafts;
  }

  private hasTab(id: string): boolean {
    return this.state.tabs.some((tab) => tab.id === id);
  }

  /**
   * Drops the drafts of tabs that closed, and of tabs whose page moved to another address while
   * their address bar did not have the focus. The tabs of a workspace that the window stops
   * showing keep theirs, for when it shows again.
   * @param before - The state before the update.
   */
  private dropStaleDrafts(before: ShellState | undefined): void {
    const left = before?.workspace;
    if (before !== undefined && left !== null && left !== undefined) {
      if (left.id !== this.state.workspace?.id) {
        for (const tab of before.tabs) if (!this.hasTab(tab.id)) this.away.set(tab.id, left.id);
      }
    }
    for (const [id, workspace] of this.away) {
      if (this.hasTab(id) || !this.state.workspaces.some((each) => each.id === workspace)) {
        this.away.delete(id);
      }
    }
    const kept = (id: string): boolean => this.hasTab(id) || this.away.has(id);
    const moved = new Set<string>();
    for (const tab of this.state.tabs) {
      const address = this.addresses.get(tab.id);
      if (address !== undefined && address !== tab.url) moved.add(tab.id);
      this.addresses.set(tab.id, tab.url);
    }
    for (const id of this.addresses.keys()) {
      if (!kept(id)) this.addresses.delete(id);
    }
    // While a new tab opens, the address bar edits what is typed for that tab.
    const editing =
      this.addressFocused && this.opening === undefined ? this.state.activeTabId : null;
    const stale = [...this.drafts.keys()].filter(
      (id) => !kept(id) || (moved.has(id) && id !== editing),
    );
    if (stale.length > 0) {
      this.drafts = new Map([...this.drafts].filter(([id]) => !stale.includes(id)));
    }
  }

  /**
   * The address bar: how secure the connection of the page is, and its address, which shows
   * its host first and leaves out `https://` until the field is edited.
   */
  private renderAddress(
    tab: TabView | undefined,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult {
    // A site without a secure connection shows the insecure address that was asked for.
    const shown = displayUrl(tab?.problem?.kind === 'insecure' ? tab.problem.url : tab?.url);
    const draft = this.draft;
    const parts = this.addressFocused || draft !== undefined ? undefined : addressParts(shown);
    const security = tab === undefined ? 'none' : securityOf(tab);
    return html`<div class="address" ?data-formatted=${parts !== undefined}>
      ${
        security === 'none'
          ? nothing
          : html`<span
              class="security"
              data-kind=${security}
              role="img"
              aria-label=${t(securityLabels[security])}
              title=${t(securityLabels[security])}
              >${securityIcons[security]}${
                security === 'insecure' ? html`<span>${t('shell.notSecure')}</span>` : nothing
              }</span
            >`
      }
      <div class="field">
        <input
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label=${t('shell.address')}
          placeholder=${t('shell.addressPlaceholder')}
          .value=${draft ?? shown}
          @focus=${(e: FocusEvent) => {
            this.addressFocused = true;
            this.escapedOnce = false;
            inputOf(e)?.select();
          }}
          @input=${(e: InputEvent) => {
            this.escapedOnce = false;
            const text = inputOf(e)?.value;
            this.setDraft(text);
            this.suggest(text ?? '');
          }}
          @keydown=${this.onAddressKey}
          @blur=${() => {
            // What was typed stays with the tab; the browser keeps the list open if the
            // focus went to it, for the click that chooses a suggestion for this address bar.
            if (this.suggesting) this.chosenFor = this.suggestionsFor;
            this.addressFocused = false;
            this.closeSuggestions();
          }}
        />
        ${
          parts === undefined
            ? nothing
            : html`<div class="url" aria-hidden="true">
                <span class="host">${parts.host}</span><span class="rest">${parts.rest}</span>
              </div>`
        }
      </div>
    </div>`;
  }

  /** The icon of a tab: a turning ring while it loads, else its page's icon. */
  private renderTabIcon(
    tab: TabView,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult {
    if (tab.loading) {
      return html`<span class="favicon" role="img" aria-label=${t('shell.loading')}>
        <svg class="spinner" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" pathLength="100" stroke-dasharray="30 100" />
        </svg>
      </span>`;
    }
    const icon = tab.favicon === null ? undefined : this.favicons.get(tab.favicon);
    return html`<span class="favicon" aria-hidden="true"
      >${icon === undefined ? (pageIcon(tab.url) ?? icons.globe) : html`<img src=${icon} alt="" />`}</span
    >`;
  }

  /**
   * Opens the menu of a tab where it was clicked with the secondary button. A Control-click
   * opens it on macOS as well, with the primary button, whose release the menu takes: that
   * press drags nothing.
   */
  private openTabMenu(event: MouseEvent, tabId: string): void {
    event.preventDefault();
    this.cancelDrag();
    void this.bridge?.invoke('tabs.openMenu', {
      tabId,
      x: Math.max(0, Math.round(event.clientX)),
      y: Math.max(0, Math.round(event.clientY)),
      // A popover that the menu opens, such as of a new group, gives the focus back here then.
      keyboard: menuByKeyboard(event),
    });
  }

  private setMuted(tabId: string, muted: boolean): void {
    void this.bridge?.invoke('tabs.setMuted', { tabId, muted });
  }

  private renderBookmarksBar(
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult | typeof nothing {
    const items = this.state.bookmarksBar;
    if (items === null) return nothing;
    return html`<div class="bookmarks" role="toolbar" aria-label=${t('shell.bookmarksBar')}>
      ${
        items.length === 0
          ? html`<span class="hint">${t('shell.bookmarksBarEmpty')}</span>`
          : html`<div class="items">${items.map((item) => this.renderBarItem(item))}</div>
              <button
                class="more"
                data-hidden
                title=${t('shell.moreBookmarks')}
                aria-label=${t('shell.moreBookmarks')}
                aria-haspopup="menu"
                aria-expanded=${this.folderOpen(bookmarkRoots.bar) ? 'true' : 'false'}
                @click=${(event: MouseEvent) =>
                  this.openFolderMenu(event, bookmarkRoots.bar, this.barOverflow)}
              >
                ${icons.more}
              </button>`
      }
    </div>`;
  }

  private renderBarItem(item: BarItem): TemplateResult {
    const url = item.url;
    if (url === null) {
      return html`<button
        aria-haspopup="menu"
        aria-expanded=${this.folderOpen(item.id) ? 'true' : 'false'}
        @click=${(event: MouseEvent) => this.openFolderMenu(event, item.id, 0)}
      >
        ${icons.folder}<span>${item.title}</span>
      </button>`;
    }
    return html`<button
      title=${url}
      @click=${(event: MouseEvent) => this.openBarLink(url, event.ctrlKey || event.metaKey)}
      @auxclick=${(event: MouseEvent) => event.button === 1 && this.openBarLink(url, true)}
    >
      <span>${item.title || url}</span>
    </button>`;
  }

  /** Opens a bookmark of the bookmarks bar in the active tab, or in a new one. */
  private openBarLink(url: string, newTab: boolean): void {
    const tabId = this.state.activeTabId;
    void (newTab || tabId === null
      ? this.bridge?.invoke('tabs.open', { input: url })
      : this.bridge?.invoke('tabs.navigate', { tabId, input: url }));
  }

  /** Whether the overlay shows the menu of a folder of the bookmarks bar. */
  private folderOpen(id: number): boolean {
    return this.state.popover?.kind === 'folder' && this.state.popover.folder === id;
  }

  /**
   * Opens the menu of a folder of the bookmarks bar at the clicked button.
   * @param event - The click; one of the keyboard, with Enter or Space, has no count of clicks.
   * @param id - The folder.
   * @param from - How many of the folder's first entries the menu leaves out.
   */
  private openFolderMenu(event: MouseEvent, id: number, from: number): void {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) {
      void this.bridge?.invoke('shell.openBookmarkFolder', {
        id,
        from,
        ...anchorOf(button, event.detail === 0),
      });
    }
  }

  /** Hides the bookmarks that do not fit in the bookmarks bar and shows the » button then. */
  private layoutBookmarksBar(): void {
    const list = this.renderRoot.querySelector('.bookmarks .items');
    const more = this.renderRoot.querySelector('.bookmarks .more');
    if (list === null || more === null) return;
    const end = list.getBoundingClientRect().right;
    const buttons = [...list.children];
    const first = buttons.findIndex((button) => button.getBoundingClientRect().right > end + 0.5);
    this.barOverflow = first === -1 ? buttons.length : first;
    for (const [index, button] of buttons.entries()) {
      button.toggleAttribute('data-hidden', index >= this.barOverflow);
    }
    more.toggleAttribute('data-hidden', first === -1);
  }

  private get active(): TabView | undefined {
    return this.state.tabs.find((tab) => tab.id === this.state.activeTabId);
  }

  private blockerLabel(tab: TabView): string {
    const params = { count: String(tab.blocked) };
    const key =
      tab.blocking === 'on'
        ? 'shell.blockerOn'
        : tab.blocking === 'failed'
          ? 'shell.blockerFailed'
          : 'shell.blockerOff';
    return this.i18n?.t(key, params) ?? 'shell.blocker';
  }

  /** Opens the content blocker's popover at its button. */
  private readonly openBlockerPopover = (event: MouseEvent): void => {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) {
      void this.bridge?.invoke('shell.openBlockerPopover', anchorOf(button, event.detail === 0));
    }
  };

  /**
   * The button of the reader view, on web pages with an article, pressed while the reader view
   * shows the article; the browser finds the article in the page. The browser's own pages and
   * the problems of pages have none.
   */
  private renderReaderButton(active: TabView | undefined): TemplateResult | typeof nothing {
    return active === undefined ||
      active.reader === 'none' ||
      active.problem !== null ||
      !/^https?:/i.test(active.url)
      ? nothing
      : html`<button
          class="icon reader"
          title=${this.tp('shell.reader')}
          aria-label=${this.tp('shell.reader')}
          aria-pressed=${active.reader === 'open' ? 'true' : 'false'}
          @click=${() => void this.bridge?.invoke('shell.toggleReader', {})}
        >
          ${icons.bookOpen}
        </button>`;
  }

  /**
   * The button of picture in picture, while a video of a web page plays, pressed while a video
   * of the page shows in picture in picture; it does what it shows: pressed, it ends picture in
   * picture, otherwise it starts it. The browser's own pages and the problems of pages have none.
   */
  private renderPictureInPictureButton(
    active: TabView | undefined,
  ): TemplateResult | typeof nothing {
    return active === undefined ||
      active.pictureInPicture === 'none' ||
      active.problem !== null ||
      !/^https?:/i.test(active.url)
      ? nothing
      : html`<button
          class="icon pip"
          title=${this.tp('shell.pictureInPicture')}
          aria-label=${this.tp('shell.pictureInPicture')}
          aria-pressed=${active.pictureInPicture === 'open' ? 'true' : 'false'}
          @click=${() => void this.bridge?.invoke('shell.togglePictureInPicture', {})}
        >
          ${icons.pictureInPicture}
        </button>`;
  }

  /**
   * The star that bookmarks a web page and opens its popover, where the bookmark gets its name
   * and folder; the browser's own pages have none.
   */
  private renderBookmarkButton(active: TabView | undefined): TemplateResult | typeof nothing {
    const t = this.tp.bind(this);
    return active === undefined || !/^https?:/i.test(active.url)
      ? nothing
      : html`<button
          class="icon bookmark"
          title=${t('shell.bookmark')}
          aria-label=${t('shell.bookmark')}
          aria-pressed=${active.bookmarked ? 'true' : 'false'}
          aria-haspopup="dialog"
          aria-expanded=${this.state.popover?.kind === 'bookmark' ? 'true' : 'false'}
          @click=${(event: MouseEvent) => {
            const button = event.currentTarget;
            if (button instanceof HTMLElement) this.openBookmark(button, event.detail === 0);
          }}
        >
          ${icons.star}
        </button>`;
  }

  /**
   * Opens the popover of the star at an element: the star, or the menu button when the
   * toolbar has no star, or a corner of the window when it has neither.
   */
  private openBookmark(element: Element | null, keyboard: boolean): void {
    void this.bridge?.invoke('shell.openBookmarkPopover', this.anchorAt(element, keyboard));
  }

  /** Opens the popover of the star for the shortcut, at the star or else at the menu button. */
  private editBookmark(): void {
    const star = this.renderRoot.querySelector('.bookmark');
    this.openBookmark(
      star !== null && laidOut(star) ? star : this.renderRoot.querySelector('.menu-button'),
      true,
    );
  }

  /**
   * Where a popover of an element of the shell opens: at the element, or at the top corner of
   * the window at its end when the element is missing or has no place, as in a layout that
   * hides the toolbar.
   */
  private anchorAt(element: Element | null, keyboard: boolean): PopoverAnchor {
    return element !== null && laidOut(element)
      ? anchorOf(element, keyboard)
      : { x: Math.max(0, Math.round(innerWidth - 1)), y: 0, width: 0, height: 0, keyboard };
  }

  /** The shield of the content blocker, on pages that it works on. */
  private renderShieldButton(active: TabView | undefined): TemplateResult | typeof nothing {
    return active === undefined || active.blocking === 'none'
      ? nothing
      : html`<button
          class="icon blocker"
          data-state=${active.blocking}
          title=${this.blockerLabel(active)}
          aria-label=${this.blockerLabel(active)}
          aria-haspopup="dialog"
          aria-expanded=${this.state.popover?.kind === 'shield' ? 'true' : 'false'}
          @click=${this.openBlockerPopover}
        >
          ${
            active.blocking === 'on'
              ? icons.shield
              : active.blocking === 'failed'
                ? icons.shieldAlert
                : icons.shieldOff
          }
          ${
            active.blocking === 'on' && active.blocked > 0
              ? html`<span class="count" aria-hidden="true"
                  >${active.blocked > 99 ? '99+' : active.blocked}</span
                >`
              : nothing
          }
        </button>`;
  }

  /** The downloads button, once the browser downloaded something, with the progress around it. */
  private renderDownloadsButton(): TemplateResult | typeof nothing {
    const downloads = this.state.downloads;
    if (downloads === null) return nothing;
    const label =
      downloads.active === 0
        ? this.tp('shell.downloads')
        : this.tp('shell.downloadsActive', { count: String(downloads.active) });
    // The ring fills with the progress; while a size is unknown, it shows a quarter.
    const ring = downloads.active === 0 ? 0 : (downloads.progress ?? 0.25);
    return html`<button
      class="icon downloads"
      title=${label}
      aria-label=${label}
      aria-haspopup="dialog"
      aria-expanded=${this.state.popover?.kind === 'downloads' ? 'true' : 'false'}
      @click=${(event: MouseEvent) => this.openDownloads(event.currentTarget, event.detail === 0)}
    >
      ${icons.download}
      ${
        downloads.active === 0
          ? nothing
          : html`<svg class="ring" viewBox="0 0 24 24" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="10"
                pathLength="100"
                stroke-dasharray="${Math.round(ring * 100)} 100"
              />
            </svg>`
      }
    </button>`;
  }

  /** Opens the list of downloads at the button, once the shortcut showed the button. */
  private openDownloadsAtButton(): void {
    // Without its button, the list opens at the menu button.
    if (!this.state.toolbar.includes('downloads')) {
      this.openDownloads(this.renderRoot.querySelector('.menu-button'), true);
      return;
    }
    this.downloadsPending = true;
    this.takeDownloadsOpening();
  }

  private takeDownloadsOpening(): void {
    const button = this.renderRoot.querySelector('.downloads');
    if (!this.downloadsPending || button === null) return;
    this.downloadsPending = false;
    this.openDownloads(button, true);
  }

  private openDownloads(button: EventTarget | null, keyboard: boolean): void {
    void this.bridge?.invoke(
      'shell.openDownloads',
      this.anchorAt(button instanceof Element ? button : null, keyboard),
    );
  }

  /** Opens the browser menu at its button; Enter or Space give a click without a count. */
  private readonly openMenu = (event: MouseEvent): void => {
    const button = event.currentTarget;
    if (button instanceof Element) {
      void this.bridge?.invoke('shell.openMenu', this.anchorAt(button, event.detail === 0));
    }
  };

  /** Opens the browser menu with the keyboard, as F10 or Alt alone do, at its button. */
  private openMenuAtButton(): void {
    void this.bridge?.invoke(
      'shell.openMenu',
      this.anchorAt(this.renderRoot.querySelector('.menu-button'), true),
    );
  }

  /** The arrow down opens the menu from its button, as it opens the menus of a menu bar. */
  private readonly onMenuKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const button = event.currentTarget;
    if (button instanceof Element) {
      void this.bridge?.invoke('shell.openMenu', this.anchorAt(button, true));
    }
  };

  /**
   * Makes the overlay ready once the pointer reaches the menu button or the button takes the
   * focus, so that the first popover opens without waiting for the overlay's page.
   */
  private readonly prepareOverlay = (): void => {
    if (this.overlayPrepared) return;
    this.overlayPrepared = true;
    void this.bridge?.invoke('shell.prepareOverlay', {});
  };

  /**
   * Asks the browser for a new tab. The answer and the state with the tab come later, so the
   * address bar is the new tab's from the click on, and takes the focus at once, so that
   * what is typed right after the click goes there.
   */
  private readonly newTab = (): void => {
    const bridge = this.bridge;
    if (bridge === undefined) return;
    const opening: Opening = {
      answer: bridge.invoke('tabs.open', {}).then(({ tabId }) => tabId),
      id: undefined,
      draft: undefined,
      entered: false,
    };
    const replaced = this.opening;
    if (replaced?.draft !== undefined) this.replacedOpenings.add(replaced);
    this.opening = opening;
    this.requestUpdate();
    this.focusAddress();
    void opening.answer.then(
      (id) => {
        opening.id = id;
        this.settleOpening();
      },
      () => {
        this.replacedOpenings.delete(opening);
        // Without a new tab, the address bar is the active tab's again.
        if (this.opening !== opening) return;
        this.opening = undefined;
        this.requestUpdate();
      },
    );
  };

  private close(tabId: string): void {
    void this.bridge?.invoke('tabs.close', { tabId });
  }

  /** The find bar of the active tab, with the number of matches and the way between them. */
  private renderFind(): TemplateResult | typeof nothing {
    const find = this.state.find;
    const tab = this.active;
    if (find === null || tab === undefined) return nothing;
    const count =
      find.query === ''
        ? ''
        : find.matches === 0
          ? this.tp('find.none')
          : this.tp('find.count', { active: String(find.active), matches: String(find.matches) });
    return html`<div class="find" role="search" aria-label=${this.tp('find.label')}>
      <input
        id="find"
        type="search"
        spellcheck="false"
        autocomplete="off"
        maxlength="1000"
        aria-label=${this.tp('find.label')}
        placeholder=${this.tp('find.label')}
        @input=${(event: Event) => {
          const input = inputOf(event);
          if (input !== undefined) this.findIn(tab.id, input.value, true, false);
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'Enter') this.findStep(tab.id, !event.shiftKey);
          else if (event.key === 'Escape') {
            // A search field clears itself on Escape; the find bar keeps its text instead.
            event.preventDefault();
            void this.bridge?.invoke('tabs.stopFind', { tabId: tab.id });
          }
        }}
      />
      <span class="count" aria-live="polite">${count}</span>
      <button
        class="icon"
        title=${this.tp('find.previous')}
        aria-label=${this.tp('find.previous')}
        @click=${() => this.findStep(tab.id, false)}
      >
        ${icons.up}
      </button>
      <button
        class="icon"
        title=${this.tp('find.next')}
        aria-label=${this.tp('find.next')}
        @click=${() => this.findStep(tab.id, true)}
      >
        ${icons.down}
      </button>
      <button
        class="icon"
        title=${this.tp('find.close')}
        aria-label=${this.tp('find.close')}
        @click=${() => void this.bridge?.invoke('tabs.stopFind', { tabId: tab.id })}
      >
        ${icons.close}
      </button>
    </div>`;
  }

  private findIn(tabId: string, query: string, forward: boolean, next: boolean): void {
    void this.bridge?.invoke('tabs.find', { tabId, query, forward, next });
  }

  /**
   * Moves to the next or previous match of the text in the find bar. It reads the field, not
   * the state, which can still hold the text from before the last key.
   */
  private findStep(tabId: string, forward: boolean): void {
    const query = this.renderRoot.querySelector<HTMLInputElement>('#find')?.value;
    this.findIn(tabId, query ?? this.state.find?.query ?? '', forward, true);
  }

  /**
   * Focuses the find bar with the text it looked for last, selected. The command can come
   * before the state that opens the bar, so the bar takes the focus when it appears.
   */
  private focusFind(): void {
    this.findFocusPending = true;
    this.takeFindFocus();
  }

  private takeFindFocus(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('#find');
    if (!this.findFocusPending || input === null) return;
    this.findFocusPending = false;
    if (input.value === '') input.value = this.state.find?.query ?? '';
    input.focus();
    input.select();
  }

  /**
   * What a tab shows when it has no page, in the content area or in its side of a split view:
   * why, and the ways on from there, which act on that tab.
   */
  private renderProblem(tab: TabView): TemplateResult | typeof nothing {
    const problem = tab.problem;
    if (problem === null) return nothing;
    const site = hostOf(problem.url);
    // Two sides can show a problem at once; each title has an id of its own.
    const title = `problem-title-${tab.id}`;
    if (problem.kind === 'certificate') {
      return html`<section class="problem" aria-labelledby=${title}>
        <h1 id=${title}>${this.tp('problem.certificateTitle')}</h1>
        <p>${this.tp('problem.certificate', { site })}</p>
        <p class="code">${this.tp('problem.code', { code: problem.code })}</p>
        ${
          tab.canGoBack
            ? html`<button @click=${() => this.action('back', tab.id)}>
                ${this.tp('problem.back')}
              </button>`
            : nothing
        }
        ${
          problem.proceed
            ? html`<details>
                <summary>${this.tp('problem.details')}</summary>
                <p>${this.tp('problem.certificateRisk')}</p>
                <button
                  @click=${() => void this.bridge?.invoke('tabs.proceedUnsafely', { tabId: tab.id })}
                >
                  ${this.tp('problem.proceed', { site })}
                </button>
              </details>`
            : html`<p>${this.tp('problem.certificateManaged')}</p>`
        }
      </section>`;
    }
    if (problem.kind === 'insecure') {
      return html`<section class="problem" aria-labelledby=${title}>
        <h1 id=${title}>${this.tp('problem.insecureTitle')}</h1>
        <p>${this.tp('problem.insecure', { site })}</p>
        <p class="code">${this.tp('problem.code', { code: problem.code })}</p>
        ${
          tab.canGoBack
            ? html`<button @click=${() => this.action('back', tab.id)}>
                ${this.tp('problem.back')}
              </button>`
            : nothing
        }
        <button
          @click=${() => void this.bridge?.invoke('tabs.proceedInsecurely', { tabId: tab.id })}
        >
          ${this.tp('problem.proceed', { site })}
        </button>
      </section>`;
    }
    const crashed = problem.kind === 'crashed';
    return html`<section class="problem" aria-labelledby=${title}>
      <h1 id=${title}>${this.tp(crashed ? 'problem.crashedTitle' : 'problem.errorTitle')}</h1>
      <p>${this.tp(crashed ? 'problem.crashed' : problemMessage(problem.code), { site })}</p>
      <p class="code">${this.tp('problem.code', { code: problem.code })}</p>
      <button @click=${() => this.action('reload', tab.id)}>
        ${this.tp(crashed ? 'problem.reload' : 'problem.retry')}
      </button>
    </section>`;
  }

  private tp(
    key: Parameters<Translator['t']>[0],
    params?: Readonly<Record<string, string>>,
  ): string {
    return this.i18n?.t(key, params) ?? key;
  }

  /**
   * Runs a history or loading action in a tab: the active one, or the tab of a side of a split
   * view whose problem showed the button.
   */
  private action(
    action: 'back' | 'forward' | 'reload' | 'stop' | 'home',
    tabId: string | null = this.state.activeTabId,
  ): void {
    if (tabId !== null) {
      void this.bridge?.invoke('tabs.action', { tabId, action });
    }
  }

  /**
   * The mouse's back and forward buttons act on the tab under the pointer, as they do over its
   * page: the tab of the side of a split view, or else the active tab.
   */
  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      const pane = event
        .composedPath()
        .find((target) => target instanceof HTMLElement && target.classList.contains('pane'));
      const tabId = pane instanceof HTMLElement ? pane.dataset['id'] : undefined;
      this.action(event.button === 3 ? 'back' : 'forward', tabId ?? this.state.activeTabId);
    }
  };

  private readonly onAddressKey = (event: KeyboardEvent): void => {
    const input = inputOf(event);
    if (input === undefined) {
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && this.suggesting) {
      event.preventDefault();
      void this.bridge
        ?.invoke('omnibox.select', { step: event.key === 'ArrowDown' ? 1 : -1 })
        .then((index) => (this.suggestion = index));
      return;
    }
    if (event.key === 'Escape') {
      // The first Escape closes the suggestions, the next brings back the page's address.
      if (this.suggesting) {
        this.closeSuggestions();
        return;
      }
      // While rows hide, one more Escape leaves the address bar that shows its page's address:
      // the page gets the keys, and the rows hide.
      const address = displayUrl(this.addressTab?.url);
      if (
        this.escapedOnce &&
        this.state.layout.hiding !== null &&
        this.draft === undefined &&
        input.value === address
      ) {
        this.escapedOnce = false;
        input.blur();
        return;
      }
      this.setDraft(undefined);
      input.value = address;
      input.select();
      this.escapedOnce = true;
    }
    if (event.key === 'Enter' && this.suggestion !== -1) {
      const typed = input.value;
      // The browser opens the suggestion in the tab that the list is for, also in the tab that
      // the New tab button opens while the shell still waits for that tab.
      const owner = this.addressOwner;
      if (isOpening(owner)) owner.entered = true;
      this.chosenFor = owner;
      this.suggestion = -1;
      this.suggesting = false;
      // A newer list may have come without the mark; then what was typed opens, for the tab
      // that it was typed for.
      void this.bridge?.invoke('omnibox.accept', {}).then((opened) => {
        if (opened) return;
        if (this.chosenFor === owner) this.chosenFor = undefined;
        if (typed.trim() !== '') this.enter(typed, input, owner);
      });
      return;
    }
    if (event.key !== 'Enter' || input.value.trim() === '') {
      return;
    }
    this.closeSuggestions();
    this.enter(input.value, input, this.addressOwner);
  };

  /**
   * Opens what was typed in an address bar: in its tab, or in the tab that the New tab button
   * opens once the browser named it. The address bar is left if it is still that tab's: a
   * click on New tab may have given it to the new tab before a late fallback of Enter.
   * @param text - What was typed.
   * @param input - The address bar.
   * @param owner - Whose address bar it was when the text was entered.
   */
  private enter(text: string, input: HTMLInputElement, owner: AddressOwner): void {
    if (isOpening(owner)) {
      // The tab that the New tab button opens loads the input once the browser named it.
      owner.entered = true;
      void owner.answer.then((id) =>
        this.bridge?.invoke('tabs.navigate', { tabId: id, input: text }),
      );
    } else {
      void (owner === null
        ? this.bridge?.invoke('tabs.open', { input: text })
        : this.bridge?.invoke('tabs.navigate', { tabId: owner, input: text }));
    }
    const now = this.ownerNow(owner);
    this.dropInput(now);
    if (now === this.addressOwner) input.blur();
  }

  /** Asks for the suggestions for what is typed, below the address bar. */
  private suggest(text: string): void {
    this.suggestion = -1;
    const field = this.renderRoot.querySelector('.address')?.getBoundingClientRect();
    if (text.trim() === '' || field === undefined) {
      this.closeSuggestions();
      return;
    }
    const style = getComputedStyle(this);
    const rowHeight = Math.round(
      Number.parseFloat(style.getPropertyValue('--control-large')) +
        Number.parseFloat(style.getPropertyValue('--space-1')),
    );
    this.suggesting = true;
    this.suggestionsFor = this.addressOwner;
    // A chosen suggestion opens in the tab of the address bar. The browser knows the tab that
    // the New tab button opens before the shell does.
    const tabId = this.opening === undefined ? this.state.activeTabId : this.opening.id;
    void this.bridge?.invoke('omnibox.suggest', {
      text: text.slice(0, 2000),
      ...(tabId === null || tabId === undefined ? {} : { tabId }),
      x: Math.max(0, Math.round(field.left)),
      y: Math.max(0, Math.round(field.bottom + 4)),
      width: Math.max(1, Math.round(field.width)),
      rowHeight: Math.min(120, Math.max(16, rowHeight || 36)),
    });
  }

  private closeSuggestions(): void {
    this.suggestion = -1;
    if (!this.suggesting) return;
    this.suggesting = false;
    void this.bridge?.invoke('omnibox.close', {});
  }

  /**
   * Leaves the address bar after a suggestion opened, with the page's address in it. The
   * suggestion may have been chosen for the tab that was active before a click on New tab
   * gave the address bar to the new tab: what is typed for the new tab then stays.
   */
  private leaveAddress(): void {
    const owner = this.ownerNow(
      this.chosenFor === undefined ? this.suggestionsFor : this.chosenFor,
    );
    this.chosenFor = undefined;
    // A suggestion opened in the tab that the New tab button opens: the address bar does not
    // take the focus back when the tab shows.
    if (isOpening(owner)) owner.entered = true;
    this.dropInput(owner);
    if (owner !== this.addressOwner) return;
    this.suggesting = false;
    this.suggestion = -1;
    this.renderRoot.querySelector('input')?.blur();
  }

  private focusAddress(): void {
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

  /**
   * Leaves room in the top row for the window controls, where the window has them: the shell
   * moves its tabs and buttons out of their way, and removes the room in full screen and with
   * the title bar of the system, where the state has no title bar.
   */
  private readonly placeTitleBar = (): void => {
    const titleBar = this.state.titleBar;
    if (titleBar === null) {
      delete this.dataset['titlebar'];
      this.titleBarRoom = '';
      return;
    }
    const controls = this.windowControls;
    const free = controls?.visible === true ? controls.getTitlebarAreaRect() : undefined;
    const room = controlsRoom(
      titleBar,
      free === undefined
        ? undefined
        : { x: free.x, width: free.width, height: free.height, viewport: window.innerWidth },
    );
    const key = JSON.stringify(room);
    if (key === this.titleBarRoom) return;
    this.titleBarRoom = key;
    this.dataset['titlebar'] = room.side;
    this.style.setProperty('--titlebar-start', `${String(room.start)}px`);
    this.style.setProperty('--titlebar-end', `${String(room.end)}px`);
  };

  /** The window controls moved or changed their size: their room, and with it the one row. */
  private readonly onControlsMove = (): void => {
    this.placeTitleBar();
    this.fitTopRow();
  };

  /**
   * Puts the tabs of the one row in a row of their own above the toolbar while the window is
   * too narrow for both. Neither gets less room than it needs, so the row is too narrow when
   * the tabs end beyond the window: the shell lays the one row out, measures, and keeps it
   * only when the tabs end within the window, all before the window draws.
   */
  private fitTopRow(): void {
    this.removeAttribute('data-narrow');
    if (this.state.layout.toolbar !== 'tab-row') return;
    const strip = this.renderRoot.querySelector('[role="tablist"]');
    const end = strip?.getBoundingClientRect().right ?? 0;
    this.toggleAttribute('data-narrow', end > window.innerWidth + 0.5);
  }

  /**
   * Takes the rows at the top from the state: where the toolbar is, and whether the rows hide,
   * show over the page, or always show, with the height of what stays of them. Rows that no
   * longer hide take nothing that held them along.
   */
  private placeRows(): void {
    const { toolbar, hiding } = this.state.layout;
    this.dataset['toolbar'] = toolbar;
    this.dataset['rows'] = hiding === null ? 'shown' : hiding.shown ? 'revealed' : 'hidden';
    if (hiding === null) {
      clearTimeout(this.rowsTimer);
      this.rowsTimer = undefined;
      this.rowPointer = false;
    } else {
      this.style.setProperty('--reveal-height', `${String(hiding.height)}px`);
    }
    this.sendHolds();
  }

  /**
   * The pointer reached what stays of rows that hide: they show at once from the edge, and
   * after a moment on the title row, which the pointer crosses on its way to the window controls.
   */
  private readonly onRevealEnter = (): void => {
    clearTimeout(this.rowsTimer);
    if (this.state.layout.hiding?.rest === 'edge') {
      this.rowsTimer = undefined;
      this.holdRows({ pointer: true });
      return;
    }
    this.rowsTimer = setTimeout(() => {
      this.rowsTimer = undefined;
      this.holdRows({ pointer: true });
    }, titleRowDwell);
  };

  /** The pointer left the title row before the rows showed. */
  private readonly onRevealLeave = (): void => {
    if (this.rowPointer) return;
    clearTimeout(this.rowsTimer);
    this.rowsTimer = undefined;
  };

  /**
   * The pointer reached the rows while they show: it holds them, also where something else
   * showed them, such as the moment after another site, and keeps those that it held.
   */
  private readonly onShellEnter = (): void => {
    if (this.state.layout.hiding?.shown !== true) return;
    clearTimeout(this.rowsTimer);
    this.rowsTimer = undefined;
    this.holdRows({ pointer: true });
  };

  /**
   * The pointer left the shell, which lies above the page cut to its rows while they show:
   * they hide after a moment, unless the pointer comes back or drags a tab. Over a region of the
   * rows that moves the window, the shell hears this too; the browser then asks the system where
   * the pointer is.
   */
  private readonly onShellLeave = (): void => {
    if (!this.rowPointer) return;
    clearTimeout(this.rowsTimer);
    const leave = (): void => {
      if (this.dragging !== undefined) {
        this.rowsTimer = setTimeout(leave, rowsLeaveDelay);
        return;
      }
      this.rowsTimer = undefined;
      this.holdRows({ pointer: false });
    };
    this.rowsTimer = setTimeout(leave, rowsLeaveDelay);
  };

  /**
   * Notes whether a control of the shell has its focus for the keys, as a field does, or a
   * control after Ctrl+L, F6 or Tab, which holds rows that hide open while the shell has the
   * focus of the window. A button that a click focused holds nothing: the keys go to the page
   * once the rows hide. The focus moves within the shell in two events; what has it after both
   * counts.
   */
  private readonly onFocusMove = (): void => {
    setTimeout(() => this.noteFocus(), 0);
  };

  /** Tells the browser when a control of the shell gets or loses the focus for the keys. */
  private noteFocus(): void {
    const active = this.shadowRoot?.activeElement ?? null;
    const focused =
      active !== null && (active instanceof HTMLInputElement || active.matches(':focus-visible'));
    if (focused !== this.rowFocus) this.holdRows({ focus: focused });
  }

  /**
   * Tells the browser that the shell drew rows that hide hidden, once it drew them: Chromium
   * sends the regions that move the window with a frame, so the shell waits for the frame after
   * the one that drew them. The browser lays the page above the shell only then, as the regions
   * of the shell below the page would win over it (ADR 0048).
   */
  private noteRowsDrawn(): void {
    if (this.dataset['rows'] !== 'hidden') {
      if (this.drawnFrame !== undefined) cancelAnimationFrame(this.drawnFrame);
      this.drawnFrame = undefined;
      if (this.rowsDrawnHidden) this.holdRows({ hidden: false });
      return;
    }
    if (this.rowsDrawnHidden || this.drawnFrame !== undefined) return;
    this.drawnFrame = requestAnimationFrame(() => {
      this.drawnFrame = requestAnimationFrame(() => {
        this.drawnFrame = undefined;
        this.holdRows({ hidden: true });
      });
    });
  }

  /** Changes what holds rows that hide open in the shell, and how the shell drew them. */
  private holdRows(change: {
    readonly pointer?: boolean;
    readonly focus?: boolean;
    readonly hidden?: boolean;
  }): void {
    this.rowPointer = change.pointer ?? this.rowPointer;
    this.rowFocus = change.focus ?? this.rowFocus;
    this.rowsDrawnHidden = change.hidden ?? this.rowsDrawnHidden;
    this.sendHolds();
  }

  /** Tells the browser what holds rows that hide open, when it changed; nothing while none hide. */
  private sendHolds(): void {
    const hiding = this.state.layout.hiding !== null;
    const holds = {
      pointer: hiding && this.rowPointer,
      focus: hiding && this.rowFocus,
      hidden: hiding && this.rowsDrawnHidden,
    };
    const sent = this.sentHolds;
    if (
      holds.pointer === sent.pointer &&
      holds.focus === sent.focus &&
      holds.hidden === sent.hidden
    )
      return;
    this.sentHolds = holds;
    void this.bridge?.invoke('shell.holdTopRows', holds);
  }

  /**
   * Tells the browser where the content area is, so the page covers exactly that area. While
   * the shell lies above the page, cut to its rows, its rows can for a moment be higher than
   * its view: nothing is below zero then.
   */
  private reportInsets(): void {
    const content = this.renderRoot.querySelector('.content')?.getBoundingClientRect();
    if (content === undefined) {
      return;
    }
    const insets = {
      top: Math.max(0, Math.round(content.top)),
      right: Math.max(0, Math.round(window.innerWidth - content.right)),
      bottom: Math.max(0, Math.round(window.innerHeight - content.bottom)),
      left: Math.max(0, Math.round(content.left)),
    };
    const key = JSON.stringify(insets);
    if (key !== this.reportedInsets) {
      this.reportedInsets = key;
      void this.bridge?.invoke('shell.setInsets', insets);
    }
  }
}

/** A tab that the New tab button asked the browser for, while the shell waits for it. */
interface Opening {
  /** The browser's answer: the id of the new tab. */
  readonly answer: Promise<string>;
  /** The id of the new tab, once the browser answered. */
  id: string | undefined;
  /** What was typed for the new tab and not yet entered. */
  draft: string | undefined;
  /** Whether something was entered for the new tab. */
  entered: boolean;
}

/** Whether the address bar took input for a tab that the New tab button opens. */
function tookInput(opening: Opening): boolean {
  return opening.entered || opening.draft !== undefined;
}

/**
 * Whose address bar it is: a tab that the New tab button opens while the shell waits for it,
 * or the id of a tab, `null` without tabs.
 */
type AddressOwner = Opening | string | null;

/** Whether an address bar is that of a tab that the New tab button opens. */
function isOpening(owner: AddressOwner | undefined): owner is Opening {
  return typeof owner === 'object' && owner !== null;
}

/**
 * How long in ms the divider of a split view keeps a share that was let go, or set with a
 * key, while no state brings it.
 */
const splitEchoWait = 1000;

/**
 * How long in ms the pointer stays on the title row of rows that hide before they show, so that
 * a pointer on its way to the window controls, or out of the window, leaves them hidden.
 */
const titleRowDwell = 300;

/** How long in ms rows that hide stay after the pointer left them, so that a slip keeps them. */
const rowsLeaveDelay = 400;

/**
 * The part of the Window Controls Overlay API that the shell reads, which the DOM types of
 * TypeScript do not have. Electron gives it to the views of windows whose window controls
 * Chromium draws, on Windows and Linux.
 */
interface WindowControls extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

/** The Window Controls Overlay API of the shell's window, if the engine has it. */
function windowControls(): WindowControls | undefined {
  const overlay: unknown = Reflect.get(navigator, 'windowControlsOverlay');
  return isWindowControls(overlay) ? overlay : undefined;
}

/** Whether a value is the Window Controls Overlay API. */
function isWindowControls(value: unknown): value is WindowControls {
  return value instanceof EventTarget && 'visible' in value && 'getTitlebarAreaRect' in value;
}

/** How a page's connection is shown in the address bar. */
type Security = 'secure' | 'insecure' | 'internal' | 'none';

const securityLabels = {
  secure: 'shell.secure',
  insecure: 'shell.notSecure',
  internal: 'shell.internalPage',
} as const;

/**
 * How secure the connection of a tab's page is: secure over HTTPS with a trusted
 * certificate; not secure without encryption to another computer, or with a certificate that
 * is not trusted, also after the user accepted it; or one of the browser's own pages. Local
 * addresses, pages without one and pages that could not be loaded or crashed show nothing.
 */
function securityOf(tab: TabView): Security {
  const problem = tab.problem?.kind;
  if (problem === 'insecure' || problem === 'certificate') return 'insecure';
  if (problem !== undefined) return 'none';
  const url = tab.url;
  if (url === newTabUrl || url === 'about:blank') return 'none';
  if (url.startsWith('app://')) return 'internal';
  if (/^https:/i.test(url)) return tab.certificateException ? 'insecure' : 'secure';
  if (!/^http:/i.test(url)) return 'none';
  const host = hostOf(url).replace(/:\d+$/, '');
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)
    ? 'none'
    : 'insecure';
}

/**
 * An address split into the host, which the address bar shows first, and the rest; secure
 * and insecure web addresses leave their scheme out, as the field shows how secure they are.
 * @param address - The address that the field holds.
 */
function addressParts(address: string): { host: string; rest: string } | undefined {
  if (address === '') return undefined;
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { host: address, rest: '' };
    const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
    return { host: url.host, rest };
  } catch {
    return { host: address, rest: '' };
  }
}

/**
 * Where a button of the shell is, for a popover that opens at it, and whether the keyboard
 * opened the popover.
 * @param element - The button.
 * @param keyboard - Whether the keyboard opened the popover, as Enter or Space on the button do.
 */
function anchorOf(element: Element, keyboard: boolean): PopoverAnchor {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
    keyboard,
  };
}

/**
 * Whether the keyboard opened a context menu, as the context menu key and Shift+F10 do.
 * Chromium gives that event no button, but the pointer type `mouse`; the standard of pointer
 * events gives it no pointer type.
 */
function menuByKeyboard(event: MouseEvent): boolean {
  return event.button === -1 || (event instanceof PointerEvent && event.pointerType === '');
}

/** Whether an element has a place in the layout, which a hidden one has not. */
function laidOut(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function inputOf(event: Event): HTMLInputElement | undefined {
  return event.target instanceof HTMLInputElement ? event.target : undefined;
}

function displayUrl(url: string | undefined): string {
  return url === undefined || url === 'about:blank' || url === newTabUrl ? '' : url;
}

/** Where the active tab's surface goes in the tab strip, and its size. */
interface Place {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Whether two lengths in pixels are the same but for rounding. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}

/** Whether two places are the same but for rounding. */
function samePlace(a: Place, b: Place): boolean {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

/**
 * Where the layout puts an element, without the transform that draws it elsewhere for now,
 * such as an animation that moves a tab to its place or lets a new tab grow there. Tabs only
 * move, and scale about their center.
 * @param element - The element.
 */
function layoutRect(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  const transform = getComputedStyle(element).transform;
  if (transform === 'none' || transform === '') return rect;
  const { a, d, e, f } = new DOMMatrixReadOnly(transform);
  if (a <= 0 || d <= 0) return rect;
  const width = rect.width / a;
  const height = rect.height / d;
  return new DOMRect(
    rect.left - e - (width * (1 - a)) / 2,
    rect.top - f - (height * (1 - d)) / 2,
    width,
    height,
  );
}

/**
 * The icon of one of the browser's own pages, which have no page icons of their own.
 * @param url - The address of the tab.
 */
const securityIcons = {
  get secure(): TemplateResult {
    return icons.lock;
  },
  get insecure(): TemplateResult {
    return icons.warning;
  },
  get internal(): TemplateResult {
    return icons.browser;
  },
};

function pageIcon(url: string): TemplateResult | undefined {
  if (url === newTabUrl || !url.startsWith('app://')) return undefined;
  const page = hostOf(url);
  if (page === 'settings') return icons.settings;
  if (page === 'history') return icons.history;
  if (page === 'bookmarks') return icons.star;
  return undefined;
}

/** Icons drawn after Lucide (ISC license), inlined so the shell needs no icon requests. */
const icons = {
  lock: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="16" height="11" x="4" y="11" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>`,
  warning: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3" />
    <path d="M12 9v4M12 17h.01" />
  </svg>`,
  browser: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="M2 9h20" />
  </svg>`,
  globe: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
  </svg>`,
  settings: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"
    />
    <circle cx="12" cy="12" r="3" />
  </svg>`,
  history: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5M12 7v5l4 2" />
  </svg>`,
  sound: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"
    />
    <path d="M16 9a5 5 0 0 1 0 6M19.4 18.4a9 9 0 0 0 0-12.8" />
  </svg>`,
  soundOff: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"
    />
    <path d="m22 9-6 6M16 9l6 6" />
  </svg>`,
  up: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>`,
  down: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>`,
  plus: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>`,
  private: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M2 12a5 5 0 0 0 5 5 8 8 0 0 1 5 2 8 8 0 0 1 5-2 5 5 0 0 0 5-5V7h-5a8 8 0 0 0-5 2 8 8 0 0 0-5-2H2Z"
    />
    <path d="M6 11c1.5 0 3 .5 3 2-2 0-3 0-3-2Z" />
    <path d="M18 11c-1.5 0-3 .5-3 2 2 0 3 0 3-2Z" />
  </svg>`,
  close: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>`,
  back: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5" /></svg>`,
  forward: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>`,
  reload: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>`,
  stop: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>`,
  home: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path
      d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
    />
  </svg>`,
  shield: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"
    />
  </svg>`,
  shieldAlert: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"
    />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </svg>`,
  shieldOff: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m2 2 20 20" />
    <path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.7 9a1 1 0 0 0 .7 0 13 13 0 0 0 4.9-3.2" />
    <path
      d="M9.3 3.5c.7-.4 1.3-.8 1.9-1.2a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1v7a8 8 0 0 1-.3 2.3"
    />
  </svg>`,
  pictureInPicture: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
    <rect width="10" height="7" x="12" y="13" rx="2" />
  </svg>`,
  bookOpen: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 7v14" />
    <path
      d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
    />
  </svg>`,
  star: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2.1 2.1 0 0 0-2 0L6.4 21a.5.5 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.1-.7a2.1 2.1 0 0 0 1.6-1.2z"
    />
  </svg>`,
  folder: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    />
  </svg>`,
  more: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 17 5-5-5-5" />
    <path d="m13 17 5-5-5-5" />
  </svg>`,
  download: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 19h14" />
  </svg>`,
  menu: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>`,
};

/**
 * The text that tells why a page could not be loaded, by Chromium's name for the cause.
 * @param code - Such as `ERR_CONNECTION_REFUSED`.
 */
function problemMessage(code: string): Parameters<Translator['t']>[0] {
  switch (code) {
    case 'ERR_INTERNET_DISCONNECTED':
      return 'problem.offline';
    case 'ERR_NAME_NOT_RESOLVED':
    case 'ERR_NAME_RESOLUTION_FAILED':
      return 'problem.notFound';
    case 'ERR_CONNECTION_REFUSED':
      return 'problem.refused';
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT':
      return 'problem.timedOut';
    case 'ERR_CONNECTION_RESET':
    case 'ERR_CONNECTION_CLOSED':
      return 'problem.interrupted';
    default:
      return 'problem.failed';
  }
}

/** The host of an address, or the address itself when it has none. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
