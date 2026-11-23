/**
 * The document of a tab whose blocked requests the shield counts. A page that loads in a tab
 * gets a new document, in a frame of its own: requests of the document that went count for no
 * page, and those of the new one count for it, also the few that the browser sees before it
 * learns that the new document has replaced the old one.
 */

/** A frame of a page, as Electron names it: its renderer process and its routing id. */
export interface FrameName {
  readonly processId: number;
  readonly routingId: number;
}

/**
 * Reads the document of a blocked request, at once or later: the name of the document of its
 * main frame, or `null` once its frame has left the frame tree.
 */
export type DocumentReader = () => string | null;

/** Documents with requests waiting for their commit that a tab keeps at most. */
const waitingDocuments = 8;
/** Requests of the document on screen that a tab reads again at the next commit, at most. */
const keptRequests = 32;

/**
 * The name of the document that a main frame shows, which a request of the document or of one
 * of its frames carries.
 * @param frame - The main frame.
 */
export function documentOf(frame: FrameName): string {
  return `${String(frame.processId)}:${String(frame.routingId)}`;
}

/** Which document of a tab its blocked requests belong to. */
export class DocumentRequests {
  private shown: string | undefined;
  private readonly waiting = new Map<string, number>();
  private recent: DocumentReader[] = [];
  /** Whether the document on screen is the first one of a page that a script opened. */
  private first = false;

  /**
   * Whether a blocked request counts for the document on screen. A request of another document
   * waits for that document: it counts once the document commits, or never. One of a frame that
   * has left the frame tree never counts.
   * @param document - Reads the document of the request; `undefined` when only its page is
   *   known, which counts for the document on screen.
   */
  counts(document: DocumentReader | undefined): boolean {
    if (document === undefined) return true;
    const name = document();
    if (name === null) return false;
    if (name === this.shown) {
      // Until the browser sees the next document commit, Electron names the frame on screen for
      // the first requests of that document; the commit reads them again.
      this.recent.push(document);
      if (this.recent.length > keptRequests) this.recent.shift();
      return true;
    }
    if (!this.waiting.has(name) && this.waiting.size >= waitingDocuments) {
      const oldest = this.waiting.keys().next().value;
      if (oldest !== undefined) this.waiting.delete(oldest);
    }
    this.waiting.set(name, (this.waiting.get(name) ?? 0) + 1);
    return false;
  }

  /**
   * Notes the first document of a page that a script opened, which shows already. The page
   * that the script asked for usually loads into the frame of that document, and its requests
   * from before the browser saw it commit count for it.
   * @param document - The first document.
   */
  opened(document: string): void {
    this.commit(document);
    this.first = true;
  }

  /**
   * Notes the commit of a new document, which the tab shows from now on.
   * @param document - The new document.
   * @returns How many of its requests were blocked before, which count for it.
   */
  commit(document: string): number {
    let before = this.waiting.get(document) ?? 0;
    // A document that keeps the frame of the one before cannot tell their requests apart; it
    // starts from 0.
    if (document !== this.shown || this.first) {
      before += this.recent.filter((read) => read() === document).length;
    }
    this.first = false;
    this.shown = document;
    this.waiting.clear();
    this.recent = [];
    return before;
  }
}
