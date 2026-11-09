import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { Translator } from '../i18n/i18n.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';

/** The content blocker's popover, as the browser process sends it. */
interface Shield {
  readonly kind: 'shield';
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly site: string;
  readonly blocked: number;
  readonly on: boolean;
  readonly available: boolean;
  readonly failed: boolean;
}

/** A site, or a proxy, that asks for a user name and password. */
interface Login {
  readonly kind: 'login';
  readonly host: string;
  readonly realm: string;
  readonly proxy: boolean;
  readonly secure: boolean;
}

type Content = Shield | Login;

// The browser process checks every message against its contract before it sends it.
const isContent = (value: unknown): value is Content =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (value.kind === 'shield' || value.kind === 'login');

/** Width of a popover, and its distance to the window's edges and to its button. */
const width = 288;
const margin = 8;
const gap = 4;

/**
 * The page of the overlay: it shows one popover next to the button that opened it. A click
 * next to the popover or Escape closes it; the browser process runs shortcuts.
 */
export class OverlayPage extends LitElement {
  static override properties = { content: { state: true } };

  /** Styles of the page, scoped to its shadow root. */
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      font: var(--font-size-ui) / 1.4 var(--font-ui);
      color: var(--text-1);
    }
    .backdrop {
      position: fixed;
      inset: 0;
    }
    section {
      position: fixed;
      left: var(--left);
      top: var(--top);
      width: ${width}px;
      box-sizing: border-box;
      padding: var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-2);
      background: var(--surface-1);
    }
    .site {
      margin: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .count {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      margin: var(--space-2) 0 var(--space-3);
      color: var(--text-2);
    }
    .count strong {
      font-size: 24px;
      font-weight: 600;
      color: var(--text-1);
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-2) 0;
      border-top: 1px solid var(--border-1);
    }
    .note {
      margin: var(--space-2) 0 0;
      color: var(--text-2);
    }
    .problem {
      color: var(--danger);
    }
    input[role='switch'] {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--accent);
    }
    button {
      width: 100%;
      margin-top: var(--space-2);
      padding: var(--space-2);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-2);
      color: inherit;
      font: inherit;
      text-align: start;
    }
    button:hover {
      background: var(--surface-hover);
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
    .dialog {
      position: fixed;
      top: 96px;
      left: 50%;
      width: 360px;
      max-width: calc(100% - 16px);
      box-sizing: border-box;
      transform: translateX(-50%);
      padding: var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-2);
      background: var(--surface-1);
    }
    .dialog h2 {
      margin: 0 0 var(--space-2);
      font-size: 16px;
      font-weight: 600;
    }
    .dialog p {
      margin: 0 0 var(--space-2);
      overflow-wrap: anywhere;
    }
    .dialog label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: var(--space-2);
    }
    .dialog input {
      height: 32px;
      padding: 0 var(--space-2);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-0);
      color: inherit;
      font: inherit;
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    .buttons button {
      width: auto;
      margin: 0;
      text-align: center;
    }
    .buttons .primary {
      border-color: var(--accent);
    }
  `;

  declare content: Content | null;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private stopListening: (() => void) | undefined;

  constructor() {
    super();
    this.content = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.stopListening = this.bridge?.on('overlay.changed', (content) => this.show(content));
    void this.bridge?.invoke('overlay.get', {}).then((content) => this.show(content));
    document.addEventListener('keydown', this.onKeyDown);
  }

  override disconnectedCallback(): void {
    this.stopListening?.();
    document.removeEventListener('keydown', this.onKeyDown);
    super.disconnectedCallback();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.content !== null) {
      event.preventDefault();
      this.close();
    }
  };

  private show(content: unknown): void {
    const before = this.content?.kind;
    this.content = isContent(content) ? content : null;
    if (this.content === null) return;
    if (this.content.kind === 'shield') this.place(this.content.anchor);
    // What opens takes the focus, so the keyboard reaches its first field or switch.
    if (before !== this.content.kind) {
      void this.updateComplete.then(() => this.renderRoot.querySelector('input')?.focus());
    }
  }

  /** Puts the popover below its button, its right edge at the button's, inside the window. */
  private place(anchor: Shield['anchor']): void {
    const left = Math.min(
      Math.max(margin, anchor.x + anchor.width - width),
      Math.max(margin, innerWidth - width - margin),
    );
    this.style.setProperty('--left', `${left}px`);
    this.style.setProperty('--top', `${anchor.y + anchor.height + gap}px`);
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === null) return nothing;
    if (content.kind === 'login') return this.renderLogin(content);
    return html`<div class="backdrop" @click=${this.close}></div>
      <section role="dialog" aria-label=${this.t('shell.blocker')}>
        <p class="site">${content.site}</p>
        <p class="count">
          <strong>${content.blocked}</strong><span>${this.t('overlay.blocked')}</span>
        </p>
        <label class="row">
          <span>${this.t('overlay.blockOnSite', { site: content.site })}</span>
          <input
            type="checkbox"
            role="switch"
            .checked=${content.on}
            ?disabled=${!content.available}
            @change=${this.toggle}
          />
        </label>
        ${
          content.failed
            ? html`<p class="note problem" role="alert">
                ${this.t('settings.contentBlockerFailed')}
              </p>`
            : content.available
              ? nothing
              : html`<p class="note">${this.t('overlay.blockerOff')}</p>`
        }
        <button type="button" @click=${this.openSettings}>
          ${this.t('overlay.blockerSettings')}
        </button>
      </section>`;
  }

  /** The sign-in prompt: it stays open until the user signs in or cancels. */
  private renderLogin(login: Login): TemplateResult {
    const site = { site: login.host };
    return html`<div class="backdrop"></div>
      <form class="dialog" role="dialog" aria-labelledby="login-title" @submit=${this.signIn}>
        <h2 id="login-title">${this.t('overlay.signInTitle')}</h2>
        <p>${this.t(login.proxy ? 'overlay.signInProxy' : 'overlay.signInSite', site)}</p>
        ${
          login.realm === ''
            ? nothing
            : html`<p class="note">${this.t('overlay.signInRealm', { realm: login.realm })}</p>`
        }
        ${login.secure ? nothing : html`<p class="note problem">${this.t('overlay.signInInsecure')}</p>`}
        <label>
          <span>${this.t('overlay.username')}</span>
          <input name="username" autocomplete="username" spellcheck="false" maxlength="1024" />
        </label>
        <label>
          <span>${this.t('overlay.password')}</span>
          <input name="password" type="password" autocomplete="current-password" maxlength="1024" />
        </label>
        <div class="buttons">
          <button type="button" @click=${this.close}>${this.t('overlay.cancel')}</button>
          <button type="submit" class="primary">${this.t('overlay.signIn')}</button>
        </div>
      </form>`;
  }

  private readonly signIn = (event: SubmitEvent): void => {
    // The page cannot submit forms; the browser process gets the values instead.
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const value = (name: string): string => {
      const field = form.elements.namedItem(name);
      return field instanceof HTMLInputElement ? field.value : '';
    };
    void this.bridge?.invoke('overlay.signIn', {
      username: value('username'),
      password: value('password'),
    });
  };

  private readonly close = (): void => {
    void this.bridge?.invoke('overlay.close', {});
  };

  private readonly toggle = (): void => {
    void this.bridge?.invoke('overlay.toggleSiteBlocking', {});
  };

  private readonly openSettings = (): void => {
    void this.bridge?.invoke('overlay.openBlockerSettings', {});
  };

  private t(
    key: Parameters<Translator['t']>[0],
    params?: Readonly<Record<string, string>>,
  ): string {
    return this.i18n?.t(key, params) ?? key;
  }
}
