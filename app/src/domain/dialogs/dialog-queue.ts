/** Answers a dialog of a page: OK or Cancel, and the text of the field of `prompt()`. */
export type DialogAnswer = (ok: boolean, value: string) => void;

/** Who asks a dialog: the frame, such as its process and its id, and the frame's origin. */
export interface DialogAsker<D> {
  readonly frame: string;
  readonly origin: string;
  /** What the dialog shows, which the queue keeps with it. */
  readonly detail: D;
}

/** A dialog of a page whose question is to show. */
export interface WaitingDialog<P, D> extends DialogAsker<D> {
  /** The number of the dialog, which its answer names. */
  readonly id: number;
  /** The page of the tab, whose question it is. */
  readonly page: P;
  /** Whether the question offers to stop the dialogs of the page. */
  readonly offersStop: boolean;
  /**
   * Whether the page waits for the answer; an alert of a tab in the background got its answer at
   * once, and its question only shows what the page said.
   */
  readonly waits: boolean;
}

type Entry<P, D> = WaitingDialog<P, D> & { readonly answer: DialogAnswer };

/** What the queue keeps of a page: its dialogs in their order, and those of its document. */
interface PageState<P, D> {
  readonly waiting: Entry<P, D>[];
  /** How many dialogs the page asked in its document, from any of its frames. */
  count: number;
  /** Whether the page answers its dialogs at once with Cancel, until its next document. */
  stopped: boolean;
}

/** Answers nothing: the page had its answer already. */
const answered: DialogAnswer = () => undefined;

/**
 * The dialogs of pages, `alert()`, `confirm()` and `prompt()`, which wait for the person who
 * uses the tab, each page apart, in the order that they came. Every dialog gets exactly one
 * answer: from the person, or Cancel when its page navigates, closes or its renderer is gone.
 * From the second dialog of a page in a document on, whichever of its frames asks, the question
 * offers to stop the dialogs of the page: it then gets Cancel at once for them, also for those
 * of its embedded pages, until its next document, so that a page that asks in a loop no longer
 * holds the tab, as Chromium keys this on the page and not on the frame. A frame asks for
 * nothing while it waits; one that asks again had its answer from elsewhere, such as from the
 * developer tools, and its question before goes.
 */
export class DialogQueue<P extends object, D> {
  private nextId = 0;
  private readonly pages = new WeakMap<P, PageState<P, D>>();

  /**
   * Takes a dialog of a page.
   * @param page - The page of the tab.
   * @param asker - The frame that asks, its origin and what the dialog shows.
   * @param answer - Gives the page its answer; called once. Without it, the page had its answer
   *   already, as an alert of a tab in the background has, and the question only shows what the
   *   page said.
   * @returns The dialog, or `undefined` when the page's dialogs are stopped and it was answered
   *   with Cancel at once.
   */
  add(page: P, asker: DialogAsker<D>, answer?: DialogAnswer): WaitingDialog<P, D> | undefined {
    const state = this.stateOf(page);
    if (state.stopped) {
      answer?.(false, '');
      return undefined;
    }
    // The frame waited for an answer that it got elsewhere, and a question that only shows what
    // the page said gives way to the page's next dialog.
    for (const before of state.waiting.filter(
      (dialog) => dialog.frame === asker.frame || !dialog.waits,
    )) {
      this.remove(state, before);
    }
    state.count += 1;
    const dialog: Entry<P, D> = {
      ...asker,
      id: this.nextId++,
      page,
      offersStop: state.count > 1,
      waits: answer !== undefined,
      answer: answer ?? answered,
    };
    state.waiting.push(dialog);
    return dialog;
  }

  /**
   * The dialog of a page that its question shows, the oldest one.
   * @param page - The page.
   */
  first(page: P): WaitingDialog<P, D> | undefined {
    return this.pages.get(page)?.waiting[0];
  }

  /**
   * Whether a page has a dialog whose question is to show.
   * @param page - The page.
   */
  asks(page: P): boolean {
    return (this.pages.get(page)?.waiting.length ?? 0) > 0;
  }

  /**
   * Whether a page waits for the answer to one of its dialogs, which holds it.
   * @param page - The page.
   */
  waits(page: P): boolean {
    return this.pages.get(page)?.waiting.some((dialog) => dialog.waits) === true;
  }

  /**
   * Answers a dialog that waits.
   * @param page - The page of the dialog.
   * @param id - The dialog.
   * @param ok - OK, or Cancel.
   * @param value - The text of the field of `prompt()`.
   * @param stop - Whether the page gets Cancel at once for its dialogs from now on.
   * @returns Whether the dialog waited, so that it got this answer.
   */
  answer(page: P, id: number, ok: boolean, value: string, stop: boolean): boolean {
    const state = this.pages.get(page);
    const dialog = state?.waiting.find((waiting) => waiting.id === id);
    if (state === undefined || dialog === undefined) return false;
    state.waiting.splice(state.waiting.indexOf(dialog), 1);
    // Only a question that offered it may stop the page's dialogs.
    if (stop && dialog.offersStop) {
      state.stopped = true;
      for (const other of state.waiting.splice(0)) other.answer(false, '');
    }
    dialog.answer(ok, value);
    return true;
  }

  /**
   * Answers every dialog of a page with Cancel, as when it starts to load another document, or
   * its tab closes or its renderer is gone.
   * @param page - The page.
   * @returns Whether the page had a dialog.
   */
  cancel(page: P): boolean {
    const state = this.pages.get(page);
    if (state === undefined || state.waiting.length === 0) return false;
    for (const dialog of state.waiting.splice(0)) dialog.answer(false, '');
    return true;
  }

  /**
   * Starts a new document of a page: its dialogs get Cancel, and the page counts and may ask
   * again from the start.
   * @param page - The page.
   * @returns Whether the page had a dialog.
   */
  newDocument(page: P): boolean {
    const cancelled = this.cancel(page);
    this.pages.delete(page);
    return cancelled;
  }

  private stateOf(page: P): PageState<P, D> {
    let state = this.pages.get(page);
    if (state === undefined) {
      state = { waiting: [], count: 0, stopped: false };
      this.pages.set(page, state);
    }
    return state;
  }

  /** Takes a dialog out of the queue with Cancel. */
  private remove(state: PageState<P, D>, dialog: Entry<P, D>): void {
    const index = state.waiting.indexOf(dialog);
    if (index !== -1) state.waiting.splice(index, 1);
    dialog.answer(false, '');
  }
}
