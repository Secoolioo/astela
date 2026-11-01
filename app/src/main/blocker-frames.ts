import { ipcMain, type Session } from 'electron';
import * as v from 'valibot';
import type { ContentBlocker } from '../platform/blocker/content-blocker.ts';

/** What a frame may report: bounded lists of short strings. */
const FrameElements = v.strictObject({
  classes: v.pipe(v.array(v.pipe(v.string(), v.maxLength(512))), v.maxLength(1000)),
  ids: v.pipe(v.array(v.pipe(v.string(), v.maxLength(512))), v.maxLength(1000)),
  hrefs: v.pipe(v.array(v.pipe(v.string(), v.maxLength(512))), v.maxLength(1000)),
});

/**
 * Connects the content blocker to the frames of web pages. Every web frame runs the frame
 * preload, which asks for its rules once, synchronously, so scriptlets run before the page's
 * own scripts, and later reports its elements. The answers depend only on the frame's own
 * address, which the browser process reads from the frame instead of trusting the message,
 * and frames of the browser's own pages get nothing.
 * @param blocker - The content blocker.
 * @param isWebSession - Tells whether a session holds web content.
 * @param preload - Path of the frame preload.
 * @returns A function that adds the frame preload to a web session.
 */
export function connectBlockerFrames(
  blocker: ContentBlocker,
  isWebSession: (session: Session) => boolean,
  preload: string,
): (session: Session) => void {
  ipcMain.on('blocker.frame', (event) => {
    const frame = isWebSession(event.sender.session) ? event.senderFrame : null;
    const url = frame?.url ?? '';
    const top = topUrl(frame);
    // The first page after the start can come before the engine has loaded. Its frame waits
    // for the engine, at most a second, so that its rules apply before its own scripts run.
    const loading = url === '' ? undefined : blocker.loading();
    if (loading === undefined) {
      event.returnValue = blocker.frameRules(url, top);
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    void Promise.race([loading, new Promise((done) => (timer = setTimeout(done, 1000)))]).then(
      () => {
        clearTimeout(timer);
        event.returnValue = blocker.frameRules(url, top);
      },
    );
  });
  ipcMain.handle('blocker.elements', (event, payload: unknown) => {
    const elements = v.safeParse(FrameElements, payload);
    if (!elements.success || !isWebSession(event.sender.session)) {
      return '';
    }
    return blocker.elementRules(
      event.senderFrame?.url ?? '',
      topUrl(event.senderFrame),
      elements.output,
    );
  });
  return (session) => {
    session.registerPreloadScript({ type: 'frame', id: 'content-blocker', filePath: preload });
  };
}

/** The address of the page that a frame belongs to; a frame that is gone has none. */
function topUrl(frame: Electron.WebFrameMain | null | undefined): string {
  try {
    return frame?.top?.url ?? '';
  } catch {
    return '';
  }
}
