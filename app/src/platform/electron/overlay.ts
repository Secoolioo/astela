import { WebContentsView, type WebContents } from 'electron';
import { OverlayChanged, type OverlayContent } from '../../shared/ipc/overlay-contracts.ts';
import { privateWindowArgument } from '../../shared/private-window.ts';
import type { BrowserWindowController, OverlayHandle } from './browser-window.ts';
import type { IpcGate } from './ipc-gate.ts';
import type { IpcRouter } from './ipc-router.ts';
import { commandForInput } from './shortcuts.ts';

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

/**
 * A transparent view above the tabs of a window, for popovers and prompts that must cover
 * web content, which lies above the shell. The view is made when it is first needed and is
 * part of the window only while it shows something, because a view takes the clicks and the
 * focus of what lies below it. A click next to the popover, Escape, a shortcut, a change of
 * the window's size or of its visible tab closes it, and the focus goes back to the page.
 */
export class WindowOverlay implements OverlayHandle {
  private view: WebContentsView | undefined;
  private shown: OverlayContent | null = null;
  /** Called once when what the overlay shows closes or is replaced. */
  private onClose: (() => void) | undefined;
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

  /**
   * Shows content above the window's tabs, or replaces what it shows.
   * @param content - What to show.
   * @param onClose - Called once when the content closes or is replaced, such as to cancel
   *   what it asked for.
   */
  open(content: OverlayContent, onClose?: () => void): void {
    this.settle();
    this.onClose = onClose;
    const view = (this.view ??= this.create());
    const base = this.window.window;
    const { width, height } = base.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
    // Adding a view that the window holds already moves it to the top.
    base.contentView.addChildView(view);
    this.window.overlay = this;
    this.shown = content;
    // Focusing the view would raise a window in the background, such as for a site's question.
    if (base.isFocused()) view.webContents.focus();
    this.options.router.publish(OverlayChanged, view.webContents, content);
  }

  /**
   * Changes what an open overlay shows, without taking the focus.
   * @param content - What to show.
   */
  update(content: OverlayContent): void {
    if (this.shown === null || this.view === undefined) return;
    this.shown = content;
    this.options.router.publish(OverlayChanged, this.view.webContents, content);
  }

  /** Closes the overlay and gives the focus back to the page or the shell. */
  close(): void {
    if (this.shown === null) return;
    this.shown = null;
    this.settle();
    if (this.window.overlay === this) this.window.overlay = undefined;
    const view = this.view;
    if (view !== undefined && !this.window.window.isDestroyed()) {
      this.window.window.contentView.removeChildView(view);
      this.options.router.publish(OverlayChanged, view.webContents, null);
      if (this.window.window.isFocused()) this.window.focusContent();
    }
  }

  private settle(): void {
    const onClose = this.onClose;
    this.onClose = undefined;
    onClose?.();
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
      },
    });
    view.setBackgroundColor('#00000000');
    const contents = view.webContents;
    const registration = this.options.gate.registerView(contents.id, {
      origin: 'app://overlay',
      capabilities: new Set(['overlay', 'appearance']),
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      const command = commandForInput(input, process.platform);
      if (command !== undefined) {
        event.preventDefault();
        this.close();
        this.window.execute(command);
      }
    });
    const close = (): void => this.close();
    this.window.window.on('resize', close);
    this.window.window.once('closed', () => {
      registration.dispose();
      if (!contents.isDestroyed()) contents.close();
    });
    void contents.loadURL(this.options.url);
    return view;
  }
}
