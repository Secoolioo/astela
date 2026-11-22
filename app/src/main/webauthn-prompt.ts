import type { WebAuthnAccount, WebContents, WebFrameMain } from 'electron';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import type { Disposable } from '../shared/disposable.ts';
import { ChooseSecurityKeyAccount } from '../shared/ipc/overlay-contracts.ts';
import { overlayBySender, overlayOf, questionKeys, track } from './overlays.ts';

/** What a frame reports of a request for a security key: it starts or it ends. */
export type SecurityKeyEvent = 'start' | 'end';

/**
 * The questions of sites that wait for a security key or a passkey, on Linux and macOS, where
 * Electron shows nothing: "Use your security key with the site", with Cancel, and the choice of
 * an account when the key holds several for the site. A question shows only while its tab is
 * the one that its window shows, again when the tab shows again, and ends when the request
 * ends, its frame or page navigates or closes, or when the person cancels it. A frame has one
 * question at a time, as Chromium lets it wait for one request, and a page at most
 * {@link questionsPerPage}, so that a page that asks again and again costs nothing.
 */
export interface SecurityKeyPrompts {
  /**
   * Takes the report of a frame whose request for a security key starts or ends.
   * @param window - The window of the page.
   * @param contents - The page.
   * @param frame - The frame that asks, whose origin names the site.
   * @param event - Whether the request starts or ends.
   * @param request - The frame's number of the request.
   */
  report(
    window: BrowserWindowController,
    contents: WebContents,
    frame: WebFrameMain,
    event: SecurityKeyEvent,
    request: number,
  ): void;
  /**
   * Lets the person choose one of the accounts that a security key holds for a site; with only
   * one, it signs in with that one, as Chrome does with a key. The choice belongs to the
   * frame's request and ends with it.
   * @param window - The window of the page.
   * @param contents - The page.
   * @param frame - The frame whose request found the accounts.
   * @param site - The site that asks, as the request names it.
   * @param accounts - The accounts of the key for the site.
   * @param answer - Gets the id of the chosen credential, or nothing, which cancels.
   */
  chooseAccount(
    window: BrowserWindowController,
    contents: WebContents,
    frame: WebFrameMain,
    site: string,
    accounts: readonly WebAuthnAccount[],
    answer: (credentialId?: string) => void,
  ): void;
}

/** How long a request waits before its question shows, in milliseconds. */
const askAfterMs = 250;

/** How many frames of a page may have a question at once; the requests of others wait. */
export const questionsPerPage = 8;

/**
 * A question of a frame of a page: for its request, or for the choice of an account that its
 * request found.
 */
interface Question {
  /** The number of the question, which the choice of an account names. */
  readonly id: number;
  readonly site: string;
  readonly frame: WebFrameMain;
  /**
   * The frame's number of the request, whose end ends the question; none for the choice of
   * an account whose request did not report, which any end of the frame's request ends.
   */
  readonly request?: number;
  /** The accounts to choose from, and where the choice goes. */
  readonly accounts?: readonly WebAuthnAccount[];
  readonly answer?: (credentialId?: string) => void;
  /** Whether the question has ended, so that its closing cancels nothing. */
  ended: boolean;
}

/** Tells the frames of the browser apart, also when Electron hands out new objects for them. */
function frameKey(frame: WebFrameMain): string {
  return `${String(frame.processId)}:${String(frame.routingId)}`;
}

/** The questions of a page, one per frame that asks, the choice of an account first. */
interface PageQuestions {
  readonly window: BrowserWindowController;
  readonly contents: WebContents;
  /** The questions by {@link frameKey}, in the order in which their frames asked. */
  readonly questions: Map<string, Question>;
  /** Whether the questions wait until the overlay shows nothing else. */
  waiting: boolean;
  /** Whether the page's next question takes the place of one of its own, which goes on. */
  replacing: boolean;
  readonly release: () => void;
}

/**
 * The questions for security keys. They load with the first request of a page.
 * @param overlay - What the overlays of all windows share.
 * @param router - IPC router.
 */
