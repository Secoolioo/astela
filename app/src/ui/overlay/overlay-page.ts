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

/** A site that asks for permissions. */
interface Permission {
  readonly kind: 'permission';
  readonly id: number;
  readonly site: string;
  readonly permissions: readonly (
    'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard'
  )[];
}

/** A site that wants to see a screen or a window, and what it can choose from. */
interface Screen {
  readonly kind: 'screen';
  readonly site: string;
  readonly sources: readonly {
    readonly id: string;
    readonly name: string;
    readonly screen: boolean;
    readonly thumbnail: string;
  }[];
}

/** A download of the list, as the browser process sends it. */
interface DownloadItem {
  readonly id: number;
  readonly name: string;
  readonly state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  readonly received: number;
  readonly total: number;
  readonly paused: boolean;
  readonly exists: boolean;
}

/** The list of downloads at its button. */
interface DownloadsList {
  readonly kind: 'downloads';
  readonly anchor: Shield['anchor'];
  readonly items: readonly DownloadItem[];
}

/** The suggestions of the address bar, the one that the arrow keys reached marked. */
interface Suggestions {
  readonly kind: 'suggestions';
  readonly items: readonly {
    readonly kind: 'search' | 'url' | 'tab' | 'bookmark' | 'history';
    readonly title: string;
    readonly url: string;
  }[];
  readonly selected: number;
}

type Content = Shield | Login | Permission | Screen | DownloadsList | Suggestions;

/** What the prompt says that a site wants, for each permission. */
const wants = {
  camera: 'overlay.permission.camera',
  microphone: 'overlay.permission.microphone',
  location: 'overlay.permission.location',
  notifications: 'overlay.permission.notifications',
  clipboard: 'overlay.permission.clipboard',
} as const satisfies Record<Permission['permissions'][number], string>;

// The browser process checks every message against its contract before it sends it.
/** How long, in milliseconds, a question shows before its buttons take clicks. */
const armDelay = 500;

const isContent = (value: unknown): value is Content =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  ['shield', 'login', 'permission', 'screen', 'downloads', 'suggestions'].includes(
    String(value.kind),
  );

/** Width of a popover, and its distance to the window's edges and to its button. */
const width = 288;
/** Width of the list of downloads, whose names need room. */
const listWidth = 360;

/** What the buttons of a download do. */
type DownloadAction = 'pause' | 'resume' | 'cancel' | 'open' | 'folder' | 'retry' | 'remove';

/**
 * A number of bytes in the units that people read, such as `12.3 MB`.
 * @param bytes - The bytes.
 * @param language - The language of the page.
 */
function sizeText(bytes: number, language: string | undefined): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}
const margin = 8;
const gap = 4;

/**
 * The page of the overlay: it shows one popover next to the button that opened it. A click
 * next to the popover or Escape closes it; the browser process runs shortcuts.
 */
