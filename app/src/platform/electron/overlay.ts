import { WebContentsView, type Input, type WebContents } from 'electron';
import { AltTap } from '../../domain/windows/alt-tap.ts';
import { OverlayChanged, type OverlayContent } from '../../shared/ipc/overlay-contracts.ts';
import type { ShellPopover } from '../../shared/ipc/shell-contracts.ts';
import { privateWindowArgument } from '../../shared/private-window.ts';
import type { BrowserWindowController, OverlayHandle } from './browser-window.ts';
import type { IpcGate } from './ipc-gate.ts';
import type { IpcRouter } from './ipc-router.ts';
import { commandForInput, type WindowCommand } from './shortcuts.ts';

/** What the overlays of all windows share. */
export interface OverlayOptions {
  /** URL of the overlay page, normally `app://overlay/`. */
  readonly url: string;
  /** Path of the preload script of the browser's own pages. */
  readonly preload: string;
  /** Partition of the browser's own views. */
  readonly partition: string;
  /** Command line argument that gives the page its design tokens. */
  readonly appearanceArgument: () => string;
  /** Command line arguments that give the page its language. */
  readonly languageArguments: readonly string[];
  readonly gate: IpcGate;
  readonly router: IpcRouter;
}

/** How the overlay handles the keys of a popover before its page sees them. */
export interface OverlayKeys {
  /**
   * Who handles Escape: the browser process, which closes the overlay, or the page, such as a
   * menu, whose submenu closes first. The page closes the overlay itself then; while it loads
   * or does not answer, the browser process closes it.
   */
  readonly escape?: 'close' | 'page';
  /**
   * Asked first for the shortcut of a window command that a key press of the popover gives:
   * `true` when the popover took it, as the browser menu takes its own shortcut to close.
   * Otherwise the overlay closes and the window runs the command.
   */
  readonly onCommand?: (command: WindowCommand) => boolean;
  /** Whether Alt pressed and released alone closes the popover, as it closes menus. */
  readonly closeOnAlt?: boolean;
}

/** How the overlay shows content. */
export interface OverlayOpenOptions {
  /**
   * Called once when the content closes or is replaced, such as to cancel what it asked for.
   */
  readonly onClose?: () => void;
  /**
   * Where the overlay lies in the window, for a list that leaves the rest of the window to the
   * shell and the page and does not take the focus; the whole window otherwise.
   */
  readonly bounds?: Electron.Rectangle;
  /** The button of the shell that the popover belongs to, which shows it as open. */
  readonly popover?: ShellPopover;
  /**
   * Where the focus goes when the popover closes: back to the shell, after the keyboard
   * opened the popover from there, or to the page, the default.
   */
  readonly focusBack?: 'shell' | 'content';
  /** How the popover handles keys. */
  readonly keys?: OverlayKeys;
  /**
   * Whether a question of a site may take the place of the popover. Menus and popovers that
   * only show something give way; prompts and editors keep what was typed into them.
   */
  readonly yieldsToQuestions?: boolean;
}

/**
 * How long a popover that closed keeps the overlay in the window at most, in milliseconds,
 * while its page lets it leave; the page tells when it is done, after `--motion-exit`.
 */
export const exitFallbackMs = 250;

/**
 * A transparent view above the tabs of a window, for popovers and prompts that must cover
 * web content, which lies above the shell. The view is made when it is first needed, or a
 * moment before, and is part of the window only while it shows something, because a view
 * takes the clicks and the focus of what lies below it. A click next to the popover, Escape,
 * a shortcut, a change of the window's size or of its visible tab closes it, and so does a
 * crash or a hang of its page; the focus goes back to the page, or to the shell when the
 * keyboard opened the popover there, and the view leaves the window once the popover has left
 * the page.
 */
export class WindowOverlay implements OverlayHandle {
  private view: WebContentsView | undefined;
  private shown: OverlayContent | null = null;
  /** Called once when what the overlay shows closes or is replaced. */
  private onClose: (() => void) | undefined;
  /** Whether what the overlay shows took the focus, which closing it gives back. */
  private tookFocus = false;
  /** Whether what the overlay shows covers the whole window. */
  private covering = false;
  /** Whether the view is one of the window's views. */
  private attached = false;
  /** Leaves the window with the view once a popover that closed had the time to leave. */
  private exitTimer: ReturnType<typeof setTimeout> | undefined;
  /** How the content that the overlay shows was opened. */
  private shownOptions: OverlayOpenOptions = {};
  /** Alt pressed and released alone in the overlay's page. */
  private readonly altTap = new AltTap();
  /** Whether the overlay's page stopped answering, until it answers again. */
  private hung = false;
  /** Whether the process of the overlay's page ended, until the page loads again. */
  private gone = false;
  private readonly window: BrowserWindowController;
  private readonly options: OverlayOptions;

