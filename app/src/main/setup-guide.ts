import { newTabUrl } from '../shared/internal-pages.ts';
import { FinishSetup, OpenSetup } from '../shared/ipc/setup-contracts.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Connects the setup guide: finishing it shows the new tab page in its tab, and the
 * settings page can open it again.
 * @param router - IPC router.
 * @param windows - Open windows.
 */
export function connectSetupGuide(router: IpcRouter, windows: WindowManager): void {
  router.handle(FinishSetup, (_request, { sender }) => {
    const window = windows.forTab(sender);
    const tabId = window?.tabIdOf(sender);
    if (window !== undefined && tabId !== undefined) {
      window.tabs.navigate(tabId, newTabUrl);
    }
    return null;
  });
  router.handle(OpenSetup, (_request, { sender }) => {
    windows.forTab(sender)?.openPage('setup');
    return null;
  });
}
