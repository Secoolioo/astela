import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { MessageKey, Translator } from '../i18n/i18n.ts';
import type { PageBridge } from './settings-client.ts';

/** A profile of another browser, as the browser process reports it. */
interface Profile {
  readonly id: string;
  readonly browser: string;
  readonly profile: string;
  readonly tabs: boolean;
}

/** What an import did, or that it is running. */
type Outcome =
  | 'running'
  | {
      readonly bookmarks: number;
      readonly history: number;
      readonly tabs: number;
      readonly failed: boolean;
    };

type Kind = 'bookmarks' | 'history' | 'tabs';

const isProfile = (value: unknown): value is Profile =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'browser' in value &&
  typeof value.browser === 'string' &&
  'profile' in value &&
  typeof value.profile === 'string' &&
  'tabs' in value &&
  typeof value.tabs === 'boolean';

const count = (value: unknown, key: string): number => {
  const number: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, key) : 0;
  return typeof number === 'number' ? number : 0;
};

/**
 * The import from other browsers, on the settings page and in the setup guide: the
 * browsers found on this computer, what to import, and one button per browser profile.
 */
export class BrowserImport extends LitElement {
  static override properties = {
    profiles: { state: true },
    enabled: { state: true },
    kinds: { state: true },
    outcomes: { state: true },
  };

  /** Styles of the list, scoped to its shadow root. */
  static override styles = css`
    :host {
      display: block;
    }
    .kinds {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-3);
    }
    .kinds label {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    input {
      margin: 0;
      accent-color: var(--accent);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--border-1);
      border-radius: var(--radius-2);
      background: var(--surface-1);
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 48px;
      padding: 0 var(--space-3);
    }
    li + li {
      border-top: 1px solid var(--border-1);
    }
    .name {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .note,
    .profile {
      color: var(--text-2);
    }
    .result {
      flex: 0 1 50%;
      color: var(--text-2);
      text-align: end;
    }
    button {
      height: 28px;
      padding: 0 var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-1);
      color: var(--text-1);
      font: inherit;
    }
    button:hover:not(:disabled) {
      background: var(--surface-hover);
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
  `;

  declare profiles: readonly Profile[] | undefined;
  declare enabled: boolean;
  declare kinds: Readonly<Record<Kind, boolean>>;
  declare outcomes: ReadonlyMap<string, Outcome>;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;

  constructor() {
    super();
    this.profiles = undefined;
    this.enabled = true;
    this.kinds = { bookmarks: true, history: true, tabs: false };
    this.outcomes = new Map();
  }

  protected override firstUpdated(): void {
    void this.load();
  }

  protected override render(): TemplateResult | typeof nothing {
    if (this.profiles === undefined) return nothing;
    if (!this.enabled) return html`<p class="note">${this.t('import.managed')}</p>`;
    if (this.profiles.length === 0) return html`<p class="note">${this.t('import.none')}</p>`;
    const tabs = this.profiles.some((profile) => profile.tabs);
    return html`<div class="kinds" role="group" aria-label=${this.t('import.what')}>
        ${this.renderKind('bookmarks', 'import.bookmarks')}
        ${this.renderKind('history', 'import.history')}
        ${tabs ? this.renderKind('tabs', 'import.tabs') : nothing}
      </div>
      <ul>
        ${this.profiles.map((profile) => this.renderProfile(profile))}
      </ul>`;
  }

  private renderKind(kind: Kind, label: MessageKey): TemplateResult {
    return html`<label>
      <input
        type="checkbox"
        .checked=${this.kinds[kind]}
        @change=${(event: Event) => {
          const input = event.target;
          if (input instanceof HTMLInputElement) {
            this.kinds = { ...this.kinds, [kind]: input.checked };
          }
        }}
      />${this.t(label)}
    </label>`;
  }

  private renderProfile(profile: Profile): TemplateResult {
    const outcome = this.outcomes.get(profile.id);
    const name = this.nameOf(profile);
    const nothingChosen = !this.kinds.bookmarks && !this.kinds.history && !this.kinds.tabs;
    return html`<li>
      <span class="name">
        <span>${profile.browser}</span>
        ${this.profileShown(profile) ? html`<span class="profile">${profile.profile}</span>` : nothing}
      </span>
      <span class="result" role="status">${this.describe(outcome, profile)}</span>
      <button
        aria-label=${this.t('import.from', { browser: name })}
        ?disabled=${outcome === 'running' || nothingChosen}
        @click=${() => void this.run(profile)}
      >
        ${this.t('import.button')}
      </button>
    </li>`;
  }

  private describe(outcome: Outcome | undefined, profile: Profile): string {
    if (outcome === undefined) return '';
    if (outcome === 'running') return this.t('import.running');
    const number = new Intl.NumberFormat(this.i18n?.language);
    const done = this.t('import.done', {
      bookmarks: number.format(outcome.bookmarks),
      history: number.format(outcome.history),
      tabs: number.format(outcome.tabs),
    });
    return outcome.failed
      ? `${done} ${this.t('import.failed', { browser: profile.browser })}`
      : done;
  }

  private t(key: MessageKey, params?: Readonly<Record<string, string>>): string {
    return this.i18n?.t(key, params) ?? key;
  }

  /** Whether a browser has more than one profile, so the profile's name tells them apart. */
  private profileShown(profile: Profile): boolean {
    return (this.profiles ?? []).filter((other) => other.browser === profile.browser).length > 1;
  }

  private nameOf(profile: Profile): string {
    return this.profileShown(profile) ? `${profile.browser} (${profile.profile})` : profile.browser;
  }

  private async load(): Promise<void> {
    const result = await this.bridge?.invoke('settings.findBrowsers', {}).catch(() => undefined);
    const enabled =
      typeof result === 'object' && result !== null ? Reflect.get(result, 'enabled') : true;
    const profiles: unknown =
      typeof result === 'object' && result !== null ? Reflect.get(result, 'profiles') : [];
    this.enabled = enabled !== false;
    this.profiles = Array.isArray(profiles) ? profiles.filter(isProfile) : [];
  }

  private async run(profile: Profile): Promise<void> {
    this.outcomes = new Map([...this.outcomes, [profile.id, 'running']]);
    const result = await this.bridge
      ?.invoke('settings.importBrowser', {
        id: profile.id,
        ...this.kinds,
        tabs: this.kinds.tabs && profile.tabs,
        labels: {
          folder: this.t('import.folder', { browser: this.nameOf(profile) }),
          toolbar: this.t('import.firefoxToolbar'),
          menu: this.t('import.firefoxMenu'),
          other: this.t('import.firefoxOther'),
          mobile: this.t('import.firefoxMobile'),
        },
      })
      .catch(() => undefined);
    const failed: unknown =
      typeof result === 'object' && result !== null ? Reflect.get(result, 'failed') : ['all'];
    this.outcomes = new Map([
      ...this.outcomes,
      [
        profile.id,
        {
          bookmarks: count(result, 'bookmarks'),
          history: count(result, 'history'),
          tabs: count(result, 'tabs'),
          failed: !Array.isArray(failed) || failed.length > 0,
        },
      ],
    ]);
  }
}
