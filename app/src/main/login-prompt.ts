import type { AuthInfo, AuthenticationResponseDetails, WebContents } from 'electron';
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
 * @param contents - The tab of the page. A tab in the background asks once it shows, not over
 *   the tab in front of it.
 * @param details - The request.
 * @param info - What the site asks for.
 * @param callback - Electron's answer.
 * @param overlay - What the overlays of all windows share.
 * @param router - IPC router.
 */
export function askForLogin(
  window: BrowserWindowController,
  contents: WebContents,
  details: AuthenticationResponseDetails,
  info: AuthInfo,
  callback: (username?: string, password?: string) => void,
  overlay: OverlayOptions,
  router: IpcRouter,
): void {
  if (window.activeTabContents !== contents) {
    whenShown(window, contents, (shown) => {
      if (shown) askForLogin(window, contents, details, info, callback, overlay, router);
      else callback();
    });
    return;
  }
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
      // The address is the site's, not the proxy's: a proxy usually gets the password
      // unencrypted, also on the way to an https site.
      secure: !info.isProxy && /^https:/i.test(details.url),
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

/**
 * Calls back once a tab is the one that its window shows, or once the tab is gone.
 * @param window - The window of the tab.
 * @param contents - The tab.
 * @param then - Told whether the tab shows; `false` when it is gone.
 */
function whenShown(
  window: BrowserWindowController,
  contents: WebContents,
  then: (shown: boolean) => void,
): void {
  const listener = window.tabs.onDidChange(() => {
    if (contents.isDestroyed()) finish(false);
    else if (window.activeTabContents === contents) finish(true);
  });
  const gone = (): void => finish(false);
  let done = false;
  function finish(shown: boolean): void {
    if (done) return;
    done = true;
    listener.dispose();
    contents.off('destroyed', gone);
    then(shown);
  }
  contents.once('destroyed', gone);
}