export function securityKeyPrompts(overlay: OverlayOptions, router: IpcRouter): SecurityKeyPrompts {
  const pages = new Map<WebContents, PageQuestions>();
  let questions = 0;

  const shown = (page: PageQuestions, question: Question): boolean => {
    const content = overlayOf(page.window, overlay, router).content;
    return content?.kind === 'securityKey' && content.id === question.id;
  };

  /** Ends a question: its request ended, it was answered, or its frame or page went. */
  const end = (page: PageQuestions, question: Question): void => {
    question.ended = true;
    const key = frameKey(question.frame);
    if (page.questions.get(key) === question) page.questions.delete(key);
    if (!page.window.window.isDestroyed() && shown(page, question)) {
      overlayOf(page.window, overlay, router).close();
    }
    if (page.questions.size === 0) page.release();
    else setTimeout(() => show(page), 0);
  };

  /** Ends every question of a page, whose requests go with its document. */
  const endAll = (page: PageQuestions): void => {
    for (const question of page.questions.values()) {
      question.answer?.();
      end(page, question);
    }
    page.release();
  };

  /** The person closed a question without an answer: the site gets `NotAllowedError`. */
  const cancel = (page: PageQuestions, question: Question): void => {
    if (question.answer !== undefined) question.answer();
    else if (!question.frame.isDestroyed()) {
      question.frame.send('webauthn.cancel', question.request);
    }
    end(page, question);
  };

  const show = (page: PageQuestions): void => {
    const { window, contents } = page;
    if (window.window.isDestroyed() || contents.isDestroyed()) {
      endAll(page);
      return;
    }
    // A frame that went has no request left.
    let question: Question | undefined;
    for (const candidate of page.questions.values()) {
      if (candidate.frame.isDestroyed() || candidate.frame.detached) {
        candidate.answer?.();
        end(page, candidate);
      } else if (
        question === undefined ||
        (question.answer === undefined && candidate.answer !== undefined)
      ) {
        question = candidate;
      }
    }
    if (question === undefined || window.activeTabContents !== contents) return;
    const target = overlayOf(window, overlay, router);
    if (shown(page, question)) return;
    // A question that shows of the page itself gives way; another prompt keeps its place.
    if (!target.yieldsToQuestions && target.content?.kind !== 'securityKey') {
      if (!page.waiting) {
        page.waiting = true;
        target.whenIdle(() => {
          page.waiting = false;
          show(page);
        });
      }
      return;
    }
    const pane = window.paneOf(contents);
    page.replacing = true;
    target.open(
      {
        kind: 'securityKey',
        id: question.id,
        site: question.site.slice(0, 300),
        accounts: (question.accounts ?? []).slice(0, 100).map((account) => ({
          name: (account.name ?? '').slice(0, 300),
          displayName: (account.displayName ?? '').slice(0, 300),
        })),
        ...(pane === undefined ? {} : { pane }),
      },
      {
        keys: questionKeys,
        // People may move or resize the window while they look for their key.
        place: () => {
          const { width, height } = window.window.getContentBounds();
          return { x: 0, y: 0, width, height };
        },
        onClose: () => closed(page, question),
      },
    );
    page.replacing = false;
    track(window, target);
  };

  /**
   * A question closed: a question that ended, or that another one of its page takes the place
   * of, goes on or has nothing left to do; one whose tab no longer shows comes back with the
   * tab. Otherwise the person closed it, with Cancel, Escape, a click next to it or a shortcut.
   */
  const closed = (page: PageQuestions, question: Question): void => {
    if (question.ended || page.replacing) return;
    if (page.window.window.isDestroyed() || page.contents.isDestroyed()) {
      endAll(page);
      return;
    }
    if (page.window.activeTabContents !== page.contents) return;
    cancel(page, question);
  };

  const pageOf = (window: BrowserWindowController, contents: WebContents): PageQuestions => {
    const known = pages.get(contents);
    if (known !== undefined) return known;
    const navigated = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) endAll(page);
    };
    const gone = (): void => endAll(page);
    // A tab that shows again shows its question again, once the window has shown it.
    let tabs: Disposable | undefined = window.tabs.onDidChange(() => {
      setTimeout(() => {
        if (pages.get(contents) === page) show(page);
      }, 0);
    });
    const page: PageQuestions = {
      window,
      contents,
      questions: new Map(),
      waiting: false,
      replacing: false,
      release: () => {
        if (pages.get(contents) !== page) return;
        pages.delete(contents);
        tabs?.dispose();
        tabs = undefined;
        contents.off('did-start-navigation', navigated);
        contents.off('destroyed', gone);
      },
    };
    contents.on('did-start-navigation', navigated);
    contents.once('destroyed', gone);
    pages.set(contents, page);
    return page;
  };

  router.handle(ChooseSecurityKeyAccount, ({ id, index }, { sender }) => {
    // A choice counts only for the question that the sending overlay shows.
    const content = overlayBySender(sender.id)?.content;
    if (content?.kind !== 'securityKey' || content.id !== id) return null;
    for (const page of pages.values()) {
      for (const question of page.questions.values()) {
        const account = question.id === id ? question.accounts?.[index] : undefined;
        if (account === undefined) continue;
        question.answer?.(account.credentialId);
        end(page, question);
        return null;
      }
    }
    return null;
  });

  return {
    report(window, contents, frame, event, request) {
      const key = frameKey(frame);
      const known = pages.get(contents);
      const asked = known?.questions.get(key);
      if (event === 'end') {
        // The end of the frame's request ends its question, also the choice of an account.
        if (known === undefined || asked === undefined) return;
        if (asked.request !== undefined && asked.request !== request) return;
        asked.answer?.();
        end(known, asked);
        return;
      }
      // A frame waits for one request at a time; the requests of a page beyond the limit wait
      // without a question, as before.
      if (asked !== undefined || (known?.questions.size ?? 0) >= questionsPerPage) return;
      const site = hostOf(frame.origin);
      if (site === undefined) return;
      const page = pageOf(window, contents);
      page.questions.set(key, { id: questions++, site, frame, request, ended: false });
      // A request that Chromium refuses at once, such as one of a site without a domain, ends
      // before its question would show.
      setTimeout(() => {
        if (pages.get(contents) === page) show(page);
      }, askAfterMs);
    },
    chooseAccount(window, contents, frame, site, accounts, answer) {
      const [only] = accounts;
      if (accounts.length === 1 && only !== undefined) {
        answer(only.credentialId);
        return;
      }
      const key = frameKey(frame);
      const known = pages.get(contents);
      const before = known?.questions.get(key);
      if (
        accounts.length === 0 ||
        (before === undefined && (known?.questions.size ?? 0) >= questionsPerPage)
      ) {
        answer();
        return;
      }
      const page = pageOf(window, contents);
      // The choice takes the place of the frame's question for the key, whose request goes on.
      if (before !== undefined) {
        before.ended = true;
        before.answer?.();
      }
      page.questions.set(key, {
        id: questions++,
        site,
        frame,
        ...(before?.request === undefined ? {} : { request: before.request }),
        accounts,
        answer,
        ended: false,
      });
      show(page);
    },
  };
}

/** The host of an origin, as the question names the site, or nothing for an opaque origin. */
function hostOf(origin: string): string | undefined {
  try {
    const { hostname } = new URL(origin);
    return hostname === '' ? undefined : hostname;
  } catch {
    return undefined;
  }
}
