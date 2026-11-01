import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import { brand } from '../../shared/brand.ts';
import { searchEngines } from '../../shared/search-engines.ts';
import { isMessageKey, type MessageKey, type Translator } from '../i18n/i18n.ts';
import { choiceStyles } from '../ui-kit/choice-styles.ts';
import { SettingsClient, paintSwatches, type PageBridge } from '../ui-kit/settings-client.ts';

/** The steps of the guide, in order. */
const steps = ['welcome', 'look', 'layout', 'search', 'import', 'browser', 'done'] as const;
type Step = (typeof steps)[number];

const colorModes = ['system', 'light', 'dark'] as const;
const tabPositions = ['top', 'bottom', 'left', 'right'] as const;
const densities = ['compact', 'normal', 'comfortable'] as const;

/** Surface colors of a window preview. */
interface PreviewColors {
  readonly window: string;
  readonly bar: string;
  readonly line: string;
}

/** Light and dark surfaces of the window previews, matching the design tokens. */
const previewColors: Readonly<Record<'light' | 'dark', PreviewColors>> = {
  light: {
    window: 'oklch(97.5% 0.003 260)',
    bar: 'oklch(99.5% 0.002 260)',
    line: 'oklch(88% 0.006 260)',
  },
  dark: {
    window: 'oklch(20% 0.008 260)',
    bar: 'oklch(25% 0.009 260)',
    line: 'oklch(36% 0.01 260)',
  },
} as const;

/**
 * The setup guide that opens on the first start of a profile: look, tab layout and search
 * engine, step by step. Every choice applies at once, so the browser around the guide
 * shows it; every step can be skipped, and the settings page offers the same choices.
 */
export class SetupGuide extends LitElement {
  static override properties = {
    step: { state: true },
    revision: { state: true },
    searchError: { state: true },
    customSearch: { state: true },
  };

