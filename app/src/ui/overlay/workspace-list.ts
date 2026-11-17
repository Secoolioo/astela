import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import type { WorkspaceList as WorkspaceListContent } from '../../shared/ipc/overlay-contracts.ts';
import { displayShortcut } from '../../shared/shortcuts.ts';
import { swatches, type Swatch } from '../../shared/swatches.ts';
import { workspaceIcons, type WorkspaceIcon } from '../../shared/workspace-icons.ts';
import { defaultWorkspaceId, workspaceNameLimit } from '../../shared/workspaces.ts';
import type { MessageKey, Translator } from '../i18n/i18n.ts';
import { keyNamesOf } from '../ui-kit/key-names.ts';
import { popoverStyles } from '../ui-kit/popover-styles.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';
import { workspaceIconSvg } from '../ui-kit/workspace-icons.ts';
import { placePopover } from './placement.ts';
import { enter } from './popover-motion.ts';

/** A workspace of the list. */
type Item = WorkspaceListContent['items'][number];

/** What the popover shows: the list, the form of a new or of a workspace, or the question. */
type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'delete'; readonly id: string };

/** What the form holds while people fill it in. */
interface Draft {
  readonly name: string;
  readonly icon: WorkspaceIcon;
  readonly color: Swatch;
  readonly isolated: boolean;
}

/**
 * The list of the workspaces at the button of the workspaces: each workspace with its icon, its
 * name, its shortcut, the number of its tabs in this window, whether one of them plays sound and
 * whether it keeps its cookies apart, and a button to edit it; a click shows the workspace in the
 * window. Below the list, a new workspace gets its name, icon and color in a form, and whether it
 * keeps its cookies and sign-ins apart, which never changes later; the form of a workspace also
 * moves it in the list or deletes it after a question. Escape leaves the form, or closes the
 * popover; Tab stays inside it.
 */
export class WorkspaceList extends LitElement {
  static override properties = {
    content: { attribute: false },
    mode: { state: true },
    draft: { state: true },
  };

