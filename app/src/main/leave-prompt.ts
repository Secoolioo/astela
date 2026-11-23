import { dialog, type WebContents } from 'electron';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { UnloadReason } from '../platform/electron/unload.ts';
import { translatorFor } from './i18n/i18n.ts';
import { uiLocale } from './ui-language.ts';

/**
 * Asks whether to leave a page that asks to stay, as one with changes that it has not saved
 * does. Chromium reads the answer as soon as the page's `will-prevent-unload` returns, so the
 * question is a box of the system that waits for its answer; the browser process waits with
 * it (ADR 0060).
 * @param window - The window of the page's tab.
 * @param contents - The page.
 * @param reason - Whether people leave the page, reload it or close its tab.
 * @returns Whether to leave, reload or close.
 */
export function askToLeave(
  window: BrowserWindowController,
  contents: WebContents,
  reason: UnloadReason,
): boolean {
  const i18n = translatorFor(uiLocale(), process.platform);
  let site = contents.getURL();
  try {
    site = new URL(site).host || site;
  } catch {
    // The address stays as it is.
  }
  const reload = reason === 'reload';
  const response = dialog.showMessageBoxSync(window.window, {
    type: 'question',
    message: i18n.t(reload ? 'dialog.reloadPage' : 'dialog.leavePage', { site }),
    detail: i18n.t('dialog.leavePageDetail'),
    buttons: [
      i18n.t(reload ? 'dialog.reload' : 'dialog.leave'),
      i18n.t(reason === 'close' ? 'dialog.cancel' : 'dialog.stay'),
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}
