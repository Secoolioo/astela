import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import { WindowOverlay, type OverlayOptions } from '../platform/electron/overlay.ts';
import { CloseOverlay, GetOverlay } from '../shared/ipc/overlay-contracts.ts';

const overlays = new WeakMap<BrowserWindowController, WindowOverlay>();
const bySender = new Map<number, WindowOverlay>();
let connected = false;

/**
 * The overlay of a window, made with its first popover or prompt. The first overlay
 * connects the channels that every overlay page uses.
 * @param window - The window.
 * @param options - What the overlays of all windows share.
 * @param router - IPC router.
 */
export function overlayOf(
  window: BrowserWindowController,
  options: OverlayOptions,
  router: IpcRouter,
): WindowOverlay {
  if (!connected) {
    connected = true;
    router.handle(GetOverlay, (_request, { sender }) => bySender.get(sender.id)?.content ?? null);
    router.handle(CloseOverlay, (_request, { sender }) => {
      bySender.get(sender.id)?.close();
      return null;
    });
  }
  let overlay = overlays.get(window);
  if (overlay === undefined) {
    overlay = new WindowOverlay(window, options);
    overlays.set(window, overlay);
  }
  return overlay;
}

/**
 * Remembers which page belongs to an overlay that is open, so its requests find it.
 * @param window - The overlay's window.
 * @param overlay - The overlay, after it opened.
 */
export function track(window: BrowserWindowController, overlay: WindowOverlay): void {
  const contents = overlay.contents;
  if (contents === undefined || bySender.has(contents.id)) return;
  const id = contents.id;
  bySender.set(id, overlay);
  window.window.once('closed', () => bySender.delete(id));
}

/**
 * The overlay whose page sent a request.
 * @param senderId - The id of the sending web contents.
 */
export function overlayBySender(senderId: number): WindowOverlay | undefined {
  return bySender.get(senderId);
}

/**
 * The window of an overlay.
 * @param windows - The open windows.
 * @param overlay - The overlay.
 */
export function windowOfOverlay(
  windows: readonly BrowserWindowController[],
  overlay: WindowOverlay,
): BrowserWindowController | undefined {
  return windows.find((window) => overlays.get(window) === overlay);
}

/**
 * The overlay of a window, if it has one already.
 * @param window - The window.
 */
export function existingOverlay(window: BrowserWindowController): WindowOverlay | undefined {
  return overlays.get(window);
}
