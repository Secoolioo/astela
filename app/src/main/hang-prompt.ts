import { dialog, type WebContents } from 'electron';
import { uiLocale } from './ui-language.ts';
import type { TabId } from '../domain/tabs/tab-service.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import { translatorFor } from './i18n/i18n.ts';

/** The pages for which the question is open, so a page is asked about once at a time. */
const asking = new WeakSet<WebContents>();

/**
 * Asks whether to wait for a page that stopped responding or to close it. The question goes
 * away by itself when the page responds again or is gone.
 * @param window - The window of the page's tab.
 * @param tabId - The page's tab.
 * @param contents - The page.
 */
export async function askAboutHangingPage(
  window: BrowserWindowController,
  tabId: TabId,
  contents: WebContents,
): Promise<void> {
  if (asking.has(contents) || contents.isDestroyed()) return;
  asking.add(contents);
  const answered = new AbortController();
  const settle = (): void => answered.abort();
  contents.once('responsive', settle);
  contents.once('destroyed', settle);
  const i18n = translatorFor(uiLocale(), process.platform);
  let site = contents.getURL();
  try {
    site = new URL(site).host || site;
  } catch {
    // The address stays as it is.
  }
  try {
    const { response } = await dialog.showMessageBox(window.window, {
      type: 'warning',
      message: i18n.t('dialog.pageUnresponsive', { site }),
      detail: i18n.t('dialog.pageUnresponsiveDetail'),
      buttons: [i18n.t('dialog.wait'), i18n.t('dialog.closePage')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal: answered.signal,
    });
    if (response === 1 && !contents.isDestroyed()) window.tabs.close(tabId);
  } finally {
    asking.delete(contents);
    contents.off('responsive', settle);
    contents.off('destroyed', settle);
  }
}
