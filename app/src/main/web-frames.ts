import {
  ipcMain,
  type SelectWebauthnAccountDetails,
  type Session,
  type WebContents,
  type WebFrameMain,
} from 'electron';
import type { Logger } from '../kernel/logging/logger.ts';
import type { BlockerFrames } from './blocker-frames.ts';
import type { SecurityKeyEvent } from './webauthn-prompt.ts';

/**
 * Where the frames of web pages report their requests for security keys and passkeys, and for
 * protected video and music.
 */
export interface FrameReports {
  /**
   * A request of a frame starts or ends; the frame preload wraps them on Linux and macOS.
   * @param contents - The page of the frame.
   * @param frame - The frame, whose origin names the site.
   * @param event - Whether the request starts or ends.
   * @param request - The frame's number of the request.
   */
  report(
    contents: WebContents,
    frame: WebFrameMain,
    event: SecurityKeyEvent,
    request: number,
  ): void;
  /**
   * A security key holds several accounts for a site, of which the person chooses one.
   * @param details - The site and the accounts, as Electron reports them.
   * @param answer - Gets the id of the chosen credential, or nothing, which cancels.
   */
  chooseAccount(
    details: SelectWebauthnAccountDetails,
    answer: (credentialId?: string) => void,
  ): void;
  /**
   * The page of a frame asked for protected playback and could not get it.
   * @param contents - The page.
   */
  protectedMedia(contents: WebContents): void;
}

/**
 * Listens to the frames of web pages, whose frame preload asks the content blocker for the
 * rules of each frame as it starts, and later reports its elements. The answers
 * (`blocker-frames.ts`) load with the code for the requests of web pages; a frame that asks
 * while that code loads waits for it, so its rules still apply before the page's own scripts
 * run. Without that code, a frame gets no rules, and never waits forever.
 * The frames also report their requests for security keys, and the sessions the accounts of a
 * key to choose from, which go to the questions for security keys, and requests for protected
 * playback that failed.
 * @param frames - Loads the answers, or gives the ones that have loaded.
 * @param preload - Path of the frame preload.
 * @param logger - Receives the error when the answers cannot load.
 * @param reports - Takes what the frames report; without it, an account of a key is never
 *   chosen, as without a listener.
 * @returns A function that adds the frame preload to a web session.
 */
export function listenToFrames(
  frames: () => Promise<BlockerFrames>,
  preload: string,
  logger: Logger,
  reports?: FrameReports,
): (session: Session) => void {
  ipcMain.on('blocker.frame', (event) => {
    frames().then(
      (loaded) => loaded.frame(event),
      (error: unknown) => {
        logger.error('The content blocker cannot answer the frames of web pages', error);
        event.returnValue = null;
      },
    );
  });
  ipcMain.handle('blocker.elements', (event, payload: unknown) =>
    frames().then(
      (loaded) => loaded.elements(event, payload),
      () => '',
    ),
  );
  ipcMain.on('webauthn.request', (event, kind: unknown, request: unknown) => {
    const frame = event.senderFrame;
    if (
      (kind === 'start' || kind === 'end') &&
      typeof request === 'number' &&
      Number.isSafeInteger(request) &&
      request >= 0 &&
      frame !== null
    ) {
      reports?.report(event.sender, frame, kind, request);
    }
  });
  ipcMain.on('media.protected', (event, keySystem: unknown) => {
    if (typeof keySystem === 'string' && keySystem.length <= 100) {
      reports?.protectedMedia(event.sender);
    }
  });
  return (session) => {
    session.registerPreloadScript({ type: 'frame', id: 'content-blocker', filePath: preload });
    // Electron cancels a sign-in with a passkey when nobody chooses its account.
    session.on('select-webauthn-account', (_event, details, answer) => {
      if (reports === undefined) answer();
      else reports.chooseAccount(details, answer);
    });
  };
}