export class OverlayPage extends LitElement {
  static override properties = {
    content: { state: true },
    chosen: { state: true },
    armed: { state: true },
  };

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
    /* The suggestions fill the overlay, which lies below the address bar, with room for their
       shadow; each row is as high as the shell asked for. */
    .suggestions {
      position: fixed;
      inset: 0 12px 12px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      list-style: none;
      border: 1px solid var(--border-1);
      border-radius: var(--radius-3);
      background: var(--surface-1);
      box-shadow: var(--shadow-popover);
      animation: drop var(--motion-fast) var(--ease-out);
    }
    @keyframes drop {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }
    .suggestions li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      height: calc(var(--control-large) + var(--space-1));
      padding: 0 var(--space-3);
      cursor: default;
    }
    .suggestions li:hover,
    .suggestions li[aria-selected='true'] {
      background: var(--surface-hover);
    }
    .suggestions .kind {
      display: grid;
      flex: none;
      color: var(--text-2);
    }
    .suggestions svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .suggestions .title {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .suggestions .where {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      color: var(--text-2);
      font-size: var(--font-size-small);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    section {
      position: fixed;
      left: var(--left);
      top: var(--top);
      width: var(--width, ${width}px);
      box-sizing: border-box;
      padding: var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-2);
      background: var(--surface-1);
    }
    .site {
      margin: 0;
      font-size: inherit;
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
      font-size: calc(var(--font-size-title) + 4px);
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
      font-size: var(--font-size-larger);
      font-weight: 600;
    }
    .dialog p {
      margin: 0 0 var(--space-2);
      overflow-wrap: anywhere;
    }
    .dialog label {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin-top: var(--space-2);
    }
    .dialog input {
      height: var(--control-large);
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
    .dialog ul {
      margin: 0 0 var(--space-2);
      padding: 0;
      list-style: none;
    }
    .dialog li {
      padding: 2px 0;
    }
    .buttons button:disabled {
      opacity: 0.5;
    }
    /* The moment before a question takes clicks does not dim its buttons. */
    .buttons[data-arming] button:disabled {
      opacity: 1;
    }
    /* A question takes the focus itself; its buttons show the ring once they have it. */
    .dialog:focus-visible {
      outline: none;
    }
    .downloads {
      max-height: 60vh;
      margin: var(--space-2) 0 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .downloads li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: var(--space-2) 0;
      border-top: 1px solid var(--border-1);
    }
    .downloads .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .downloads progress {
      width: 100%;
      height: 4px;
      accent-color: var(--accent-secondary);
    }
    .downloads .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .downloads .actions button {
      width: auto;
      margin: 0;
      padding: 2px var(--space-2);
    }
    .dialog.wide {
      width: 640px;
    }
    .sources {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
      gap: var(--space-2);
      max-height: 50vh;
      margin: var(--space-2) 0 0;
      padding: 2px;
      overflow-y: auto;
    }
    .sources h3 {
      grid-column: 1 / -1;
      margin: var(--space-2) 0 0;
      font-size: var(--font-size-ui);
      font-weight: 600;
    }
    .source {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: 0;
      padding: var(--space-1);
      text-align: start;
    }
    .source[aria-pressed='true'] {
      border-color: var(--accent);
      outline: 1px solid var(--accent);
    }
    .source img,
    .source .blank {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: contain;
      border-radius: var(--radius-1);
      background: var(--surface-0);
    }
    .source span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  declare content: Content | null;
  /** The screen or window chosen in the picker. */
  declare chosen: string | undefined;
  /**
   * Whether the buttons of a question take clicks. They do a moment after the question shows,
   * as in other browsers, so the second click of a double click on the question before does
   * not answer this one.
   */
  declare armed: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  private stopListening: (() => void) | undefined;

  constructor() {
    super();
    this.content = null;
    this.chosen = undefined;
    this.armed = false;
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
    if (this.content.kind === 'downloads') this.place(this.content.anchor, listWidth);
    if (this.content.kind === 'screen') this.chosen = undefined;
    if (this.content.kind === 'permission') this.arm(this.content.id);
    // What opens takes the focus, so the keyboard reaches its first field, switch or choice. A
    // question gets it itself, not on a button, so a key meant for the page decides nothing.
    // The suggestions leave the focus in the address bar, where the typing goes on.
    if (before !== this.content.kind && this.content.kind !== 'suggestions') {
      void this.updateComplete.then(() =>
        (
          this.renderRoot.querySelector<HTMLElement>('input, .source') ??
          this.renderRoot.querySelector<HTMLElement>('[role="dialog"]')
        )?.focus(),
      );
    }
  }

  /** Lets the buttons of a question take clicks once it has shown for a moment. */
  private arm(id: number): void {
    this.armed = false;
    setTimeout(() => {
      if (this.content?.kind === 'permission' && this.content.id === id) this.armed = true;
    }, armDelay);
  }

  /** Puts the popover below its button, its right edge at the button's, inside the window. */
  private place(anchor: Shield['anchor'], popover = width): void {
    const left = Math.min(
      Math.max(margin, anchor.x + anchor.width - popover),
      Math.max(margin, innerWidth - popover - margin),
    );
    this.style.setProperty('--left', `${left}px`);
    this.style.setProperty('--width', `${popover}px`);
    this.style.setProperty('--top', `${anchor.y + anchor.height + gap}px`);
  }

  /** The suggestions of the address bar, which fill the overlay below the field. */
  private renderSuggestions(content: Suggestions): TemplateResult {
    return html`<ul class="suggestions" role="listbox" aria-label=${this.t('overlay.suggestions')}>
      ${content.items.map(
        (item, index) =>
          html`<li
            role="option"
            aria-selected=${index === content.selected ? 'true' : 'false'}
            data-kind=${item.kind}
            @mousedown=${(event: MouseEvent) => event.preventDefault()}
            @click=${() => void this.bridge?.invoke('overlay.chooseSuggestion', { index })}
          >
            <span class="kind" aria-hidden="true">${suggestionIcons[item.kind]}</span>
            <span class="title"
              >${item.kind === 'search' ? item.title : item.title || item.url}</span
            >
            <span class="where"
              >${
                item.kind === 'search'
                  ? this.t('overlay.suggestion.search')
                  : item.kind === 'tab'
                    ? this.t('overlay.suggestion.tab')
                    : item.url
              }</span
            >
          </li>`,
      )}
    </ul>`;
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === null) return nothing;
    if (content.kind === 'login') return this.renderLogin(content);
    if (content.kind === 'permission') return this.renderPermission(content);
    if (content.kind === 'screen') return this.renderScreens(content);
    if (content.kind === 'downloads') return this.renderDownloads(content);
    if (content.kind === 'suggestions') return this.renderSuggestions(content);
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

  /**
   * The question of a site for permissions: it stays open until it is answered or closed, also
   * with a click next to it.
   */
  private renderPermission(question: Permission): TemplateResult {
    return html`<div class="backdrop" @click=${this.close}></div>
      <section class="dialog" role="dialog" tabindex="-1" aria-labelledby="permission-title">
        <h2 id="permission-title">${this.t('overlay.permissionTitle', { site: question.site })}</h2>
        <ul>
          ${question.permissions.map((name) => html`<li>${this.t(wants[name])}</li>`)}
        </ul>
        <p class="note">${this.t('overlay.permissionNote')}</p>
        <div class="buttons" ?data-arming=${!this.armed}>
          <button
            type="button"
            ?disabled=${!this.armed}
            @click=${() => this.answer(question.id, false)}
          >
            ${this.t('overlay.block')}
          </button>
          <button
            type="button"
            class="primary"
            ?disabled=${!this.armed}
            @click=${() => this.answer(question.id, true)}
          >
            ${this.t('overlay.allow')}
          </button>
        </div>
      </section>`;
  }

  /** The screens and windows that a site may see, as pictures with their names. */
  private renderScreens(picker: Screen): TemplateResult {
    const group = (screens: boolean): TemplateResult | typeof nothing => {
      const sources = picker.sources.filter((source) => source.screen === screens);
      if (sources.length === 0) return nothing;
      return html`<h3>${this.t(screens ? 'overlay.shareScreens' : 'overlay.shareWindows')}</h3>
        ${sources.map(
          (source) =>
            html`<button
              type="button"
              class="source"
              aria-pressed=${String(this.chosen === source.id)}
              @click=${() => (this.chosen = source.id)}
              @dblclick=${() => this.share(source.id)}
            >
              ${
                source.thumbnail === ''
                  ? html`<span class="blank"></span>`
                  : html`<img src=${source.thumbnail} alt="" />`
              }
              <span>${source.name}</span>
            </button>`,
        )}`;
    };
    return html`<div class="backdrop"></div>
      <section class="dialog wide" role="dialog" aria-labelledby="share-title">
        <h2 id="share-title">${this.t('overlay.shareTitle', { site: picker.site })}</h2>
        <div class="sources">${group(true)} ${group(false)}</div>
        <div class="buttons">
          <button type="button" @click=${this.close}>${this.t('overlay.cancel')}</button>
          <button
            type="button"
            class="primary"
            ?disabled=${this.chosen === undefined}
            @click=${() => this.chosen !== undefined && this.share(this.chosen)}
          >
            ${this.t('overlay.share')}
          </button>
        </div>
      </section>`;
  }

  /** The list of downloads, newest first, with what each one allows. */
  private renderDownloads(list: DownloadsList): TemplateResult {
    return html`<div class="backdrop" @click=${this.close}></div>
      <section role="dialog" aria-labelledby="downloads-title">
        <h2 id="downloads-title" class="site">${this.t('overlay.downloads')}</h2>
        ${
          list.items.length === 0
            ? html`<p class="note">${this.t('overlay.downloadsNone')}</p>`
            : html`<ul class="downloads">
                ${list.items.map((item) => this.renderDownload(item))}
              </ul>`
        }
        <button type="button" @click=${this.openDownloadsFolder}>
          ${this.t('overlay.downloadsFolder')}
        </button>
      </section>`;
  }

  private renderDownload(item: DownloadItem): TemplateResult {
    const running = item.state === 'progressing';
    const action = (name: DownloadAction, label: Parameters<Translator['t']>[0]) =>
      html`<button
        type="button"
        aria-label=${this.t('overlay.downloadActionFor', { action: this.t(label), name: item.name })}
        @click=${() => void this.bridge?.invoke('overlay.download', { id: item.id, action: name })}
      >
        ${this.t(label)}
      </button>`;
    return html`<li>
      <span class="name" title=${item.name}>${item.name}</span>
      <span class="note">${this.downloadStatus(item)}</span>
      ${
        running
          ? html`<progress
              max=${item.total > 0 ? item.total : nothing}
              value=${item.total > 0 ? item.received : nothing}
            ></progress>`
          : nothing
      }
      <span class="actions">
        ${
          running
            ? html`${
                item.paused
                  ? action('resume', 'overlay.downloadResume')
                  : action('pause', 'overlay.downloadPause')
              }
              ${action('cancel', 'overlay.downloadCancel')}`
            : html`${
                item.state === 'completed' && item.exists
                  ? html`${action('open', 'overlay.downloadOpen')}
                    ${action('folder', 'overlay.downloadShow')}`
                  : item.state === 'completed'
                    ? nothing
                    : action('retry', 'overlay.downloadRetry')
              }
              ${action('remove', 'overlay.downloadRemove')}`
        }
      </span>
    </li>`;
  }

  /** Where a download stands, in words and bytes. */
  private downloadStatus(item: DownloadItem): string {
    const language = this.i18n?.language;
    const received = sizeText(item.received, language);
    const progress =
      item.total > 0
        ? this.t('overlay.downloadProgress', { received, total: sizeText(item.total, language) })
        : received;
    if (item.state === 'progressing') {
      return item.paused ? `${this.t('overlay.downloadPaused')}, ${progress}` : progress;
    }
    if (item.state === 'completed') {
      return item.exists
        ? sizeText(Math.max(item.total, item.received), language)
        : this.t('overlay.downloadDeleted');
    }
    return this.t(
      item.state === 'cancelled' ? 'overlay.downloadCanceled' : 'overlay.downloadFailed',
    );
  }

  private readonly openDownloadsFolder = (): void => {
    void this.bridge?.invoke('overlay.openDownloadsFolder', {});
  };

  private answer(id: number, allow: boolean): void {
    void this.bridge?.invoke('overlay.answerPermission', { id, allow });
  }

  private share(id: string): void {
    void this.bridge?.invoke('overlay.shareScreen', { id });
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

/** Icons of the kinds of suggestions, drawn after Lucide (ISC license). */
const suggestionIcons = {
  search: html`<svg viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>`,
  url: html`<svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
  </svg>`,
  tab: html`<svg viewBox="0 0 24 24">
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" />
  </svg>`,
  bookmark: html`<svg viewBox="0 0 24 24">
    <path
      d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2.1 2.1 0 0 0-2 0L6.4 21a.5.5 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.1-.7a2.1 2.1 0 0 0 1.6-1.2z"
    />
  </svg>`,
  history: html`<svg viewBox="0 0 24 24">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5M12 7v5l4 2" />
  </svg>`,
};
