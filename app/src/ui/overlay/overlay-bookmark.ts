import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { bookmarkRoots } from '../../shared/bookmarks.ts';
import type { BookmarkEditor } from '../../shared/ipc/overlay-contracts.ts';
import type { Translator } from '../i18n/i18n.ts';
import { popoverStyles } from '../ui-kit/popover-styles.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';
import { placePopover } from './placement.ts';
import { enter } from './popover-motion.ts';

/**
 * The popover of the bookmark star: the name of the page's bookmark, the folder it is in, a way
 * to remove it, and Done. Done, Enter and a click next to the popover save the name and the
 * folder; Escape closes without saving. The folders are a list in the popover, never a menu of
 * the system, and Tab stays in the popover.
 */
export class OverlayBookmark extends LitElement {
  static override properties = {
    content: { attribute: false },
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
        width: 320px;
        max-width: calc(100vw - 2 * var(--space-2));
        padding: var(--space-3);
        overflow-y: auto;
      }
      h2 {
        margin: 0 0 var(--space-2);
        font-size: var(--font-size-larger);
        font-weight: var(--font-weight-strong);
      }
      label {
        display: block;
        margin-top: var(--space-2);
      }
      input,
      select {
        display: block;
        box-sizing: border-box;
        width: 100%;
        margin-top: var(--space-1);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-0);
        color: inherit;
        font: inherit;
      }
      input {
        height: var(--control-large);
        padding: 0 var(--space-2);
      }
      select {
        padding: var(--space-1) 0;
      }
      /* A folder is indented by its depth, which the page sets as --depth on its option. */
      option {
        padding-block: calc(var(--space-1) / 2);
        padding-inline: calc(var(--space-2) + var(--space-3) * var(--depth, 0)) var(--space-2);
      }
      .buttons {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        margin-top: var(--space-3);
      }
      button {
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-1);
        background: var(--surface-2);
        color: inherit;
        font: inherit;
      }
      button:hover {
        background: var(--surface-hover);
      }
      .primary {
        border-color: var(--accent);
      }
      :focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 1px;
      }
    `,
  ];

  declare content: BookmarkEditor | undefined;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  /** Whether the popover only leaves the page, so that it takes no focus and saves nothing. */
  leaving = false;
  /** Whether the popover entered the page already. */
  private entered = false;

  constructor() {
    super();
    this.content = undefined;
  }

  /** The surface of the popover, which leaves the page when it closes. */
  surfaces(): HTMLElement[] {
    const form = this.renderRoot.querySelector<HTMLElement>('form');
    return form === null ? [] : [form];
  }

  /** Saves the name and the folder, as a click next to the popover does. */
  save(): void {
    const content = this.content;
    const form = this.renderRoot.querySelector('form');
    if (content === undefined || form === null || this.leaving) return;
    const title = form.querySelector('input')?.value ?? content.title;
    const folder = Number(form.querySelector('select')?.value);
    void this.bridge?.invoke('overlay.saveBookmark', {
      id: content.id,
      title: title.slice(0, 1024),
      folder: Number.isInteger(folder) && folder > 0 ? folder : content.folder,
    });
  }

  protected override updated(changed: PropertyValues<this>): void {
    const form = this.renderRoot.querySelector<HTMLElement>('form');
    const content = this.content;
    if (form === null || content === undefined) return;
    const placement = placePopover(
      content.anchor,
      { width: form.offsetWidth, height: form.scrollHeight },
      { width: innerWidth, height: innerHeight },
    );
    form.style.left = `${placement.x}px`;
    form.style.top = `${placement.y}px`;
    form.style.maxHeight = `${placement.maxHeight}px`;
    // The policy of the page refuses style attributes, so the depths go in through the CSSOM.
    for (const option of form.querySelectorAll<HTMLOptionElement>('option[data-depth]')) {
      option.style.setProperty('--depth', option.dataset['depth'] ?? '0');
    }
    if (this.entered || this.leaving || !changed.has('content')) return;
    this.entered = true;
    enter(form, placement.above);
    // The name takes the focus, all of it selected, so that typing replaces it.
    const name = form.querySelector('input');
    name?.focus();
    name?.select();
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === undefined) return nothing;
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    // Folders that the popover does not list keep the bookmark where it is.
    const listed = content.folders.some((folder) => folder.id === content.folder);
    return html`<form
      class="popover"
      role="dialog"
      aria-labelledby="bookmark-title"
      @submit=${this.onSubmit}
      @keydown=${this.onKey}
    >
      <h2 id="bookmark-title">
        ${t(content.added ? 'overlay.bookmarkAdded' : 'overlay.bookmarkEdit')}
      </h2>
      <label>
        ${t('bookmarks.name')}
        <input
          name="title"
          maxlength="1024"
          spellcheck="false"
          autocomplete="off"
          .value=${content.title}
        />
      </label>
      <label for="folder">${t('bookmarks.folder')}</label>
      <select id="folder" name="folder" size="6">
        ${content.folders.map(
          (folder) =>
            html`<option
              value=${folder.id}
              data-depth=${folder.depth}
              ?selected=${listed ? folder.id === content.folder : false}
            >
              ${this.folderName(folder, t)}
            </option>`,
        )}
      </select>
      <div class="buttons">
        <button type="button" @click=${this.removeBookmark}>${t('overlay.bookmarkRemove')}</button>
        <button type="submit" class="primary">${t('overlay.bookmarkDone')}</button>
      </div>
    </form>`;
  }

  /** The name of a folder: the two folders at the top have names in the page's language. */
  private folderName(
    folder: BookmarkEditor['folders'][number],
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): string {
    if (folder.id === bookmarkRoots.bar) return t('bookmarks.bar');
    if (folder.id === bookmarkRoots.other) return t('bookmarks.other');
    return folder.title;
  }

  private readonly onSubmit = (event: SubmitEvent): void => {
    // The page cannot submit forms; the browser process gets the values instead.
    event.preventDefault();
    this.save();
  };

  /**
   * Escape closes without saving, Enter in the list of folders saves, as Enter in the name
   * does, and Tab goes round inside the popover.
   */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      void this.bridge?.invoke('overlay.close', {});
      return;
    }
    if (event.key === 'Enter' && event.target instanceof HTMLSelectElement) {
      event.preventDefault();
      this.save();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...this.renderRoot.querySelectorAll<HTMLElement>('input, select, button')];
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

  private readonly removeBookmark = (): void => {
    if (this.leaving) return;
    void this.bridge?.invoke('overlay.removeBookmark', {});
  };
}