  /** Styles of the popover, scoped to its shadow root. */
  static override styles = [
    popoverStyles,
    css`
      :host {
        display: contents;
      }
      section {
        position: fixed;
        top: 0;
        left: 0;
        width: 320px;
        max-width: calc(100vw - 2 * var(--space-2));
        padding: var(--space-2);
        overflow-y: auto;
      }
      h2 {
        margin: var(--space-1) var(--space-2) var(--space-2);
        font-size: var(--font-size-larger);
        font-weight: var(--font-weight-strong);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--space-1);
      }
      button {
        border: 0;
        border-radius: var(--radius-1);
        background: transparent;
        color: inherit;
        font: inherit;
      }
      button:hover:not(:disabled) {
        background: var(--surface-hover);
      }
      button:disabled {
        color: var(--text-2);
      }
      .row {
        display: flex;
        flex: 1;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
        min-height: var(--row-height);
        padding: var(--space-1) var(--space-2);
        text-align: start;
      }
      .row[aria-current='true'] {
        background: var(--surface-2);
      }
      .text {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .details {
        color: var(--text-2);
        font-size: var(--font-size-small);
      }
      .badge {
        padding: 0 var(--space-1);
        border: 1px solid var(--line-1);
        border-radius: var(--radius-1);
        color: var(--text-2);
        font-size: var(--font-size-small);
        white-space: nowrap;
      }
      kbd {
        color: var(--text-2);
        font: inherit;
        font-size: var(--font-size-small);
        white-space: nowrap;
      }
      [data-color='blue'] {
        --workspace-color: var(--swatch-blue);
      }
      [data-color='teal'] {
        --workspace-color: var(--swatch-teal);
      }
      [data-color='green'] {
        --workspace-color: var(--swatch-green);
      }
      [data-color='orange'] {
        --workspace-color: var(--swatch-orange);
      }
      [data-color='red'] {
        --workspace-color: var(--swatch-red);
      }
      [data-color='graphite'] {
        --workspace-color: var(--swatch-graphite);
      }
      .icon {
        display: grid;
        flex: none;
        place-items: center;
        color: var(--workspace-color);
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
      .edit {
        display: grid;
        flex: none;
        place-items: center;
        width: var(--control-height);
        height: var(--control-height);
      }
      .new {
        display: flex;
        width: 100%;
        align-items: center;
        gap: var(--space-2);
        margin-top: var(--space-1);
        padding: var(--space-2);
        border-top: 1px solid var(--line-1);
        border-radius: 0 0 var(--radius-1) var(--radius-1);
        text-align: start;
      }
      .note {
        margin: var(--space-1) var(--space-2);
        color: var(--text-2);
        font-size: var(--font-size-small);
      }
      form {
        padding: 0 var(--space-2) var(--space-1);
      }
      label.field {
        display: block;
      }
      input[type='text'] {
        display: block;
        box-sizing: border-box;
        width: 100%;
        height: var(--control-large);
        margin-top: var(--space-1);
        padding: 0 var(--space-2);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-0);
        color: inherit;
        font: inherit;
      }
      fieldset {
        margin: var(--space-3) 0 0;
        padding: 0;
        border: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--space-1);
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
      }
      /* Each icon and color is a radio button that takes the keys and the focus. */
      .choice {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--control-height);
        height: var(--control-height);
        border-radius: var(--radius-1);
      }
      .choice input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
      }
      .choice:has(input:checked) {
        outline: 2px solid var(--text-1);
        outline-offset: 1px;
      }
      .choice:has(input:focus-visible) {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
      .swatch {
        border-radius: var(--radius-pill);
        background: var(--workspace-color);
      }
      .hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      label.isolate {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        margin-top: var(--space-3);
      }
      .moves {
        display: flex;
        gap: var(--space-1);
        margin-top: var(--space-3);
      }
      .buttons {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        margin-top: var(--space-3);
      }
      .buttons button,
      .moves button {
        padding: var(--space-1) var(--space-3);
        border: 1px solid var(--border-1);
        background: var(--surface-2);
      }
      .buttons .primary {
        border-color: var(--accent);
      }
      .delete {
        margin-top: var(--space-2);
        padding: var(--space-1) 0;
        color: var(--text-1);
      }
      p.question {
        margin: 0 var(--space-2) var(--space-2);
      }
      :focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
      @media (forced-colors: active) {
        .swatch {
          border: 1px solid CanvasText;
        }
        .choice:has(input:checked) {
          outline-color: Highlight;
        }
        .row[aria-current='true'] {
          outline: 1px solid Highlight;
        }
      }
    `,
  ];

  declare content: WorkspaceListContent | undefined;
  /** What the popover shows now. */
  declare mode: Mode;
  /** What the form holds while it shows. */
  declare draft: Draft;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  /** Whether the popover only leaves the page, so that it takes no focus and changes nothing. */
  leaving = false;
  /** Whether the popover entered the page already. */
  private entered = false;
  /** Whether the next update gives the focus to the first field of what shows. */
  private focusNext = true;

  constructor() {
    super();
    this.content = undefined;
    this.mode = { kind: 'list' };
    this.draft = { name: '', icon: 'circle', color: 'blue', isolated: false };
  }

