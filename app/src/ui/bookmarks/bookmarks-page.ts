import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { bookmarkRoots } from '../../shared/bookmarks.ts';
import type { MessageKey, Translator } from '../i18n/i18n.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';

/** A bookmark or a folder, as the browser process reports it. */
interface Item {
  readonly id: number;
  readonly parentId: number | null;
  readonly title: string;
  readonly url: string | null;
}

const isItem = (value: unknown): value is Item =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'number' &&
  'parentId' in value &&
  (value.parentId === null || typeof value.parentId === 'number') &&
  'title' in value &&
  typeof value.title === 'string' &&
  'url' in value &&
  (value.url === null || typeof value.url === 'string');

const roots = [bookmarkRoots.bar, bookmarkRoots.other] as const;

/**
 * The bookmarks page: the bookmarks bar and the other bookmarks with their folders. It
 * opens, renames, moves and removes bookmarks, adds folders, and searches all bookmarks.
 */
export class BookmarksPage extends LitElement {
  static override properties = {
    items: { state: true },
    query: { state: true },
    expanded: { state: true },
    editing: { state: true },
    confirming: { state: true },
    error: { state: true },
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
    h1 {
      margin: 24px 0 16px;
      font-size: 20px;
      line-height: 28px;
      font-weight: 600;
    }
    input,
    select {
      box-sizing: border-box;
      height: 32px;
      padding: 0 var(--space-2);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-1);
      background: var(--surface-1);
      color: var(--text-1);
      font: inherit;
    }
    input[type='search'] {
      width: 100%;
      height: 36px;
      margin-bottom: 16px;
      padding: 0 var(--space-3);
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 16px 0 4px;
    }
    h2 {
      flex: 1;
      margin: 0;
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      color: var(--text-2);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .list {
      border: 1px solid var(--border-1);
      border-radius: var(--radius-2);
      background: var(--surface-1);
    }
    li + li,
    .nested > li:first-child {
      border-top: 1px solid var(--border-1);
    }
    .nested {
      padding-inline-start: 20px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      min-height: 36px;
      padding: 0 var(--space-1) 0 var(--space-3);
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
    .host,
    .empty,
    .note {
      color: var(--text-2);
    }
    .host {
      flex: none;
      max-width: 40%;
    }
    .note {
      padding: var(--space-2) var(--space-3);
    }
    .folder::before {
      content: '›' / '';
      display: inline-block;
      width: 12px;
      color: var(--text-2);
    }
    .folder[aria-expanded='true']::before {
      transform: rotate(90deg);
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
    .open,
    .folder {
      height: auto;
      border: 0;
      padding-inline: 0;
    }
    .open:hover,
    .folder:hover {
      background: none;
    }
    .tool {
      width: 28px;
      padding: 0;
      border-color: transparent;
      background: transparent;
      color: var(--text-2);
    }
    form {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--space-2) var(--space-3);
      align-items: center;
      padding: var(--space-3);
    }
    .actions {
      grid-column: 2;
      display: flex;
      gap: var(--space-2);
    }
    [role='alert'] {
      grid-column: 2;
      margin: 0;
      color: var(--danger);
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
  `;

  declare items: readonly Item[];
  declare query: string;
  declare expanded: ReadonlySet<number>;
  declare editing: number | undefined;
  declare confirming: number | undefined;
  declare error: string | undefined;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private stopListening: (() => void) | undefined;

  constructor() {
    super();
    this.items = [];
    this.query = '';
    this.expanded = new Set();
    this.editing = undefined;
    this.confirming = undefined;
    this.error = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The star in the address bar and other bookmarks pages change the bookmarks, too.
    this.stopListening = this.bridge?.on('bookmarks.changed', () => void this.load());
    void this.load().then(() => {
      document.documentElement.dataset['ready'] = 'true';
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopListening?.();
  }

  protected override render(): TemplateResult {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    return html`
      <h1>${this.t('bookmarks.title')}</h1>
      <input
        type="search"
        aria-label=${this.t('bookmarks.search')}
        placeholder=${this.t('bookmarks.search')}
        .value=${this.query}
        @input=${this.search}
      />
      ${words.length > 0 ? this.renderMatches(words) : roots.map((root) => this.renderSection(root))}
    `;
  }

  private renderSection(root: number): TemplateResult {
    const label = this.rootLabel(root);
    const children = this.childrenOf(root);
    return html`<section>
      <div class="head">
        <h2>${label}</h2>
        <button
          aria-label=${this.t('bookmarks.newFolderIn', { folder: label })}
          @click=${() => void this.addFolder(root)}
        >
          ${this.t('bookmarks.newFolder')}
        </button>
      </div>
      ${
        children.length === 0
          ? html`<p class="empty">${this.t('bookmarks.emptyFolder')}</p>`
          : html`<ul class="list">
              ${children.map((item) => this.renderItem(item))}
            </ul>`
      }
    </section>`;
  }

  private renderMatches(words: readonly string[]): TemplateResult {
    const matches = this.items.filter(
      (item) =>
        item.url !== null &&
        words.every((word) => `${item.title} ${item.url ?? ''}`.toLowerCase().includes(word)),
    );
    return matches.length === 0
      ? html`<p class="empty">${this.t('bookmarks.empty')}</p>`
      : html`<ul class="list">
          ${matches.map((item) => this.renderItem(item, false))}
        </ul>`;
  }

  private renderItem(item: Item, nested = true): TemplateResult {
    if (this.editing === item.id) {
      return html`<li>${this.renderEditor(item)}</li>`;
    }
    const name = item.title || (item.url ?? '');
    if (this.confirming === item.id) {
      return html`<li class="row">
        <span class="open">${this.t('bookmarks.removeFolderConfirm', { title: name })}</span>
        <button @click=${() => void this.removeItem(item)}>
          ${this.t('bookmarks.removeConfirm')}
        </button>
        <button @click=${() => (this.confirming = undefined)}>${this.t('bookmarks.cancel')}</button>
      </li>`;
    }
    const tools = html`<button
        class="tool"
        aria-label=${this.t('bookmarks.edit', { title: name })}
        title=${this.t('bookmarks.edit', { title: name })}
        @click=${() => this.edit(item)}
      >
        ✎
      </button>
      <button
        class="tool"
        aria-label=${this.t('bookmarks.remove', { title: name })}
        title=${this.t('bookmarks.remove', { title: name })}
        @click=${() => this.askToRemove(item)}
      >
        ×
      </button>`;
    const url = item.url;
    if (url !== null) {
      return html`<li class="row">
        <button
          class="open"
          title=${url}
          @click=${(event: MouseEvent) => this.open(url, event.ctrlKey || event.metaKey)}
          @auxclick=${(event: MouseEvent) => event.button === 1 && this.open(url, true)}
        >
          <span>${name}</span>
          <span class="host">${hostOf(url)}</span>
        </button>
        ${tools}
      </li>`;
    }
    const open = nested && this.expanded.has(item.id);
    const children = open ? this.childrenOf(item.id) : [];
    return html`<li>
      <div class="row">
        <button
          class="open folder"
          aria-expanded=${open ? 'true' : 'false'}
          @click=${() => this.toggle(item.id)}
        >
          <span>${name}</span>
        </button>
        ${tools}
      </div>
      ${
        open
          ? html`<ul class="nested">
              ${
                children.length === 0
                  ? html`<li class="note">${this.t('bookmarks.emptyFolder')}</li>`
                  : children.map((child) => this.renderItem(child))
              }
            </ul>`
          : nothing
      }
    </li>`;
  }

  private renderEditor(item: Item): TemplateResult {
    const targets = this.folderChoices(item);
    return html`<form @submit=${(event: SubmitEvent) => void this.save(event, item)}>
      <label for="title">${this.t('bookmarks.name')}</label>
      <input id="title" name="title" .value=${item.title} required maxlength="1024" />
      ${
        item.url === null
          ? nothing
          : html`<label for="url">${this.t('bookmarks.address')}</label>
              <input id="url" name="url" .value=${item.url} required maxlength="8192" />`
      }
      <label for="parent">${this.t('bookmarks.folder')}</label>
      <select id="parent" name="parent">
        ${targets.map(
          ({ id, label }) =>
            html`<option value=${id} ?selected=${id === item.parentId}>${label}</option>`,
        )}
      </select>
      ${this.error === undefined ? nothing : html`<p role="alert">${this.error}</p>`}
      <div class="actions">
        <button type="submit">${this.t('bookmarks.save')}</button>
        <button type="button" @click=${this.cancelEdit}>${this.t('bookmarks.cancel')}</button>
      </div>
    </form>`;
  }

  private t(key: MessageKey, params?: Record<string, string>): string {
    return this.i18n?.t(key, params) ?? key;
  }

  private rootLabel(id: number): string {
    return this.t(id === bookmarkRoots.bar ? 'bookmarks.bar' : 'bookmarks.other');
  }

  private childrenOf(id: number): Item[] {
    return this.items.filter((item) => item.parentId === id);
  }

  /** Every folder that an item may move to, indented by depth: never into itself. */
  private folderChoices(item: Item): { id: number; label: string }[] {
    const choices: { id: number; label: string }[] = [];
    const visit = (id: number, label: string, depth: number): void => {
      if (id === item.id) return;
      choices.push({ id, label: `${' '.repeat(depth)}${label}` });
      for (const child of this.childrenOf(id)) {
        if (child.url === null) visit(child.id, child.title, depth + 1);
      }
    };
    for (const root of roots) visit(root, this.rootLabel(root), 0);
    return choices;
  }

  private readonly search = (event: Event): void => {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.query = input.value;
  };

  private async load(): Promise<void> {
    const result = await this.bridge?.invoke('bookmarks.list', {});
    this.items =
      typeof result === 'object' &&
      result !== null &&
      'items' in result &&
      Array.isArray(result.items)
        ? result.items.filter(isItem)
        : [];
  }

  private open(url: string, newTab: boolean): void {
    void this.bridge?.invoke('bookmarks.open', { url, newTab });
  }

  private toggle(id: number): void {
    const expanded = new Set(this.expanded);
    if (!expanded.delete(id)) expanded.add(id);
    this.expanded = expanded;
  }

  private edit(item: Item): void {
    this.editing = item.id;
    this.confirming = undefined;
    this.error = undefined;
  }

  private readonly cancelEdit = (): void => {
    this.editing = undefined;
    this.error = undefined;
  };

  private async addFolder(parentId: number): Promise<void> {
    const result = await this.bridge?.invoke('bookmarks.add', {
      parentId,
      title: this.t('bookmarks.newFolder'),
    });
    await this.load();
    if (typeof result === 'object' && result !== null && 'id' in result) {
      const id = Number(result.id);
      this.expanded = new Set([...this.expanded, parentId]);
      this.editing = id;
      this.error = undefined;
    }
  }

  private async save(event: SubmitEvent, item: Item): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const field = (name: string): string => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const title = field('title');
    const url = item.url === null ? undefined : field('url');
    const parentId = Number(field('parent'));
    if (url !== undefined && !/^https?:\/\/\S+$/i.test(url)) {
      this.error = this.t('bookmarks.invalidAddress');
      return;
    }
    await this.bridge?.invoke('bookmarks.update', {
      id: item.id,
      title,
      ...(url === undefined ? {} : { url }),
      ...(parentId === item.parentId ? {} : { parentId }),
    });
    this.editing = undefined;
    this.error = undefined;
    await this.load();
  }

  private askToRemove(item: Item): void {
    if (item.url === null && this.childrenOf(item.id).length > 0) {
      this.confirming = item.id;
    } else {
      void this.removeItem(item);
    }
  }

  private async removeItem(item: Item): Promise<void> {
    await this.bridge?.invoke('bookmarks.remove', { id: item.id });
    this.confirming = undefined;
    await this.load();
  }
}

function hostOf(url: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '';
}
