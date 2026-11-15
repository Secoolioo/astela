import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import type {
  MenuEntry,
  MenuLevel,
  MenuPopover,
  ZoomPart,
} from '../../shared/ipc/overlay-contracts.ts';
import { displayShortcut } from '../../shared/shortcuts.ts';
import type { MessageKey, Translator } from '../i18n/i18n.ts';
import { keyNamesOf } from '../ui-kit/key-names.ts';
import { percent } from '../ui-kit/percent.ts';
import { popoverStyles } from '../ui-kit/popover-styles.ts';
import type { PageBridge } from '../ui-kit/settings-client.ts';
import { menuKey, parseLabel, type KeyEntry, type LabelParts } from './menu-keys.ts';
import { placePopover, placeSubmenu } from './placement.ts';
import { enter } from './popover-motion.ts';

/** The parts of the zoom row, from the left. */
const zoomParts: readonly ZoomPart[] = ['zoomOut', 'reset', 'zoomIn', 'fullScreen'];

/** How long the pointer rests on an item before its submenu opens or another one closes, in ms. */
const submenuWait = 300;

/** Whether a part of the zoom row can be chosen. */
function partEnabled(entry: Extract<MenuEntry, { type: 'zoom' }>, part: ZoomPart): boolean {
  if (part === 'zoomOut') return entry.canZoomOut;
  if (part === 'zoomIn') return entry.canZoomIn;
  if (part === 'reset') return entry.zoom !== null;
  return true;
}

/** An entry of a menu as far as the keys need it. */
function keyEntry(entry: MenuEntry): KeyEntry {
  if (entry.type === 'separator') return entry;
  if (entry.type === 'zoom') {
    return {
      type: 'zoom',
      label: entry.label,
      enabled: zoomParts.some((part) => partEnabled(entry, part)),
    };
  }
  return { type: entry.type, label: entry.label, enabled: entry.enabled };
}

/**
 * A shortcut as `aria-keyshortcuts` writes it, such as `Control+Shift+N`; keys that it cannot
 * write, as it joins keys with +, are left out.
 */
function ariaShortcut(shortcut: string | null): string | undefined {
  if (shortcut === null) return undefined;
  const match = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Cmd\+)?(.+)$/.exec(shortcut);
  const key = match?.[5];
  if (match === null || key === undefined || key === '+' || key === '=') return undefined;
  return [
    match[1] === undefined ? '' : 'Control',
    match[2] === undefined ? '' : 'Alt',
    match[3] === undefined ? '' : 'Shift',
    match[4] === undefined ? '' : 'Meta',
    key,
  ]
    .filter((part) => part !== '')
    .join('+');
}

/**
 * A menu in the overlay, such as the browser menu or the menu of a folder of the bookmarks
 * bar, with its submenus next to it. Each level is a `menu` whose items take the focus in turn,
 * as the menu pattern of WAI-ARIA has it: the arrows, Home and End move, Right, Enter and Space
 * open a submenu, Left and Escape close it, Enter and Space choose an item, and letters choose
 * by access key or move to the next item that starts with them. The pointer opens a submenu
 * when it rests on its item. The browser process finds what a chosen place stands for.
 */
export class OverlayMenu extends LitElement {
  static override properties = {
    content: { attribute: false },
    shown: { state: true },
    keysShown: { state: true },
  };

