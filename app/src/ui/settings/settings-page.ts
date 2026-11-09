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
    blockerFailed: { state: true },
    siteError: { state: true },
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
      .problem {
        color: var(--danger);
      }
      .error {
        color: var(--danger);
        font-size: 12px;
        line-height: 16px;
      }
      select,
      input[type='url'],
      input[type='text'],
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
  declare customSearch: boolean;
  /** Whether the content blocker has no usable filter data. */
  declare blockerFailed: boolean;
  /** Whether the last site to add was not a site name. */
  declare siteError: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private client: SettingsClient | undefined;

  constructor() {
    super();
    this.revision = 0;
    this.searchError = false;
    this.customSearch = false;
    this.blockerFailed = false;
    this.siteError = false;
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
        ${this.renderToggle('bookmarks.bar', 'settings.bookmarksBar', 'settings.bookmarksBarNote')}
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
        ${this.renderToggle('contentBlocker.cookieNotices', 'settings.cookieNotices', 'settings.cookieNoticesNote')}
        ${this.renderToggle('contentBlocker.annoyances', 'settings.annoyances', 'settings.annoyancesNote')}
        ${this.renderAllowedSites()} ${this.renderSitePermissions()}
        ${
          this.blockerFailed
            ? html`<p class="row note problem" role="alert">
                ${t('settings.contentBlockerFailed')}
              </p>`
            : nothing
        }
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

/**
 * The host name of what someone typed as a site, such as `example.com` for
 * `https://www.example.com/page` without its `www.`; `undefined` when it is no site name.
 * @param input - The text of the field.
 */
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
