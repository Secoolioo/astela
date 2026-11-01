import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { searchEngines } from '../../shared/search-engines.ts';
import { isMessageKey, type MessageKey, type Translator } from '../i18n/i18n.ts';
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
  'tabs.position': ['top', 'bottom', 'left', 'right'],
  'startup.page': ['restore', 'newtab'],
} as const;

/**
 * The settings page: every setting that has a place on it, grouped in sections. Changes
 * apply at once; values that a policy sets are shown but cannot be changed.
 */
export class SettingsPage extends LitElement {
  static override properties = {
    revision: { state: true },
    searchError: { state: true },
    customSearch: { state: true },
  };

  /** Styles of the page, scoped to its shadow root. */
  static override styles = [
    choiceStyles,
    css`
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
      select,
      input[type='url'],
      button {
        height: 32px;
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
  declare customSearch: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private client: SettingsClient | undefined;

  constructor() {
    super();
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
      this.customSearch = this.engineId() === 'custom';
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
    const t = this.t;
    return html`
      <h1>${t('settings.title')}</h1>
      <h2 id="appearance">${t('settings.appearance')}</h2>
      <section aria-labelledby="appearance">
        ${this.renderChoice('appearance.colorMode', 'settings.colorMode')} ${this.renderAccent()}
        ${this.renderChoice('appearance.density', 'settings.density')}
        ${this.renderChoice('tabs.position', 'settings.tabPosition')}
      </section>
      <h2 id="startup">${t('settings.startup')}</h2>
      <section aria-labelledby="startup">
        ${this.renderChoice('startup.page', 'settings.startupPage')}
      </section>
      <h2 id="search">${t('settings.search')}</h2>
      <section aria-labelledby="search">${this.renderSearch()}</section>
      <h2 id="privacy">${t('settings.privacy')}</h2>
      <section aria-labelledby="privacy">
        ${this.renderToggle('contentBlocker.enabled', 'settings.contentBlocker', 'settings.contentBlockerNote')}
      </section>
      <h2 id="default-browser">${t('defaultBrowser.title')}</h2>
      <section aria-labelledby="default-browser">
        <default-browser .bridge=${this.bridge} .i18n=${this.i18n}></default-browser>
      </section>
      <h2 id="import">${t('import.title')}</h2>
      <div class="plain" role="group" aria-labelledby="import">
        <p class="intro">${t('import.note')}</p>
        <browser-import .bridge=${this.bridge} .i18n=${this.i18n}></browser-import>
      </div>
      <h2 id="setup">${t('settings.setup')}</h2>
      <section aria-labelledby="setup">
        <div class="row">
          <span class="label">
            <span>${t('settings.setupGuide')}</span>
            <span class="note">${t('settings.setupGuideNote')}</span>
          </span>
          <button @click=${() => void this.bridge?.invoke('settings.openSetup', {})}>
            ${t('settings.setupGuideOpen')}
          </button>
        </div>
      </section>
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

  private renderToggle(key: string, label: MessageKey, note: MessageKey): TemplateResult {
    const setting = this.client?.get(key);
    return html`<div class="row">
      <label class="label" for=${key}>
        <span>${this.t(label)}</span>
        <span class="note">
          ${setting?.locked === true ? this.t('settings.managed') : this.t(note)}
        </span>
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
      await this.client?.set('search.urlTemplate', engine.searchUrl);
    }
  }

  private async setSearchUrl(event: Event): Promise<void> {
    const input = event.target;
    if (input instanceof HTMLInputElement && this.client !== undefined) {
      this.searchError = !(await this.client.set('search.urlTemplate', input.value.trim()));
    }
  }
}
