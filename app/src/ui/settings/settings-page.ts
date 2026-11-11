import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { bangs } from '../../shared/bangs.ts';
import { searchEngines, type CustomSearchEngine } from '../../shared/search-engines.ts';
import { secureDnsProviders, secureDnsTemplatesPattern } from '../../shared/secure-dns.ts';
import { displayShortcut, windowCommands, type WindowCommand } from '../../shared/shortcuts.ts';
import { toolbarItems, type ToolbarItem } from '../../shared/layout.ts';
import { webTextSizes } from '../../shared/web-text-sizes.ts';
import { zoomFactors } from '../../shared/zoom.ts';
import { catalogs, isMessageKey, Translator, type MessageKey } from '../i18n/i18n.ts';
import { choiceStyles } from '../ui-kit/choice-styles.ts';
import {
  SettingsClient,
  paintSwatches,
  type PageBridge,
  type SettingView,
} from '../ui-kit/settings-client.ts';

/** Options of a choice between a few values. */
const choices = {
  'appearance.colorMode': ['system', 'light', 'dark'],
  'appearance.density': ['compact', 'normal', 'comfortable'],
  'appearance.textSize': ['small', 'medium', 'large', 'larger'],
  'tabs.position': ['top', 'bottom', 'left', 'right'],
  'startup.page': ['restore', 'newtab', 'pages'],
} as const;

/**
 * The settings page: every setting that has a place on it, grouped in sections. Changes
 * apply at once; values that a policy sets are shown but cannot be changed.
 */
export class SettingsPage extends LitElement {
  static override properties = {
    revision: { state: true },
    searchError: { state: true },
    fontError: { state: true },
    pageError: { state: true },
    engineError: { state: true },
    tileError: { state: true },
    shortcuts: { state: true },
    recording: { state: true },
    shortcutNote: { state: true },
    dnsError: { state: true },
    customDns: { state: true },
    dataCleared: { state: true },
    homeError: { state: true },
    webFontError: { state: true },
    customSearch: { state: true },
    blockerFailed: { state: true },
    siteError: { state: true },
    query: { state: true },
    current: { state: true },
    changedOnly: { state: true },
    message: { state: true },
  };

