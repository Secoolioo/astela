import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type {
  CommandPalette as PaletteContent,
  PaletteItem,
} from '../../shared/ipc/overlay-contracts.ts';
import { displayShortcut } from '../../shared/shortcuts.ts';
import type { MessageKey, Translator } from '../i18n/i18n.ts';
import { keyNamesOf } from '../ui-kit/key-names.ts';
import { popoverStyles } from '../ui-kit/popover-styles.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';
import { TabIcons } from '../ui-kit/tab-icons.ts';
import {
  keptSelection,
  localGroups,
  mergeGroups,
  moveSelection,
  parseQuery,
  remoteScope,
  tabLabel,
  type PaletteAnswer,
  type PaletteGroup,
  type PaletteRow,
  type PaletteScope,
  type RemoteScope,
  type SelectionMove,
} from './palette-model.ts';
import { enter } from './popover-motion.ts';

/** A request for results that the browser process has not answered yet. */
interface Sent {
  readonly id: number;
  readonly scope: RemoteScope;
  readonly text: string;
}

/** An answer of the browser process, with the scope and the text that it answers. */
interface Shown extends PaletteAnswer {
  readonly scope: RemoteScope;
}

/** The answer to a request for results, as the contract of `overlay.paletteQuery` has it. */
interface QueryAnswer extends PaletteAnswer {
  readonly typed: string;
  readonly enter: boolean;
}

/** How long Enter waits for the answer for the text that was typed, in milliseconds. */
const enterWait = 200;
/** How long the status waits until typing pauses before it tells the number of results, in ms. */
const statusWait = 400;

/** The keys that move the marked row. */
const moves: Readonly<Record<string, SelectionMove>> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  PageDown: 'pageDown',
  PageUp: 'pageUp',
};

/** The placeholders of the field, by scope. */
const placeholders: Readonly<Record<PaletteScope, MessageKey>> = {
  all: 'palette.placeholder.all',
  commands: 'palette.placeholder.commands',
  tabs: 'palette.placeholder.tabs',
  bookmarks: 'palette.placeholder.bookmarks',
  history: 'palette.placeholder.history',
  settings: 'settings.searchLabel',
};

/** The names of the scopes on their chip. */
const scopeNames: Readonly<Record<Exclude<PaletteScope, 'all'>, MessageKey>> = {
  commands: 'palette.scope.commands',
  tabs: 'palette.scope.tabs',
  bookmarks: 'palette.scope.bookmarks',
  history: 'palette.scope.history',
  settings: 'palette.scope.settings',
};

/** Whether a value is an answer of `overlay.paletteQuery`; the browser process checks it too. */
function isAnswer(value: unknown): value is QueryAnswer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'answer') === 'number' &&
    typeof Reflect.get(value, 'typed') === 'string' &&
    typeof Reflect.get(value, 'enter') === 'boolean' &&
    Array.isArray(Reflect.get(value, 'items'))
  );
}