  /** The surface of the popover, which leaves the page when it closes. */
  surfaces(): HTMLElement[] {
    const section = this.renderRoot.querySelector<HTMLElement>('section');
    return section === null ? [] : [section];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    // A workspace that is gone, such as one deleted in another window, leaves its form.
    const mode = this.mode;
    if (
      changed.has('content') &&
      (mode.kind === 'edit' || mode.kind === 'delete') &&
      this.itemOf(mode.id) === undefined
    ) {
      this.mode = { kind: 'list' };
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    const section = this.renderRoot.querySelector<HTMLElement>('section');
    const content = this.content;
    if (section === null || content === undefined) return;
    const placement = placePopover(
      content.anchor,
      { width: section.offsetWidth, height: section.scrollHeight },
      { width: innerWidth, height: innerHeight },
      { align: 'start' },
    );
    section.style.left = `${placement.x}px`;
    section.style.top = `${placement.y}px`;
    section.style.maxHeight = `${placement.maxHeight}px`;
    section.toggleAttribute('data-above', placement.above);
    if (!this.entered && !this.leaving && changed.has('content')) {
      this.entered = true;
      enter(section, placement.above);
    }
    if (!this.focusNext || this.leaving) return;
    this.focusNext = false;
    // The list starts at the workspace that shows, a form at its name, the question at Cancel.
    const target =
      this.mode.kind === 'list'
        ? section.querySelector<HTMLElement>('.row[aria-current="true"]')
        : this.mode.kind === 'delete'
          ? section.querySelector<HTMLElement>('.buttons button')
          : section.querySelector<HTMLInputElement>('input[type="text"]');
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === undefined) return nothing;
    const mode = this.mode;
    const item = mode.kind === 'list' || mode.kind === 'create' ? undefined : this.itemOf(mode.id);
    return html`<section
      class="popover"
      role="dialog"
      aria-labelledby="workspaces-title"
      @keydown=${this.onKey}
    >
      <h2 id="workspaces-title">${this.t('overlay.workspaces')}</h2>
      ${
        mode.kind === 'list' || (mode.kind !== 'create' && item === undefined)
          ? this.renderList(content)
          : mode.kind === 'delete' && item !== undefined
            ? this.renderQuestion(item)
            : this.renderForm(item, content)
      }
    </section>`;
  }

  /** The workspaces, each with its button to edit it, and the button of a new workspace. */
  private renderList(content: WorkspaceListContent): TemplateResult {
    return html`<ul>
        ${content.items.map((item) => this.renderRow(item, content))}
      </ul>
      <button
        type="button"
        class="new"
        ?disabled=${content.full}
        @click=${() => this.startCreate(content)}
      >
        <span class="icon" aria-hidden="true">${plusIcon}</span>${this.t('overlay.workspaceNew')}
      </button>
      ${content.full ? html`<p class="note">${this.t('overlay.workspaceFull')}</p>` : nothing}`;
  }

  /** A workspace of the list. */
  private renderRow(item: Item, content: WorkspaceListContent): TemplateResult {
    const name = this.nameOf(item);
    const current = item.id === content.current;
    const details = [
      this.t('overlay.workspaceTabs', { count: String(item.tabs) }),
      ...(item.audible ? [this.t('overlay.workspacePlaying')] : []),
    ].join(', ');
    return html`<li data-color=${item.color}>
      <button
        type="button"
        class="row"
        data-id=${item.id}
        aria-current=${current ? 'true' : 'false'}
        aria-description=${current ? this.t('overlay.workspaceCurrent') : nothing}
        @click=${() => this.switchTo(item.id)}
      >
        <span class="icon" aria-hidden="true">${workspaceIconSvg[item.icon]}</span>
        <span class="text">
          <span class="name">${name}</span>
          <span class="details">${details}</span>
        </span>
        ${item.isolated ? html`<span class="badge">${this.t('overlay.workspaceApart')}</span>` : nothing}
        ${
          item.shortcut === null
            ? nothing
            : html`<kbd
                >${displayShortcut(
                  item.shortcut,
                  content.mac,
                  keyNamesOf((key) => this.t(key)),
                )}</kbd
              >`
        }
      </button>
      <button
        type="button"
        class="edit"
        title=${this.t('overlay.workspaceEdit', { name })}
        aria-label=${this.t('overlay.workspaceEdit', { name })}
        @click=${() => this.startEdit(item)}
      >
        ${pencilIcon}
      </button>
    </li>`;
  }