  /** Styles of the guide, scoped to its shadow root. */
  static override styles = [
    choiceStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        min-height: 100vh;
        max-width: 760px;
        margin: 0 auto;
        padding: 40px var(--space-3) var(--space-3);
      }
      .progress {
        display: flex;
        gap: var(--space-1);
        margin-bottom: 32px;
      }
      .progress span {
        height: 4px;
        flex: 1;
        border-radius: 2px;
        background: var(--border-1);
      }
      .progress span.done {
        background: var(--accent);
      }
      .options {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border-1);
        border-radius: var(--radius-2);
        background: var(--surface-1);
      }
      .options > * + * {
        border-top: 1px solid var(--border-1);
      }
      .option {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        min-height: 48px;
        padding: var(--space-2) var(--space-3);
      }
      .option .text {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      .option .note {
        color: var(--text-2);
      }
      .option input {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: var(--accent);
      }
      .step {
        flex: 1;
        animation: enter var(--motion-fast) ease-out;
      }
      @keyframes enter {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
      }
      .eyebrow {
        margin: 0 0 var(--space-2);
        color: var(--text-2);
        font-size: 12px;
        line-height: 16px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 var(--space-2);
        font-size: 28px;
        line-height: 36px;
        font-weight: 600;
      }
      p {
        margin: 0 0 24px;
        max-width: 560px;
        color: var(--text-2);
        font-size: 14px;
        line-height: 20px;
      }
      h2 {
        margin: 24px 0 var(--space-2);
        font-size: 14px;
        line-height: 20px;
        font-weight: 600;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--space-3);
      }
      .card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        padding: var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-2);
        background: var(--surface-1);
        transition: border-color var(--motion-fast);
      }
      .card:hover {
        border-color: var(--text-2);
      }
      .card:has(input:checked) {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent);
      }
      .card svg {
        display: block;
        width: 100%;
        height: auto;
        border-radius: var(--radius-1);
      }
      .card span {
        font-size: 13px;
        line-height: 16px;
      }
      /* Presentation attributes cannot use custom properties, so the previews use classes. */
      .card .accent {
        fill: var(--accent);
      }
      .card .bar {
        fill: var(--surface-1);
      }
      .card .page {
        fill: var(--surface-2);
      }
      .engines {
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      }
      .engines .card {
        flex-direction: row;
        align-items: center;
        min-height: 48px;
        padding: 0 var(--space-3);
      }
      .swatches {
        --swatch-size: 36px;
      }
      input[type='url'] {
        box-sizing: border-box;
        width: 100%;
        max-width: 480px;
        height: 32px;
        padding: 0 var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-1);
        color: var(--text-1);
        font: inherit;
      }
      .error {
        display: block;
        margin-top: var(--space-1);
        color: var(--danger);
        font-size: 12px;
      }
      footer {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 24px 0 var(--space-3);
      }
      footer .spacer {
        flex: 1;
      }
      button {
        height: 36px;
        padding: 0 var(--space-3);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-1);
        color: var(--text-1);
        font: inherit;
      }
      button:hover {
        background: var(--surface-hover);
      }
      button.primary {
        border-color: var(--accent);
        background: var(--accent);
        color: var(--surface-0);
      }
      button.link {
        border-color: transparent;
        background: transparent;
        color: var(--text-2);
      }
      :focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
    `,
  ];

  declare step: Step;
  declare revision: number;
  declare searchError: boolean;
  /** Whether the user chose to enter a search address of their own. */
  declare customSearch: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private client: SettingsClient | undefined;

  constructor() {
    super();
    this.step = 'welcome';
    this.revision = 0;
    this.searchError = false;
    this.customSearch = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.bridge === undefined) {
      return;
    }
    this.client = new SettingsClient(this.bridge, () => (this.revision += 1));
    void this.client.load().then(() => {
      document.documentElement.dataset['ready'] = 'true';
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.client?.dispose();
  }

  protected override updated(): void {
    paintSwatches(this.renderRoot, this.client?.accents ?? []);
  }

  protected override render(): TemplateResult {
    const index = steps.indexOf(this.step);
    return html`
      <div class="progress" aria-hidden="true">
        ${steps.map((_, i) => html`<span class=${i <= index ? 'done' : ''}></span>`)}
      </div>
      <main class="step" aria-live="polite">
        <p class="eyebrow">
          ${this.t('setup.stepOf', { step: String(index + 1), count: String(steps.length) })}
        </p>
        ${this.renderStep()}
      </main>
      ${this.renderFooter(index)}
    `;
  }

  private readonly t = (key: MessageKey, params?: Readonly<Record<string, string>>): string =>
    this.i18n?.t(key, { product: brand.productName, ...params }) ?? key;

  private readonly tk = (key: string): string => (isMessageKey(key) ? this.t(key) : key);

  private renderStep(): TemplateResult {
    const views: Readonly<Record<Step, () => TemplateResult>> = {
      welcome: () => this.renderWelcome(),
      look: () => this.renderLook(),
      layout: () => this.renderLayout(),
      search: () => this.renderSearch(),
      import: () => this.renderImport(),
      browser: () => this.renderBrowser(),
      done: () => this.renderDone(),
    };
    return views[this.step]();
  }

  private renderWelcome(): TemplateResult {
    return html`<h1>${this.t('setup.welcome.title')}</h1>
      <p>${this.t('setup.welcome.body')}</p>`;
  }

  private renderLook(): TemplateResult {
    return html`<h1>${this.t('setup.look.title')}</h1>
      <p>${this.t('setup.look.body')}</p>
      <h2 id="mode">${this.t('settings.colorMode')}</h2>
      <div class="cards" role="radiogroup" aria-labelledby="mode">
        ${colorModes.map((mode) =>
          this.renderCard(
            'appearance.colorMode',
            mode,
            `settings.colorMode.${mode}`,
            modePreview(mode),
          ),
        )}
      </div>
      <h2 id="accent">${this.t('settings.accent')}</h2>
      ${this.renderSwatches()}`;
  }

  private renderLayout(): TemplateResult {
    return html`<h1>${this.t('setup.layout.title')}</h1>
      <p>${this.t('setup.layout.body')}</p>
      <h2 id="tabs">${this.t('settings.tabPosition')}</h2>
      <div class="cards" role="radiogroup" aria-labelledby="tabs">
        ${tabPositions.map((position) =>
          this.renderCard(
            'tabs.position',
            position,
            `settings.tabPosition.${position}`,
            layoutPreview(position),
          ),
        )}
      </div>
      <h2 id="density">${this.t('settings.density')}</h2>
      <div class="segments" role="radiogroup" aria-labelledby="density">
        ${densities.map((density) => {
          const setting = this.client?.get('appearance.density');
          return html`<label>
            <input
              type="radio"
              name="appearance.density"
              .checked=${setting?.value === density}
              ?disabled=${setting?.locked !== false}
              @change=${() => void this.client?.set('appearance.density', density)}
            />${this.tk(`settings.density.${density}`)}
          </label>`;
        })}
      </div>
      <h2>${this.t('shell.bookmarksBar')}</h2>
      ${this.renderSwitch('bookmarks.bar', 'settings.bookmarksBar', 'settings.bookmarksBarNote')}`;
  }

  /** A switch for a setting of the guide, with a note below its label, and more rows. */
  private renderSwitch(
    key: string,
    label: MessageKey,
    note: MessageKey,
    more: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    const setting = this.client?.get(key);
    return html`<div class="options">
      <label class="option">
        <span class="text">
          <span>${this.t(label)}</span>
          <span class="note"
            >${setting?.locked === true ? this.t('settings.managed') : this.t(note)}</span
          >
        </span>
        <input
          type="checkbox"
          role="switch"
          .checked=${setting?.value === true}
          ?disabled=${setting?.locked !== false}
          @change=${(event: Event) => {
            const input = event.target;
            if (input instanceof HTMLInputElement) void this.client?.set(key, input.checked);
          }}
        />
      </label>
      ${more}
    </div>`;
  }

  private renderDone(): TemplateResult {
    return html`<h1>${this.t('setup.done.title')}</h1>
      <p>${this.t('setup.done.body')}</p>`;
  }

  private renderCard(
    key: string,
    value: string,
    label: string,
    preview: TemplateResult,
  ): TemplateResult {
    const setting = this.client?.get(key);
    return html`<label class="card">
      <input
        type="radio"
        name=${key}
        .checked=${setting?.value === value}
        ?disabled=${setting?.locked !== false}
        @change=${() => void this.client?.set(key, value)}
      />
      ${preview}
      <span>${this.tk(label)}</span>
    </label>`;
  }

  private renderSwatches(): TemplateResult {
    const setting = this.client?.get('appearance.accent');
    const value = typeof setting?.value === 'string' ? setting.value : '';
    const disabled = setting?.locked !== false;
    return html`<div class="swatches" role="radiogroup" aria-labelledby="accent">
      ${(this.client?.accents ?? []).map(
        (accent) =>
          html`<label title=${this.tk(`settings.accent.${accent.id}`)} data-accent=${accent.id}>
            <input
              type="radio"
              name="accent"
              aria-label=${this.tk(`settings.accent.${accent.id}`)}
              .checked=${value === accent.id}
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
    </div>`;
  }

  private renderSearch(): TemplateResult {
    const setting = this.client?.get('search.urlTemplate');
    const value = typeof setting?.value === 'string' ? setting.value : '';
    const disabled = setting?.locked !== false;
    const known = searchEngines.find((engine) => engine.searchUrl === value);
    const custom = this.customSearch || known === undefined;
    return html`<h1>${this.t('setup.search.title')}</h1>
      <p>${this.t('setup.search.body')}</p>
      <div class="cards engines" role="radiogroup" aria-label=${this.t('settings.searchEngine')}>
        ${searchEngines.map(
          (engine) =>
            html`<label class="card">
              <input
                type="radio"
                name="engine"
                .checked=${!custom && known?.id === engine.id}
                ?disabled=${disabled}
                @change=${() => {
                  this.customSearch = false;
                  this.searchError = false;
                  void this.client?.set('search.urlTemplate', engine.searchUrl);
                }}
              />
              <span>${engine.name}</span>
            </label>`,
        )}
        <label class="card">
          <input
            type="radio"
            name="engine"
            .checked=${custom}
            ?disabled=${disabled}
            @change=${() => {
              this.customSearch = true;
              this.searchError = false;
            }}
          />
          <span>${this.t('settings.searchEngine.custom')}</span>
        </label>
      </div>
      ${
        custom
          ? html`<h2>${this.t('settings.searchUrl')}</h2>
              <input
                type="url"
                aria-label=${this.t('settings.searchUrl')}
                spellcheck="false"
                .value=${known === undefined ? value : ''}
                ?disabled=${disabled}
                @change=${(event: Event) => void this.setSearchUrl(event)}
              />
              ${
                this.searchError
                  ? html`<span class="error" role="alert"
                      >${this.t('settings.searchUrlInvalid')}</span
                    >`
                  : nothing
              }`
          : nothing
      }`;
  }

  private renderImport(): TemplateResult {
    return html`<h1>${this.t('setup.import.title')}</h1>
      <p>${this.t('setup.import.body')}</p>
      <browser-import .bridge=${this.bridge} .i18n=${this.i18n}></browser-import>`;
  }

  private renderBrowser(): TemplateResult {
    return html`<h1>${this.t('setup.browser.title')}</h1>
      <p>${this.t('setup.browser.body')}</p>
      ${this.renderSwitch('contentBlocker.enabled', 'settings.contentBlocker', 'settings.contentBlockerNote', html`<default-browser .bridge=${this.bridge} .i18n=${this.i18n}></default-browser>`)}`;
  }

  private renderFooter(index: number): TemplateResult {
    const last = index === steps.length - 1;
    return html`<footer>
      ${
        index > 0 && !last
          ? html`<button @click=${() => this.go(index - 1)}>${this.t('setup.back')}</button>`
          : nothing
      }
      <span class="spacer"></span>
      ${
        last
          ? nothing
          : html`<button class="link" @click=${this.finish}>${this.t('setup.skip')}</button>`
      }
      ${
        last
          ? html`<button class="primary" @click=${this.finish}>${this.t('setup.finish')}</button>`
          : html`<button class="primary" @click=${() => this.go(index + 1)}>
              ${this.t(index === 0 ? 'setup.start' : 'setup.next')}
            </button>`
      }
    </footer>`;
  }

  private go(index: number): void {
    this.step = steps[index] ?? this.step;
  }

  private readonly finish = (): void => {
    void this.bridge?.invoke('setup.finish', {});
  };

  private async setSearchUrl(event: Event): Promise<void> {
    const input = event.target;
    if (input instanceof HTMLInputElement && this.client !== undefined) {
      this.searchError = !(await this.client.set('search.urlTemplate', input.value.trim()));
    }
  }
}

