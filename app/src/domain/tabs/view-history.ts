/** One entry of a view's history, as Chromium reports it. */
export interface HistoryEntry {
  readonly url: string;
  readonly title: string;
  /** Chromium's serialized state of the page, such as its form values. */
  readonly pageState?: string;
}

/** The history of one view: its entries and the position of the current one. */
export interface ViewSnapshot {
  readonly entries: readonly HistoryEntry[];
  readonly index: number;
}

/** How many views of a tab are kept for Back. */
const viewLimit = 50;

/**
 * The history of a tab across its views. Web pages and internal pages are shown in views
 * of different sessions, and each view has its own history. When a tab switches to a view
 * of the other kind, the old view closes and its history is kept here, so Back and Forward
 * cross the switch.
 */
export class ViewHistory {
  private readonly back: ViewSnapshot[] = [];
  private forward: ViewSnapshot[] = [];

  /** Whether an earlier view exists. */
  get canGoBack(): boolean {
    return this.back.length > 0;
  }

  /** Whether a later view exists. */
  get canGoForward(): boolean {
    return this.forward.length > 0;
  }

  /**
   * Keeps the view that the tab leaves for a new page. Later views are dropped, as when a
   * page navigates after going back.
   * @param current - History of the view that closes.
   */
  leave(current: ViewSnapshot): void {
    this.back.push(current);
    if (this.back.length > viewLimit) {
      this.back.shift();
    }
    this.forward = [];
  }

  /**
   * Steps back to the previous view.
   * @param current - History of the view that closes; it becomes the next view.
   * @returns The view to restore, or `undefined` if there is none.
   */
  goBack(current: ViewSnapshot): ViewSnapshot | undefined {
    const previous = this.back.pop();
    if (previous !== undefined) {
      this.forward.push(current);
    }
    return previous;
  }

  /**
   * Steps forward to the next view.
   * @param current - History of the view that closes; it becomes the previous view.
   * @returns The view to restore, or `undefined` if there is none.
   */
  goForward(current: ViewSnapshot): ViewSnapshot | undefined {
    const next = this.forward.pop();
    if (next !== undefined) {
      this.back.push(current);
    }
    return next;
  }
}
