import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { newTabUrl } from '../../shared/internal-pages.ts';
import type { BarItem, ShellState, TabView } from '../../shared/ipc/shell-contracts.ts';
import type { Translator } from '../i18n/i18n.ts';
import type { ShellBridge } from './bridge.ts';

/**
 * The browser shell: tab strip, navigation buttons and the address bar. It renders the
 * state that the browser process sends and reports the space it needs, so web content
 * fills the rest of the window.
 */
export class AppShell extends LitElement {
  static override properties = {
    state: { state: true },
    editing: { state: true },
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
      grid-template: 'tabs' auto 'nav' auto 'bar' auto 'content' 1fr / 1fr;
      background: var(--surface-0);
      user-select: none;
    }
    :host([data-tabs='bottom']) {
      grid-template: 'nav' auto 'bar' auto 'content' 1fr 'tabs' auto / 1fr;
    }
    :host([data-tabs='left']) {
      grid-template:
        'nav nav' auto 'bar bar' auto 'tabs content' 1fr / var(--sidebar-width, 240px)
        1fr;
    }
    :host([data-tabs='right']) {
      grid-template:
        'nav nav' auto 'bar bar' auto 'content tabs' 1fr / 1fr
        var(--sidebar-width, 240px);
    }
    .content {
      grid-area: content;
    }
    /* The bookmarks bar belongs to the toolbar: the line below the toolbar moves below it. */
    nav:has(+ .bookmarks) {
      border-bottom: 0;
    }
    .bookmarks {
      grid-area: bar;
      border-bottom: 1px solid var(--border-1);
      background: var(--surface-1);
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      height: 28px;
      padding: 0 var(--space-2);
      overflow: hidden;
      font-size: 12px;
    }
    .bookmarks button {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      flex: none;
      max-width: 180px;
      height: 24px;
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
      overflow-x: auto;
      scrollbar-width: none;
    }
    :host([data-tabs='bottom']) [role='tablist'] {
      padding: 0 var(--space-2) var(--space-1);
      border-top: 1px solid var(--border-1);
    }
    [aria-orientation='vertical'] {
      flex-direction: column;
      height: auto;
      min-height: 0;
      padding: var(--space-2);
      overflow: hidden auto;
    }
    :host([data-tabs='left']) [role='tablist'] {
      border-right: 1px solid var(--border-1);
    }
    :host([data-tabs='right']) [role='tablist'] {
      border-left: 1px solid var(--border-1);
    }
    [aria-orientation='vertical'] .tab {
      flex: none;
      height: var(--tab-height);
      border-radius: var(--radius-1);
    }
    :host([data-tabs='bottom']) .tab {
      border-radius: 0 0 var(--radius-1) var(--radius-1);
    }
    .tab {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      min-width: 0;
      flex: 0 1 220px;
      padding: 0 var(--space-1) 0 var(--space-3);
      border: 0;
      border-radius: var(--radius-1) var(--radius-1) 0 0;
      background: transparent;
      color: var(--text-2);
      font: inherit;
      text-align: start;
    }
    .tab:hover {
      background: var(--surface-hover);
    }
    .tab[aria-selected='true'] {
      background: var(--surface-1);
      color: var(--text-1);
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .loading {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      flex: none;
    }
    button {
      cursor: default;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
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
    .icon:disabled {
      opacity: 0.4;
    }
    .close {
      width: 24px;
      height: 24px;
    }
    .blocker {
      position: relative;
      width: auto;
      min-width: 28px;
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
    .bookmark[aria-pressed='true'] svg {
      color: var(--accent);
      fill: currentColor;
    }
    .count {
      font-size: 11px;
      line-height: 16px;
      color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }
    nav {
      grid-area: nav;
      border-bottom: 1px solid var(--border-1);
      display: flex;
      align-items: center;
      gap: var(--space-1);
      height: var(--toolbar-height);
      padding: 0 var(--space-2);
      background: var(--surface-1);
    }
    input {
      flex: 1;
      min-width: 0;
      height: 28px;
      padding: 0 var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-0);
      color: var(--text-1);
      font: inherit;
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
  declare editing: string | undefined;
  bridge: ShellBridge | undefined;
  i18n: Translator | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private unsubscribers: (() => void)[] = [];
  /** The active tab that the shell last handled focus for. */
  private focusedTabId: string | undefined;
  /** The insets last sent to the browser. */
  private reportedInsets = '';

  constructor() {
    super();
    this.state = { tabs: [], activeTabId: null, tabStrip: 'top', bookmarksBar: null };
    this.editing = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('mouseup', this.onMouseUp);
    const bridge = this.bridge;
    if (bridge === undefined) {
      return;
    }
    this.unsubscribers.push(
      bridge.on('shell.stateChanged', (state) => (this.state = state)),
      bridge.on('shell.command', () => this.focusAddress()),
    );
    void bridge.invoke('shell.getState', {}).then((state) => (this.state = state));
    this.resizeObserver = new ResizeObserver(() => this.reportInsets());
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('mouseup', this.onMouseUp);
    this.resizeObserver?.disconnect();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('state')) {
      this.dataset['tabs'] = this.state.tabStrip;
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('state')) {
      this.reportInsets();
    }
    if (changed.has('state') && this.active === undefined) {
      this.editing = undefined;
    }
    // A tab that becomes active on the new tab page waits for input in the address bar.
    const active = this.active;
    if (changed.has('state') && active?.id !== this.focusedTabId) {
      this.focusedTabId = active?.id;
      if (active?.url === newTabUrl) {
        this.focusAddress();
      }
    }
  }

  protected override render(): TemplateResult {
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    const active = this.active;
    const vertical = this.state.tabStrip === 'left' || this.state.tabStrip === 'right';
    return html`
      <div
        role="tablist"
        aria-label=${t('shell.tabs')}
        aria-orientation=${vertical ? 'vertical' : 'horizontal'}
      >
        ${this.state.tabs.map((tab) => this.renderTab(tab, t))}
        <button
          class="icon"
          title=${t('shell.newTab')}
          aria-label=${t('shell.newTab')}
          @click=${this.newTab}
        >
          ${icons.plus}
        </button>
      </div>
      <nav aria-label=${t('shell.toolbar')}>
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
        <input
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label=${t('shell.address')}
          placeholder=${t('shell.addressPlaceholder')}
          .value=${this.editing ?? displayUrl(active?.url)}
          @focus=${(e: FocusEvent) => inputOf(e)?.select()}
          @input=${(e: InputEvent) => (this.editing = inputOf(e)?.value)}
          @keydown=${this.onAddressKey}
          @blur=${() => (this.editing = undefined)}
        />
        ${
          active === undefined || !/^https?:/i.test(active.url)
            ? nothing
            : html`<button
                class="icon bookmark"
                title=${t('shell.bookmark')}
                aria-label=${t('shell.bookmark')}
                aria-pressed=${active.bookmarked ? 'true' : 'false'}
                @click=${() => void this.bridge?.invoke('shell.toggleBookmark', {})}
              >
                ${icons.star}
              </button>`
        }
        ${
          active === undefined || active.blocking === 'none'
            ? nothing
            : html`<button
                class="icon blocker"
                data-state=${active.blocking}
                title=${this.blockerLabel(active)}
                aria-label=${this.blockerLabel(active)}
                aria-haspopup="menu"
                @click=${this.openBlockerMenu}
              >
                ${active.blocking === 'on' ? icons.shield : icons.shieldOff}
                ${
                  active.blocking === 'on' && active.blocked > 0
                    ? html`<span class="count" aria-hidden="true"
                        >${active.blocked > 99 ? '99+' : active.blocked}</span
                      >`
                    : nothing
                }
              </button>`
        }
        <button
          class="icon"
          title=${t('shell.menu')}
          aria-label=${t('shell.menu')}
          aria-haspopup="menu"
          @click=${this.openMenu}
        >
          ${icons.menu}
        </button>
      </nav>
      ${this.renderBookmarksBar(t)}
      <div class="content"></div>
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
        tabindex=${selected ? 0 : -1}
        aria-selected=${selected ? 'true' : 'false'}
        title=${title}
        @click=${() => void this.bridge?.invoke('tabs.activate', { tabId: tab.id })}
        @auxclick=${(e: MouseEvent) => e.button === 1 && this.close(tab.id)}
      >
        ${tab.loading ? html`<span class="loading" role="img" aria-label=${t('shell.loading')}></span>` : nothing}
        <span class="title">${title}</span>
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

  private renderBookmarksBar(
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult | typeof nothing {
    const items = this.state.bookmarksBar;
    if (items === null) return nothing;
    return html`<div class="bookmarks" role="toolbar" aria-label=${t('shell.bookmarksBar')}>
      ${
        items.length === 0
          ? html`<span class="hint">${t('shell.bookmarksBarEmpty')}</span>`
          : items.map((item) => this.renderBarItem(item))
      }
    </div>`;
  }

  private renderBarItem(item: BarItem): TemplateResult {
    const url = item.url;
    if (url === null) {
      return html`<button
        aria-haspopup="menu"
        @click=${(event: MouseEvent) => this.openBarFolder(event, item.id)}
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

  /** Opens the menu of a folder of the bookmarks bar below its button. */
  private openBarFolder(event: MouseEvent, id: number): void {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) {
      const rect = button.getBoundingClientRect();
      void this.bridge?.invoke('shell.openBookmarkFolder', {
        id,
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
      });
    }
  }

  private get active(): TabView | undefined {
    return this.state.tabs.find((tab) => tab.id === this.state.activeTabId);
  }

  private blockerLabel(tab: TabView): string {
    const params = { count: String(tab.blocked) };
    return (
      this.i18n?.t(tab.blocking === 'on' ? 'shell.blockerOn' : 'shell.blockerOff', params) ??
      'shell.blocker'
    );
  }

  /** Opens the content blocker's menu below its button. */
  private readonly openBlockerMenu = (event: MouseEvent): void => {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) {
      const rect = button.getBoundingClientRect();
      void this.bridge?.invoke('shell.openBlockerMenu', {
        x: Math.round(rect.left),
        y: Math.round(rect.bottom),
      });
    }
  };

  /** Opens the browser menu below the button. */
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

  private readonly newTab = (): void => {
    void this.bridge?.invoke('tabs.open', {});
  };

  private close(tabId: string): void {
    void this.bridge?.invoke('tabs.close', { tabId });
  }

  private action(action: 'back' | 'forward' | 'reload' | 'stop'): void {
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
    if (event.key === 'Escape') {
      this.editing = undefined;
      input.value = displayUrl(this.active?.url);
      input.select();
    }
    if (event.key !== 'Enter' || input.value.trim() === '') {
      return;
    }
    const tabId = this.state.activeTabId;
    void (tabId === null
      ? this.bridge?.invoke('tabs.open', { input: input.value })
      : this.bridge?.invoke('tabs.navigate', { tabId, input: input.value }));
    this.editing = undefined;
    input.blur();
  };

  private focusAddress(): void {
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

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

function inputOf(event: Event): HTMLInputElement | undefined {
  return event.target instanceof HTMLInputElement ? event.target : undefined;
}

function displayUrl(url: string | undefined): string {
  return url === undefined || url === 'about:blank' || url === newTabUrl ? '' : url;
}

/** Icons drawn after Lucide (ISC license), inlined so the shell needs no icon requests. */
const icons = {
  plus: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>`,
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
  shield: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.7 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"
    />
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
  menu: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>`,
};