/** One window of a color mode preview, drawn at an offset and width in a 160 by 90 box. */
function previewWindow(x: number, width: number, colors: PreviewColors): TemplateResult {
  return svg`
    <rect x=${x} y="0" width=${width} height="90" fill=${colors.window} />
    <rect x=${x} y="0" width=${width} height="16" fill=${colors.bar} />
    <rect x=${x} y="16" width=${width} height="1" fill=${colors.line} />
    <rect x=${x + 12} y="30" width=${Math.min(width - 24, 80)} height="6" rx="3" fill=${colors.line} />
    <rect x=${x + 12} y="42" width=${Math.min(width - 24, 56)} height="6" rx="3" fill=${colors.line} />`;
}

/** A small window that shows a color mode; the system mode shows both halves. */
function modePreview(mode: (typeof colorModes)[number]): TemplateResult {
  const parts =
    mode === 'system'
      ? svg`${previewWindow(0, 80, previewColors.light)}${previewWindow(80, 80, previewColors.dark)}`
      : previewWindow(0, 160, previewColors[mode]);
  return html`<svg viewBox="0 0 160 90" aria-hidden="true">${parts}</svg>`;
}

/** A small window that shows where the tab strip goes, drawn in the page's own colors. */
function layoutPreview(position: (typeof tabPositions)[number]): TemplateResult {
  const tabs = {
    top: svg`<rect x="0" y="0" width="160" height="12" class="accent" /><rect x="0" y="12" width="160" height="12" class="bar" />`,
    bottom: svg`<rect x="0" y="0" width="160" height="12" class="bar" /><rect x="0" y="78" width="160" height="12" class="accent" />`,
    left: svg`<rect x="0" y="0" width="160" height="12" class="bar" /><rect x="0" y="12" width="40" height="78" class="accent" />`,
    right: svg`<rect x="0" y="0" width="160" height="12" class="bar" /><rect x="120" y="12" width="40" height="78" class="accent" />`,
  }[position];
  return html`<svg viewBox="0 0 160 90" aria-hidden="true">
    <rect x="0" y="0" width="160" height="90" class="page" />
    ${tabs}
  </svg>`;
}
