import { ipcMain, type Session } from 'electron';
import type { Logger } from '../kernel/logging/logger.ts';
import type { BlockerFrames } from './blocker-frames.ts';

/**
 * Listens to the frames of web pages, whose frame preload asks the content blocker for the
 * rules of each frame as it starts, and later reports its elements. The answers
 * (`blocker-frames.ts`) load with the code for the requests of web pages; a frame that asks
 * while that code loads waits for it, so its rules still apply before the page's own scripts
 * run. Without that code, a frame gets no rules, and never waits forever.
 * @param frames - Loads the answers, or gives the ones that have loaded.
 * @param preload - Path of the frame preload.
 * @param logger - Receives the error when the answers cannot load.
 * @returns A function that adds the frame preload to a web session.
 */
export function listenToFrames(
  frames: () => Promise<BlockerFrames>,
  preload: string,
  logger: Logger,
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
  return (session) => {
    session.registerPreloadScript({ type: 'frame', id: 'content-blocker', filePath: preload });
  };
}
