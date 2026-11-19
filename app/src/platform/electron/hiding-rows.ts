import { screen } from 'electron';
import {
  peekTime,
  rowsHiding,
  sameHiding,
  siteOfPage,
  type RowsHiding,
} from '../../domain/windows/top-rows.ts';
import { titleBarArea, windowButtonsAt } from '../../domain/windows/title-bar.ts';
import type { HidingRows, Insets, RowHoldsOfShell, WindowHost } from './browser-window.ts';

/**
 * The tabs and the toolbar of a window that hide until they are needed (ADR 0058). The code
 * loads with the first window while the setting hides them, or once it is turned on, and each
 * window that is no popup gets one. While the rows hide, the page lies under an edge or a title
 * row of the shell; while they show, the shell lies above the page, cut to the height of its
 * rows, so the page neither moves nor changes its size. On macOS, the three buttons of the
 * window hide and show with the rows. Over a region of the rows that moves the window, the shell
 * gets no events of the pointer, as if the pointer had left it: there, the browser asks the
 * system where the pointer is. The shell goes below the pages again only once it drew the rows
 * hidden, which move no window, and rows that hide never keep the keys from the page.
 * @param host - What the code uses of the window.
 */
export function hidingRows(host: WindowHost): HidingRows {
  return new RowsOfWindow(host);
}

/** The rows of one window that hide, with what holds them open. */
class RowsOfWindow implements HidingRows {
  hiding: RowsHiding | null;
  /** Whether the pointer is over the rows, as the shell last told. */
  private pointer = false;
  /**
   * Checks where the pointer is while the shell lost it over the rows that show, as over a
   * region that moves the window, until the pointer left them.
   */
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;
  /** How often the browser asked since the shell lost the pointer. */
  private cursorChecks = 0;
  /** How high the rows are, above the content area. */
  private rowsHeight = 0;
  /** Whether an element of the shell has the shell's focus, as the shell last told. */
  private focus = false;
  /** How many native menus of the shell are open. */
  private menus = 0;
  /** Ends the moment of the rows after the visible tab or its site changed, while it lasts. */
  private peekTimer: ReturnType<typeof setTimeout> | undefined;
  /** The visible tab and its site, to see when either changes; `undefined` before the first. */
  private seen: string | undefined;
  /** Whether the shell lies above the pages now. */
  private raised = false;
  /**
   * Whether the shell drew the rows hidden, as it last told: their regions then move no window,
   * and the shell can go below the pages.
   */
  private drawnHidden = false;
  /** Lets the shell go below the pages after a while, should it not tell that it drew the rows. */
  private lowerTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the three buttons of a macOS window show now. */
  private buttonsShown = true;
  private readonly host: WindowHost;

  constructor(host: WindowHost) {
    this.host = host;
    this.hiding = this.next();
    host.window.window.once('closed', () => {
      clearTimeout(this.peekTimer);
      clearTimeout(this.cursorTimer);
      clearTimeout(this.lowerTimer);
    });
    // The focus in an element of the shell holds the rows only while the shell has the focus of
    // the window, which the shell itself cannot tell.
    const shell = host.window.shellContents;
    shell.on('focus', () => this.apply());
    shell.on('blur', () => this.apply());
  }

  update(): boolean {
    this.notice();
    const next = this.next();
    const changed = !sameHiding(next, this.hiding);
    const hid = this.hiding?.shown === true && next?.shown === false;
    this.hiding = next;
    this.fitButtons();
    if (hid) this.giveKeys();
    return changed;
  }

  pageTop(): number | undefined {
    // Without a page that covers the content area, such as for a problem, the rows lie as always.
    return this.hiding !== null && this.covers() ? this.hiding.height : undefined;
  }

  layout(width: number, height: number, insets: Insets): void {
    const { window, shown } = this.host;
    const base = window.window;
    // The shell draws the rows at once: the window lays itself out for them now.
    if (this.update()) this.host.publish();
    const hiding = this.hiding;
    const covers = this.covers();
    const over = hiding !== null && hiding.shown && covers && insets.top > hiding.height;
    // While they show, the rows of the shell move the window, and below the page their regions
    // would win over it (ADR 0048): the shell stays above the pages until it drew them hidden.
    const waits = !over && this.raised && hiding !== null && covers && !this.drawnHidden;
    if (over) this.drawnHidden = false;
    if (!waits) {
      clearTimeout(this.lowerTimer);
      this.lowerTimer = undefined;
    } else {
      this.lowerTimer ??= setTimeout(() => {
        this.lowerTimer = undefined;
        this.drawnHidden = true;
        this.apply();
      }, lowerAtMost);
    }
    const raise = over || waits;
    const bounds = { x: 0, y: 0, width, height: raise ? Math.min(height, insets.top) : height };
    this.rowsHeight = Math.min(height, insets.top);
    // The shell shrinks before it goes above the pages, and grows only once it is below them.
    if (raise) window.shell.setBounds(bounds);
    if (raise !== this.raised) {
      this.raised = raise;
      // Adding a view that the window holds already moves it to the top; the index is ignored.
      if (raise) base.contentView.addChildView(window.shell);
      else for (const view of shown) base.contentView.addChildView(view);
      window.overlay?.raise();
    }
    if (!raise) window.shell.setBounds(bounds);
  }

  attached(): void {
    const { window } = this.host;
    if (this.raised && !window.window.isDestroyed()) {
      window.window.contentView.addChildView(window.shell);
    }
  }

