import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { searchEngines } from '../../shared/search-engines.ts';
import { isMessageKey, type MessageKey, type Translator } from '../i18n/i18n.ts';

/** A setting as the browser process reports it. */
interface SettingView {
  readonly key: string;
  readonly value: unknown;
  readonly locked: boolean;
}

/** An accent preset with its color in each mode. */
interface AccentSwatch {
  readonly id: string;
  readonly light: string;
  readonly dark: string;
}

/** The part of the page bridge that the settings page uses. */
interface PageBridge {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSettingView = (value: unknown): value is SettingView =>
  isRecord(value) && typeof value['key'] === 'string' && typeof value['locked'] === 'boolean';

const settingViews = (value: unknown): SettingView[] =>
  isRecord(value) && Array.isArray(value['settings'])
    ? value['settings'].filter(isSettingView)
    : [];

const isSwatch = (value: unknown): value is AccentSwatch =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  typeof value['light'] === 'string' &&
  typeof value['dark'] === 'string';

/** Options of a choice between a few values, with the message key of each label. */
const choices = {
  'appearance.colorMode': ['system', 'light', 'dark'],
  'appearance.density': ['compact', 'normal', 'comfortable'],
} as const;

/**
 * The settings page: every setting that has a place on it, grouped in sections. Changes
 * apply at once; values that a policy sets are shown but cannot be changed.
 */
export class SettingsPage extends LitElement {
  static override properties = {
    values: { state: true },
    accents: { state: true },
    searchError: { state: true },
    customSearch: { state: true },
  };