  /** The form of a new workspace, or of one of the list. */
  private renderForm(item: Item | undefined, content: WorkspaceListContent): TemplateResult {
    const draft = this.draft;
    const index = item === undefined ? -1 : content.items.indexOf(item);
    return html`<form @submit=${this.onSubmit}>
      <label class="field">
        ${this.t('overlay.workspaceName')}
        <input
          type="text"
          maxlength=${workspaceNameLimit}
          spellcheck="false"
          autocomplete="off"
          placeholder=${item?.id === defaultWorkspaceId ? this.t('shell.workspaceDefault') : ''}
          .value=${draft.name}
          @input=${this.onName}
        />
      </label>
      <fieldset>
        <legend>${this.t('overlay.workspaceIcon')}</legend>
        <div class="choices" data-color=${draft.color}>
          ${workspaceIcons.map(
            (icon) =>
              html`<label class="choice icon" title=${this.t(`overlay.workspaceIcon.${icon}`)}>
                <input
                  type="radio"
                  name="icon"
                  value=${icon}
                  .checked=${icon === draft.icon}
                  @change=${() => (this.draft = { ...this.draft, icon })}
                />
                ${workspaceIconSvg[icon]}
                <span class="hidden">${this.t(`overlay.workspaceIcon.${icon}`)}</span>
              </label>`,
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>${this.t('overlay.workspaceColor')}</legend>
        <div class="choices">
          ${swatches.map(
            (color) =>
              html`<label
                class="choice swatch"
                data-color=${color}
                title=${this.t(`settings.accent.${color}`)}
              >
                <input
                  type="radio"
                  name="color"
                  value=${color}
                  .checked=${color === draft.color}
                  @change=${() => (this.draft = { ...this.draft, color })}
                />
                <span class="hidden">${this.t(`settings.accent.${color}`)}</span>
              </label>`,
          )}
        </div>
      </fieldset>
      ${
        item === undefined
          ? html`<label class="isolate">
                <input
                  type="checkbox"
                  .checked=${draft.isolated}
                  aria-describedby="isolate-note"
                  @change=${(event: Event) =>
                    (this.draft = {
                      ...this.draft,
                      isolated: event.target instanceof HTMLInputElement && event.target.checked,
                    })}
                />
                <span>${this.t('overlay.workspaceIsolate')}</span>
              </label>
              <p class="note" id="isolate-note">${this.t('overlay.workspaceIsolateNote')}</p>`
          : item.isolated
            ? html`<p class="note">${this.t('overlay.workspaceIsolated')}</p>`
            : nothing
      }
      ${
        item === undefined
          ? nothing
          : html`<div class="moves">
                <button
                  type="button"
                  ?disabled=${index <= 0}
                  @click=${() => this.move(item, index - 1)}
                >
                  ${this.t('overlay.workspaceMoveUp')}
                </button>
                <button
                  type="button"
                  ?disabled=${index >= content.items.length - 1}
                  @click=${() => this.move(item, index + 1)}
                >
                  ${this.t('overlay.workspaceMoveDown')}
                </button>
              </div>
              ${
                item.id === defaultWorkspaceId
                  ? nothing
                  : html`<button type="button" class="delete" @click=${() => this.ask(item)}>
                      ${this.t('overlay.workspaceDelete')}
                    </button>`
              }`
      }
      <div class="buttons">
        <button type="button" @click=${this.backToList}>
          ${this.t('overlay.workspaceCancel')}
        </button>
        <button type="submit" class="primary">
          ${this.t(item === undefined ? 'overlay.workspaceCreate' : 'overlay.workspaceSave')}
        </button>
      </div>
    </form>`;
  }

  /** The question before a workspace is deleted. */
  private renderQuestion(item: Item): TemplateResult {
    return html`<p class="question">
        ${this.t('overlay.workspaceDeleteQuestion', { name: this.nameOf(item) })}
        ${item.isolated ? this.t('overlay.workspaceDeleteData') : nothing}
      </p>
      <div class="buttons">
        <button type="button" @click=${() => this.startEdit(item)}>
          ${this.t('overlay.workspaceCancel')}
        </button>
        <button type="button" class="primary" @click=${() => this.deleteWorkspace(item)}>
          ${this.t('overlay.workspaceDeleteConfirm')}
        </button>
      </div>`;
  }

  /** A text of the page. */
  private t(key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    return this.i18n?.t(key, params) ?? key;
  }

  /** The name of a workspace; the default one is called Default until it is renamed. */
  private nameOf(item: Item): string {
    return item.name === '' ? this.t('shell.workspaceDefault') : item.name;
  }

  private itemOf(id: string): Item | undefined {
    return this.content?.items.find((item) => item.id === id);
  }