  hold({ pointer, focus, hidden }: RowHoldsOfShell): void {
    const left = this.focus && !focus;
    const lost = this.pointer && !pointer;
    this.pointer = pointer;
    this.focus = focus;
    this.drawnHidden = hidden;
    if (pointer || this.hiding?.shown !== true) this.stopCursor();
    else if (lost && this.cursorOverRows()) {
      this.cursorChecks = 0;
      this.followCursor();
    }
    this.apply();
    // Rows that hide never keep the keys: when the focus leaves the shell's controls while the
    // shell keeps the focus of its window, as after Escape in the address bar, the page gets it,
    // also while the rows still show. Rows that hid gave it already.
    if (left && this.hiding?.shown === true) this.giveKeys();
  }

  menu(): () => void {
    this.menus += 1;
    this.apply();
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      this.menus -= 1;
      this.apply();
    };
  }

  /**
   * Gives the page the keys while the shell has the focus of the window, but none of its
   * controls has it: after the focus left them, or when the rows hide after a click on a part of
   * them that takes no focus, such as the title row, which gives the shell the focus.
   */
  private giveKeys(): void {
    const { window } = this.host;
    if (
      !this.focus &&
      window.window.isFocused() &&
      !window.shellContents.isDestroyed() &&
      window.shellContents.isFocused() &&
      this.covers()
    ) {
      window.focusContent();
    }
  }

  /**
   * Whether the system's pointer is over the rows while they show, which are as wide as the
   * window's content, at its top.
   */
  private cursorOverRows(): boolean {
    const base = this.host.window.window;
    if (this.hiding?.shown !== true || base.isDestroyed()) return false;
    const { x, y } = screen.getCursorScreenPoint();
    const area = base.getContentBounds();
    return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + this.rowsHeight;
  }

  /**
   * Holds the rows while the system's pointer stays over them, and lets them go after, or after
   * a while in any case, should the system not tell where its pointer is.
   */
  private followCursor(): void {
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = undefined;
      this.cursorChecks += 1;
      if (this.cursorChecks < cursorChecksAtMost && this.cursorOverRows()) this.followCursor();
      else this.apply();
    }, cursorCheck);
  }

  /** Stops following the system's pointer. */
  private stopCursor(): void {
    clearTimeout(this.cursorTimer);
    this.cursorTimer = undefined;
  }

  /** Lays the window out again, which tells the shell when the rows changed. */
  private apply(): void {
    if (!this.host.window.window.isDestroyed()) this.host.layout();
  }

  /** The rows of now, from the settings, the state of the window and what holds them. */
  private next(): RowsHiding | null {
    const { window, options } = this.host;
    const base = window.window;
    const titleBar = options.titleBar?.();
    return rowsHiding({
      platform: process.platform,
      density: titleBar?.density ?? 'normal',
      tabStrip: options.tabStripPosition(),
      placement: options.toolbarPlacement?.() ?? 'own-row',
      autoHide: options.autoHideToolbar?.().value === true,
      popup: window.popup,
      integrated: titleBar?.integrated === true,
      windowFullScreen: !base.isDestroyed() && base.isFullScreen(),
      pageFullScreen: this.host.coveringTab() !== undefined,
      pageCovers: this.covers(),
      holds: {
        pointer: this.pointer || this.cursorTimer !== undefined,
        focus:
          this.focus && !window.shellContents.isDestroyed() && window.shellContents.isFocused(),
        find: window.findOpen,
        popover: (window.overlay?.popover ?? null) !== null,
        menu: this.menus > 0,
        peek: this.peekTimer !== undefined,
      },
    });
  }

  /**
   * Whether the pages that the content area shows cover it: every shown view belongs to a tab
   * whose page shows, without a problem that the shell shows in its place.
   */
  private covers(): boolean {
    const { window, entries, shown } = this.host;
    if (shown.length === 0) return false;
    let covering = 0;
    for (const [id, entry] of entries) {
      if (!shown.includes(this.host.shownViewOf(entry))) continue;
      if ((window.tabs.get(id)?.problem ?? null) !== null) return false;
      covering += 1;
    }
    return covering === shown.length;
  }

  /**
   * Shows the rows for a moment when the visible tab changes or shows another site, so that
   * people see where the page comes from; only while the settings hide them.
   */
  private notice(): void {
    const { window, options } = this.host;
    const active = window.tabs.active;
    const seen = active === undefined ? '' : `${active.id} ${siteOfPage(active.url)}`;
    if (seen === this.seen) return;
    this.seen = seen;
    if (options.autoHideToolbar?.().value !== true || window.popup) return;
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => {
      this.peekTimer = undefined;
      this.apply();
    }, peekTime);
  }

  /**
   * Hides the three buttons of a macOS window with the rows, and shows them with the rows and
   * in full screen, where macOS shows them when the pointer reaches the top. Hiding and showing
   * them can move them back to where macOS keeps them, so they go back to their row.
   */
  private fitButtons(): void {
    const { window, options } = this.host;
    const base = window.window;
    const titleBar = options.titleBar?.();
    if (process.platform !== 'darwin' || titleBar?.integrated !== true || base.isDestroyed()) {
      return;
    }
    const show = this.hiding === null || this.hiding.shown || base.isFullScreen();
    if (show === this.buttonsShown) return;
    this.buttonsShown = show;
    base.setWindowButtonVisibility(show);
    if (!show) return;
    const area = titleBarArea('darwin', titleBar.density, {
      side: options.tabStripPosition(),
      toolbar: options.toolbarPlacement?.() ?? 'own-row',
    });
    base.setWindowButtonPosition(windowButtonsAt(area));
  }
}

/**
 * How long in ms the shell stays above the pages at most after the rows hid, should it not tell
 * that it drew them hidden, as while its window is minimized.
 */
const lowerAtMost = 250;

/** How often in ms the browser asks where the pointer is while the shell lost it over the rows. */
const cursorCheck = 200;

/** How often the browser asks at most, for 10 s, before it lets the rows go. */
const cursorChecksAtMost = 50;