  /** Styles of the menu, scoped to its shadow root. */
  static override styles = [
    popoverStyles,
    css`
      :host {
        display: contents;
      }
      .menu {
        position: fixed;
        top: 0;
        left: 0;
        min-width: 240px;
        max-width: min(400px, calc(100vw - 2 * var(--space-2)));
        padding: var(--space-1);
        overflow-x: hidden;
        overflow-y: auto;
        outline: none;
      }
      .item,
      .zoom {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--control-large);
        padding: 0 var(--space-2);
        border-radius: var(--radius-1);
        white-space: nowrap;
        cursor: default;
        outline: none;
      }
      .item:focus,
      .item[aria-expanded='true'] {
        background: var(--surface-hover);
      }
      /* The item that has the focus carries the accent bar of marked rows (ADR 0051). */
      .item:focus::before {
        content: '';
        position: absolute;
        inset-block: var(--space-2);
        inset-inline-start: 0;
        width: 3px;
        border-radius: var(--radius-pill);
        background: var(--accent);
      }
      .item[aria-disabled='true'] {
        color: var(--text-2);
      }
      .icon {
        display: grid;
        place-items: center;
        flex: none;
        width: 16px;
        color: var(--text-2);
      }
      .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :host([data-keys]) .key {
        text-decoration: underline;
      }
      .shortcut {
        flex: none;
        margin-inline-start: var(--space-4);
        color: var(--text-2);
        font-size: var(--font-size-small);
      }
      .separator {
        height: 1px;
        margin: var(--space-1) 0;
        background: var(--line-1);
      }
      .zoom .label {
        flex: 1;
      }
      .part {
        display: grid;
        place-items: center;
        min-width: var(--control-height);
        height: var(--control-height);
        padding: 0 var(--space-1);
        border-radius: var(--radius-1);
        font-variant-numeric: tabular-nums;
        outline: none;
      }
      .part.reset {
        min-width: calc(var(--control-height) * 2);
      }
      .part:hover,
      .part:focus {
        background: var(--surface-hover);
      }
      .part:focus {
        box-shadow: inset 0 0 0 2px var(--focus-ring);
      }
      .part[aria-disabled='true'] {
        color: var(--text-2);
        opacity: 0.5;
      }
      .part[aria-checked='true'] {
        color: var(--accent);
      }
      .live {
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
      /* Forced colors take every surface away; the item that has the focus keeps the system's mark. */
      @media (forced-colors: active) {
        .item:focus,
        .part:focus {
          forced-color-adjust: none;
          background: Highlight;
          color: HighlightText;
        }
      }
    `,
  ];

  declare content: MenuPopover | undefined;
  /** How many levels of the menu show: a submenu that closed in the page stays in the content. */
  declare shown: number;
  /** Whether the access keys show, after the keyboard opened the menu or while Alt is down. */
  declare keysShown: boolean;
  bridge: PageBridge | undefined;
  i18n: Translator | undefined;
  /** Whether the menu only leaves the page, so that it takes no focus and runs nothing. */
  leaving = false;
  /** The entry that has the focus in each level that shows, or -1 for the level itself. */
  private focused: number[] = [];
  /** The part of the zoom row that the keyboard is on. */
  private zoomPart: ZoomPart = 'reset';
  /** A submenu that was asked for, and whether the keyboard asked, to focus it when it comes. */
  private opening:
    { readonly level: number; readonly index: number; keyboard: boolean } | undefined;
  /** The entry that takes the focus after the next update. */
  private focusAfter: { readonly level: number; readonly index: number } | undefined;
  private waiting: ReturnType<typeof setTimeout> | undefined;
  /** Whether the menu entered the page already. */
  private entered = false;

  constructor() {
    super();
    this.content = undefined;
    this.shown = 1;
    this.keysShown = false;
  }

  override disconnectedCallback(): void {
    clearTimeout(this.waiting);
    super.disconnectedCallback();
  }