  /** Styles of the page, scoped to its shadow root. */
  static override styles = [
    choiceStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: 176px minmax(0, 720px);
        justify-content: center;
        column-gap: var(--space-6);
        box-sizing: border-box;
        padding: var(--space-3) var(--space-3) var(--space-7);
      }
      nav {
        position: sticky;
        top: var(--space-3);
        align-self: start;
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 112px;
      }
      /* A link moves the focus to a heading; it needs no frame there. */
      h2:focus {
        outline: none;
      }
      nav button {
        border: none;
        background: none;
        color: var(--text-2);
        text-align: start;
      }
      nav button[aria-current='true'] {
        background: var(--surface-hover);
        color: var(--text-1);
        font-weight: 600;
      }
      @media (max-width: 760px) {
        :host {
          grid-template-columns: minmax(0, 1fr);
        }
        nav {
          display: none;
        }
      }
      input[type='search'] {
        width: 100%;
        box-sizing: border-box;
        height: var(--control-large);
        padding: 0 var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-0);
        color: var(--text-1);
        font: inherit;
      }
      .empty {
        margin: var(--space-3) 0;
        color: var(--text-2);
      }
      .slot + .slot {
        border-top: 1px solid var(--border-1);
      }
      .slot {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
      }
      .slot > :not(.reset) {
        grid-column: 1;
      }
      .slot > .reset {
        grid-column: 2;
        grid-row: 1;
        margin-right: var(--space-3);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin: var(--space-2) 0 0;
      }
      .actions button[aria-pressed='true'] {
        border-color: var(--accent);
        color: var(--accent);
      }
      .message {
        margin: var(--space-2) 0 0;
        color: var(--text-2);
      }
      .fonts {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--space-2) var(--space-3);
      }
      .font {
        display: grid;
        gap: var(--space-1);
        color: var(--text-2);
        font-size: var(--font-size-small);
      }
      .font input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
      }
      .path {
        overflow-wrap: anywhere;
      }
      .toolbar-items li {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .toolbar-items .buttons {
        display: flex;
        gap: var(--space-1);
      }
      .keyword {
        color: var(--text-2);
        font-family: ui-monospace, monospace;
        font-size: var(--font-size-small);
      }
      .engines li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(8em, auto) 6em;
        align-items: center;
        gap: var(--space-2);
      }
      .engines li button {
        justify-self: end;
      }
      .shortcut .label {
        flex: 1;
      }
      .shortcut .keys {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        justify-content: flex-end;
      }
      .shortcut kbd {
        font: inherit;
        font-size: var(--font-size-small);
        padding: 0 var(--space-1);
        border: 1px solid var(--border);
        border-radius: var(--radius-1);
        background: var(--surface-2);
      }
      #clear-data form {
        display: grid;
        gap: var(--space-2);
      }
      #clear-data h3 {
        margin: 0;
        font-size: var(--font-size-large);
      }
      #clear-data .field {
        display: grid;
        gap: var(--space-1);
      }
      #clear-data .check {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .add-tile {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
        gap: var(--space-2);
      }
      .add-tile input {
        min-width: 0;
      }
      .add-engine {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 0.6fr) minmax(0, 2fr) auto;
        gap: var(--space-2);
      }
      .add-engine input {
        min-width: 0;
      }
      .bangs {
        padding: 0 var(--space-3) var(--space-2);
        color: var(--text-2);
      }
      .bangs ul {
        columns: 2;
        margin: var(--space-2) 0 0;
        padding: 0;
        list-style: none;
      }
      /* The hint stays in view at the bottom while the page scrolls. */
      .restart {
        position: sticky;
        bottom: var(--space-3);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin: var(--space-3) 0 0;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-2);
        background: var(--surface-1);
      }
      .lock {
        width: 12px;
        height: 12px;
        margin-right: var(--space-1);
        vertical-align: -1px;
      }
      dialog {
        max-width: 420px;
        border: 1px solid var(--border-1);
        border-radius: var(--radius-2);
        background: var(--surface-1);
        color: var(--text-1);
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 30%);
      }
      dialog .buttons {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
      }
      dialog .primary,
      .restart .primary {
        border-color: var(--accent);
        background: var(--accent);
        color: var(--on-accent, #fff);
      }
      h1 {
        margin: var(--space-5) 0 var(--space-4);
        font-size: var(--font-size-title);
        line-height: var(--line-height-title);
        font-weight: 600;
      }
      h2 {
        margin: var(--space-5) 0 var(--space-2);
        font-size: var(--font-size-large);
        line-height: var(--line-height-large);
        font-weight: 600;
        color: var(--text-2);
      }
      .intro {
        margin: 0 0 var(--space-3);
        color: var(--text-2);
      }
      section {
        border: 1px solid var(--border-1);
        border-radius: var(--radius-2);
        background: var(--surface-1);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        min-height: var(--row-height);
        padding: var(--space-2) var(--space-3);
        box-sizing: border-box;
      }
      .row + .row {
        border-top: 1px solid var(--border-1);
      }
      .label {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .note {
        color: var(--text-2);
        font-size: var(--font-size-small);
        line-height: var(--line-height-ui);
      }
      .problem {
        color: var(--danger);
      }
      .error {
        color: var(--danger);
        font-size: var(--font-size-small);
        line-height: var(--line-height-ui);
      }
      select,
      input[type='url'],
      input[type='text'],
      button {
        height: var(--control-large);
        padding: 0 var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-0);
        color: var(--text-1);
        font: inherit;
      }
      button {
        padding: 0 var(--space-3);
      }
      button:hover {
        background: var(--surface-hover);
      }
      input[type='url'] {
        width: 100%;
        box-sizing: border-box;
      }
      .stack {
        flex-direction: column;
        align-items: stretch;
      }
      .sites {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .sites li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        padding: var(--space-1) 0;
      }
      .permissions li {
        flex-direction: column;
        align-items: stretch;
      }
      .permissions .site {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .permission {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .permission > span {
        flex: 1;
      }
      .add-site {
        display: flex;
        gap: var(--space-2);
      }
      .add-site input {
        flex: 1;
      }
      input[role='switch'] {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: var(--accent);
      }
      :focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
    `,
  ];

  declare revision: number;
  declare searchError: boolean;
  /** Whether the last font name was not one. */
  declare fontError: boolean;
  /** Whether the last page to add at start was not a web address. */
  declare pageError: boolean;
  /** Whether the last search engine to add was not valid. */
  declare engineError: boolean;
  /** Whether the last tile to add had no web address. */
  declare tileError: boolean;
  /** The shortcuts of every command, as the window uses them, once loaded. */
  declare shortcuts: ShortcutList | undefined;
  /** The command whose new shortcut the page waits for. */
  declare recording: WindowCommand | undefined;
  /** Why the last shortcut was not taken, or which command it would take it from. */
  declare shortcutNote: ShortcutNote | undefined;
  /** Whether the address of a DNS over HTTPS service was not valid. */
  declare dnsError: boolean;
  /** Whether the field for the address of another DNS over HTTPS service shows. */
  declare customDns: boolean;
  /** Whether the browsing data was just cleared. */
  declare dataCleared: boolean;
  /** Whether the last home page was not a web address. */
  declare homeError: boolean;
  /** Whether the last name of a font for web pages was not one. */
  declare webFontError: boolean;
  declare customSearch: boolean;
  /** Whether the content blocker has no usable filter data. */
  declare blockerFailed: boolean;
  /** Whether the last site to add was not a site name. */
  declare siteError: boolean;
  /** What the search field holds. */
  declare query: string;
  /** The section in view, which the navigation marks. */
  declare current: string;
  /** Whether the page shows only the settings that differ from their defaults. */
  declare changedOnly: boolean;
  /** The outcome of the last import, if it needs telling. */
  declare message: { readonly alert: boolean; readonly text: string } | undefined;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private client: SettingsClient | undefined;
  /** Stops listening for recorded shortcuts. */
  private unsubscribeShortcuts: (() => void) | undefined;
  /** The value of the shortcut setting, as JSON, that the shortcuts were loaded for. */
  private shortcutsLoaded: string | undefined;
  /** The toolbar button that moved, to focus again once the list shows its new place. */
  private toolbarFocus:
    { readonly item: ToolbarItem; readonly index: number; readonly step: -1 | 1 } | undefined;

  constructor() {
    super();
    this.revision = 0;
    this.searchError = false;
    this.fontError = false;
    this.pageError = false;
    this.engineError = false;
    this.tileError = false;
    this.shortcuts = undefined;
    this.recording = undefined;
    this.shortcutNote = undefined;
    this.dnsError = false;
    this.customDns = false;
    this.dataCleared = false;
    this.homeError = false;
    this.webFontError = false;
    this.customSearch = false;
    this.blockerFailed = false;
    this.siteError = false;
    this.query = '';
    this.current = 'appearance';
    this.changedOnly = false;
    this.message = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.bridge === undefined) {
      return;
    }
    this.unsubscribeShortcuts = this.bridge.on(
      'settings.shortcutRecorded',
      (payload) => void this.takeShortcut(payload),
    );
    this.client = new SettingsClient(this.bridge, () => {
      this.revision += 1;
      // The shortcuts depend on the setting and on the defaults of the system.
      this.loadShortcuts();
    });
    void this.client.load().then(() => {
      this.customSearch = this.engineId() === 'custom';
      this.reveal(location.hash);
      document.documentElement.dataset['ready'] = 'true';
    });
    addEventListener('hashchange', this.onHashChange);
    void this.bridge
      .invoke('settings.getBlockerStatus', {})
      .then((result) => {
        this.blockerFailed =
          typeof result === 'object' &&
          result !== null &&
          Reflect.get(result, 'status') === 'failed';
      })
      .catch(() => undefined);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeShortcuts?.();
    removeEventListener('hashchange', this.onHashChange);
    this.spy?.disconnect();
    this.client?.dispose();
  }

  protected override updated(): void {
    this.focusMovedToolbarItem();
    paintSwatches(this.renderRoot, this.client?.accents ?? []);
    // The navigation marks the section whose heading is in the upper part of the window.
    this.spy?.disconnect();
    this.spy = new IntersectionObserver(
      (entries) => {
        const shown = entries.find((entry) => entry.isIntersecting);
        if (shown !== undefined) this.current = shown.target.id;
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    for (const heading of this.renderRoot.querySelectorAll('h2')) this.spy.observe(heading);
  }

  private spy: IntersectionObserver | undefined;

  /** The button that sets a changed setting back to its default. */
  private renderReset(row: PageRow): TemplateResult | typeof nothing {
    const title = row.keys[0];
    if (this.client?.get(row.id)?.changed !== true || title === undefined) return nothing;
    return html`<button
      type="button"
      class="reset"
      aria-label=${this.t('settings.resetOne', { setting: this.t(title) })}
      @click=${() => void this.bridge?.invoke('settings.reset', { keys: [row.id] })}
    >
      ${this.t('settings.resetShort')}
    </button>`;
  }

  /** Sets every setting that differs from its default back, after the question. */
  private async resetAll(): Promise<void> {
    this.renderRoot.querySelector('dialog')?.close();
    const keys = this.sections()
      .flatMap((section) => section.rows)
      .map((row) => row.id)
      .filter((id) => this.client?.get(id)?.changed === true);
    await this.bridge?.invoke('settings.reset', { keys });
  }

  private async exportFile(): Promise<void> {
    this.message = undefined;
    await this.bridge?.invoke('settings.export', {});
  }

  private async importFile(): Promise<void> {
    this.message = undefined;
    const result: unknown = await this.bridge?.invoke('settings.import', {});
    if (typeof result !== 'object' || result === null) return;
    if (Reflect.get(result, 'ok') === true) {
      const count = String(Reflect.get(result, 'applied'));
      const skipped = Number(Reflect.get(result, 'skipped'));
      this.message = {
        alert: false,
        text:
          skipped > 0
            ? this.t('settings.importSkipped', { count, skipped: String(skipped) })
            : this.t('settings.importDone', { count }),
      };
    } else if (Reflect.get(result, 'error') === 'invalid') {
      this.message = { alert: true, text: this.t('settings.importInvalid') };
    }
  }

  /** The note of a value that the organization sets or suggests, or else nothing. */
  private managedNote(setting: SettingView | undefined): TemplateResult | typeof nothing {
    if (setting?.locked === true) {
      return html`<span class="note">${lockIcon}${this.t('settings.managed')}</span>`;
    }
    if (setting?.recommended === true) {
      return html`<span class="note">${this.t('settings.recommended')}</span>`;
    }
    return nothing;
  }

  private readonly onHashChange = (): void => this.reveal(location.hash);

  /**
   * Shows a section or a setting that a link names, such as `#tabs.position`, and gives the
   * focus to its first control. The name is only looked up, never put into the page.
   * @param hash - The fragment of the page's address.
   */
  private reveal(hash: string): void {
    let id = '';
    try {
      id = decodeURIComponent(hash.replace(/^#/, ''));
    } catch {
      return;
    }
    if (id === '') return;
    // A search could hide what the link names.
    this.query = '';
    void this.updateComplete.then(() => {
      const root = this.renderRoot;
      const row = root.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`);
      const heading = root.querySelector<HTMLElement>(`h2[id="${CSS.escape(id)}"]`);
      const target = row ?? heading;
      if (target === null) return;
      target.scrollIntoView({ block: 'start' });
      const control = row?.querySelector<HTMLElement>('input, select, button') ?? target;
      control.focus({ preventScroll: true });
      if (heading !== null) this.current = id;
    });
  }

  /** The sections of the page with their rows, and the words that find each row. */
  private sections(): readonly PageSection[] {
    const t = this.t;
    return [
      {
        id: 'appearance',
        title: 'settings.appearance',
        rows: [
          {
            id: 'appearance.colorMode',
            keys: [
              'settings.colorMode',
              'settings.colorMode.keywords',
              ...optionKeys('appearance.colorMode', 'settings.colorMode'),
            ],
            render: () => this.renderChoice('appearance.colorMode', 'settings.colorMode'),
          },
          { id: 'appearance.accent', keys: ['settings.accent'], render: () => this.renderAccent() },
          {
            id: 'appearance.density',
            keys: [
              'settings.density',
              'settings.density.keywords',
              ...optionKeys('appearance.density', 'settings.density'),
            ],
            render: () => this.renderChoice('appearance.density', 'settings.density'),
          },
          {
            id: 'appearance.textSize',
            keys: [
              'settings.textSize',
              'settings.textSize.keywords',
              ...optionKeys('appearance.textSize', 'settings.textSize'),
            ],
            render: () => this.renderChoice('appearance.textSize', 'settings.textSize'),
          },
          {
            id: 'appearance.font',
            keys: ['settings.font', 'settings.fontNote', 'settings.font.keywords'],
            render: () => this.renderFont(),
          },
          {
            id: 'fonts.size',
            keys: [
              'settings.webTextSize',
              'settings.webTextSizeNote',
              'settings.webTextSize.keywords',
              'settings.webTextSize.9',
              'settings.webTextSize.12',
              'settings.webTextSize.16',
              'settings.webTextSize.20',
              'settings.webTextSize.24',
            ],
            render: () => this.renderWebTextSize(),
          },
          {
            id: 'fonts.web',
            keys: [
              'settings.webFonts',
              'settings.webFontsNote',
              'settings.webFonts.keywords',
              'settings.webFont.standard',
              'settings.webFont.serif',
              'settings.webFont.sansSerif',
              'settings.webFont.fixed',
            ],
            render: () => this.renderWebFonts(),
          },
          {
            id: 'zoom.default',
            keys: ['settings.pageZoom', 'settings.pageZoomNote', 'settings.pageZoom.keywords'],
            render: () => this.renderPageZoom(),
          },
          {
            id: 'toolbar.items',
            keys: [
              'settings.toolbar',
              'settings.toolbarNote',
              'settings.toolbar.keywords',
              'settings.toolbar.bookmark',
              'settings.toolbar.shield',
              'settings.toolbar.downloads',
            ],
            render: () => this.renderToolbar(),
          },
          {
            id: 'tabs.position',
            keys: [
              'settings.tabPosition',
              'settings.tabPosition.keywords',
              ...optionKeys('tabs.position', 'settings.tabPosition'),
            ],
            render: () => this.renderChoice('tabs.position', 'settings.tabPosition'),
          },
          {
            id: 'bookmarks.bar',
            keys: ['settings.bookmarksBar', 'settings.bookmarksBarNote'],
            render: () =>
              this.renderToggle(
                'bookmarks.bar',
                'settings.bookmarksBar',
                'settings.bookmarksBarNote',
              ),
          },
        ],
      },
      {
        id: 'startup',
        title: 'settings.startup',
        rows: [
          {
            id: 'startup.page',
            keys: [
              'settings.startupPage',
              'settings.startupPage.keywords',
              ...optionKeys('startup.page', 'settings.startupPage'),
            ],
            render: () => this.renderChoice('startup.page', 'settings.startupPage'),
          },
          // The list shows when the browser opens specific pages at start.
          ...(this.client?.get('startup.page')?.value === 'pages'
            ? [
                {
                  id: 'startup.urls',
                  keys: ['settings.startupPages', 'settings.startupPagesNote'],
                  render: () => this.renderStartupPages(),
                } satisfies PageRow,
              ]
            : []),
          {
            id: 'home.button',
            keys: ['settings.homeButton', 'settings.homeButtonNote', 'settings.home.keywords'],
            render: () =>
              this.renderToggle('home.button', 'settings.homeButton', 'settings.homeButtonNote'),
          },
          {
            id: 'home.page',
            keys: ['settings.homePage', 'settings.homePageNote', 'settings.home.keywords'],
            render: () => this.renderHomePage(),
          },
        ],
      },
      {
        id: 'newtab',
        title: 'settings.newTab',
        rows: [
          {
            id: 'newtab.search',
            keys: ['settings.newTabSearch', 'settings.newTabSearchNote'],
            render: () =>
              this.renderToggle(
                'newtab.search',
                'settings.newTabSearch',
                'settings.newTabSearchNote',
              ),
          },
          {
            id: 'newtab.clock',
            keys: ['settings.newTabClock', 'settings.newTabClockNote'],
            render: () =>
              this.renderToggle('newtab.clock', 'settings.newTabClock', 'settings.newTabClockNote'),
          },
          {
            id: 'newtab.tiles',
            keys: ['settings.newTabTiles', 'settings.newTabTilesNote', 'settings.newTab.keywords'],
            render: () => this.renderTiles(),
          },
        ],
      },
      {
        id: 'downloads',
        title: 'settings.downloads',
        rows: [
          {
            id: 'downloads.folder',
            keys: [
              'settings.downloadFolder',
              'settings.downloadFolder.keywords',
              'settings.downloadFolderSystem',
            ],
            render: () => this.renderDownloadFolder(),
          },
          {
            id: 'downloads.ask',
            keys: ['settings.downloadAsk', 'settings.downloadAskNote'],
            render: () =>
              this.renderToggle(
                'downloads.ask',
                'settings.downloadAsk',
                'settings.downloadAskNote',
              ),
          },
        ],
      },
      {
        id: 'languages',
        title: 'settings.languages',
        rows: [
          {
            id: 'i18n.language',
            keys: [
              'settings.language',
              'settings.languageNote',
              'settings.language.keywords',
              'settings.language.system',
            ],
            words: Object.keys(catalogs).map((code) => languageName(code)),
            render: () => this.renderLanguage(),
          },
        ],
      },
      {
        id: 'search',
        title: 'settings.search',
        rows: [
          {
            id: 'search.urlTemplate',
            keys: ['settings.searchEngine', 'settings.searchEngine.keywords'],
            words: searchEngines.map((engine) => engine.name),
            render: () => this.renderSearch(),
          },
          {
            id: 'search.engines',
            keys: [
              'settings.searchEngines',
              'settings.searchEnginesNote',
              'settings.searchEngines.keywords',
            ],
            words: searchEngines.map((engine) => engine.keyword),
            render: () => this.renderSearchEngines(),
          },
          {
            id: 'search.bangs',
            keys: ['settings.bangs', 'settings.bangsNote'],
            words: bangs.map((site) => site.name),
            render: () => this.renderBangs(),
          },
        ],
      },
      {
        id: 'privacy',
        title: 'settings.privacy',
        rows: [
          {
            id: 'contentBlocker.enabled',
            keys: [
              'settings.contentBlocker',
              'settings.contentBlockerNote',
              'settings.contentBlocker.keywords',
            ],
            render: () =>
              html`${this.renderToggle(
                'contentBlocker.enabled',
                'settings.contentBlocker',
                'settings.contentBlockerNote',
              )}${
                this.blockerFailed
                  ? html`<p class="row note problem" role="alert">
                      ${t('settings.contentBlockerFailed')}
                    </p>`
                  : nothing
              }`,
          },
          {
            id: 'contentBlocker.cookieNotices',
            keys: [
              'settings.cookieNotices',
              'settings.cookieNoticesNote',
              'settings.contentBlocker.keywords',
            ],
            render: () =>
              this.renderToggle(
                'contentBlocker.cookieNotices',
                'settings.cookieNotices',
                'settings.cookieNoticesNote',
              ),
          },
          {
            id: 'contentBlocker.annoyances',
            keys: [
              'settings.annoyances',
              'settings.annoyancesNote',
              'settings.contentBlocker.keywords',
            ],
            render: () =>
              this.renderToggle(
                'contentBlocker.annoyances',
                'settings.annoyances',
                'settings.annoyancesNote',
              ),
          },
          {
            id: 'contentBlocker.allowedSites',
            keys: [
              'settings.allowedSites',
              'settings.allowedSitesNote',
              'settings.contentBlocker.keywords',
            ],
            render: () => this.renderAllowedSites(),
          },
          {
            id: 'privacy.httpsFirst',
            keys: [
              'settings.httpsFirst',
              'settings.httpsFirstNote',
              'settings.httpsFirst.keywords',
            ],
            render: () =>
              this.renderToggle(
                'privacy.httpsFirst',
                'settings.httpsFirst',
                'settings.httpsFirstNote',
              ),
          },
          {
            id: 'network.secureDns',
            keys: ['settings.secureDns', 'settings.secureDnsNote', 'settings.secureDns.keywords'],
            words: secureDnsProviders.map((provider) => provider.name),
            render: () => this.renderSecureDns(),
          },
          {
            id: 'clear-data',
            keys: ['settings.clearData', 'settings.clearDataNote', 'settings.clearData.keywords'],
            render: () => this.renderClearData(),
          },
          {
            id: 'permissions.sites',
            keys: [
              'settings.sitePermissions',
              'settings.sitePermissionsNote',
              'settings.sitePermissions.keywords',
            ],
            render: () => this.renderSitePermissions(),
          },
        ],
      },
      {
        id: 'shortcuts',
        title: 'settings.shortcuts',
        rows: [
          ...windowCommands.map((command) => ({
            id: `shortcut-${command}`,
            keys: [`shortcut.${command}` as const, 'settings.shortcuts' as const],
            render: () => this.renderShortcut(command),
          })),
          {
            id: 'shortcuts-reset',
            keys: ['settings.shortcuts', 'settings.shortcutsNote', 'settings.shortcuts.keywords'],
            render: () => this.renderShortcutsReset(),
          },
        ],
      },
      {
        id: 'default-browser',
        title: 'defaultBrowser.title',
        rows: [
          {
            id: 'default-browser',
            keys: ['defaultBrowser.title'],
            render: () =>
              html`<default-browser .bridge=${this.bridge} .i18n=${this.i18n}></default-browser>`,
          },
        ],
      },
      {
        id: 'import',
        title: 'import.title',
        plain: true,
        rows: [
          {
            id: 'import',
            keys: ['import.title', 'import.note'],
            render: () =>
              html`<p class="intro">${t('import.note')}</p>
                <browser-import .bridge=${this.bridge} .i18n=${this.i18n}></browser-import>`,
          },
        ],
      },
      {
        id: 'setup',
        title: 'settings.setup',
        rows: [
          {
            id: 'setup',
            keys: ['settings.setupGuide', 'settings.setupGuideNote'],
            render: () =>
              html`<div class="row">
                <span class="label">
                  <span>${t('settings.setupGuide')}</span>
                  <span class="note">${t('settings.setupGuideNote')}</span>
                </span>
                <button @click=${() => void this.bridge?.invoke('settings.openSetup', {})}>
                  ${t('settings.setupGuideOpen')}
                </button>
              </div>`,
          },
        ],
      },
    ];
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const sections = this.sections();
    const restart = sections
      .flatMap((section) => section.rows)
      .some((row) => this.client?.get(row.id)?.restart === true);
    const words = searchWords(this.query);
    const shown = sections
      .map((section) => {
        const all = matches(textOf([section.title]), words);
        return {
          ...section,
          rows: section.rows.filter(
            (row) =>
              (all || matches(textOf(row.keys, row.words), words)) &&
              (!this.changedOnly || this.client?.get(row.id)?.changed === true),
          ),
        };
      })
      .filter((section) => section.rows.length > 0);
    return html`
      <nav aria-label=${t('settings.sections')}>
        ${sections.map(
          (section) =>
            html`<button
              type="button"
              aria-current=${this.current === section.id ? 'true' : nothing}
              @click=${() => this.reveal(section.id)}
            >
              ${t(section.title)}
            </button>`,
        )}
      </nav>
      <div>
        <h1>${t('settings.title')}</h1>
        <input
          type="search"
          aria-label=${t('settings.searchLabel')}
          placeholder=${t('settings.searchLabel')}
          .value=${this.query}
          @input=${(event: Event) => {
            const input = event.target;
            if (input instanceof HTMLInputElement) this.query = input.value;
          }}
        />
        <div class="actions">
          <button
            type="button"
            aria-pressed=${this.changedOnly ? 'true' : 'false'}
            @click=${() => (this.changedOnly = !this.changedOnly)}
          >
            ${t('settings.changedOnly')}
          </button>
          <button type="button" @click=${() => void this.exportFile()}>
            ${t('settings.export')}
          </button>
          <button type="button" @click=${() => void this.importFile()}>
            ${t('settings.import')}
          </button>
          <button
            type="button"
            @click=${() => this.renderRoot.querySelector('dialog')?.showModal()}
          >
            ${t('settings.resetAll')}
          </button>
        </div>
        ${
          this.message === undefined
            ? nothing
            : html`<p class="message" role=${this.message.alert ? 'alert' : 'status'}>
                ${this.message.text}
              </p>`
        }
        <dialog aria-labelledby="reset-question">
          <p id="reset-question">${t('settings.resetAllQuestion')}</p>
          <div class="buttons">
            <button type="button" @click=${() => this.renderRoot.querySelector('dialog')?.close()}>
              ${t('settings.cancel')}
            </button>
            <button type="button" class="primary" @click=${() => void this.resetAll()}>
              ${t('settings.resetAllConfirm')}
            </button>
          </div>
        </dialog>
        ${
          shown.length === 0
            ? html`<p class="empty" role="status">
                ${
                  this.changedOnly && this.query.trim() === ''
                    ? t('settings.changedNone')
                    : t('settings.searchEmpty', { query: this.query.trim() })
                }
              </p>`
            : nothing
        }
        ${shown.map(
          (section) =>
            html`<h2 id=${section.id} tabindex="-1">${t(section.title)}</h2>
              ${
                section.plain === true
                  ? html`<div class="plain" role="group" aria-labelledby=${section.id}>
                      ${section.rows.map((row) => html`<div data-row=${row.id}>${row.render()}</div>`)}
                    </div>`
                  : html`<section aria-labelledby=${section.id}>
                      ${section.rows.map(
                        (row) =>
                          html`<div class="slot" data-row=${row.id}>
                            ${row.render()}${this.renderReset(row)}
                          </div>`,
                      )}
                    </section>`
              }`,
        )}
        ${
          restart
            ? html`<div class="restart" role="status">
                <span>${t('settings.restartNeeded')}</span>
                <button
                  type="button"
                  class="primary"
                  @click=${() => void this.bridge?.invoke('settings.restart', {})}
                >
                  ${t('settings.restartNow')}
                </button>
              </div>`
            : nothing
        }
      </div>
    `;
  }

  private readonly t = (key: MessageKey, params?: Readonly<Record<string, string>>): string =>
    this.i18n?.t(key, params) ?? key;

  /** Translates a key that is put together from parts, such as an option of a setting. */
  private readonly tk = (key: string): string => (isMessageKey(key) ? this.t(key) : key);

  private renderLabel(key: MessageKey, setting: SettingView | undefined): TemplateResult {
    return html`<span class="label">
      <span>${this.t(key)}</span>
      ${this.managedNote(setting)}
    </span>`;
  }

  private renderChoice(key: keyof typeof choices, label: MessageKey): TemplateResult {
    const setting = this.client?.get(key);
    return html`<div class="row">
      ${this.renderLabel(label, setting)}
      <div class="segments" role="radiogroup" aria-label=${this.t(label)}>
        ${choices[key].map(
          (option) =>
            html`<label>
              <input
                type="radio"
                name=${key}
                .checked=${setting?.value === option}
                ?disabled=${setting?.locked !== false}
                @change=${() => void this.client?.set(key, option)}
              />${this.tk(`${label}.${option}`)}
            </label>`,
        )}
      </div>
    </div>`;
  }

  /** The sites on which the content blocker is off, with a way to remove and to add them. */
  private renderAllowedSites(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('contentBlocker.allowedSites');
    const sites = Array.isArray(setting?.value)
      ? setting.value.filter((site): site is string => typeof site === 'string')
      : [];
    const disabled = setting?.locked !== false;
    return html`<div class="row stack">
      <span class="label">
        <span id="allowed-sites">${t('settings.allowedSites')}</span>
        <span class="note">
          ${setting?.locked === true ? t('settings.managed') : t('settings.allowedSitesNote')}
        </span>
      </span>
      ${
        sites.length === 0
          ? html`<span class="note">${t('settings.allowedSitesNone')}</span>`
          : html`<ul class="sites" aria-labelledby="allowed-sites">
              ${sites.map(
                (site) =>
                  html`<li>
                    <span>${site}</span>
                    <button
                      ?disabled=${disabled}
                      aria-label=${t('settings.allowedSitesRemove', { site })}
                      @click=${() =>
                        void this.client?.set(
                          'contentBlocker.allowedSites',
                          sites.filter((other) => other !== site),
                        )}
                    >
                      ${t('settings.remove')}
                    </button>
                  </li>`,
              )}
            </ul>`
      }
      <form class="add-site" @submit=${(event: SubmitEvent) => this.addSite(event, sites)}>
        <input
          type="text"
          name="site"
          autocomplete="off"
          spellcheck="false"
          placeholder="example.com"
          aria-label=${t('settings.allowedSitesAdd')}
          ?disabled=${disabled}
        />
        <button type="submit" ?disabled=${disabled}>${t('settings.add')}</button>
      </form>
      ${this.siteError ? html`<span class="error" role="alert">${t('settings.allowedSitesInvalid')}</span>` : nothing}
    </div>`;
  }

  /** What sites may use, by site, with a way to change and to remove each decision. */
  private renderSitePermissions(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('permissions.sites');
    const sites = decisionsOf(setting?.value);
    const disabled = setting?.locked !== false;
    const origins = Object.keys(sites).toSorted();
    const save = (next: Decisions): void => void this.client?.set('permissions.sites', next);
    return html`<div class="row stack">
      <span class="label">
        <span id="site-permissions">${t('settings.sitePermissions')}</span>
        <span class="note">
          ${setting?.locked === true ? t('settings.managed') : t('settings.sitePermissionsNote')}
        </span>
      </span>
      ${
        origins.length === 0
          ? html`<span class="note">${t('settings.sitePermissionsNone')}</span>`
          : html`<ul class="sites permissions" aria-labelledby="site-permissions">
              ${origins.map(
                (origin) =>
                  html`<li>
                    <span class="site">${origin}</span>
                    ${permissionNames.map((name) => {
                      const decision = sites[origin]?.[name];
                      if (decision === undefined) return nothing;
                      const label = t(permissionLabels[name]);
                      const params = { permission: label, site: origin };
                      return html`<span class="permission">
                        <span>${label}</span>
                        <select
                          aria-label=${t('settings.permissionFor', params)}
                          ?disabled=${disabled}
                          @change=${(event: Event) => {
                            const value =
                              event.target instanceof HTMLSelectElement ? event.target.value : '';
                            if (value === 'allow' || value === 'block') {
                              save({ ...sites, [origin]: { ...sites[origin], [name]: value } });
                            }
                          }}
                        >
                          <option value="allow" ?selected=${decision === 'allow'}>
                            ${t('settings.permissionAllow')}
                          </option>
                          <option value="block" ?selected=${decision === 'block'}>
                            ${t('settings.permissionBlock')}
                          </option>
                        </select>
                        <button
                          ?disabled=${disabled}
                          aria-label=${t('settings.permissionRemove', params)}
                          @click=${() => save(withoutDecision(sites, origin, name))}
                        >
                          ${t('settings.remove')}
                        </button>
                      </span>`;
                    })}
                  </li>`,
              )}
            </ul>`
      }
    </div>`;
  }

  /** Adds the site of the form's field to the sites without blocking. */
  private addSite(event: SubmitEvent, sites: readonly string[]): void {
    // The page cannot submit forms; it saves the setting instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.elements.namedItem('site');
    if (!(field instanceof HTMLInputElement)) return;
    const site = hostOf(field.value);
    this.siteError = site === undefined;
    if (site === undefined) return;
    field.value = '';
    if (!sites.includes(site)) {
      void this.client?.set('contentBlocker.allowedSites', [...sites, site].toSorted());
    }
  }

  private renderToggle(key: string, label: MessageKey, note: MessageKey): TemplateResult {
    const setting = this.client?.get(key);
    return html`<div class="row">
      <label class="label" for=${key}>
        <span>${this.t(label)}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${this.t(note)}</span>`
        }
      </label>
      <input
        id=${key}
        type="checkbox"
        role="switch"
        .checked=${setting?.value === true}
        ?disabled=${setting?.locked !== false}
        @change=${(event: Event) => {
          const input = event.target;
          if (input instanceof HTMLInputElement) void this.client?.set(key, input.checked);
        }}
      />
    </div>`;
  }

  private renderAccent(): TemplateResult {
    const setting = this.client?.get('appearance.accent');
    const disabled = setting?.locked !== false;
    const value = typeof setting?.value === 'string' ? setting.value : '';
    return html`<div class="row">
      ${this.renderLabel('settings.accent', setting)}
      <div class="swatches" role="radiogroup" aria-label=${this.t('settings.accent')}>
        ${(this.client?.accents ?? []).map(
          (accent) =>
            html`<label title=${this.tk(`settings.accent.${accent.id}`)} data-accent=${accent.id}>
              <input
                type="radio"
                name="accent"
                aria-label=${this.tk(`settings.accent.${accent.id}`)}
                .checked=${setting?.value === accent.id}
                ?disabled=${disabled}
                @change=${() => void this.client?.set('appearance.accent', accent.id)}
              /><span class="swatch"></span>
            </label>`,
        )}
        <input
          type="color"
          aria-label=${this.t('settings.accent.custom')}
          title=${this.t('settings.accent.custom')}
          .value=${value.startsWith('#') ? value : '#3366cc'}
          ?disabled=${disabled}
          @change=${(event: Event) => {
            const input = event.target;
            if (input instanceof HTMLInputElement) {
              void this.client?.set('appearance.accent', input.value);
            }
          }}
        />
      </div>
    </div>`;
  }

  /** The font of the browser, by name; an empty field keeps the font of the system. */
  private renderFont(): TemplateResult {
    const setting = this.client?.get('appearance.font');
    return html`<div class="row stack">
      <label class="label" for="ui-font">
        <span>${this.t('settings.font')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${this.t('settings.fontNote')}</span>`
        }
      </label>
      <input
        id="ui-font"
        type="text"
        spellcheck="false"
        autocomplete="off"
        maxlength="64"
        placeholder=${this.t('settings.fontSystem')}
        .value=${typeof setting?.value === 'string' ? setting.value : ''}
        ?disabled=${setting?.locked !== false}
        aria-invalid=${this.fontError ? 'true' : 'false'}
        @change=${(event: Event) => void this.setFont(event)}
      />
      ${
        this.fontError
          ? html`<span class="error" role="alert">${this.t('settings.fontInvalid')}</span>`
          : nothing
      }
    </div>`;
  }

  private async setFont(event: Event): Promise<void> {
    const input = event.target;
    if (input instanceof HTMLInputElement && this.client !== undefined) {
      this.fontError = !(await this.client.set('appearance.font', input.value.trim()));
    }
  }

  /** The pages that open at start, in their order, with a way to remove and to add them. */
  private renderStartupPages(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('startup.urls');
    const pages = Array.isArray(setting?.value)
      ? setting.value.filter((url): url is string => typeof url === 'string')
      : [];
    const disabled = setting?.locked !== false;
    return html`<div class="row stack">
      <span class="label">
        <span id="startup-pages">${t('settings.startupPages')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${t('settings.startupPagesNote')}</span>`
        }
      </span>
      ${
        pages.length === 0
          ? html`<span class="note">${t('settings.startupPagesNone')}</span>`
          : html`<ul class="sites" aria-labelledby="startup-pages">
              ${pages.map(
                (url, index) =>
                  html`<li>
                    <span>${url}</span>
                    <button
                      ?disabled=${disabled}
                      aria-label=${t('settings.startupPagesRemove', { page: url })}
                      @click=${() =>
                        void this.client?.set(
                          'startup.urls',
                          pages.filter((_page, other) => other !== index),
                        )}
                    >
                      ${t('settings.remove')}
                    </button>
                  </li>`,
              )}
            </ul>`
      }
      <form class="add-site" @submit=${(event: SubmitEvent) => this.addStartupPage(event, pages)}>
        <input
          type="text"
          inputmode="url"
          name="page"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://example.com"
          aria-label=${t('settings.startupPagesAdd')}
          ?disabled=${disabled}
        />
        <button type="submit" ?disabled=${disabled}>${t('settings.add')}</button>
      </form>
      ${
        this.pageError
          ? html`<span class="error" role="alert">${t('settings.addressInvalid')}</span>`
          : nothing
      }
    </div>`;
  }

  private addStartupPage(event: SubmitEvent, pages: readonly string[]): void {
    // The page cannot submit forms; it saves the setting instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.elements.namedItem('page');
    if (!(field instanceof HTMLInputElement)) return;
    const url = webAddressOf(field.value);
    this.pageError = url === undefined;
    if (url === undefined) return;
    field.value = '';
    if (!pages.includes(url)) void this.client?.set('startup.urls', [...pages, url]);
  }

  /** The page of the home button; an empty field opens the new tab page. */
  private renderHomePage(): TemplateResult {
    const setting = this.client?.get('home.page');
    return html`<div class="row stack">
      <label class="label" for="home-page">
        <span>${this.t('settings.homePage')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${this.t('settings.homePageNote')}</span>`
        }
      </label>
      <input
        id="home-page"
        type="text"
        inputmode="url"
        spellcheck="false"
        autocomplete="off"
        placeholder=${this.t('settings.homePageNewTab')}
        .value=${typeof setting?.value === 'string' ? setting.value : ''}
        ?disabled=${setting?.locked !== false}
        aria-invalid=${this.homeError ? 'true' : 'false'}
        @change=${(event: Event) => void this.setHomePage(event)}
      />
      ${
        this.homeError
          ? html`<span class="error" role="alert">${this.t('settings.addressInvalid')}</span>`
          : nothing
      }
    </div>`;
  }

  private async setHomePage(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || this.client === undefined) return;
    const text = input.value.trim();
    const url = text === '' ? '' : webAddressOf(text);
    this.homeError = url === undefined || !(await this.client.set('home.page', url));
  }

  /** The size of the text of web pages, from a list of sizes; new tabs use it. */
  private renderWebTextSize(): TemplateResult {
    const setting = this.client?.get('fonts.size');
    const value = typeof setting?.value === 'number' ? setting.value : 16;
    // A size from a policy or an import that the list does not offer is shown as well.
    const sizes = [...new Set([...webTextSizes, value])].toSorted((a, b) => a - b);
    const label = (size: number): string => {
      const key = `settings.webTextSize.${String(size)}`;
      return isMessageKey(key) ? this.t(key) : `${String(size)} px`;
    };
    return html`<div class="row">
      <span class="label">
        <span>${this.t('settings.webTextSize')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${this.t('settings.webTextSizeNote')}</span>`
        }
      </span>
      <select
        aria-label=${this.t('settings.webTextSize')}
        ?disabled=${setting?.locked !== false}
        @change=${(event: Event) => {
          const select = event.target;
          if (select instanceof HTMLSelectElement) {
            void this.client?.set('fonts.size', Number(select.value));
          }
        }}
      >
        ${sizes.map(
          (size) =>
            html`<option value=${String(size)} ?selected=${size === value}>${label(size)}</option>`,
        )}
      </select>
    </div>`;
  }

  /** The zoom of sites without a zoom of their own. */
  private renderPageZoom(): TemplateResult {
    const setting = this.client?.get('zoom.default');
    const value = typeof setting?.value === 'number' ? setting.value : 1;
    const format = new Intl.NumberFormat(this.i18n?.language, { style: 'percent' });
    return html`<div class="row">
      <span class="label">
        <span>${this.t('settings.pageZoom')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${this.t('settings.pageZoomNote')}</span>`
        }
      </span>
      <select
        aria-label=${this.t('settings.pageZoom')}
        ?disabled=${setting?.locked !== false}
        @change=${(event: Event) => {
          const select = event.target;
          if (select instanceof HTMLSelectElement) {
            void this.client?.set('zoom.default', Number(select.value));
          }
        }}
      >
        ${zoomFactors.map(
          (factor) =>
            html`<option value=${String(factor)} ?selected=${factor === value}>
              ${format.format(factor)}
            </option>`,
        )}
      </select>
    </div>`;
  }

  /** The fonts of web pages that name none; an empty field keeps the default. */
  private renderWebFonts(): TemplateResult {
    const setting = this.client?.get('fonts.web');
    const fonts = typeof setting?.value === 'object' && setting.value !== null ? setting.value : {};
    const disabled = setting?.locked !== false;
    const field = (name: 'standard' | 'serif' | 'sansSerif' | 'fixed'): TemplateResult => {
      const value: unknown = Reflect.get(fonts, name);
      return html`<label class="font">
        <span>${this.t(`settings.webFont.${name}`)}</span>
        <input
          type="text"
          spellcheck="false"
          autocomplete="off"
          maxlength="64"
          placeholder=${this.t('settings.webFontDefault')}
          .value=${typeof value === 'string' ? value : ''}
          ?disabled=${disabled}
          @change=${(event: Event) => void this.setWebFont(name, event)}
        />
      </label>`;
    };
    return html`<div class="row stack">
      <span class="label">
        <span>${this.t('settings.webFonts')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${this.t('settings.webFontsNote')}</span>`
        }
      </span>
      <div class="fonts">
        ${field('standard')}${field('serif')}${field('sansSerif')}${field('fixed')}
      </div>
      ${
        this.webFontError
          ? html`<span class="error" role="alert">${this.t('settings.fontInvalid')}</span>`
          : nothing
      }
    </div>`;
  }

  private async setWebFont(
    name: 'standard' | 'serif' | 'sansSerif' | 'fixed',
    event: Event,
  ): Promise<void> {
    const input = event.target;
    const current = this.client?.get('fonts.web')?.value;
    if (!(input instanceof HTMLInputElement) || typeof current !== 'object' || current === null) {
      return;
    }
    const value = { ...current, [name]: input.value.trim() };
    this.webFontError = !(await this.client?.set('fonts.web', value));
  }

  /** The folder of downloads, which only the system's dialog changes. */
  private renderDownloadFolder(): TemplateResult {
    const setting = this.client?.get('downloads.folder');
    const folder = typeof setting?.value === 'string' ? setting.value : '';
    return html`<div class="row">
      <span class="label">
        <span>${this.t('settings.downloadFolder')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note path">
                ${folder === '' ? this.t('settings.downloadFolderSystem') : folder}
              </span>`
        }
      </span>
      <button
        type="button"
        ?disabled=${setting?.locked !== false}
        @click=${() => void this.bridge?.invoke('settings.chooseDownloadFolder', {})}
      >
        ${this.t('settings.downloadFolderChange')}
      </button>
    </div>`;
  }

  /** The buttons next to the address bar: which ones show, and in which order. */
  private renderToolbar(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('toolbar.items');
    const shown = Array.isArray(setting?.value)
      ? setting.value.filter((item): item is ToolbarItem =>
          toolbarItems.some((known) => known === item),
        )
      : [...toolbarItems];
    const items = [...shown, ...toolbarItems.filter((item) => !shown.includes(item))];
    const disabled = setting?.locked !== false;
    const save = (next: readonly ToolbarItem[]): void =>
      void this.client?.set('toolbar.items', next);
    const move = (item: ToolbarItem, step: -1 | 1): void => {
      const next = [...shown];
      const index = next.indexOf(item);
      const other = index + step;
      if (index < 0 || other < 0 || other >= next.length) return;
      [next[index], next[other]] = [next[other] ?? item, item];
      // The focus stays with the item that moved, so that the same button moves it on.
      this.toolbarFocus = { item, index: other, step };
      void this.client?.set('toolbar.items', next).then((saved) => {
        if (!saved) this.toolbarFocus = undefined;
      });
    };
    return html`<div class="row stack">
      <span class="label">
        <span id="toolbar-items">${t('settings.toolbar')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${t('settings.toolbarNote')}</span>`
        }
      </span>
      <ul class="sites toolbar-items" aria-labelledby="toolbar-items">
        ${repeat(
          items,
          (item) => item,
          (item) => {
            const name = t(`settings.toolbar.${item}`);
            const index = shown.indexOf(item);
            return html`<li data-item=${item}>
              <label>
                <input
                  type="checkbox"
                  .checked=${index >= 0}
                  ?disabled=${disabled}
                  @change=${(event: Event) => {
                    const box = event.target;
                    if (!(box instanceof HTMLInputElement)) return;
                    save(box.checked ? [...shown, item] : shown.filter((other) => other !== item));
                  }}
                />
                ${name}
              </label>
              <span class="buttons">
                <button
                  type="button"
                  aria-label=${t('settings.toolbarUp', { item: name })}
                  ?disabled=${disabled || index <= 0}
                  @click=${() => move(item, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label=${t('settings.toolbarDown', { item: name })}
                  ?disabled=${disabled || index < 0 || index >= shown.length - 1}
                  @click=${() => move(item, 1)}
                >
                  ↓
                </button>
              </span>
            </li>`;
          },
        )}
      </ul>
    </div>`;
  }

  /** Focuses the button that moved a toolbar item once the list shows the item in its new place. */
  private focusMovedToolbarItem(): void {
    const focus = this.toolbarFocus;
    const value = this.client?.get('toolbar.items')?.value;
    if (focus === undefined || !Array.isArray(value) || value.indexOf(focus.item) !== focus.index) {
      return;
    }
    this.toolbarFocus = undefined;
    const [left, right] = this.renderRoot.querySelectorAll<HTMLButtonElement>(
      `.toolbar-items [data-item="${focus.item}"] button`,
    );
    const target = focus.step < 0 ? left : right;
    (target?.disabled === true ? (focus.step < 0 ? right : left) : target)?.focus();
  }

  /** The tiles of the new tab page, with a way to add and to remove them. */
  private renderTiles(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('newtab.tiles');
    const tiles = Array.isArray(setting?.value)
      ? setting.value.filter(
          (tile): tile is { title: string; url: string } =>
            typeof tile === 'object' &&
            tile !== null &&
            typeof Reflect.get(tile, 'title') === 'string' &&
            typeof Reflect.get(tile, 'url') === 'string',
        )
      : [];
    const disabled = setting?.locked !== false;
    return html`<div class="row stack">
      <span class="label">
        <span id="newtab-tiles">${t('settings.newTabTiles')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${t('settings.newTabTilesNote')}</span>`
        }
      </span>
      ${
        tiles.length === 0
          ? nothing
          : html`<ul class="sites" aria-labelledby="newtab-tiles">
              ${tiles.map(
                (tile, index) =>
                  html`<li>
                    <span>${tile.title}</span>
                    <span class="keyword">${tile.url}</span>
                    <button
                      ?disabled=${disabled}
                      aria-label=${t('settings.newTabTileRemove', { tile: tile.title })}
                      @click=${() =>
                        void this.client?.set(
                          'newtab.tiles',
                          tiles.filter((_tile, other) => other !== index),
                        )}
                    >
                      ${t('settings.remove')}
                    </button>
                  </li>`,
              )}
            </ul>`
      }
      <form class="add-tile" @submit=${(event: SubmitEvent) => void this.addTile(event, tiles)}>
        <input
          type="text"
          name="title"
          autocomplete="off"
          maxlength="64"
          aria-label=${t('settings.newTabTileTitle')}
          placeholder=${t('settings.newTabTileTitle')}
          ?disabled=${disabled || tiles.length >= 12}
        />
        <input
          type="text"
          inputmode="url"
          name="url"
          autocomplete="off"
          spellcheck="false"
          aria-label=${t('settings.newTabTileAddress')}
          placeholder="https://example.com"
          ?disabled=${disabled || tiles.length >= 12}
        />
        <button type="submit" ?disabled=${disabled || tiles.length >= 12}>
          ${t('settings.add')}
        </button>
      </form>
      ${
        this.tileError
          ? html`<span class="error" role="alert">${t('settings.addressInvalid')}</span>`
          : nothing
      }
    </div>`;
  }

  private async addTile(
    event: SubmitEvent,
    tiles: readonly { title: string; url: string }[],
  ): Promise<void> {
    // The page cannot submit forms; it saves the setting instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const field = (name: string): string => {
      const input = form.elements.namedItem(name);
      return input instanceof HTMLInputElement ? input.value.trim() : '';
    };
    const url = webAddressOf(field('url'));
    const title = field('title') || (url === undefined ? '' : new URL(url).hostname);
    const saved =
      url !== undefined &&
      (await this.client?.set('newtab.tiles', [...tiles, { title, url }])) === true;
    this.tileError = !saved;
    if (saved) form.reset();
  }

  /**
   * DNS over HTTPS: with the provider of the system, with a provider from the list or another
   * service, or off.
   */
  private renderSecureDns(): TemplateResult {
    const t = this.t;
    const mode = this.client?.get('network.secureDns');
    const templates = this.client?.get('network.secureDnsTemplates');
    const template = typeof templates?.value === 'string' ? templates.value : '';
    const provider = secureDnsProviders.find((known) => known.template === template);
    const selected =
      mode?.value === 'off'
        ? 'off'
        : mode?.value !== 'secure' || template === ''
          ? 'automatic'
          : this.customDns || provider === undefined
            ? 'custom'
            : provider.template;
    const locked = mode?.locked !== false || templates?.locked !== false;
    const choose = async (value: string): Promise<void> => {
      this.dnsError = false;
      this.customDns = value === 'custom';
      if (value === 'custom') return;
      // The services first, so that the browser never runs only DNS over HTTPS without one.
      await this.client?.set(
        'network.secureDnsTemplates',
        value === 'off' || value === 'automatic' ? '' : value,
      );
      await this.client?.set(
        'network.secureDns',
        value === 'off' ? 'off' : value === 'automatic' ? 'automatic' : 'secure',
      );
    };
    return html`<div class="row">
        <span class="label">
          <span>${t('settings.secureDns')}</span>
          ${
            mode?.locked === true || templates?.locked === true
              ? this.managedNote(mode?.locked === true ? mode : templates)
              : html`<span class="note">${t('settings.secureDnsNote')}</span>`
          }
        </span>
        <select
          aria-label=${t('settings.secureDns')}
          ?disabled=${locked}
          @change=${(event: Event) => {
            const select = event.target;
            if (select instanceof HTMLSelectElement) void choose(select.value);
          }}
        >
          <option value="automatic" ?selected=${selected === 'automatic'}>
            ${t('settings.secureDnsAutomatic')}
          </option>
          ${secureDnsProviders.map(
            (known) =>
              html`<option value=${known.template} ?selected=${selected === known.template}>
                ${known.name}
              </option>`,
          )}
          <option value="custom" ?selected=${selected === 'custom'}>
            ${t('settings.secureDnsCustom')}
          </option>
          <option value="off" ?selected=${selected === 'off'}>${t('settings.secureDnsOff')}</option>
        </select>
      </div>
      ${
        selected === 'custom'
          ? html`<form
              class="row add-site"
              @submit=${(event: SubmitEvent) => void this.setCustomDns(event)}
            >
              <input
                type="text"
                inputmode="url"
                name="template"
                autocomplete="off"
                spellcheck="false"
                aria-label=${t('settings.secureDnsTemplate')}
                placeholder="https://dns.example/dns-query"
                .value=${provider === undefined ? template : ''}
                ?disabled=${locked}
              />
              <button type="submit" ?disabled=${locked}>${t('settings.save')}</button>
              ${
                this.dnsError
                  ? html`<span class="error" role="alert">${t('settings.secureDnsInvalid')}</span>`
                  : nothing
              }
            </form>`
          : nothing
      }`;
  }

  private async setCustomDns(event: SubmitEvent): Promise<void> {
    // The page cannot submit forms; it asks the browser instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const field = form.elements.namedItem('template');
    const value = field instanceof HTMLInputElement ? field.value.trim() : '';
    if (value === '' || !secureDnsTemplatesPattern.test(value)) {
      this.dnsError = true;
      return;
    }
    const saved = (await this.client?.set('network.secureDnsTemplates', value)) === true;
    this.dnsError = !saved;
    if (saved) {
      await this.client?.set('network.secureDns', 'secure');
      this.customDns = false;
    }
  }

  /**
   * Loads the shortcuts of every command, as the window uses them, for the value of the
   * setting: once, and again after it changed.
   */
  private loadShortcuts(): void {
    const value = JSON.stringify(this.client?.get('keys.shortcuts')?.value ?? null);
    if (value === this.shortcutsLoaded) return;
    this.shortcutsLoaded = value;
    void this.bridge?.invoke('settings.getShortcuts', {}).then(
      (result) => {
        if (isShortcutList(result)) this.shortcuts = result;
      },
      () => {
        // Asked too often; the next change of the settings asks again.
        this.shortcutsLoaded = undefined;
      },
    );
  }

  /** A command with its shortcuts, a way to record another and to go back to the default. */
  private renderShortcut(command: WindowCommand): TemplateResult {
    const t = this.t;
    const entry = this.shortcuts?.commands.find((known) => known.command === command);
    const mac = this.shortcuts?.mac ?? false;
    const name = t(`shortcut.${command}`);
    const note = this.shortcutNote?.command === command ? this.shortcutNote : undefined;
    const locked = this.client?.get('keys.shortcuts')?.locked !== false;
    return html`<div class="row shortcut" data-command=${command}>
        <span class="label"><span>${name}</span></span>
        <span class="keys">
          ${
            entry === undefined || entry.shortcuts.length === 0
              ? html`<span class="note">${t('settings.shortcutNone')}</span>`
              : entry.shortcuts.map(
                  (shortcut) => html`<kbd>${displayShortcut(shortcut, mac)}</kbd>`,
                )
          }
        </span>
        <span class="buttons">
          <button
            type="button"
            aria-label=${t('settings.shortcutChange', { command: name })}
            ?disabled=${locked}
            @click=${() => void this.recordShortcut(command)}
          >
            ${this.recording === command ? t('settings.shortcutPress') : t('settings.shortcutChangeShort')}
          </button>
          ${
            entry?.changed === true
              ? html`<button
                  type="button"
                  aria-label=${t('settings.shortcutReset', { command: name })}
                  ?disabled=${locked}
                  @click=${() => void this.setShortcut(command, undefined)}
                >
                  ${t('settings.shortcutResetShort')}
                </button>`
              : nothing
          }
        </span>
      </div>
      ${note === undefined ? nothing : this.renderShortcutNote(note, name, mac)}`;
  }

  private renderShortcutNote(note: ShortcutNote, name: string, mac: boolean): TemplateResult {
    const t = this.t;
    if (note.other !== undefined) {
      const other = note.other;
      return html`<p class="row note" role="alert">
        ${t('settings.shortcutTaken', {
          shortcut: displayShortcut(note.shortcut, mac),
          command: t(`shortcut.${other}`),
        })}
        <button type="button" @click=${() => void this.setShortcut(note.command, [note.shortcut])}>
          ${t('settings.shortcutUseHere', { command: name })}
        </button>
      </p>`;
    }
    return html`<p class="row note problem" role="alert">
      ${t(`settings.shortcutProblem.${note.problem ?? 'text'}`)}
    </p>`;
  }

  /** Goes back to the default shortcuts of every command. */
  private renderShortcutsReset(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('keys.shortcuts');
    const changed =
      typeof setting?.value === 'object' &&
      setting.value !== null &&
      Object.keys(setting.value).length > 0;
    return html`<div class="row">
      <span class="label">
        <span>${t('settings.shortcutsResetAll')}</span>
        <span class="note">${t('settings.shortcutsNote')}</span>
      </span>
      <button
        type="button"
        ?disabled=${setting?.locked !== false || !changed}
        @click=${() => void this.client?.set('keys.shortcuts', {})}
      >
        ${t('settings.shortcutsResetAllShort')}
      </button>
    </div>`;
  }

  /** Starts waiting for the keys of a new shortcut of a command. */
  private async recordShortcut(command: WindowCommand): Promise<void> {
    this.shortcutNote = undefined;
    try {
      await this.bridge?.invoke('settings.recordShortcut', {});
    } catch {
      // The browser refused to wait, for example after many clicks in a row.
      return;
    }
    // The browser waits for the keys now, and the button says so.
    this.recording = command;
  }

  /** Takes the keys that the browser recorded for the command that waits, if they can be one. */
  private async takeShortcut(payload: unknown): Promise<void> {
    const command = this.recording;
    this.recording = undefined;
    if (command === undefined || typeof payload !== 'object' || payload === null) return;
    const shortcut: unknown = Reflect.get(payload, 'shortcut');
    if (typeof shortcut !== 'string') return;
    const problem: unknown = Reflect.get(payload, 'problem');
    if (problem === 'text' || problem === 'altgr' || problem === 'system') {
      this.shortcutNote = { command, shortcut, problem };
      return;
    }
    const other = this.shortcuts?.commands.find(
      (entry) => entry.command !== command && entry.shortcuts.includes(shortcut),
    );
    if (other !== undefined) {
      this.shortcutNote = { command, shortcut, other: other.command };
      return;
    }
    await this.setShortcut(command, [shortcut]);
  }

  /** Gives a command its own shortcuts, or its default ones again. */
  private async setShortcut(
    command: WindowCommand,
    shortcuts: readonly string[] | undefined,
  ): Promise<void> {
    this.shortcutNote = undefined;
    const setting = this.client?.get('keys.shortcuts');
    const current =
      typeof setting?.value === 'object' && setting.value !== null ? setting.value : {};
    const next = Object.fromEntries(Object.entries(current).filter(([known]) => known !== command));
    await this.client?.set(
      'keys.shortcuts',
      shortcuts === undefined ? next : { ...next, [command]: shortcuts },
    );
  }

  /** Clearing the browsing data, with a question for the time range and the kinds of data. */
  private renderClearData(): TemplateResult {
    const t = this.t;
    const dialog = (): HTMLDialogElement | null => this.renderRoot.querySelector('#clear-data');
    return html`<div class="row">
        <span class="label">
          <span>${t('settings.clearData')}</span>
          <span class="note">${t('settings.clearDataNote')}</span>
        </span>
        <button
          type="button"
          @click=${() => {
            this.dataCleared = false;
            dialog()?.showModal();
          }}
        >
          ${t('settings.clearDataOpen')}
        </button>
      </div>
      ${
        this.dataCleared
          ? html`<p class="row note" role="status">${t('settings.clearDataDone')}</p>`
          : nothing
      }
      <dialog id="clear-data" aria-labelledby="clear-data-title">
        <form method="dialog" @submit=${(event: SubmitEvent) => void this.clearData(event)}>
          <h3 id="clear-data-title">${t('settings.clearData')}</h3>
          <label class="field">
            <span>${t('settings.clearDataRange')}</span>
            <select name="range">
              ${(['hour', 'day', 'week', 'month', 'all'] as const).map(
                (range) =>
                  html`<option value=${range} ?selected=${range === 'hour'}>
                    ${t(`settings.clearDataRange.${range}`)}
                  </option>`,
              )}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name="history" checked />
            ${t('settings.clearDataHistory')}
          </label>
          <label class="check">
            <input type="checkbox" name="cookies" checked />
            ${t('settings.clearDataCookies')}
          </label>
          <label class="check">
            <input type="checkbox" name="cache" checked />
            ${t('settings.clearDataCache')}
          </label>
          <p class="note">${t('settings.clearDataAll')}</p>
          <div class="buttons">
            <button type="button" @click=${() => dialog()?.close()}>${t('settings.cancel')}</button>
            <button type="submit" class="primary">${t('settings.clearDataConfirm')}</button>
          </div>
        </form>
      </dialog>`;
  }

  private async clearData(event: SubmitEvent): Promise<void> {
    // The page cannot submit forms; it asks the browser instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const checked = (name: string): boolean => {
      const box = form.elements.namedItem(name);
      return box instanceof HTMLInputElement && box.checked;
    };
    const select = form.elements.namedItem('range');
    const range = select instanceof HTMLSelectElement ? select.value : 'hour';
    this.renderRoot.querySelector<HTMLDialogElement>('#clear-data')?.close();
    await this.bridge?.invoke('settings.clearData', {
      range,
      history: checked('history'),
      cookies: checked('cookies'),
      cache: checked('cache'),
    });
    this.dataCleared = true;
  }

  /** The language of the browser, which takes effect after a restart. */
  private renderLanguage(): TemplateResult {
    const setting = this.client?.get('i18n.language');
    const value = typeof setting?.value === 'string' ? setting.value : 'system';
    return html`<div class="row">
      <span class="label">
        <span>${this.t('settings.language')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">
                ${this.t(setting?.restart === true ? 'settings.restartNote' : 'settings.languageNote')}
              </span>`
        }
      </span>
      <select
        aria-label=${this.t('settings.language')}
        ?disabled=${setting?.locked !== false}
        @change=${(event: Event) => {
          const select = event.target;
          if (select instanceof HTMLSelectElement)
            void this.client?.set('i18n.language', select.value);
        }}
      >
        <option value="system" ?selected=${value === 'system'}>
          ${this.t('settings.language.system')}
        </option>
        ${Object.keys(catalogs).map(
          (code) =>
            html`<option value=${code} lang=${code} ?selected=${value === code}>
              ${languageName(code)}
            </option>`,
        )}
      </select>
    </div>`;
  }

  private renderSearch(): TemplateResult {
    const setting = this.client?.get('search.urlTemplate');
    const disabled = setting?.locked !== false;
    const engine = this.engineId();
    const custom = this.customSearch || engine === 'custom';
    return html`<div class="row">
        ${this.renderLabel('settings.searchEngine', setting)}
        <select
          aria-label=${this.t('settings.searchEngine')}
          ?disabled=${disabled}
          @change=${(event: Event) => void this.chooseEngine(event)}
        >
          ${searchEngines.map(
            (option) =>
              html`<option value=${option.id} ?selected=${!custom && engine === option.id}>
                ${option.name}
              </option>`,
          )}
          ${this.customEngines().map(
            (option) =>
              html`<option
                value=${`engine:${option.keyword}`}
                ?selected=${!custom && engine === `engine:${option.keyword}`}
              >
                ${option.name}
              </option>`,
          )}
          <option value="custom" ?selected=${custom}>
            ${this.t('settings.searchEngine.custom')}
          </option>
        </select>
      </div>
      ${
        custom
          ? html`<div class="row stack">
              <label class="label" for="search-url">
                <span>${this.t('settings.searchUrl')}</span>
                <span class="note">${this.t('settings.searchUrlHint')}</span>
              </label>
              <input
                id="search-url"
                type="url"
                spellcheck="false"
                .value=${
                  engine === 'custom' && typeof setting?.value === 'string' ? setting.value : ''
                }
                ?disabled=${disabled}
                aria-invalid=${this.searchError ? 'true' : 'false'}
                @change=${(event: Event) => void this.setSearchUrl(event)}
              />
              ${
                this.searchError
                  ? html`<span class="error" role="alert"
                      >${this.t('settings.searchUrlInvalid')}</span
                    >`
                  : nothing
              }
            </div>`
          : nothing
      }`;
  }

  private engineId(): string {
    const value = this.client?.get('search.urlTemplate')?.value;
    const added = this.customEngines().find((engine) => engine.url === value);
    return (
      searchEngines.find((engine) => engine.searchUrl === value)?.id ??
      (added === undefined ? 'custom' : `engine:${added.keyword}`)
    );
  }

  /** The search engines that someone added, as the setting holds them. */
  private customEngines(): CustomSearchEngine[] {
    const value = this.client?.get('search.engines')?.value;
    return Array.isArray(value)
      ? value.filter(
          (engine): engine is CustomSearchEngine =>
            typeof engine === 'object' &&
            engine !== null &&
            typeof Reflect.get(engine, 'name') === 'string' &&
            typeof Reflect.get(engine, 'keyword') === 'string' &&
            typeof Reflect.get(engine, 'url') === 'string',
        )
      : [];
  }

  /** The engines and their keywords, with a way to add and to remove engines. */
  private renderSearchEngines(): TemplateResult {
    const t = this.t;
    const setting = this.client?.get('search.engines');
    const added = this.customEngines();
    const disabled = setting?.locked !== false;
    return html`<div class="row stack">
      <span class="label">
        <span id="search-engines">${t('settings.searchEngines')}</span>
        ${
          setting?.locked === true || setting?.recommended === true
            ? this.managedNote(setting)
            : html`<span class="note">${t('settings.searchEnginesNote')}</span>`
        }
      </span>
      <ul class="sites engines" aria-labelledby="search-engines">
        ${searchEngines.map(
          (engine) =>
            html`<li>
              <span>${engine.name}</span>
              <span class="keyword">${engine.keyword}</span>
            </li>`,
        )}
        ${added.map(
          (engine) =>
            html`<li>
              <span>${engine.name}</span>
              <span class="keyword">${engine.keyword}</span>
              <button
                ?disabled=${disabled}
                aria-label=${t('settings.searchEngineRemove', { name: engine.name })}
                @click=${() =>
                  void this.client?.set(
                    'search.engines',
                    added.filter((other) => other.keyword !== engine.keyword),
                  )}
              >
                ${t('settings.remove')}
              </button>
            </li>`,
        )}
      </ul>
      <form class="add-engine" @submit=${(event: SubmitEvent) => void this.addEngine(event, added)}>
        <input
          type="text"
          name="name"
          autocomplete="off"
          aria-label=${t('settings.searchEngineName')}
          placeholder=${t('settings.searchEngineName')}
          ?disabled=${disabled}
        />
        <input
          type="text"
          name="keyword"
          autocomplete="off"
          spellcheck="false"
          aria-label=${t('settings.searchEngineKeyword')}
          placeholder=${t('settings.searchEngineKeyword')}
          ?disabled=${disabled}
        />
        <input
          type="text"
          inputmode="url"
          name="url"
          autocomplete="off"
          spellcheck="false"
          aria-label=${t('settings.searchEngineAddress')}
          placeholder="https://search.example/?q=%s"
          ?disabled=${disabled}
        />
        <button type="submit" ?disabled=${disabled}>${t('settings.add')}</button>
      </form>
      ${
        this.engineError
          ? html`<span class="error" role="alert">${t('settings.searchEngineInvalid')}</span>`
          : nothing
      }
    </div>`;
  }

  private async addEngine(event: SubmitEvent, added: readonly CustomSearchEngine[]): Promise<void> {
    // The page cannot submit forms; it saves the setting instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const field = (name: string): string => {
      const input = form.elements.namedItem(name);
      return input instanceof HTMLInputElement ? input.value.trim() : '';
    };
    const engine = { name: field('name'), keyword: field('keyword'), url: field('url') };
    const taken = searchEngines.some(
      (other) => other.keyword.toLowerCase() === engine.keyword.toLowerCase(),
    );
    const saved = !taken && (await this.client?.set('search.engines', [...added, engine])) === true;
    this.engineError = !saved;
    if (saved) form.reset();
  }

  /** Whether `!bangs` search their sites, with the list of them. */
  private renderBangs(): TemplateResult {
    const setting = this.client?.get('search.bangs');
    return html`${this.renderToggle('search.bangs', 'settings.bangs', 'settings.bangsNote')}
      <details class="bangs">
        <summary>${this.t('settings.bangsAll')}</summary>
        <ul>
          ${bangs.map(
            (site) => html`<li><span class="keyword">!${site.bang}</span> ${site.name}</li>`,
          )}
        </ul>
      </details>
      ${setting === undefined ? nothing : nothing}`;
  }

  private async chooseEngine(event: Event): Promise<void> {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const url =
      searchEngines.find((option) => option.id === select.value)?.searchUrl ??
      this.customEngines().find((option) => `engine:${option.keyword}` === select.value)?.url;
    this.customSearch = url === undefined;
    this.searchError = false;
    if (url !== undefined) {
      await this.client?.set('search.urlTemplate', url);
    }
  }

  private async setSearchUrl(event: Event): Promise<void> {
    const input = event.target;
    if (input instanceof HTMLInputElement && this.client !== undefined) {
      this.searchError = !(await this.client.set('search.urlTemplate', input.value.trim()));
    }
  }
}

/**
 * The host name of what someone typed as a site, such as `example.com` for
 * `https://www.example.com/page` without its `www.`; `undefined` when it is no site name.
 * @param input - The text of the field.
 */
/** The mark of values that the organization sets. */
const lockIcon = svg`<svg class="lock" viewBox="0 0 16 16" aria-hidden="true">
  <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" />
  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5" />
</svg>`;

/** A row of the settings page: a setting, or a part such as the import. */
/** The shortcuts of every command, as the browser tells them. */
interface ShortcutList {
  readonly mac: boolean;
  readonly commands: readonly {
    readonly command: WindowCommand;
    readonly shortcuts: readonly string[];
    readonly changed: boolean;
  }[];
}

/** A shortcut that was not taken: why, or which command has it. */
interface ShortcutNote {
  readonly command: WindowCommand;
  readonly shortcut: string;
  readonly problem?: 'text' | 'altgr' | 'system';
  readonly other?: WindowCommand;
}

function isShortcutList(value: unknown): value is ShortcutList {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mac' in value &&
    typeof value.mac === 'boolean' &&
    'commands' in value &&
    Array.isArray(value.commands) &&
    value.commands.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'command' in entry &&
        windowCommands.some((command) => command === entry.command) &&
        'shortcuts' in entry &&
        Array.isArray(entry.shortcuts) &&
        entry.shortcuts.every((shortcut: unknown) => typeof shortcut === 'string') &&
        'changed' in entry &&
        typeof entry.changed === 'boolean',
    )
  );
}

interface PageRow {
  /** The setting's key, or the part's name; links name it after `#`. */
  readonly id: string;
  /** The texts that find the row, in every language. */
  readonly keys: readonly MessageKey[];
  /** Words that find the row in every language, such as the names of search engines. */
  readonly words?: readonly string[];
  readonly render: () => TemplateResult;
}

/** A section of the settings page. */
interface PageSection {
  readonly id: string;
  readonly title: MessageKey;
  /** Whether the section draws its rows without a frame. */
  readonly plain?: boolean;
  readonly rows: readonly PageRow[];
}

/** The texts of the page in every language, so a word of either language finds a setting. */
const languages = [new Translator('en'), new Translator('de')];

/** The name of a language in that language, such as Deutsch. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The keys of the names of a choice's options. */
function optionKeys(key: keyof typeof choices, label: MessageKey): MessageKey[] {
  return choices[key].map((option) => `${label}.${option}`).filter(isMessageKey);
}

/** Text in a form that compares without case, accents and ß. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('ß', 'ss');
}

/** The words of a search, folded. */
function searchWords(query: string): string[] {
  return folded(query)
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** The texts of some keys in every language, and some more words, folded. */
function textOf(keys: readonly MessageKey[], words: readonly string[] = []): string {
  return folded(
    [...keys.flatMap((key) => languages.map((i18n) => i18n.t(key))), ...words].join(' '),
  );
}

/** Whether a text holds every word of a search. */
function matches(text: string, words: readonly string[]): boolean {
  return words.every((word) => text.includes(word));
}

/** The permissions that sites ask for, and their names on the page. */
const permissionLabels = {
  camera: 'settings.permission.camera',
  microphone: 'settings.permission.microphone',
  location: 'settings.permission.location',
  notifications: 'settings.permission.notifications',
  clipboard: 'settings.permission.clipboard',
} as const satisfies Record<string, MessageKey>;

type PermissionName = keyof typeof permissionLabels;

const permissionNames: readonly PermissionName[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
];

/** What the user decided for each site, by origin. */
type Decisions = Readonly<Record<string, Partial<Record<PermissionName, 'allow' | 'block'>>>>;

/** The decisions in the value of the setting `permissions.sites`, which main checked. */
function decisionsOf(value: unknown): Decisions {
  if (typeof value !== 'object' || value === null) return {};
  const sites: Record<string, Partial<Record<PermissionName, 'allow' | 'block'>>> = {};
  for (const [origin, decisions] of Object.entries(value)) {
    if (typeof decisions !== 'object' || decisions === null) continue;
    const kept: Partial<Record<PermissionName, 'allow' | 'block'>> = {};
    for (const name of permissionNames) {
      const decision: unknown = Reflect.get(decisions, name);
      if (decision === 'allow' || decision === 'block') kept[name] = decision;
    }
    sites[origin] = kept;
  }
  return sites;
}

/** The decisions without one of a site; a site without decisions leaves the list. */
function withoutDecision(sites: Decisions, origin: string, name: PermissionName): Decisions {
  const { [name]: _removed, ...rest } = sites[origin] ?? {};
  const { [origin]: _site, ...others } = sites;
  return Object.keys(rest).length === 0 ? others : { ...others, [origin]: rest };
}

/** A web address that someone typed, with `https://` added when it has no scheme. */
function webAddressOf(input: string): string | undefined {
  const text = input.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function hostOf(input: string): string | undefined {
  const text = input.trim().toLowerCase();
  let host = text;
  try {
    host = new URL(text.includes('://') ? text : `http://${text}`).hostname;
  } catch {
    return undefined;
  }
  host = host.replace(/^www\./, '');
  return /^[a-z0-9.:[\]-]{1,253}$/.test(host) && host.includes('.') ? host : undefined;
}
