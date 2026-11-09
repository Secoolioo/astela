import {
  desktopCapturer,
  type DesktopCapturerSource,
  type Streams,
  type WebContents,
} from 'electron';
import {
  originOf,
  type PermissionDecision,
  type SitePermission,
} from '../domain/permissions/site-permissions.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { AnswerPermission, ShareScreen } from '../shared/ipc/overlay-contracts.ts';
import { overlayBySender, overlayOf, track } from './overlays.ts';

/** The questions of sites for permissions and screens, in the overlay of their window. */
export interface PermissionPrompts {
  /**
   * Asks whether a site may use some permissions. Questions wait for the one before them in
   * the window; the same question of a page shares one prompt.
   * @param window - The window of the page.
   * @param contents - The page, the window's visible tab.
   * @param origin - The origin of the page.
   * @param permissions - What the site wants.
   * @returns The answer, or nothing when the prompt closed without one.
   */
  askForPermissions(
    window: BrowserWindowController,
    contents: WebContents,
    origin: string,
    permissions: readonly SitePermission[],
  ): Promise<PermissionDecision | undefined>;
  /**
   * Lets the user choose a screen or a window for a site to see, or nothing.
   * @param window - The window of the page.
   * @param contents - The page, the window's visible tab.
   * @param origin - The origin of the page.
   * @param callback - Electron's answer; `null` refuses.
   */
  chooseScreen(
    window: BrowserWindowController,
    contents: WebContents,
    origin: string,
    callback: (streams: Streams | null) => void,
  ): void;
}

/** A question of a page, and everyone who waits for its answer. */
interface Question {
  readonly contents: WebContents;
  readonly origin: string;
  readonly permissions: readonly SitePermission[];
  readonly answers: ((decision: PermissionDecision | undefined) => void)[];
}

/** A screen picker that is open, and how to answer it. */
interface Picker {
  readonly sources: readonly DesktopCapturerSource[];
  readonly reply: (streams: Streams | null) => void;
}

/** Size of the pictures of screens and windows; the picker shows them smaller. */
const thumbnailSize = { width: 320, height: 180 };

/**
 * The prompts for permissions. They load with the first question of a site.
 * @param overlay - What the overlays of all windows share.
 * @param router - IPC router.
 * @param logger - Logger.
 */
export function permissionPrompts(
  overlay: OverlayOptions,
  router: IpcRouter,
  logger: Logger,
): PermissionPrompts {
  const queues = new WeakMap<WindowOverlay, Question[]>();
  const pickers = new WeakMap<WindowOverlay, Picker>();
  const settle = (question: Question, decision: PermissionDecision | undefined): void => {
    for (const answer of question.answers) answer(decision);
  };

  const showNext = (window: BrowserWindowController, target: WindowOverlay): void => {
    const queue = queues.get(target) ?? [];
    for (let next = queue[0]; next !== undefined; next = queue[0]) {
      // A page that left, or is no longer shown, has nobody to ask.
      if (!visible(window, next.contents, next.origin) || busy(target)) {
        queue.shift();
        settle(next, undefined);
        continue;
      }
      const question = next;
      target.open(
        {
          kind: 'permission',
          site: hostOf(question.origin),
          permissions: [...question.permissions],
        },
        () => {
          // Closed without an answer: nothing is decided, and the site may ask again.
          if (queue[0] === question) {
            queue.shift();
            settle(question, undefined);
          }
          // The overlay finishes closing before it shows the next question.
          setTimeout(() => showNext(window, target), 0);
        },
      );
      track(window, target);
      return;
    }
  };

  router.handle(AnswerPermission, ({ allow }, { sender }) => {
    const open = overlayBySender(sender.id);
    const queue = open === undefined ? undefined : queues.get(open);
    const question = queue?.[0];
    if (open?.content?.kind === 'permission' && queue !== undefined && question !== undefined) {
      queue.shift();
      settle(question, allow ? 'allow' : 'block');
      open.close();
    }
    return null;
  });
  router.handle(ShareScreen, ({ id }, { sender }) => {
    const open = overlayBySender(sender.id);
    const picker = open === undefined ? undefined : pickers.get(open);
    const source = picker?.sources.find((candidate) => candidate.id === id);
    if (open !== undefined && picker !== undefined && source !== undefined) {
      pickers.delete(open);
      picker.reply({ video: { id: source.id, name: source.name } });
      open.close();
    }
    return null;
  });

  return {
    askForPermissions(window, contents, origin, permissions) {
      const target = overlayOf(window, overlay, router);
      return new Promise((resolve) => {
        let queue = queues.get(target);
        if (queue === undefined) {
          queue = [];
          queues.set(target, queue);
        }
        const same = queue.find(
          (question) =>
            question.contents === contents &&
            question.origin === origin &&
            question.permissions.join() === permissions.join(),
        );
        if (same !== undefined) {
          same.answers.push(resolve);
          return;
        }
        queue.push({ contents, origin, permissions, answers: [resolve] });
        if (queue.length === 1) showNext(window, target);
      });
    },
    chooseScreen(window, contents, origin, callback) {
      const target = overlayOf(window, overlay, router);
      let answered = false;
      const reply = (streams: Streams | null): void => {
        if (answered) return;
        answered = true;
        callback(streams);
      };
      // Screens and windows separately: a system that cannot list its windows, such as one
      // without a window manager, would otherwise list nothing at all.
      Promise.all([
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize }),
        desktopCapturer.getSources({ types: ['window'], thumbnailSize }).catch((error: unknown) => {
          logger.warn('The windows could not be listed', { error: String(error) });
          return [];
        }),
      ]).then(
        ([screens, windows]) => {
          const shown = [...screens, ...windows].slice(0, 100);
          if (shown.length === 0 || busy(target) || !visible(window, contents, origin)) {
            reply(null);
            return;
          }
          const picker = { sources: shown, reply };
          target.open(
            {
              kind: 'screen',
              site: hostOf(origin),
              sources: shown.map((source) => ({
                id: source.id.slice(0, 200),
                name: source.name.slice(0, 500),
                screen: source.id.startsWith('screen:'),
                thumbnail: source.thumbnail.isEmpty()
                  ? ''
                  : `data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}`,
              })),
            },
            () => {
              // Closed without a choice: the site sees nothing.
              if (pickers.get(target) === picker) pickers.delete(target);
              reply(null);
            },
          );
          pickers.set(target, picker);
          track(window, target);
        },
        (error: unknown) => {
          logger.warn('The screens and windows could not be listed', { error: String(error) });
          reply(null);
        },
      );
    },
  };
}

/** Whether an overlay shows another prompt, such as for a password, that stays. */
function busy(target: WindowOverlay): boolean {
  return target.content !== null && target.content.kind !== 'shield';
}

/** Whether a page is still the visible tab of its window, at the same site. */
function visible(window: BrowserWindowController, contents: WebContents, origin: string): boolean {
  return (
    !contents.isDestroyed() &&
    window.activeTabContents === contents &&
    originOf(contents.getURL()) === origin
  );
}

/** The host of an origin with its port, as the prompts name a site. */
function hostOf(origin: string): string {
  return new URL(origin).host.slice(0, 300);
}
