import type { AuthInfo, AuthenticationResponseDetails } from 'electron';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { SignIn } from '../shared/ipc/overlay-contracts.ts';
import { overlayBySender, overlayOf, track } from './overlays.ts';

/** Answers a site's question for a user name and password; no arguments cancel it. */
type Answer = (username?: string, password?: string) => void;

/** The answers that the open sign-in prompt of each overlay waits for. */
const waiting = new WeakMap<WindowOverlay, { key: string; answers: Answer[] }>();
let connected = false;

/**
 * Asks for the user name and password that a site or a proxy wants, in the window's
 * overlay. Requests for the same host and realm share one prompt; closing it cancels them.
 * @param window - The window of the page that made the request.
 * @param details - The request.
 * @param info - What the site asks for.
 * @param callback - Electron's answer.
 * @param overlay - What the overlays of all windows share.
 * @param router - IPC router.
 */
export function askForLogin(
  window: BrowserWindowController,
  details: AuthenticationResponseDetails,
  info: AuthInfo,
  callback: (username?: string, password?: string) => void,
  overlay: OverlayOptions,
  router: IpcRouter,
): void {
  const target = overlayOf(window, overlay, router);
  if (!connected) {
    connected = true;
    router.handle(SignIn, ({ username, password }, { sender }) => {
      const open = overlayBySender(sender.id);
      const prompt = open === undefined ? undefined : waiting.get(open);
      if (open !== undefined && prompt !== undefined) {
        waiting.delete(open);
        for (const answer of prompt.answers) answer(username, password);
        open.close();
      }
      return null;
    });
  }
  let answered = false;
  const answer: Answer = (username, password) => {
    if (answered) return;
    answered = true;
    if (username === undefined) callback();
    else callback(username, password ?? '');
  };
  const host = info.port > 0 ? `${info.host}:${info.port}` : info.host;
  const key = `${String(info.isProxy)}|${host}|${info.realm}`;
  const open = waiting.get(target);
  if (open?.key === key && target.content?.kind === 'login') {
    open.answers.push(answer);
    return;
  }
  const prompt = { key, answers: [answer] };
  target.open(
    {
      kind: 'login',
      host: host.slice(0, 300),
      realm: info.realm.slice(0, 300),
      proxy: info.isProxy,
      secure: /^https:/i.test(details.url),
    },
    // Closing the prompt in any way cancels what it asked for.
    () => {
      if (waiting.get(target) === prompt) waiting.delete(target);
      for (const cancel of prompt.answers) cancel();
    },
  );
  waiting.set(target, prompt);
  track(window, target);
}
