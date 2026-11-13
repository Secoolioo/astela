import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { easingOf, motionOf } from '../ui-kit/motion.ts';
import { percent } from '../ui-kit/percent.ts';
import { sameZoom } from '../../shared/zoom.ts';
import { bookmarkRoots } from '../../shared/bookmarks.ts';
import { newTabUrl } from '../../shared/internal-pages.ts';
import type { BarItem, ShellState, TabView } from '../../shared/ipc/shell-contracts.ts';
import { controlsRoom } from '../../shared/window-controls.ts';
import type { Translator } from '../i18n/i18n.ts';
import type { ShellBridge } from './bridge.ts';
import {
  dropPlace,
  spanOf,
  stripItems,
  unitsOf,
  type Span,
  type StripUnit,
} from './strip-items.ts';
import { TabIcons } from '../ui-kit/tab-icons.ts';

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
    .content {
      grid-area: content;
      overflow: auto;
    }
    /* The find bar of the active tab, between the toolbar and the page. */
    .find {
      grid-area: find;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-1);
      padding: 2px var(--space-2);
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
    .bookmarks button:hover {
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
    /* While a tab is dragged, the others make room for it, and it has its own surface. */
    .tabs[data-dragging] .tab:not([data-dragged]) {
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
    /* Tabs that closed, while they fade where they were. */
    .ghosts {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
    }
    .ghosts > .tab {
      position: absolute;
    }
    :host([data-tabs='bottom']) [role='tablist'] {
      padding: 0 var(--space-2) var(--space-1);
      border-top: 1px solid var(--line-1);
    }
    [aria-orientation='vertical'] {
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
    /* A click next to a popover of the overlay closes it instead of moving the window. */
    :host([data-titlebar][data-covered]) .top-row {
      -webkit-app-region: no-drag;
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
  /** The insets last sent to the browser. */
  private reportedInsets = '';
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
        /** The units of the strip when the drag started, in their order. */
        readonly units: readonly StripUnit[];
        readonly pointer: number;
        readonly start: number;
        /** Where each item of the strip was along the strip, by its key. */
        readonly spans: ReadonlyMap<string, Span>;
        /** The space between two items of the strip. */
        readonly gap: number;
        /** How many items came before the dragged unit. */
        readonly index: number;
        moved: boolean;
        target: number;
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
      toolbar: ['bookmark', 'shield', 'downloads'],
      titleBar: null,
      covered: false,
    };
    this.drafts = new Map();
    this.addressFocused = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('mouseup', this.onMouseUp);
    this.windowControls = windowControls();
    this.windowControls?.addEventListener('geometrychange', this.placeTitleBar);
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
        else this.focusAddress();
      }),
    );
    void bridge.invoke('shell.getState', {}).then((state) => (this.state = state));
    this.resizeObserver = new ResizeObserver(() => {
      this.placeTitleBar();
      this.reportInsets();
      this.layoutBookmarksBar();
      this.placeIndicator(false);
      this.markHiddenTabs();
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
    this.windowControls?.removeEventListener('geometrychange', this.placeTitleBar);
    this.resizeObserver?.disconnect();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('state')) {
      this.settleOpening();
      this.dataset['tabs'] = this.state.tabStrip;
      // The shell keeps the icons of its tabs only.
      this.favicons.keep(this.state.tabs.flatMap((tab) => tab.favicon ?? []));
      this.toggleAttribute('data-covered', this.state.covered);
      this.placeTitleBar();
      // Tabs move from where they were, unless the whole strip moved to another side.
      const before = changed.get('state');
      if (
        this.hasUpdated &&
        this.dragging?.moved !== true &&
        before?.tabStrip === this.state.tabStrip
      ) {
        this.measureTabs();
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
      if (this.dragging?.moved !== true) {
        // The surface learns where the active tab goes before the tabs start to move there.
        this.placeIndicator(true);
        this.animateTabs();
      }
      this.markHiddenTabs();
      this.reportInsets();
      this.layoutBookmarksBar();
      this.takeFindFocus();
      this.takeDownloadsOpening();
    }
    if (changed.has('state')) this.dropStaleDrafts();
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
      if (active?.url === newTabUrl && !keepsInput) {
        this.focusAddress();
      }
    }
    if (changed.has('state')) this.openedWithInput = undefined;
  }

  protected override render(): TemplateResult {
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    const active = this.active;
    const vertical = this.state.tabStrip === 'left' || this.state.tabStrip === 'right';
    return html`
      <div
        role="tablist"
        class=${this.state.tabStrip === 'top' ? 'top-row' : ''}
        aria-label=${t('shell.tabs')}
        aria-orientation=${vertical ? 'vertical' : 'horizontal'}
      >
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
            (item) => this.renderTab(item.tab, t),
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
      </div>
      <nav class=${this.state.tabStrip === 'top' ? '' : 'top-row'} aria-label=${t('shell.toolbar')}>
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
          item === 'bookmark'
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
        <button
          class="icon menu-button"
          title=${t('shell.menu')}
          aria-label=${t('shell.menu')}
          aria-haspopup="menu"
          @click=${this.openMenu}
        >
          ${icons.menu}
        </button>
        ${active?.loading === true ? html`<div class="progress" aria-hidden="true"></div>` : nothing}
      </nav>
      ${this.renderBookmarksBar(t)} ${this.renderFind()}
      <div class="content">${active?.problem ? this.renderProblem(active) : nothing}</div>
    `;
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
        tabindex=${selected ? 0 : -1}
        aria-selected=${selected ? 'true' : 'false'}
        aria-label=${title}
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
    const units = unitsOf(stripItems(this.state));
    const unit = units.find((candidate) => candidate.includes(id)) ?? [id];
    this.dragging = {
      id,
      unit,
      units,
      pointer: event.pointerId,
      start: vertical ? event.clientY : event.clientX,
      spans: new Map(
        elements.map((element) => [
          element.dataset['id'] ?? '',
          spanOf(element.getBoundingClientRect(), vertical),
        ]),
      ),
      gap: this.tabGap(),
      index: elements.findIndex((element) => element.dataset['id'] === unit[0]),
      moved: false,
      target: -1,
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
    const place = dropPlace(drag.units, drag.unit, offset, drag.spans, drag.gap);
    if (place === undefined) return;
    drag.target = place.index;
    for (const element of this.stripElements()) {
      const key = element.dataset['id'] ?? '';
      if (!drag.spans.has(key)) continue;
      const dragged = drag.unit.includes(key);
      const shift = dragged ? offset : (place.shifts.get(key) ?? 0);
      element.toggleAttribute('data-dragged', dragged);
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
    if (event.type === 'pointerup' && drag.target !== -1 && drag.target !== drag.index) {
      this.dropPending = true;
      void this.bridge?.invoke('tabs.move', { tabId: drag.id, index: drag.target });
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
   * their address bar did not have the focus.
   */
  private dropStaleDrafts(): void {
    const moved = new Set<string>();
    for (const tab of this.state.tabs) {
      const before = this.addresses.get(tab.id);
      if (before !== undefined && before !== tab.url) moved.add(tab.id);
      this.addresses.set(tab.id, tab.url);
    }
    for (const id of this.addresses.keys()) {
      if (!this.hasTab(id)) this.addresses.delete(id);
    }
    // While a new tab opens, the address bar edits what is typed for that tab.
    const editing =
      this.addressFocused && this.opening === undefined ? this.state.activeTabId : null;
    const stale = [...this.drafts.keys()].filter(
      (id) => !this.hasTab(id) || (moved.has(id) && id !== editing),
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
            inputOf(e)?.select();
          }}
          @input=${(e: InputEvent) => {
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

  /**
   * Opens the menu of a folder of the bookmarks bar below the clicked button.
   * @param event - The click.
   * @param id - The folder.
   * @param from - How many of the folder's first entries the menu leaves out.
   */
  private openFolderMenu(event: MouseEvent, id: number, from: number): void {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) {
      const rect = button.getBoundingClientRect();
      void this.bridge?.invoke('shell.openBookmarkFolder', {
        id,
        from,
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
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
      const rect = button.getBoundingClientRect();
      void this.bridge?.invoke('shell.openBlockerPopover', {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
  };

  /** Opens the browser menu below the button. */
  /** The star that bookmarks a web page; the browser's own pages have none. */
  private renderBookmarkButton(active: TabView | undefined): TemplateResult | typeof nothing {
    const t = this.tp.bind(this);
    return active === undefined || !/^https?:/i.test(active.url)
      ? nothing
      : html`<button
          class="icon bookmark"
          title=${t('shell.bookmark')}
          aria-label=${t('shell.bookmark')}
          aria-pressed=${active.bookmarked ? 'true' : 'false'}
          @click=${() => void this.bridge?.invoke('shell.toggleBookmark', {})}
        >
          ${icons.star}
        </button>`;
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
      @click=${(event: MouseEvent) => this.openDownloads(event.currentTarget)}
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
      this.openDownloads(this.renderRoot.querySelector('.menu-button'));
      return;
    }
    this.downloadsPending = true;
    this.takeDownloadsOpening();
  }

  private takeDownloadsOpening(): void {
    const button = this.renderRoot.querySelector('.downloads');
    if (!this.downloadsPending || button === null) return;
    this.downloadsPending = false;
    this.openDownloads(button);
  }

  private openDownloads(button: EventTarget | null): void {
    if (!(button instanceof HTMLElement)) return;
    const rect = button.getBoundingClientRect();
    void this.bridge?.invoke('shell.openDownloads', {
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  private readonly openMenu = (event: MouseEvent): void => {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) {
      const rect = button.getBoundingClientRect();
      void this.bridge?.invoke('shell.openMenu', {
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
      });
    }
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

  /** What the active tab shows when it has no page: why, and the ways on from there. */
  private renderProblem(tab: TabView): TemplateResult | typeof nothing {
    const problem = tab.problem;
    if (problem === null) return nothing;
    const site = hostOf(problem.url);
    if (problem.kind === 'certificate') {
      return html`<section class="problem" aria-labelledby="problem-title">
        <h1 id="problem-title">${this.tp('problem.certificateTitle')}</h1>
        <p>${this.tp('problem.certificate', { site })}</p>
        <p class="code">${this.tp('problem.code', { code: problem.code })}</p>
        ${
          tab.canGoBack
            ? html`<button @click=${() => this.action('back')}>${this.tp('problem.back')}</button>`
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
      return html`<section class="problem" aria-labelledby="problem-title">
        <h1 id="problem-title">${this.tp('problem.insecureTitle')}</h1>
        <p>${this.tp('problem.insecure', { site })}</p>
        <p class="code">${this.tp('problem.code', { code: problem.code })}</p>
        ${
          tab.canGoBack
            ? html`<button @click=${() => this.action('back')}>${this.tp('problem.back')}</button>`
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
    return html`<section class="problem" aria-labelledby="problem-title">
      <h1 id="problem-title">
        ${this.tp(crashed ? 'problem.crashedTitle' : 'problem.errorTitle')}
      </h1>
      <p>${this.tp(crashed ? 'problem.crashed' : problemMessage(problem.code), { site })}</p>
      <p class="code">${this.tp('problem.code', { code: problem.code })}</p>
      <button @click=${() => this.action('reload')}>
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

  private action(action: 'back' | 'forward' | 'reload' | 'stop' | 'home'): void {
    const tabId = this.state.activeTabId;
    if (tabId !== null) {
      void this.bridge?.invoke('tabs.action', { tabId, action });
    }
  }

  /** The mouse's back and forward buttons act on the active tab, as they do over its page. */
  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      this.action(event.button === 3 ? 'back' : 'forward');
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
      this.setDraft(undefined);
      input.value = displayUrl(this.addressTab?.url);
      input.select();
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

  /** Tells the browser where the content area is, so the page covers exactly that area. */
  private reportInsets(): void {
    const content = this.renderRoot.querySelector('.content')?.getBoundingClientRect();
    if (content === undefined) {
      return;
    }
    const insets = {
      top: Math.round(content.top),
      right: Math.round(window.innerWidth - content.right),
      bottom: Math.round(window.innerHeight - content.bottom),
      left: Math.round(content.left),
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
