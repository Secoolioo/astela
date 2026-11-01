import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { Translator } from '../i18n/i18n.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';

/** A page of the history, as the browser process reports it. */
interface Item {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly lastVisit: number;
}

const isItem = (value: unknown): value is Item =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'number' &&
  'url' in value &&
  typeof value.url === 'string' &&
  'title' in value &&
  typeof value.title === 'string' &&
  'lastVisit' in value &&
  typeof value.lastVisit === 'number';

/**
 * The history page: the pages you visited, newest first and grouped by day, with search,
 * and with a way to remove single pages or everything.
 */
export class HistoryPage extends LitElement {
  static override properties = {
    items: { state: true },
    query: { state: true },
    more: { state: true },
    confirming: { state: true },
  };

  /** Styles of the page, scoped to its shadow root. */
  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      max-width: 760px;
      margin: 0 auto;
      padding: var(--space-3) var(--space-3) 48px;
    }
    header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 24px 0 16px;
    }
    h1 {
      flex: 1;
      margin: 0;
      font-size: 20px;
      line-height: 28px;
      font-weight: 600;
    }
    input[type='search'] {
      box-sizing: border-box;
      width: 100%;
      height: 36px;
      margin-bottom: 16px;
      padding: 0 var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-1);
      color: var(--text-1);
      font: inherit;
    }
    h2 {
      margin: 16px 0 4px;
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      color: var(--text-2);
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
      gap: var(--space-2);
      min-height: 36px;
      padding: 0 var(--space-1) 0 var(--space-3);
    }
    li + li {
      border-top: 1px solid var(--border-1);
    }
    time {
      flex: none;
      width: 44px;
      color: var(--text-2);
      font-variant-numeric: tabular-nums;
    }
    .open {
      flex: 1;
      min-width: 0;
      display: flex;
      gap: var(--space-2);
      align-items: baseline;
      padding: var(--space-2) 0;
      border: 0;
      background: none;
      color: var(--text-1);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .open span {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .host {
      flex: none;
      max-width: 40%;
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
    .remove {
      width: 28px;
      padding: 0;
      border-color: transparent;
      background: transparent;
      color: var(--text-2);
    }
    .empty {
      color: var(--text-2);
    }
    .more {
      display: block;
      margin: 16px auto 0;
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
  `;

  declare items: readonly Item[];
  declare query: string;
  declare more: boolean;
  declare confirming: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.items = [];
    this.query = '';
    this.more = false;
    this.confirming = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load(false).then(() => {
      document.documentElement.dataset['ready'] = 'true';
    });
  }

  protected override render(): TemplateResult {
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    return html`
      <header>
        <h1>${t('history.title')}</h1>
        ${
          this.confirming
            ? html`<span>${t('history.clearConfirm')}</span>
                <button @click=${this.clear}>${t('history.clear')}</button>
                <button @click=${() => (this.confirming = false)}>${t('history.cancel')}</button>`
            : html`<button
                ?disabled=${this.items.length === 0}
                @click=${() => (this.confirming = true)}
              >
                ${t('history.clearAll')}
              </button>`
        }
      </header>
      <input
        type="search"
        aria-label=${t('history.search')}
        placeholder=${t('history.search')}
        .value=${this.query}
        @input=${this.search}
      />
      ${this.items.length === 0 ? html`<p class="empty">${t('history.empty')}</p>` : this.renderDays()}
      ${
        this.more
          ? html`<button class="more" @click=${() => void this.load(true)}>
              ${t('history.more')}
            </button>`
          : nothing
      }
    `;
  }

  private renderDays(): TemplateResult[] {
    const days = new Map<string, Item[]>();
    for (const item of this.items) {
      const day = new Date(item.lastVisit).toDateString();
      days.set(day, [...(days.get(day) ?? []), item]);
    }
    const format = new Intl.DateTimeFormat(this.i18n?.language, { dateStyle: 'full' });
    const time = new Intl.DateTimeFormat(this.i18n?.language, { timeStyle: 'short' });
    return [...days].map(
      ([day, items]) =>
        html`<h2>${format.format(new Date(day))}</h2>
          <ul>
            ${items.map(
              (item) =>
                html`<li>
                  <time>${time.format(new Date(item.lastVisit))}</time>
                  <button
                    class="open"
                    title=${item.url}
                    @click=${(event: MouseEvent) => this.open(item, event.ctrlKey || event.metaKey)}
                    @auxclick=${(event: MouseEvent) => event.button === 1 && this.open(item, true)}
                  >
                    <span>${item.title || item.url}</span>
                    <span class="host">${hostOf(item.url)}</span>
                  </button>
                  <button
                    class="remove"
                    aria-label=${this.i18n?.t('history.remove', { title: item.title || item.url }) ?? ''}
                    @click=${() => void this.removeItem(item)}
                  >
                    ×
                  </button>
                </li>`,
            )}
          </ul>`,
    );
  }

  private readonly search = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.query = input.value;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(false), 150);
  };

  private async load(append: boolean): Promise<void> {
    const before = append ? this.items.at(-1)?.lastVisit : undefined;
    const result = await this.bridge?.invoke('history.list', {
      query: this.query.slice(0, 256),
      ...(before === undefined ? {} : { before }),
    });
    const items =
      typeof result === 'object' &&
      result !== null &&
      'items' in result &&
      Array.isArray(result.items)
        ? result.items.filter(isItem)
        : [];
    this.items = append ? [...this.items, ...items] : items;
    this.more = items.length === 200;
  }

  private open(item: Item, newTab: boolean): void {
    void this.bridge?.invoke('history.open', { url: item.url, newTab });
  }

  private async removeItem(item: Item): Promise<void> {
    await this.bridge?.invoke('history.delete', { ids: [item.id] });
    this.items = this.items.filter((other) => other.id !== item.id);
  }

  private readonly clear = async (): Promise<void> => {
    await this.bridge?.invoke('history.clear', {});
    this.confirming = false;
    this.items = [];
    this.more = false;
  };
}

function hostOf(url: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '';
}
