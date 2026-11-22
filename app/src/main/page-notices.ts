import type { WebContents } from 'electron';
import { noticeSite } from '../domain/page-tools/notice-site.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { MeasureNotice, type PageNotice } from '../shared/ipc/overlay-contracts.ts';
import { overlayBySender, overlayOf, track } from './overlays.ts';

/** What a page took: the whole screen, or the mouse pointer. */
export type PageNoticeKind = PageNotice['notice'];

/** How long a notice shows, in milliseconds, as in Chrome. */
export const noticeMs = 4000;

/**
 * The size of the notice's part of the window until its page has measured the notice, at the
 * top of the pages in the middle; the notice wraps its text within this width.
 */
const noticeSize = { width: 480, height: 80 };

/**
 * The notices of pages that take the whole screen or the mouse pointer: they name the site and
 * the way out, Escape, which Chromium handles. A notice shows for a moment at the top of the
 * window, in a part of the window of its own size, and takes neither the focus nor the keys nor
 * the place of a question of a site, which it waits for. The site is the origin of the page's
 * document, also for a page at a `blob:` address or an `about:blank` page that its opener
 * wrote; a page whose origin names no site gets the notice without one.
 */
export interface PageNotices {
  /**
   * Shows the notice of a page, if its tab is the one that its window shows.
   * @param window - The window of the page.
   * @param contents - The page.
   * @param kind - What the page took.
   */
  show(window: BrowserWindowController, contents: WebContents, kind: PageNoticeKind): void;
}

/**
 * Where a notice lies in a window: at the top of the pages, in the middle, which is the top of
 * the window while a page covers it in full screen; the shell above the pages stays free.
 * @param window - The window.
 * @param size - The size of the notice with the room around it.
 */
function noticeBounds(
  window: BrowserWindowController,
  size: { readonly width: number; readonly height: number },
): Electron.Rectangle {
  const area = window.pageArea();
  const width = Math.min(size.width, area.width);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y,
    width,
    height: Math.min(size.height, area.height),
  };
}

/**
 * The notices of pages, which load with the first page that takes the screen or the pointer.
 * @param overlay - What the overlays of all windows share.
 * @param router - IPC router.
 */
export function pageNotices(overlay: OverlayOptions, router: IpcRouter): PageNotices {
  /** Ends the notice that waits in an overlay until a question of a site has closed. */
  const waiting = new WeakMap<WindowOverlay, () => void>();
  /** The size of the notice that an overlay shows, once its page has measured it. */
  const sizes = new WeakMap<PageNotice, { width: number; height: number }>();
  router.handle(MeasureNotice, (size, { sender }) => {
    const target = overlayBySender(sender.id);
    const content = target?.content;
    if (target === undefined || content?.kind !== 'notice') return null;
    sizes.set(content, size);
    target.refit();
    return null;
  });
  const show = (
    window: BrowserWindowController,
    contents: WebContents,
    kind: PageNoticeKind,
  ): void => {
    if (contents.isDestroyed() || window.window.isDestroyed()) return;
    if (window.activeTabContents !== contents) return;
    const target = overlayOf(window, overlay, router);
    const site = noticeSite(contents.mainFrame.origin);
    const notice: PageNotice = {
      kind: 'notice',
      notice: kind,
      ...(site === undefined ? {} : { site }),
    };
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      ended = true;
      clearTimeout(timer);
      contents.off('leave-html-full-screen', end);
      contents.off('did-start-navigation', navigated);
      contents.off('destroyed', stop);
      if (waiting.get(target) === end) waiting.delete(target);
    };
    // A page that leaves full screen, or another page in its place, ends its notice at once.
    const end = (): void => {
      stop();
      if (target.content === notice) target.close('now');
    };
    const navigated = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) end();
    };
    if (kind === 'fullScreen') contents.on('leave-html-full-screen', end);
    contents.on('did-start-navigation', navigated);
    contents.once('destroyed', stop);
    const place = (): Electron.Rectangle => noticeBounds(window, sizes.get(notice) ?? noticeSize);
    const open = (): void => {
      if (ended) return;
      if (window.window.isDestroyed() || window.activeTabContents !== contents) {
        stop();
        return;
      }
      // A question of a site, or what else the overlay shows, keeps its place; the notice
      // shows once that has closed, in place of one that waited before it.
      if (target.content !== null && target.content.kind !== 'notice') {
        const before = waiting.get(target);
        if (before !== end) before?.();
        waiting.set(target, end);
        target.whenIdle(open);
        return;
      }
      if (waiting.get(target) === end) waiting.delete(target);
      target.open(notice, {
        bounds: place(),
        place,
        passive: true,
        yieldsToQuestions: true,
        onClose: stop,
      });
      track(window, target);
      timer = setTimeout(end, noticeMs);
    };
    open();
  };
  return { show };
}