  /**
   * @param window - The window that the overlay covers.
   * @param options - What the overlays of all windows share.
   */
  constructor(window: BrowserWindowController, options: OverlayOptions) {
    this.window = window;
    this.options = options;
  }

  /** What the overlay shows, or `null` while it is closed. */
  get content(): OverlayContent | null {
    return this.shown;
  }

  /** The page of the overlay, once it exists. */
  get contents(): WebContents | undefined {
    return this.view?.webContents;
  }

  /** Whether the overlay shows something that covers the whole window, such as a popover. */
  get coversWindow(): boolean {
    return this.shown !== null && this.covering;
  }

  /** The popover of a button of the shell that the overlay shows, or `null`. */
  get popover(): ShellPopover | null {
    return this.shown === null ? null : (this.shownOptions.popover ?? null);
  }

  /**
   * Whether a question of a site may take the place of what the overlay shows: when it shows
   * nothing, or a popover that gives way to questions.
   */
  get yieldsToQuestions(): boolean {
    return this.shown === null || this.shownOptions.yieldsToQuestions === true;
  }

  /**
   * Makes the overlay's view and loads its page, without making it part of the window, so
   * that the first popover need not wait for them. Nothing happens once the view exists.
   */
  prepare(): void {
    if (this.window.window.isDestroyed()) return;
    this.ready();
  }

  /**
   * Shows content above the window's tabs, or replaces what it shows.
   * @param content - What to show.
   * @param options - How it shows: where, what its closing calls and where it gives the focus
   *   back, and how it handles keys and questions of sites.
   */
  open(content: OverlayContent, options: OverlayOpenOptions = {}): void {
    this.settle();
    this.onClose = options.onClose;
    const view = this.ready();
    const base = this.window.window;
    // A popover that is still leaving gives way at once: the view stays where it is.
    clearTimeout(this.exitTimer);
    this.exitTimer = undefined;
    const { width, height } = base.getContentBounds();
    view.setBounds(options.bounds ?? { x: 0, y: 0, width, height });
    // Adding a view that the window holds already moves it to the top.
    base.contentView.addChildView(view);
    this.attached = true;
    this.shown = content;
    this.shownOptions = options;
    this.covering = options.bounds === undefined;
    this.tookFocus = options.bounds === undefined;
    this.altTap.reset();
    this.window.overlay = this;
    // Focusing the view would raise a window in the background, such as for a site's question.
    if (base.isFocused() && options.bounds === undefined) view.webContents.focus();
    this.options.router.publish(OverlayChanged, view.webContents, content);
  }

  /**
   * Changes what an open overlay shows, without taking the focus.
   * @param content - What to show.
   * @param bounds - Where the overlay lies now, for a list that changed its length.
   */
  update(content: OverlayContent, bounds?: Electron.Rectangle): void {
    if (this.shown === null || this.view === undefined) return;
    if (bounds !== undefined) this.view.setBounds(bounds);
    this.shown = content;
    this.options.router.publish(OverlayChanged, this.view.webContents, content);
  }

  /**
   * Puts the overlay above every other view of the window again while it shows something,
   * after the window attached a view, such as the page of a tab.
   */
  raise(): void {
    const view = this.view;
    if (this.shown === null || view === undefined || this.window.window.isDestroyed()) return;
    // Adding a view that the window holds already moves it to the top.
    this.window.window.contentView.addChildView(view);
  }

  /**
   * Closes the overlay and gives the focus back to the page or the shell, if the overlay had
   * it: a list below the address bar leaves the focus where the typing goes on. A popover that
   * covers the window leaves the page with its motion first, and the view stays in the window
   * until the page says that it is done, or for {@link exitFallbackMs} at most.
   * @param how - `now` takes the view out of the window at once, as for a change of the
   *   window's size, which would leave the popover in the wrong place.
   */
  close(how: 'animate' | 'now' = 'animate'): void {
    if (this.shown === null) {
      // A popover that is still leaving goes at once.
      if (how === 'now') this.detach();
      return;
    }
    const covering = this.covering;
    const focusBack = this.shownOptions.focusBack ?? 'content';
    this.shown = null;
    this.settle();
    this.shownOptions = {};
    if (this.window.overlay === this) this.window.overlay = undefined;
    const view = this.view;
    if (view === undefined || this.window.window.isDestroyed()) return;
    const hadFocus = this.tookFocus || view.webContents.isFocused();
    // A page whose process ended has nothing to clear; it loads empty again with the next
    // popover.
    if (!this.ended(view.webContents)) {
      this.options.router.publish(OverlayChanged, view.webContents, null);
    }
    if (hadFocus && this.window.window.isFocused()) {
      if (focusBack === 'shell') this.window.shellContents.focus();
      else this.window.focusContent();
    }
    clearTimeout(this.exitTimer);
    this.exitTimer = undefined;
    if (how === 'now' || !covering) this.detach();
    else this.exitTimer = setTimeout(() => this.detach(), exitFallbackMs);
  }

