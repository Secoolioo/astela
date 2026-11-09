import { app, dialog, type WebContents } from 'electron';
import { join } from 'node:path';
import type { Logger } from '../kernel/logging/logger.ts';
import type { BrowserWindowController, PageCommand } from '../platform/electron/browser-window.ts';
import { translatorFor } from './i18n/i18n.ts';

/** What the tools of a web page need from the browser process. */
export interface PageToolDependencies {
  /** Whether a policy lets people open the developer tools. */
  readonly developerTools: () => boolean;
  readonly logger: Logger;
}

/**
 * Prints a web page, saves it, shows its source in a new tab, or opens or closes its
 * developer tools. The module loads with the first of these commands.
 * @param window - The window of the page's tab.
 * @param command - The command.
 * @param contents - The page.
 * @param deps - What the tools need.
 */
export async function runPageCommand(
  window: BrowserWindowController,
  command: PageCommand,
  contents: WebContents,
  deps: PageToolDependencies,
): Promise<void> {
  switch (command) {
    case 'page.print':
      contents.print({}, (printed, reason) => {
        if (!printed && reason !== 'Print job canceled') {
          deps.logger.warn('The page was not printed', { reason });
        }
      });
      break;
    case 'page.save': {
      const i18n = translatorFor(app.getLocale(), process.platform);
      const name = `${safeFileName(contents.getTitle()) || 'page'}.html`;
      const { canceled, filePath } = await dialog.showSaveDialog(window.window, {
        defaultPath: join(app.getPath('downloads'), name),
        filters: [{ name: i18n.t('dialog.webPage'), extensions: ['html', 'htm'] }],
      });
      if (!canceled && filePath !== undefined && !contents.isDestroyed()) {
        await contents.savePage(filePath, 'HTMLComplete');
      }
      break;
    }
    case 'page.source': {
      const url = contents.getURL();
      if (/^https?:/i.test(url)) window.tabs.open(`view-source:${url}`);
      break;
    }
    case 'devtools.toggle':
      if (contents.isDevToolsOpened()) contents.closeDevTools();
      else if (deps.developerTools()) contents.openDevTools({ mode: 'detach' });
      break;
  }
}

/** A title as a file name: without characters that file systems refuse, and not too long. */
function safeFileName(title: string): string {
  // Control characters and the characters that Windows forbids in file names.
  return title
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}
