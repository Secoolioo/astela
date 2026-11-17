import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import type { GroupEditor } from '../../shared/ipc/overlay-contracts.ts';
import { swatches, type Swatch } from '../../shared/swatches.ts';
import type { Translator } from '../i18n/i18n.ts';
import { popoverStyles } from '../ui-kit/popover-styles.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';
import { placePopover } from './placement.ts';
import { enter } from './popover-motion.ts';

/**
 * The popover of a group of tabs at its chip: the name of the group and its color, which
 * change at once, a new tab in the group, and the buttons that end the group or close its tabs.
 * Escape and a click next to the popover close it; Tab stays inside it. Below the chip, or
 * above it when the tab strip is at the bottom of the window.
 */
export class GroupPopover extends LitElement {
  static override properties = {
    content: { attribute: false },
    color: { state: true },
  };

  /** Styles of the popover, scoped to its shadow root. */
  static override styles = [
    popoverStyles,
    css`
      :host {
        display: contents;
      }
      form {
        position: fixed;
        top: 0;
        left: 0;
        width: 288px;
        max-width: calc(100vw - 2 * var(--space-2));
        padding: var(--space-3);
        overflow-y: auto;
      }
      h2 {
        margin: 0 0 var(--space-2);
        font-size: var(--font-size-larger);
        font-weight: var(--font-weight-strong);
      }
      label.name {
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
      input[type='text']::placeholder {
        color: var(--text-2);
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
      .swatches {
        display: flex;
        gap: var(--space-2);
      }
      [data-color='blue'] {
        --group-color: var(--swatch-blue);
      }
      [data-color='teal'] {
        --group-color: var(--swatch-teal);
      }
      [data-color='green'] {
        --group-color: var(--swatch-green);
      }
      [data-color='orange'] {
        --group-color: var(--swatch-orange);
      }
      [data-color='red'] {
        --group-color: var(--swatch-red);
      }
      [data-color='graphite'] {
        --group-color: var(--swatch-graphite);
      }
      /* Each color is a round swatch; the radio inside it takes the keys and the focus. */
      .swatch {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--control-height);
        height: var(--control-height);
        border-radius: var(--radius-pill);
        background: var(--group-color);
      }
      .swatch input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
      }
      .swatch:has(input:checked) {
        outline: 2px solid var(--text-1);
        outline-offset: 2px;
      }
      .swatch:has(input:focus-visible) {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }
      .label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .buttons {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin-top: var(--space-3);
        padding-top: var(--space-2);
        border-top: 1px solid var(--line-1);
      }
      button {
        padding: var(--space-1) var(--space-2);
        border: 0;
        border-radius: var(--radius-1);
        background: transparent;
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
      @media (forced-colors: active) {
        .swatch {
          border: 1px solid CanvasText;
        }
        .swatch:has(input:checked) {
          outline-color: Highlight;
        }
      }
    `,
  ];

  declare content: GroupEditor | undefined;
  /** The color that the popover shows as chosen, which changes before the browser answers. */
  declare color: Swatch | undefined;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  /** Whether the popover only leaves the page, so that it takes no focus and changes nothing. */
  leaving = false;
  /** Whether the popover entered the page already. */
  private entered = false;

  constructor() {
    super();
    this.content = undefined;
    this.color = undefined;
  }

  /** The surface of the popover, which leaves the page when it closes. */
  surfaces(): HTMLElement[] {
    const form = this.renderRoot.querySelector<HTMLElement>('form');
    return form === null ? [] : [form];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('content') && this.color === undefined) this.color = this.content?.color;
  }

  protected override updated(changed: PropertyValues<this>): void {
    const form = this.renderRoot.querySelector<HTMLElement>('form');
    const content = this.content;
    if (form === null || content === undefined) return;
    const placement = placePopover(
      content.anchor,
      { width: form.offsetWidth, height: form.scrollHeight },
      { width: innerWidth, height: innerHeight },
      { align: 'start' },
    );
    form.style.left = `${placement.x}px`;
    form.style.top = `${placement.y}px`;
    form.style.maxHeight = `${placement.maxHeight}px`;
    form.toggleAttribute('data-above', placement.above);
    if (this.entered || this.leaving || !changed.has('content')) return;
    this.entered = true;
    enter(form, placement.above);
    // The name takes the focus, all of it selected, so that typing replaces it.
    const name = form.querySelector<HTMLInputElement>('input[type="text"]');
    name?.focus();
    name?.select();
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === undefined) return nothing;
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    return html`<form
      class="popover"
      role="dialog"
      aria-labelledby="group-title"
      @submit=${this.onSubmit}
      @keydown=${this.onKey}
    >
      <h2 id="group-title">${t('overlay.group')}</h2>
      <label class="name">
        ${t('overlay.groupName')}
        <input
          type="text"
          maxlength="50"
          spellcheck="false"
          autocomplete="off"
          placeholder=${t('overlay.groupNamePlaceholder')}
          .value=${content.name}
          @input=${this.onName}
        />
      </label>
      <fieldset>
        <legend>${t('overlay.groupColor')}</legend>
        <div class="swatches">
          ${swatches.map(
            (swatch) =>
              html`<label
                class="swatch"
                data-color=${swatch}
                title=${t(`settings.accent.${swatch}`)}
              >
                <input
                  type="radio"
                  name="color"
                  value=${swatch}
                  .checked=${swatch === this.color}
                  @change=${() => this.choose(swatch)}
                />
                <span class="label">${t(`settings.accent.${swatch}`)}</span>
              </label>`,
          )}
        </div>
      </fieldset>
      <div class="buttons">
        <button type="button" @click=${() => this.act('newTab')}>
          ${t('overlay.groupNewTab')}
        </button>
        <button type="button" @click=${() => this.act('ungroup')}>
          ${t('overlay.groupUngroup')}
        </button>
        <button type="button" @click=${() => this.act('close')}>${t('overlay.groupClose')}</button>
      </div>
    </form>`;
  }

  /** Renames the group while people type; the field keeps its text and its caret. */
  private readonly onName = (event: Event): void => {
    if (this.leaving || !(event.target instanceof HTMLInputElement)) return;
    void this.bridge?.invoke('overlay.editGroup', { name: event.target.value.slice(0, 50) });
  };

  /** Gives the group another color. */
  private choose(color: Swatch): void {
    if (this.leaving) return;
    this.color = color;
    void this.bridge?.invoke('overlay.editGroup', { color });
  }

  /** Opens a new tab in the group, ends it or closes its tabs; the popover closes. */
  private act(action: 'newTab' | 'ungroup' | 'close'): void {
    if (this.leaving) return;
    void this.bridge?.invoke('overlay.groupAction', { action });
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    // Enter in the name keeps it, which the popover saved while people typed, and closes.
    event.preventDefault();
    if (!this.leaving) void this.bridge?.invoke('overlay.close', {});
  };

  /** Tab goes round inside the popover. */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const stops = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        'input[type="text"], input[type="radio"]:checked, button',
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
