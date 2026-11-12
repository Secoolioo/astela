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
 * @param blocksCookies - Whether an embedded frame of another site than its page gets no
 *   cookies, by the origins of the frame and the page.
 * @returns A function that adds the frame preload to a web session.
 */
export function connectBlockerFrames(
  blocker: ContentBlocker,
  isWebSession: (session: Session) => boolean,
  preload: string,
  blocksCookies: (origin: string, topOrigin: string, session: Session) => Promise<boolean>,
): (session: Session) => void {
  ipcMain.on('blocker.frame', (event) => {
    const frame = isWebSession(event.sender.session) ? event.senderFrame : null;
    const url = frame?.url ?? '';
    const top = topUrl(frame);
    // Only an embedded frame can be another site than its page. Frames without an address
    // of their own, such as about:blank ones that a script fills, have the origin of the
    // frame that made them, so they count as its site. When the answer fails, the frame
    // gets no cookies.
    const cookies =
      frame === null || frame.parent === null
        ? Promise.resolve(false)
        : blocksCookies(originOf(frame), originOf(frame.top), event.sender.session).catch(
            () => true,
          );
    // The first page after the start can come before the engine has loaded. Its frame waits
    // for the engine, at most a second, so that its rules apply before its own scripts run.
    const loading = url === '' ? undefined : blocker.loading();
    let timer: NodeJS.Timeout | undefined;
    const ready =
      loading === undefined
        ? Promise.resolve()
        : Promise.race([loading, new Promise((done) => (timer = setTimeout(done, 1000)))]);
    void Promise.all([ready, cookies]).then(([, blockCookies]) => {
      clearTimeout(timer);
      event.returnValue = { ...blocker.frameRules(url, top), blockCookies };
    });
  });
  ipcMain.handle('blocker.elements', async (event, payload: unknown) => {
    const elements = v.safeParse(FrameElements, payload);
    if (!elements.success || !isWebSession(event.sender.session)) {
      return '';
    }
    const url = event.senderFrame?.url ?? '';
    const top = topUrl(event.senderFrame);
    // A frame reports each element once, so a report that comes while the engine loads waits.
    await blocker.loading()?.catch(() => undefined);
    return blocker.elementRules(url, top, elements.output);
  });
  return (session) => {
    session.registerPreloadScript({ type: 'frame', id: 'content-blocker', filePath: preload });
  };
}

/** The origin of a frame; a frame that is gone has an opaque one. */
function originOf(frame: Electron.WebFrameMain | null | undefined): string {
  try {
    return frame?.origin ?? 'null';
  } catch {
    return 'null';
  }
}

/** The address of the page that a frame belongs to; a frame that is gone has none. */
function topUrl(frame: Electron.WebFrameMain | null | undefined): string {
  try {
    return frame?.top?.url ?? '';
  } catch {
    return '';
  }
}