  /** Takes the view out of the window once the page let a popover that closed leave. */
  exited(): void {
    if (this.shown === null) this.detach();
  }

  /** Takes the view out of the window, unless it shows something again. */
  private detach(): void {
    clearTimeout(this.exitTimer);
    this.exitTimer = undefined;
    const view = this.view;
    if (this.shown !== null || !this.attached || view === undefined) return;
    this.attached = false;
    // A destroyed window no longer has a content view; touching it blocks.
    if (!this.window.window.isDestroyed()) this.window.window.contentView.removeChildView(view);
  }

  /** The view of the overlay, made once, with its page loaded again after its process ended. */
  private ready(): WebContentsView {
    const view = (this.view ??= this.create());
    if (this.ended(view.webContents)) {
      this.gone = false;
      this.hung = false;
      void view.webContents.loadURL(this.options.url);
    }
    return view;
  }

  /**
   * Whether the process of the overlay's page ended, however Chromium tells it: with the
   * sandbox of Linux, a renderer that crashed can count as one that exited cleanly, which
   * Electron does not count as crashed.
   */
  private ended(contents: WebContents): boolean {
    return this.gone || contents.isCrashed();
  }

  /**
   * Whether the overlay's page can handle its keys: it has loaded and answers. Until then, a
   * popover shows nothing that the page could close, so the browser process closes it.
   */
  private pageAnswers(): boolean {
    const contents = this.view?.webContents;
    return contents !== undefined && !this.hung && !contents.isLoading() && !this.ended(contents);
  }

  private settle(): void {
    const onClose = this.onClose;
    this.onClose = undefined;
    onClose?.();
  }

  /**
   * Handles a key press of the overlay's page before the page sees it: Escape closes the
   * overlay unless the page handles it, a shortcut of the window closes the overlay and runs,
   * unless the popover takes it, and Alt alone closes a menu.
   */
  private onInput(event: { preventDefault(): void }, input: Input): void {
    if (this.shown === null) return;
    const keys = this.shownOptions.keys ?? {};
    if (
      keys.closeOnAlt === true &&
      process.platform !== 'darwin' &&
      this.altTap.key(input) === 'open'
    ) {
      this.close();
      return;
    }
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape') {
      // An input method composes text with Escape too, and the page may close a part first,
      // once it has loaded and answers.
      if (input.isComposing || (keys.escape === 'page' && this.pageAnswers())) return;
      event.preventDefault();
      this.close(this.pageAnswers() ? 'animate' : 'now');
      return;
    }
    const command = commandForInput(input, process.platform, this.window.shortcuts());
    if (command === undefined) return;
    event.preventDefault();
    if (keys.onCommand?.(command) === true) return;
    this.close();
    this.window.execute(command);
  }

  private create(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.options.preload,
        partition: this.options.partition,
        additionalArguments: [
          '--bridge-scope=overlay',
          this.options.appearanceArgument(),
          ...this.options.languageArguments,
          ...(this.window.isPrivate ? [privateWindowArgument] : []),
        ],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        v8CacheOptions: 'bypassHeatCheck',
        // The page would take the focus as it loads, also for a list that leaves it in the
        // address bar; what takes the focus gets it from open().
        focusOnNavigation: false,
      },
    });
    view.setBackgroundColor('#00000000');
    const contents = view.webContents;
    const registration = this.options.gate.registerView(contents.id, {
      origin: 'app://overlay',
      capabilities: new Set(['overlay', 'appearance']),
    });
    contents.on('before-input-event', (event, input) => this.onInput(event, input));
    // The popover would no longer lie at its button; it goes at once.
    const close = (): void => this.close('now');
    // A page that crashed or hangs would leave a view in the window that takes every click and
    // key; the view leaves, and a page whose process ended loads again with the next popover.
    contents.on('render-process-gone', () => {
      this.gone = true;
      close();
    });
    contents.on('unresponsive', () => {
      this.hung = true;
      close();
    });
    contents.on('responsive', () => (this.hung = false));
    this.window.window.on('resize', close);
    // An Alt that went down before the window lost the focus, as for Alt+Tab, closes nothing.
    this.window.window.on('blur', () => this.altTap.reset());
    this.window.window.once('closed', () => {
      clearTimeout(this.exitTimer);
      this.exitTimer = undefined;
      registration.dispose();
      if (!contents.isDestroyed()) contents.close();
    });
    void contents.loadURL(this.options.url);
    return view;
  }
}