/** An address as people read it, without `https://`. */
function shortAddress(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/** The host of an address, or the address itself. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * The command palette, which covers the window: a field and a list of results in groups. It
 * finds the commands that can run now and the rows of the settings itself, in every shipped
 * language, and asks the browser process for the open tabs, the bookmarks, the history and
 * what the address bar would do with the text. The field is a combobox, the list a listbox
 * with groups, and the arrows mark a row while the focus stays in the field, as in the address
 * bar. A prefix such as `> ` narrows the search to one kind, which a chip shows. Enter acts on
 * the marked row, and waits a moment for the answer for the text first. The keys typed before
 * the field was ready come with the answer to the first request. The browser process acts only
 * on what it sent: a command, which it checks again, a row of the settings, or a place in an
 * answer.
 */
export class CommandPalette extends LitElement {
  static override properties = {
    content: { attribute: false },
    scope: { state: true },
    text: { state: true },
    shown: { state: true },
    marked: { state: true },
    status: { state: true },
  };

  /** Styles of the palette, scoped to its shadow root. */
  static override styles = [
    popoverStyles,
    css`
      :host {
        display: contents;
      }
      .palette {
        --panel-width: min(640px, calc(var(--area-width) - 2 * var(--space-4)));
        position: fixed;
        top: calc(var(--area-y) + var(--space-6));
        left: calc(var(--area-x) + (var(--area-width) - var(--panel-width)) / 2);
        display: flex;
        flex-direction: column;
        width: var(--panel-width);
        max-height: calc(100vh - var(--area-y) - 2 * var(--space-6));
        overflow: hidden;
      }
      .field {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex: none;
        padding: var(--space-2) var(--space-3);
        border-bottom: 1px solid var(--line-1);
      }
      input {
        flex: 1;
        min-width: 0;
        height: var(--control-large);
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--font-size-larger);
        outline: none;
      }
      .chip {
        flex: none;
        padding: 2px var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-2);
        color: inherit;
        font: inherit;
        font-size: var(--font-size-small);
      }
      .chip:hover {
        background: var(--surface-hover);
      }
      .chip:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
      .list {
        flex: 1 1 auto;
        min-height: 0;
        max-height: 480px;
        padding: var(--space-1);
        overflow-y: auto;
      }
      .heading {
        padding: var(--space-2) var(--space-2) var(--space-1);
        color: var(--text-2);
        font-size: var(--font-size-small);
        font-weight: var(--font-weight-medium);
      }
      .row {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: calc(var(--control-large) + var(--space-1));
        padding: 0 var(--space-2);
        border-radius: var(--radius-2);
        cursor: default;
      }
      .row:hover,
      .row[aria-selected='true'] {
        background: var(--surface-hover);
      }
      /* The marked row, which Enter acts on, carries the accent bar of marked rows (ADR 0051). */
      .row[aria-selected='true']::before {
        content: '';
        position: absolute;
        inset-block: var(--space-2);
        inset-inline-start: 0;
        width: 3px;
        border-radius: var(--radius-pill);
        background: var(--accent);
      }
      .icon {
        display: grid;
        place-items: center;
        flex: none;
        width: 16px;
        height: 16px;
        color: var(--text-2);
      }
      .icon img {
        width: 16px;
        height: 16px;
      }
      /* A tab that sleeps shows its icon faded, as in the tab strip. */
      .icon[data-sleeping] {
        opacity: 0.7;
      }
      .label {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .detail {
        flex: 1 1 0;
        min-width: 0;
        overflow: hidden;
        color: var(--text-2);
        font-size: var(--font-size-small);
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .tag,
      .shortcut {
        flex: none;
        margin-inline-start: auto;
        color: var(--text-2);
        font-size: var(--font-size-small);
      }
      /* The tags of a row stand together at its end. */
      .tag + .tag {
        margin-inline-start: 0;
      }
      .none,
      .hint {
        margin: 0;
        padding: var(--space-2) var(--space-3);
        color: var(--text-2);
      }
      .hint {
        flex: none;
        border-top: 1px solid var(--line-1);
        font-size: var(--font-size-small);
      }
      .hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      /* Forced colors take every surface away; the marked row gets the system's outline. */
      @media (forced-colors: active) {
        .row[aria-selected='true'] {
          outline: 2px solid Highlight;
          outline-offset: -2px;
        }
        .row[aria-selected='true']::before {
          forced-color-adjust: none;
          background: Highlight;
        }
      }
    `,
  ];

  declare content: PaletteContent | undefined;
  /** What the palette searches now. */
  declare scope: PaletteScope;
  /** What the field holds, without the prefix of a scope. */
  declare text: string;
  /** The answer of the browser process that shows. */
  declare shown: Shown | undefined;
  /** The key of the marked row. */
  declare marked: string | undefined;
  /** What the status tells assistive technology: the number of results, or that none match. */
  declare status: string;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  /** Whether the palette only leaves the page, so that it takes no focus and runs nothing. */
  leaving = false;
  /** The groups that show, made before each update. */
  private groups: PaletteGroup[] = [];
  /** The time the palette opened, which its requests name. */
  private session = 0;
  private requests = 0;
  /** The newest request, while its answer is on its way. */
  private sent: Sent | undefined;
  /** Whether the first request of this opening is still to go, which hands it what was typed. */
  private first = false;
  /**
   * The first request of this opening while its answer is on its way: only that answer brings
   * what was typed before the field was ready, also when a later request answers first.
   */
  private firstId: number | undefined;
  /** Whether the keys moved the mark since the text changed last. */
  private moved = false;
  /** Whether Enter waits for the answer for the text. */
  private choosing: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the status waits for typing to pause. */
  private typing = false;
  /** Whether the marked row must come into view after the next update. */
  private reveal = false;
  private focusField = false;
  private entered = false;
  private stopShortcuts: (() => void) | undefined;
  private readonly icons = new TabIcons(
    (key) => this.favicon(key),
    () => this.requestUpdate(),
  );

  constructor() {
    super();
    this.content = undefined;
    this.scope = 'all';
    this.text = '';
    this.shown = undefined;
    this.marked = undefined;
    this.status = '';
  }

  override disconnectedCallback(): void {
    clearTimeout(this.choosing);
    clearTimeout(this.statusTimer);
    this.stopShortcuts?.();
    this.stopShortcuts = undefined;
    super.disconnectedCallback();
  }

  /** The surfaces of the palette, which leave the page when it closes. */
  surfaces(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('.palette')];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.stopShortcuts ??= this.bridge?.on('overlay.paletteShortcut', (scope) =>
      this.onShortcut(scope),
    );
    const content = this.content;
    if (content === undefined) return;
    if (changed.has('content') && content.session !== this.session) {
      // A palette that opens anew starts empty and asks at once, which hands it what was typed.
      this.session = content.session;
      this.scope = content.scope;
      this.text = '';
      this.shown = undefined;
      this.moved = false;
      this.first = true;
      this.firstId = undefined;
      this.focusField = true;
      this.query();
    }
    const local = localGroups(this.text, this.scope, content, (key, params) => this.t(key, params));
    this.groups = mergeGroups(local, this.answerShown(), this.scope);
    const keys = this.groups.flatMap((group) => group.rows.map((row) => row.key));
    this.marked = keptSelection(keys, this.marked, this.moved);
    this.icons.keep(
      this.groups.flatMap((group) =>
        group.rows.flatMap((row) =>
          row.kind === 'item' && row.item.kind === 'tab' && row.item.favicon !== null
            ? [row.item.favicon]
            : [],
        ),
      ),
    );
    this.tell(keys.length);
  }

  protected override updated(): void {
    const panel = this.renderRoot.querySelector<HTMLElement>('.palette');
    const area = this.content?.area;
    if (panel === null || area === undefined) return;
    panel.style.setProperty('--area-x', `${String(area.x)}px`);
    panel.style.setProperty('--area-y', `${String(area.y)}px`);
    panel.style.setProperty('--area-width', `${String(area.width)}px`);
    if (!this.entered && !this.leaving) {
      this.entered = true;
      enter(panel);
    }
    if (this.focusField && !this.leaving) {
      this.focusField = false;
      this.renderRoot.querySelector<HTMLInputElement>('input')?.focus();
    }
    if (this.reveal) {
      this.reveal = false;
      this.renderRoot
        .querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    }
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === undefined) return nothing;
    const title = this.t(this.scope === 'tabs' ? 'palette.titleTabs' : 'palette.title');
    const placeholder = this.t(placeholders[this.scope]);
    const rows = this.groups.flatMap((group) => group.rows);
    const markedAt = rows.findIndex((row) => row.key === this.marked);
    const hint = this.scope === 'all' && this.text === '';
    const describedBy = [this.scope === 'all' ? '' : 'palette-scope', hint ? 'palette-hint' : '']
      .filter((id) => id !== '')
      .join(' ');
    let place = 0;
    return html`<section
      class="popover palette"
      role="dialog"
      aria-modal="true"
      aria-labelledby="palette-title"
      data-surface
    >
      <h2 id="palette-title" class="hidden">${title}</h2>
      <div class="field">
        ${
          this.scope === 'all'
            ? nothing
            : html`<button
                type="button"
                class="chip"
                id="palette-scope"
                title=${this.t('palette.removeScope')}
                tabindex="-1"
                @mousedown=${(event: MouseEvent) => event.preventDefault()}
                @click=${() => this.setScope('all')}
              >
                ${this.t(scopeNames[this.scope])}
              </button>`
        }
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant=${markedAt === -1 ? nothing : `palette-option-${String(markedAt)}`}
          aria-describedby=${describedBy === '' ? nothing : describedBy}
          aria-label=${placeholder}
          placeholder=${placeholder}
          autocomplete="off"
          spellcheck="false"
          maxlength="200"
          .value=${live(this.text)}
          @input=${this.onInput}
          @keydown=${this.onKeyDown}
        />
      </div>
      <div class="list" id="palette-list" role="listbox" aria-label=${this.t('palette.results')}>
        ${this.groups.map(
          (group) =>
            html`<div role="group" aria-labelledby="palette-group-${group.id}">
              <div class="heading" role="presentation" id="palette-group-${group.id}">
                ${this.t(`palette.group.${group.id}`)}
              </div>
              ${group.rows.map((row) => this.renderRow(row, place++))}
            </div>`,
        )}
      </div>
      ${
        rows.length === 0 && this.sent === undefined
          ? html`<p class="none">
              ${
                this.text === ''
                  ? this.t('palette.empty')
                  : this.t('palette.none', { query: this.text })
              }
            </p>`
          : nothing
      }
      ${hint ? html`<p class="hint" id="palette-hint">${this.t('palette.hint')}</p>` : nothing}
      <div class="hidden" role="status">${this.status}</div>
    </section>`;
  }

  private renderRow(row: PaletteRow, place: number): TemplateResult {
    // A tab that sleeps says so, as in the tab strip.
    const sleeping = row.kind === 'item' && row.item.kind === 'tab' && row.item.sleeping;
    return html`<div
      class="row"
      role="option"
      id="palette-option-${String(place)}"
      aria-selected=${row.key === this.marked ? 'true' : 'false'}
      aria-description=${sleeping ? this.t('shell.tabSleeping') : nothing}
      @mousedown=${(event: MouseEvent) => event.preventDefault()}
      @click=${() => this.activate(row)}
    >
      ${this.renderParts(row)}
    </div>`;
  }

  /** The icon, the name and the details of a row. */
  private renderParts(row: PaletteRow): TemplateResult {
    if (row.kind === 'command') {
      const shortcut =
        row.shortcut === undefined
          ? ''
          : displayShortcut(
              row.shortcut,
              this.content?.mac ?? false,
              keyNamesOf((key) => this.t(key)),
            );
      return html`<span class="icon" aria-hidden="true">${icons.command}</span>
        <span class="label">${row.label}</span>
        ${shortcut === '' ? nothing : html`<span class="shortcut">${shortcut}</span>`}`;
    }
    if (row.kind === 'setting') {
      return html`<span class="icon" aria-hidden="true">${icons.setting}</span>
        <span class="label">${row.label}</span>
        <span class="detail">${this.t('palette.settingIn', { section: row.section })}</span>`;
    }
    return this.renderItem(row.item);
  }

  /** A result of the browser process. */
  private renderItem(item: PaletteItem): TemplateResult {
    if (item.kind === 'tab') {
      const icon = item.favicon === null ? undefined : this.icons.get(item.favicon);
      const tag =
        item.place === 'current'
          ? this.t('palette.currentTab')
          : item.place === 'other'
            ? this.t('palette.otherWindow')
            : '';
      // The description of the row tells screen readers that the tab sleeps.
      return html`<span class="icon" aria-hidden="true" ?data-sleeping=${item.sleeping}
          >${icon === undefined ? icons.globe : html`<img src=${icon} alt="" />`}</span
        >
        <span class="label">${tabLabel(item, this.t('shell.untitled'))}</span>
        <span class="detail">${hostOf(item.url)}</span>
        ${
          item.sleeping
            ? html`<span class="tag" aria-hidden="true">${this.t('palette.sleeping')}</span>`
            : nothing
        }
        ${tag === '' ? nothing : html`<span class="tag">${tag}</span>`}`;
    }
    if (item.kind === 'bookmark' || item.kind === 'history') {
      return html`<span class="icon" aria-hidden="true">${icons[item.kind]}</span>
        <span class="label">${item.title || shortAddress(item.url)}</span>
        <span class="detail">${shortAddress(item.url)}</span>`;
    }
    if (item.kind === 'search') {
      return html`<span class="icon" aria-hidden="true">${icons.search}</span>
        <span class="label">${this.t('palette.searchFor', { query: item.query })}</span>
        <span class="detail">${item.host}</span>`;
    }
    return html`<span class="icon" aria-hidden="true">${icons.globe}</span>
      <span class="label">${shortAddress(item.url)}</span>
      <span class="detail">${this.t('palette.openAddress')}</span>`;
  }

  /** The answer that shows for the scope now: the newest for it, until the next one comes. */
  private answerShown(): Shown | undefined {
    const remote = remoteScope(this.scope, this.text);
    return this.shown !== undefined && this.shown.scope === remote ? this.shown : undefined;
  }

  /**
   * Asks the browser process for its results for the text, unless the page finds everything
   * itself; the first request of an opening always goes, as it hands over what was typed.
   */
  private query(): void {
    const content = this.content;
    const bridge = this.bridge;
    if (content === undefined || bridge === undefined || this.leaving) return;
    const remote = remoteScope(this.scope, this.text);
    if (remote === undefined && !this.first) {
      this.sent = undefined;
      return;
    }
    const sent: Sent = { id: ++this.requests, scope: remote ?? 'all', text: this.text };
    this.sent = sent;
    if (this.first) {
      this.first = false;
      this.firstId = sent.id;
    }
    const session = content.session;
    bridge.invoke('overlay.paletteQuery', { session, scope: sent.scope, text: sent.text }).then(
      (answer) => this.answered(session, sent, isAnswer(answer) ? answer : undefined),
      () => this.answered(session, sent, undefined),
    );
  }

  /**
   * Takes an answer of the browser process. The answer to the first request of an opening puts
   * what was typed before the field was ready in front of what the field holds, also when a
   * later request answered first, and chooses the first result when Enter was among it.
   * Answers to older requests are dropped otherwise, and so is one for a text that changed
   * meanwhile, which is asked for again.
   */
  private answered(session: number, sent: Sent, answer: QueryAnswer | undefined): void {
    if (session !== this.session || this.leaving) return;
    const newest = sent.id === this.requests;
    if (sent.id === this.firstId) {
      this.firstId = undefined;
      if (answer !== undefined && (answer.typed !== '' || answer.enter)) {
        this.takeTyped(answer.typed, answer.enter, newest);
      }
    }
    if (!newest) return;
    this.sent = undefined;
    const remote = remoteScope(this.scope, this.text);
    const full = (answer?.typed ?? '') + sent.text;
    if (answer !== undefined && remote === sent.scope && full === this.text) {
      this.shown = { answer: answer.answer, items: answer.items, scope: sent.scope };
    } else if (remote !== undefined && (remote !== sent.scope || full !== this.text)) {
      // What was typed before changed the text, or its prefix the scope.
      this.query();
    }
    // The list says that nothing matches once no answer is on its way.
    this.requestUpdate();
    if (this.sent === undefined && this.choosing !== undefined) {
      void this.updateComplete.then(() => this.act());
    }
  }

  /**
   * Puts what was typed before the field was ready in front of what the field holds.
   * @param newest - Whether the answer that brought it is that of the newest request; a later
   *   request that answered first answered for the text without it, so the list asks again.
   */
  private takeTyped(typed: string, enterTyped: boolean, newest: boolean): void {
    this.setText(typed + this.text);
    const input = this.renderRoot.querySelector<HTMLInputElement>('input');
    void this.updateComplete.then(() => {
      if (input !== null) input.setSelectionRange(input.value.length, input.value.length);
    });
    if (!newest && this.sent === undefined) this.query();
    // Enter typed before the field was ready chooses as Enter in the field does.
    if (enterTyped) this.waitToChoose();
  }

  /** Takes a new text: a prefix of a scope narrows everything, and the mark goes to the top. */
  private setText(value: string): void {
    let text = value;
    if (this.scope === 'all') {
      const parsed = parseQuery(value);
      if (parsed.scope !== undefined) {
        this.scope = parsed.scope;
        text = parsed.text;
      }
    }
    this.text = text.slice(0, 200);
    this.moved = false;
  }

  private readonly onInput = (event: InputEvent): void => {
    if (this.leaving || !(event.target instanceof HTMLInputElement)) return;
    const field = event.target;
    // While an input method composes text, a prefix is no prefix yet.
    if (event.isComposing) {
      this.text = field.value;
    } else {
      this.setText(field.value);
      // The prefix goes from the field to the chip.
      field.value = this.text;
    }
    this.moved = false;
    this.typing = true;
    this.query();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.leaving) return;
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const keys = this.groups.flatMap((group) => group.rows.map((row) => row.key));
      this.marked = moveSelection(keys, this.marked, move);
      this.moved = true;
      this.reveal = true;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.waitToChoose();
    } else if (event.key === 'Tab') {
      // The palette has one field, which keeps the focus.
      event.preventDefault();
    } else if (event.key === 'Backspace' && this.text === '' && this.scope !== 'all') {
      event.preventDefault();
      this.setScope('all');
    }
  };

  /**
   * Acts on the marked row, once the answer for the text is there, or after a moment; without
   * an answer on its way, once the list shows the text, which a text typed ahead just changed.
   */
  private waitToChoose(): void {
    clearTimeout(this.choosing);
    if (this.sent === undefined) {
      this.choosing = undefined;
      void this.updateComplete.then(() => this.act());
      return;
    }
    this.choosing = setTimeout(() => this.act(), enterWait);
  }

  /** Acts on the marked row. */
  private act(): void {
    clearTimeout(this.choosing);
    this.choosing = undefined;
    const row = this.groups
      .flatMap((group) => group.rows)
      .find((candidate) => candidate.key === this.marked);
    if (row !== undefined) this.activate(row);
  }

  /** Acts on a row: runs a command, opens the settings at a row or opens a result. */
  private activate(row: PaletteRow): void {
    const bridge = this.bridge;
    if (bridge === undefined || this.leaving) return;
    if (row.kind === 'command') {
      // Tab search is a scope of the palette.
      if (row.id === 'tabs.search') {
        this.text = '';
        this.setScope('tabs');
        return;
      }
      void bridge.invoke('overlay.paletteRun', { command: row.id });
    } else if (row.kind === 'setting') {
      void bridge.invoke('overlay.paletteSetting', { id: row.id });
    } else if (row.answer > 0) {
      void bridge.invoke('overlay.paletteChoose', { answer: row.answer, index: row.index });
    }
  }

  /** Searches another scope with the text of the field. */
  private setScope(scope: PaletteScope): void {
    this.scope = scope;
    this.moved = false;
    this.typing = false;
    this.query();
  }

  /**
   * One of the palette's shortcuts was pressed while it shows: the shortcut of the scope that
   * shows closes it, the other one switches to its scope and keeps the text.
   */
  private onShortcut(payload: unknown): void {
    if (this.leaving || this.content === undefined) return;
    const shows = this.scope === 'tabs' ? 'tabs' : 'all';
    if (payload === shows) void this.bridge?.invoke('overlay.close', {});
    else if (payload === 'all' || payload === 'tabs') this.setScope(payload);
  }

  /**
   * Tells assistive technology how many results show, at once after a change of the scope and
   * once typing pauses.
   */
  private tell(count: number): void {
    const status =
      count > 0
        ? this.t('palette.count', { count: String(count) })
        : this.sent !== undefined
          ? this.status
          : this.text === ''
            ? this.t('palette.empty')
            : this.t('palette.none', { query: this.text });
    clearTimeout(this.statusTimer);
    if (!this.typing) {
      this.status = status;
      return;
    }
    this.statusTimer = setTimeout(() => {
      this.typing = false;
      this.status = status;
    }, statusWait);
  }

  /** The icon of a tab's page, which the browser process gives only for windows of this kind. */
  private async favicon(key: string): Promise<string | null> {
    const icon = await this.bridge?.invoke('overlay.favicon', { key });
    return typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null;
  }

  private t(key: MessageKey, params?: Readonly<Record<string, string>>): string {
    return this.i18n?.t(key, params) ?? key;
  }
}

/** Icons of the rows of the palette, drawn after Lucide (ISC license). */
const icons = {
  command: html`<svg viewBox="0 0 24 24">
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="m10 8 4 4-4 4" />
  </svg>`,
  setting: html`<svg viewBox="0 0 24 24">
    <path d="M20 7h-9M14 17H5" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
  </svg>`,
  search: html`<svg viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>`,
  globe: html`<svg viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
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
