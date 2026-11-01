import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { brand } from '../../shared/brand.ts';
import type { MessageKey, Translator } from '../i18n/i18n.ts';
import type { PageBridge } from './settings-client.ts';

type Outcome = 'done' | 'settings' | 'failed';

/**
 * The default browser setting, on the settings page and in the setup guide: whether the
 * browser is the default, and a button that makes it the default. The state is read again
 * when the page gets the focus back, for example from the system settings.
 */
export class DefaultBrowser extends LitElement {
  static override properties = {
    isDefault: { state: true },
    allowed: { state: true },
    outcome: { state: true },
  };

  /** Styles of the row, scoped to its shadow root. */
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 48px;
      padding: var(--space-2) var(--space-3);
      box-sizing: border-box;
    }
    .label {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .note {
      color: var(--text-2);
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
    button:hover {
      background: var(--surface-hover);
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
  `;

  declare isDefault: boolean | undefined;
  declare allowed: boolean;
  declare outcome: Outcome | undefined;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;

  constructor() {
    super();
    this.isDefault = undefined;
    this.allowed = true;
    this.outcome = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('focus', this.load);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('focus', this.load);
  }

  protected override firstUpdated(): void {
    this.load();
  }

  protected override render(): TemplateResult | typeof nothing {
    if (this.isDefault === undefined) return nothing;
    const note = !this.allowed
      ? this.t('settings.managed')
      : this.isDefault
        ? this.t('defaultBrowser.is')
        : this.outcome === 'settings'
          ? this.t('defaultBrowser.windows')
          : this.outcome === 'failed'
            ? this.t('defaultBrowser.failed')
            : this.t('defaultBrowser.not');
    return html`<span class="label">
        <span>${this.t('defaultBrowser.title')}</span>
        <span class="note" role="status">${note}</span>
      </span>
      ${
        this.allowed && !this.isDefault
          ? html`<button @click=${() => void this.make()}>${this.t('defaultBrowser.make')}</button>`
          : nothing
      }`;
  }

  private t(key: MessageKey): string {
    return this.i18n?.t(key, { product: brand.productName }) ?? key;
  }

  private readonly load = (): void => {
    void this.bridge
      ?.invoke('settings.getDefaultBrowser', {})
      .then((result) => {
        if (typeof result !== 'object' || result === null) return;
        this.isDefault = Reflect.get(result, 'isDefault') === true;
        this.allowed = Reflect.get(result, 'allowed') !== false;
      })
      .catch(() => undefined);
  };

  private async make(): Promise<void> {
    const result = await this.bridge
      ?.invoke('settings.makeDefaultBrowser', {})
      .catch(() => undefined);
    const outcome: unknown =
      typeof result === 'object' && result !== null ? Reflect.get(result, 'outcome') : 'failed';
    this.outcome = outcome === 'done' || outcome === 'settings' ? outcome : 'failed';
    this.load();
  }
}