  /** The surfaces of the menu, which leave the page when it closes. */
  surfaces(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('.menu')];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('content')) return;
    const content = this.content;
    if (content === undefined) return;
    const before = changed.get('content');
    if (before === undefined) {
      this.shown = 1;
      this.focused = [];
      this.keysShown = content.keyboard && !content.mac;
      // Opened with the keyboard, the first item takes the focus; with the pointer, the menu.
      this.focusAfter = { level: 0, index: content.keyboard ? this.firstOf(0) : -1 };
      return;
    }
    const opening = this.opening;
    const opened = opening === undefined ? undefined : content.levels[opening.level + 1];
    if (opening !== undefined && opened?.parent === opening.index) {
      this.opening = undefined;
      this.shown = opening.level + 2;
      // A submenu that the keyboard opened takes the focus at its first item.
      if (opening.keyboard) {
        this.focusAfter = { level: opening.level + 1, index: this.firstOf(opening.level + 1) };
      }
    } else {
      this.shown = Math.min(this.shown, content.levels.length);
    }
    this.focused = this.focused.slice(0, this.shown);
  }

  protected override updated(): void {
    const content = this.content;
    if (content === undefined) return;
    this.toggleAttribute('data-keys', this.keysShown && !content.mac);
    const panels = this.surfaces();
    const viewport = { width: innerWidth, height: innerHeight };
    let above = false;
    for (const panel of panels) {
      const level = Number(panel.dataset['level']);
      const size = { width: panel.offsetWidth, height: panel.scrollHeight };
      const parent =
        level === 0 ? undefined : this.itemElement(level - 1, content.levels[level]?.parent ?? -1);
      const placement =
        parent === undefined
          ? placePopover(content.anchor, size, viewport, { align: content.align })
          : placeSubmenu(parent.getBoundingClientRect(), size, viewport);
      if (level === 0) above = placement.above;
      panel.style.left = `${placement.x}px`;
      panel.style.top = `${placement.y}px`;
      panel.style.maxHeight = `${placement.maxHeight}px`;
    }
    if (!this.entered && !this.leaving && panels[0] !== undefined) {
      this.entered = true;
      enter(panels[0], above);
    }
    const target = this.focusAfter;
    this.focusAfter = undefined;
    if (target !== undefined && !this.leaving) this.moveFocus(target.level, target.index);
  }

  override render(): TemplateResult | typeof nothing {
    const content = this.content;
    if (content === undefined) return nothing;
    return html`${content.levels
      .slice(0, this.shown)
      .map((level, depth) => this.renderLevel(level, depth))}`;
  }

  private renderLevel(level: MenuLevel, depth: number): TemplateResult {
    const mac = this.content?.mac ?? false;
    return html`<div
      class="popover menu"
      role="menu"
      aria-label=${parseLabel(level.label, mac).text}
      aria-orientation="vertical"
      tabindex="-1"
      data-level=${depth}
      @keydown=${(event: KeyboardEvent) => this.onKey(event, depth)}
    >
      ${level.items.map((entry, index) => this.renderEntry(entry, depth, index))}
    </div>`;
  }

  private renderEntry(entry: MenuEntry, depth: number, index: number): TemplateResult {
    if (entry.type === 'separator') return html`<div class="separator" role="separator"></div>`;
    if (entry.type === 'zoom') return this.renderZoom(entry, depth, index);
    const mac = this.content?.mac ?? false;
    const parts = parseLabel(entry.label, mac);
    const icon = entry.icon === null ? nothing : icons[entry.icon];
    const focused = this.focused[depth] === index;
    if (entry.type === 'submenu') {
      const open = this.shown > depth + 1 && this.content?.levels[depth + 1]?.parent === index;
      return html`<div
        class="item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded=${open ? 'true' : 'false'}
        aria-disabled=${entry.enabled ? nothing : 'true'}
        tabindex=${focused ? '0' : '-1'}
        data-level=${depth}
        data-index=${index}
        @click=${() => this.openSubmenu(depth, index, false)}
        @mouseenter=${() => this.hover(depth, index)}
      >
        <span class="icon" aria-hidden="true">${icon}</span>
        <span class="label">${this.renderLabel(parts)}</span>
        <span class="icon" aria-hidden="true">${icons.more}</span>
      </div>`;
    }
    const shortcut = entry.shortcut;
    return html`<div
      class="item"
      role="menuitem"
      aria-disabled=${entry.enabled ? nothing : 'true'}
      aria-keyshortcuts=${ariaShortcut(shortcut) ?? nothing}
      tabindex=${focused ? '0' : '-1'}
      data-level=${depth}
      data-index=${index}
      @click=${(event: MouseEvent) => this.activate(depth, index, event.ctrlKey || event.metaKey)}
      @auxclick=${(event: MouseEvent) => {
        if (event.button === 1) this.activate(depth, index, true);
      }}
      @mouseenter=${() => this.hover(depth, index)}
    >
      <span class="icon" aria-hidden="true">${icon}</span>
      <span class="label">${this.renderLabel(parts)}</span>
      ${
        shortcut === null
          ? nothing
          : html`<span class="shortcut" aria-hidden="true">${this.shortcutText(shortcut)}</span>`
      }
    </div>`;
  }

  /**
   * The zoom row: zoom out, the zoom of the page, which resets it, zoom in and full screen. The
   * menu stays open while the page zooms, and the new zoom is read out.
   */
  private renderZoom(
    entry: Extract<MenuEntry, { type: 'zoom' }>,
    depth: number,
    index: number,
  ): TemplateResult {
    const mac = this.content?.mac ?? false;
    const focused = this.focused[depth] === index;
    const language = this.i18n?.language;
    const zoom = entry.zoom === null ? '–' : percent(entry.zoom, language);
    const part = (name: ZoomPart, shown: TemplateResult | string): TemplateResult => {
      const enabled = partEnabled(entry, name);
      const label = parseLabel(entry.labels[name], mac).text;
      return html`<div
        class="part ${name === 'reset' ? 'reset' : ''}"
        role=${name === 'fullScreen' ? 'menuitemcheckbox' : 'menuitem'}
        aria-label=${label}
        title=${label}
        aria-checked=${name === 'fullScreen' ? String(entry.fullScreen) : nothing}
        aria-disabled=${enabled ? nothing : 'true'}
        aria-keyshortcuts=${ariaShortcut(entry.shortcuts[name]) ?? nothing}
        tabindex=${focused && this.zoomPart === name ? '0' : '-1'}
        data-level=${depth}
        data-index=${index}
        data-part=${name}
        @click=${() => this.choosePart(depth, index, name)}
        @mouseenter=${() => this.hover(depth, index, name)}
      >
        ${shown}
      </div>`;
    };
    return html`<div class="zoom" role="group" aria-label=${parseLabel(entry.label, mac).text}>
      <span class="label" aria-hidden="true"
        >${this.renderLabel(parseLabel(entry.label, mac))}</span
      >
      ${part('zoomOut', icons.minus)} ${part('reset', zoom)} ${part('zoomIn', icons.plus)}
      ${part('fullScreen', icons.fullScreen)}
      <span class="live" aria-live="polite"
        >${entry.zoom === null ? '' : this.t('overlay.zoomState', { zoom })}</span
      >
    </div>`;
  }

  /** The text of an item, with its access key marked. */
  private renderLabel(parts: LabelParts): TemplateResult | string {
    const { text, at } = parts;
    if (at === undefined) return text;
    const key = /^./su.exec(text.slice(at))?.[0] ?? '';
    return html`${text.slice(0, at)}<span class="key">${key}</span>${text.slice(at + key.length)}`;
  }

  /** A shortcut as the system writes it, with the names of keys in the page's language. */
  private shortcutText(shortcut: string): string {
    return displayShortcut(
      shortcut,
      this.content?.mac ?? false,
      keyNamesOf((key) => this.t(key)),
    );
  }

  /** The element of an entry, or of the part of the zoom row that the keyboard is on. */
  private itemElement(level: number, index: number): HTMLElement | undefined {
    const items = [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        `[data-level="${level}"][data-index="${index}"]`,
      ),
    ];
    return items.find((item) => item.dataset['part'] === this.zoomPart) ?? items[0];
  }

  /** The first entry of a level that the keyboard reaches, or -1. */
  private firstOf(level: number): number {
    const content = this.content;
    const entries = content?.levels[level]?.items.map(keyEntry) ?? [];
    const first = menuKey(entries, -1, 'Home', { mac: content?.mac ?? false, root: level === 0 });
    return first.kind === 'focus' ? first.index : -1;
  }

  /** Gives an entry of a level the focus, or the level itself for -1. */
  private moveFocus(level: number, index: number): void {
    this.focused[level] = index;
    this.focused.length = level + 1;
    // The zoom row takes the focus on a part that can be chosen.
    const entry = this.content?.levels[level]?.items[index];
    if (entry?.type === 'zoom' && !partEnabled(entry, this.zoomPart)) {
      this.zoomPart = zoomParts.find((part) => partEnabled(entry, part)) ?? 'fullScreen';
    }
    const target =
      index === -1
        ? this.renderRoot.querySelector<HTMLElement>(`.menu[data-level="${level}"]`)
        : this.itemElement(level, index);
    // The roving focus: only the focused entry of a level is in the order of Tab.
    for (const item of this.renderRoot.querySelectorAll<HTMLElement>(
      `[data-level="${level}"][data-index]`,
    )) {
      item.tabIndex = item === target ? 0 : -1;
    }
    target?.focus();
  }

  private readonly onKey = (event: KeyboardEvent, depth: number): void => {
    const content = this.content;
    const level = content?.levels[depth];
    if (content === undefined || level === undefined || this.leaving) return;
    if (event.key === 'Alt') {
      if (!content.mac) this.keysShown = true;
      return;
    }
    // Shortcuts belong to the browser; Ctrl or Command with Enter opens a bookmark in a new tab.
    if ((event.ctrlKey || event.metaKey) && event.key !== 'Enter') return;
    const index = this.focused[depth] ?? -1;
    const entry = level.items[index];
    if (entry?.type === 'zoom' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      this.stepPart(entry, depth, index, event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    const action = menuKey(level.items.map(keyEntry), index, event.key, {
      mac: content.mac,
      root: depth === 0,
    });
    if (action.kind === 'none') return;
    event.preventDefault();
    switch (action.kind) {
      case 'focus':
        this.leaveSubmenus(depth);
        this.moveFocus(depth, action.index);
        break;
      case 'activate': {
        const chosen = level.items[action.index];
        if (chosen?.type === 'zoom') this.choosePart(depth, action.index, this.zoomPart);
        else this.activate(depth, action.index, event.ctrlKey || event.metaKey);
        break;
      }
      case 'openSubmenu':
        this.openSubmenu(depth, action.index, true);
        break;
      case 'closeSubmenu':
        this.closeSubmenu(depth);
        break;
      case 'closeMenu':
        void this.bridge?.invoke('overlay.close', {});
        break;
    }
  };

  /** Moves the keyboard to the next part of the zoom row that can be chosen. */
  private stepPart(
    entry: Extract<MenuEntry, { type: 'zoom' }>,
    depth: number,
    index: number,
    by: 1 | -1,
  ): void {
    const from = zoomParts.indexOf(this.zoomPart);
    for (let moved = 1; moved < zoomParts.length; moved += 1) {
      const next = zoomParts[from + by * moved];
      if (next === undefined) return;
      if (partEnabled(entry, next)) {
        this.zoomPart = next;
        this.moveFocus(depth, index);
        return;
      }
    }
  }

  /** The pointer reached an entry: it takes the focus, and its submenu opens after a moment. */
  private hover(depth: number, index: number, part?: ZoomPart): void {
    if (this.leaving) return;
    clearTimeout(this.waiting);
    const entry = this.content?.levels[depth]?.items[index];
    if (entry === undefined) return;
    if (part !== undefined) this.zoomPart = part;
    this.moveFocus(depth, index);
    const open = this.shown > depth + 1 && this.content?.levels[depth + 1]?.parent === index;
    if (entry.type === 'submenu' && entry.enabled && !open) {
      this.waiting = setTimeout(() => this.openSubmenu(depth, index, false), submenuWait);
    } else if (!open && this.shown > depth + 1) {
      this.waiting = setTimeout(() => {
        if (!this.leaving) this.shown = depth + 1;
      }, submenuWait);
    }
  }

  /** Closes the submenus after a level, once the keyboard moves on in it. */
  private leaveSubmenus(depth: number): void {
    if (this.shown > depth + 1) this.shown = depth + 1;
  }

  /** Opens the submenu of an item, or moves into it when it is open. */
  private openSubmenu(depth: number, index: number, keyboard: boolean): void {
    clearTimeout(this.waiting);
    const content = this.content;
    const entry = content?.levels[depth]?.items[index];
    if (content === undefined || entry?.type !== 'submenu' || !entry.enabled || this.leaving)
      return;
    const next = content.levels[depth + 1];
    if (this.shown > depth + 1 && next?.parent === index) {
      if (keyboard) this.moveFocus(depth + 1, this.firstOf(depth + 1));
      return;
    }
    this.shown = depth + 1;
    this.opening = { level: depth, index, keyboard };
    void this.bridge?.invoke('overlay.openSubmenu', { level: depth, index });
  }

  /** Closes a submenu and gives its item the focus again. */
  private closeSubmenu(depth: number): void {
    const parent = this.content?.levels[depth]?.parent ?? -1;
    this.shown = depth;
    this.focusAfter = { level: depth - 1, index: parent };
  }

  /** Chooses an item; a bookmark opens in a new tab with Ctrl or Command, or the middle button. */
  private activate(depth: number, index: number, newTab: boolean): void {
    const entry = this.content?.levels[depth]?.items[index];
    if (entry === undefined || this.leaving) return;
    if (entry.type === 'submenu') {
      this.openSubmenu(depth, index, false);
      return;
    }
    if (entry.type !== 'item' || !entry.enabled) return;
    void this.bridge?.invoke('overlay.chooseMenuItem', { level: depth, index, newTab });
  }

  /** Chooses a part of the zoom row; the menu stays open while the page zooms. */
  private choosePart(depth: number, index: number, part: ZoomPart): void {
    const entry = this.content?.levels[depth]?.items[index];
    if (entry?.type !== 'zoom' || !partEnabled(entry, part) || this.leaving) return;
    this.zoomPart = part;
    this.moveFocus(depth, index);
    void this.bridge?.invoke('overlay.chooseMenuItem', {
      level: depth,
      index,
      part,
      newTab: false,
    });
  }

  private t(key: MessageKey, params?: Readonly<Record<string, string>>): string {
    return this.i18n?.t(key, params) ?? key;
  }
}

/** Icons of the menus, drawn after Lucide (ISC license). */
const icons = {
  bookmark: html`<svg viewBox="0 0 24 24">
    <path
      d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2.1 2.1 0 0 0-2 0L6.4 21a.5.5 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.1-.7a2.1 2.1 0 0 0 1.6-1.2z"
    />
  </svg>`,
  folder: html`<svg viewBox="0 0 24 24">
    <path
      d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
    />
  </svg>`,
  more: html`<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>`,
  minus: html`<svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>`,
  plus: html`<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14" /></svg>`,
  fullScreen: html`<svg viewBox="0 0 24 24">
    <path
      d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"
    />
  </svg>`,
};