  /** Shows a workspace in the window, which closes the popover. */
  private switchTo(id: string): void {
    if (this.leaving) return;
    void this.bridge?.invoke('overlay.switchWorkspace', { id });
  }

  /** Opens the form of a new workspace, with the icon and the color that are used least. */
  private startCreate(content: WorkspaceListContent): void {
    if (this.leaving || content.full) return;
    const used = (color: Swatch): number =>
      content.items.filter((item) => item.color === color).length;
    const color = swatches.reduce((best, candidate) =>
      used(candidate) < used(best) ? candidate : best,
    );
    this.draft = { name: '', icon: 'circle', color, isolated: false };
    this.show({ kind: 'create' });
  }

  /** Opens the form of a workspace of the list. */
  private startEdit(item: Item): void {
    if (this.leaving) return;
    this.draft = { name: item.name, icon: item.icon, color: item.color, isolated: item.isolated };
    this.show({ kind: 'edit', id: item.id });
  }

  /** Asks whether to delete a workspace. */
  private ask(item: Item): void {
    if (this.leaving) return;
    this.show({ kind: 'delete', id: item.id });
  }

  private show(mode: Mode): void {
    this.mode = mode;
    this.focusNext = true;
  }

  private readonly backToList = (): void => {
    if (this.leaving) return;
    this.show({ kind: 'list' });
  };

  private readonly onName = (event: Event): void => {
    if (event.target instanceof HTMLInputElement) {
      this.draft = { ...this.draft, name: event.target.value.slice(0, workspaceNameLimit) };
    }
  };

  /** Creates the workspace of the form, which the window then shows, or saves the changes. */
  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const mode = this.mode;
    if (this.leaving || (mode.kind !== 'create' && mode.kind !== 'edit')) return;
    const { name, icon, color, isolated } = this.draft;
    // A workspace other than the default one needs a name.
    if (name.trim() === '' && !(mode.kind === 'edit' && mode.id === defaultWorkspaceId)) {
      this.renderRoot.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      return;
    }
    const id = mode.kind === 'edit' ? mode.id : undefined;
    void this.bridge
      ?.invoke('overlay.saveWorkspace', {
        ...(id === undefined ? {} : { id }),
        name,
        icon,
        color,
        isolated,
      })
      .then((saved) => {
        // A new workspace closes the popover as the window shows it; a change goes back to the list.
        if (saved !== null && id !== undefined && this.mode === mode) this.show({ kind: 'list' });
      });
  };

  /** Moves a workspace up or down in the list; its form stays. */
  private move(item: Item, index: number): void {
    if (this.leaving) return;
    void this.bridge?.invoke('overlay.moveWorkspace', { id: item.id, index });
  }

  /** Deletes a workspace after the question. */
  private deleteWorkspace(item: Item): void {
    if (this.leaving) return;
    this.show({ kind: 'list' });
    void this.bridge?.invoke('overlay.deleteWorkspace', { id: item.id });
  }

  /**
   * Escape leaves a form or the question for the list, and closes the popover from the list,
   * as the page does; an input method that composes text keeps it. Tab goes round inside, and
   * the arrows go from workspace to workspace.
   */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.isComposing && this.mode.kind !== 'list') {
      event.preventDefault();
      this.show(
        this.mode.kind === 'delete' ? { kind: 'edit', id: this.mode.id } : { kind: 'list' },
      );
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && this.mode.kind === 'list') {
      const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('.row')];
      const at = rows.findIndex((row) => row === this.shadowRoot?.activeElement);
      if (at === -1) return;
      event.preventDefault();
      rows[(at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input[type="text"], input[type="checkbox"], input[type="radio"]:checked',
      ),
    ];
    const first = stops[0];
    const last = stops.at(-1);
    const at = this.shadowRoot?.activeElement;
    if (event.shiftKey && at === first && last !== undefined) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last && first !== undefined) {
      event.preventDefault();
      first.focus();
    }
  };
}

/** The plus of a new workspace, Lucide's plus. */
const plusIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 12h14M12 5v14" />
</svg>`;

/** The pencil of the button that edits a workspace, Lucide's pencil. */
const pencilIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true">
  <path
    d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
  />
</svg>`;
