import { webContents, type App, type IpcMainEvent, type Session, type WebContents } from 'electron';
import type { Logger } from '../kernel/logging/logger.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import { leave, unloaded, unloadReason } from '../platform/electron/unload.ts';
import { askToLeave } from './leave-prompt.ts';
import type { DialogRequest } from './page-dialogs.ts';

/** What the questions of web pages need from the composition root. */
export interface PageQuestionOptions {
  readonly app: App;
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  /** Whether a session holds web content. */
  readonly isWebSession: (session: Session) => boolean;
  readonly logger: Logger;
}

/** The questions of web pages, which follow every page of a web session. */
export interface PageQuestions {
  /**
   * Answers the frame preload of a page that calls `prompt()`, which waits for the answer.
   * @param event - The synchronous message of the frame.
   * @param message - The message of the page.
   * @param value - The text that the field starts with.
   */
  prompt(event: IpcMainEvent, message: unknown, value: unknown): void;
}

/**
 * Electron's internal event of a page's `alert()` and `confirm()`, which its own handler answers
 * with a box that disables the whole window (ADR 0060).
 */
const dialogEvent = '-run-dialog';

/**
 * Follows the questions of web pages: their dialogs, which the browser asks over the page in its
 * tab instead of Electron's box, and their question to stay, as a page with changes that it has
 * not saved asks, which the browser asks before people leave or reload the page or close its tab.
 * It loads with the code for the requests of web pages, before the first web page loads, and
 * takes the pages that exist then and every later one, also those that pages open.
 * @param options - The windows, the sessions and what the overlays share.
 */
export function watchPageQuestions(options: PageQuestionOptions): PageQuestions {
  const { windows } = options;
  const ask = (contents: WebContents, request: DialogRequest, answer: Answer): void => {
    import('./page-dialogs.ts')
      .then(({ askPageDialog }) => askPageDialog(options, contents, request, answer))
      .catch((error: unknown) => {
        options.logger.error('The dialog of a page could not be asked', error);
        answer(false, '');
      });
  };
  const watch = (contents: WebContents): void => {
    if (!options.isWebSession(contents.session)) return;
    takeDialogs(contents, ask, options.logger);
    contents.on('will-prevent-unload', (event) => {
      const reason = unloadReason(contents);
      const window = windows.forTab(contents);
      // A page of no tab, which nobody sees, stays.
      if (window === undefined || !askToLeave(window, contents, reason)) return;
      if (reason === 'close') {
        // The tab opens again with what its page holds now, once the page has gone.
        const id = window.tabIdOf(contents);
        if (id !== undefined) window.historyOf(id, true);
        leave(contents);
      }
      event.preventDefault();
    });
    // A page that leaves without asking has nothing to name anymore.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) unloaded(contents);
    });
  };
  for (const contents of webContents.getAllWebContents()) watch(contents);
  options.app.on('web-contents-created', (_event, contents) => watch(contents));
  return {
    prompt(event, message, value) {
      let answered = false;
      // The frame waits until it has an answer, also when nobody can ask.
      const answer: Answer = (ok, text) => {
        if (answered) return;
        answered = true;
        event.returnValue = ok ? text : null;
      };
      const contents = event.sender;
      const frame = event.senderFrame;
      if (
        typeof message !== 'string' ||
        typeof value !== 'string' ||
        frame === null ||
        contents.isDestroyed() ||
        !options.isWebSession(contents.session)
      ) {
        answer(false, '');
        return;
      }
      ask(
        contents,
        {
          type: 'prompt',
          frame: frameKey(frame),
          origin: frame.origin,
          embedded: frame.origin !== contents.mainFrame.origin,
          message,
          value,
        },
        answer,
      );
    },
  };
}

/** Gives a page its answer: OK or Cancel, and the text of the field of `prompt()`. */
type Answer = (ok: boolean, value: string) => void;

/**
 * Takes the `alert()` and `confirm()` of a page from Electron's handler. Electron registers its
 * handler once for every page; when an update of Electron changes that, the page keeps Electron's
 * handler, with the box that offers to stop the dialogs of a site (`safeDialogs`).
 * @param contents - The page.
 * @param ask - Asks a dialog over the page.
 * @param logger - Records a page whose dialogs the browser could not take.
 */
function takeDialogs(
  contents: WebContents,
  ask: (contents: WebContents, request: DialogRequest, answer: Answer) => void,
  logger: Logger,
): void {
  // Electron does not declare its internal events.
  const events: NodeJS.EventEmitter = contents;
  const count = events.listenerCount(dialogEvent);
  if (count !== 1) {
    logger.error('The dialogs of a page stay with Electron, whose handler changed', { count });
    return;
  }
  events.removeAllListeners(dialogEvent);
  events.on(dialogEvent, (info: unknown, callback: unknown) => {
    if (typeof callback !== 'function') return;
    let answered = false;
    // The page waits until it has its answer, which Electron takes once.
    const answer: Answer = (ok, value) => {
      if (answered) return;
      answered = true;
      Reflect.apply(callback, undefined, [ok, value]);
    };
    const request = dialogOf(contents, info);
    if (request === undefined) answer(false, '');
    else ask(contents, request, answer);
  });
}

/**
 * The dialog that Electron reports for a page, or `undefined` for one that it does not describe
 * as it does now.
 * @param contents - The page.
 * @param info - Electron's description: the frame, the kind, the message and the text of the
 *   field of `prompt()`.
 */
function dialogOf(contents: WebContents, info: unknown): DialogRequest | undefined {
  if (typeof info !== 'object' || info === null) return undefined;
  const frame: unknown = Reflect.get(info, 'frame');
  const type: unknown = Reflect.get(info, 'dialogType');
  const message: unknown = Reflect.get(info, 'messageText');
  const value: unknown = Reflect.get(info, 'defaultPromptText');
  if (
    (type !== 'alert' && type !== 'confirm' && type !== 'prompt') ||
    typeof message !== 'string' ||
    !isFrame(frame)
  ) {
    return undefined;
  }
  return {
    type,
    frame: frameKey(frame),
    origin: frame.origin,
    embedded: frame.origin !== contents.mainFrame.origin,
    message,
    value: typeof value === 'string' ? value : '',
  };
}

/** Whether a value is a frame of a page, as Electron reports it with a dialog. */
function isFrame(value: unknown): value is Electron.WebFrameMain {
  return (
    typeof value === 'object' &&
    value !== null &&
    'origin' in value &&
    typeof value.origin === 'string' &&
    'processId' in value &&
    'routingId' in value
  );
}

/** The process and the id of a frame, which name it while it asks. */
function frameKey(frame: Electron.WebFrameMain): string {
  return `${String(frame.processId)}:${String(frame.routingId)}`;
}
