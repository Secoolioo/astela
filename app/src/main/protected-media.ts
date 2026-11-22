import type { WebContents } from 'electron';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import { brand } from '../shared/brand.ts';
import { OpenProtectedMedia, ProtectedMediaChanged } from '../shared/ipc/media-contracts.ts';
import { LearnAboutProtectedMedia } from '../shared/ipc/overlay-contracts.ts';
import {
  focusBackOf,
  overlayBySender,
  overlayOf,
  rectOf,
  track,
  windowOfOverlay,
} from './overlays.ts';

/** The part of the user guide that tells why protected video and music do not play. */
export const protectedMediaHelp = `${brand.website}docs/user/page-problems/#protected-video-and-music`;

/**
 * The pages that asked for protected video or music, as from Widevine, which stock Electron
 * cannot play: the shell shows a quiet sign in the address bar while the active tab's page is
 * one of them, whose popover says why and links to the user guide. A page is one until it
 * navigates or plays media, as players and scripts that tell browsers apart also ask for key
 * systems that they do not need; a page that played media since its document loaded never
 * becomes one (`web-requests.ts`).
 */
export interface ProtectedMedia {
  /**
   * Marks a page that asked for protected playback and could not get it.
   * @param contents - The page.
   */
  mark(contents: WebContents): void;
}

/**
 * The signs of protected video and music. They load with the first page that asks for it.
 * @param windows - The windows, which find the tab of a page.
 * @param overlay - What the overlays of all windows share.
 * @param router - IPC router.
 */
export function protectedMedia(
  windows: WindowManager,
  overlay: OverlayOptions,
  router: IpcRouter,
): ProtectedMedia {
  const marked = new Map<WebContents, BrowserWindowController>();
  /** Tells a shell which of its tabs show the sign. */
  const publish = (window: BrowserWindowController): void => {
    if (window.window.isDestroyed()) return;
    const tabs = [...marked].flatMap(([contents, of]) => {
      const id = of === window ? window.tabIdOf(contents) : undefined;
      return id === undefined ? [] : [id];
    });
    router.publish(ProtectedMediaChanged, window.shellContents, { tabs });
  };
  router.handle(OpenProtectedMedia, (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window === undefined) return null;
    const target = overlayOf(window, overlay, router);
    target.open(
      { kind: 'protectedMedia', anchor: rectOf(anchor) },
      {
        popover: { kind: 'protectedMedia', folder: null },
        focusBack: focusBackOf(window, anchor),
        yieldsToQuestions: true,
      },
    );
    track(window, target);
    return null;
  });
  router.handle(LearnAboutProtectedMedia, (_request, { sender }) => {
    const target = overlayBySender(sender.id);
    const window = target === undefined ? undefined : windowOfOverlay(windows.all, target);
    if (target?.content?.kind !== 'protectedMedia' || window === undefined) return null;
    target.close();
    window.tabs.open(protectedMediaHelp);
    return null;
  });
  return {
    mark(contents) {
      const window = windows.forTab(contents);
      if (window === undefined || marked.has(contents)) return;
      const unmark = (): void => {
        contents.off('did-start-navigation', navigated);
        contents.off('media-started-playing', unmark);
        contents.off('destroyed', unmark);
        if (marked.delete(contents)) publish(window);
      };
      const navigated = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
        if (details.isMainFrame && !details.isSameDocument) unmark();
      };
      contents.on('did-start-navigation', navigated);
      contents.on('media-started-playing', unmark);
      contents.once('destroyed', unmark);
      marked.set(contents, window);
      publish(window);
    },
  };
}