  /** Styles of the page, scoped to its shadow root. */
  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      max-width: 720px;
      margin: 0 auto;
      padding: var(--space-3) var(--space-3) 48px;
    }
    h1 {
      margin: 24px 0 16px;
      font-size: 20px;
      line-height: 28px;
      font-weight: 600;
    }
    h2 {
      margin: 24px 0 8px;
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
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
      min-height: 48px;
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
      font-size: 12px;
      line-height: 16px;
    }
    .error {
      color: var(--danger);
      font-size: 12px;
      line-height: 16px;
    }
    .segments {
      display: inline-flex;
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      overflow: hidden;
    }
    .segments label {
      position: relative;
      padding: var(--space-1) var(--space-3);
      line-height: 20px;
    }
    .segments label + label {
      border-left: 1px solid var(--border-1);
    }
    .segments label:has(input:checked) {
      background: var(--accent);
      color: var(--surface-0);
    }
    .segments label:has(input:focus-visible),
    .swatches label:has(input:focus-visible) {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
    input[type='radio'] {
      position: absolute;
      opacity: 0;
      inset: 0;
      margin: 0;
    }
    .swatches {
      display: flex;
      gap: var(--space-2);
      align-items: center;
    }
    .swatches label {
      position: relative;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      box-sizing: border-box;
      border: 2px solid transparent;
    }
    .swatches label:has(input:checked) {
      border-color: var(--text-1);
    }
    .swatch {
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: var(--swatch-light);
      pointer-events: none;
    }
    @media (prefers-color-scheme: dark) {
      .swatch {
        background: var(--swatch-dark);
      }
    }
    input[type='color'] {
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: none;
    }
    select,
    input[type='url'] {
      height: 32px;
      padding: 0 var(--space-2);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-0);
      color: var(--text-1);
      font: inherit;
    }
    input[type='url'] {
      width: 100%;
      box-sizing: border-box;
    }
    .stack {
      flex-direction: column;
      align-items: stretch;
    }
    :disabled,
    label:has(:disabled) {
      opacity: 0.6;
    }
  `;

  declare values: ReadonlyMap<string, SettingView>;
  declare accents: readonly AccentSwatch[];
  declare searchError: boolean;
  declare customSearch: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor() {
    super();
    this.values = new Map();
    this.accents = [];
    this.searchError = false;
    this.customSearch = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const bridge = this.bridge;
    if (bridge === undefined) {
      return;
    }
    this.unsubscribe = bridge.on('settings.changed', (payload) =>
      this.merge(settingViews(payload)),
    );
    void bridge.invoke('settings.getAll', {}).then((payload) => {
      this.merge(settingViews(payload));
      this.accents =
        isRecord(payload) && Array.isArray(payload['accents'])
          ? payload['accents'].filter(isSwatch)
          : [];
      this.customSearch = this.engineId() === 'custom';
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  protected override updated(): void {
    // Colors go through the CSS object model: the page's policy forbids style attributes.
    for (const accent of this.accents) {
      const label = this.renderRoot.querySelector<HTMLElement>(`[data-accent="${accent.id}"]`);
      label?.style.setProperty('--swatch-light', accent.light);
      label?.style.setProperty('--swatch-dark', accent.dark);
    }
  }

  protected override render(): TemplateResult {
    const t = this.t;
    return html`
      <h1>${t('settings.title')}</h1>
      <h2 id="appearance">${t('settings.appearance')}</h2>
      <section aria-labelledby="appearance">
        ${this.renderChoice('appearance.colorMode', 'settings.colorMode')} ${this.renderAccent()}
        ${this.renderChoice('appearance.density', 'settings.density')}
      </section>
      <h2 id="search">${t('settings.search')}</h2>
      <section aria-labelledby="search">${this.renderSearch()}</section>
    `;
  }

  private readonly t = (key: MessageKey, params?: Readonly<Record<string, string>>): string =>
    this.i18n?.t(key, params) ?? key;

  /** Translates a key that is put together from parts, such as an option of a setting. */
  private readonly tk = (key: string): string => (isMessageKey(key) ? this.t(key) : key);

  private renderLabel(key: MessageKey, setting: SettingView | undefined): TemplateResult {
    return html`<span class="label">
      <span>${this.t(key)}</span>
      ${
        setting?.locked === true
          ? html`<span class="note">${this.t('settings.managed')}</span>`
          : nothing
      }
    </span>`;
  }

  private renderChoice(key: keyof typeof choices, label: MessageKey): TemplateResult {
    const setting = this.values.get(key);
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
                @change=${() => void this.set(key, option)}
              />${this.tk(`${label}.${option}`)}
            </label>`,
        )}
      </div>
    </div>`;
  }

  private renderAccent(): TemplateResult {
    const setting = this.values.get('appearance.accent');
    const disabled = setting?.locked !== false;
    const value = typeof setting?.value === 'string' ? setting.value : '';
    return html`<div class="row">
      ${this.renderLabel('settings.accent', setting)}
      <div class="swatches" role="radiogroup" aria-label=${this.t('settings.accent')}>
        ${this.accents.map(
          (accent) =>
            html`<label title=${this.tk(`settings.accent.${accent.id}`)} data-accent=${accent.id}>
              <input
                type="radio"
                name="accent"
                aria-label=${this.tk(`settings.accent.${accent.id}`)}
                .checked=${setting?.value === accent.id}
                ?disabled=${disabled}
                @change=${() => void this.set('appearance.accent', accent.id)}
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
            if (input instanceof HTMLInputElement) void this.set('appearance.accent', input.value);
          }}
        />
      </div>
    </div>`;
  }

  private renderSearch(): TemplateResult {
    const setting = this.values.get('search.urlTemplate');
    const disabled = setting?.locked !== false;
    const engine = this.engineId();
    return html`<div class="row">
        ${this.renderLabel('settings.searchEngine', setting)}
        <select
          aria-label=${this.t('settings.searchEngine')}
          ?disabled=${disabled}
          @change=${(event: Event) => void this.chooseEngine(event)}
        >
          ${searchEngines.map(
            (option) =>
              html`<option value=${option.id} ?selected=${engine === option.id}>
                ${option.name}
              </option>`,
          )}
          <option value="custom" ?selected=${this.customSearch || engine === 'custom'}>
            ${this.t('settings.searchEngine.custom')}
          </option>
        </select>
      </div>
      ${
        this.customSearch || engine === 'custom'
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
    const value = this.values.get('search.urlTemplate')?.value;
    return searchEngines.find((engine) => engine.searchUrl === value)?.id ?? 'custom';
  }

  private async chooseEngine(event: Event): Promise<void> {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const engine = searchEngines.find((option) => option.id === select.value);
    this.customSearch = engine === undefined;
    this.searchError = false;
    if (engine !== undefined) {
      await this.set('search.urlTemplate', engine.searchUrl);
    }
  }

  private async setSearchUrl(event: Event): Promise<void> {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      this.searchError = !(await this.set('search.urlTemplate', input.value.trim()));
    }
  }

  /** Writes a setting and reports whether the browser accepted it. */
  private async set(key: string, value: unknown): Promise<boolean> {
    const result = await this.bridge?.invoke('settings.set', { key, value });
    return isRecord(result) && result['ok'] === true;
  }

  private merge(views: readonly SettingView[]): void {
    if (views.length > 0) {
      const next = new Map(this.values);
      for (const view of views) next.set(view.key, view);
      this.values = next;
    }
  }
}
