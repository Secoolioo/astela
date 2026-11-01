import { GetDefaultBrowser, MakeDefaultBrowser } from '../shared/ipc/default-browser-contracts.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Connects the default browser setting of the settings page and the setup guide. The
 * platform code loads with the first question, not at the start.
 * @param router - IPC router.
 * @param allowed - Whether a policy lets the user make the browser the default.
 */
export function connectDefaultBrowser(router: IpcRouter, allowed: () => boolean): void {
  router.handle(GetDefaultBrowser, async () => {
    const { isDefaultBrowser } = await import('../platform/electron/default-browser.ts');
    return { isDefault: await isDefaultBrowser(), allowed: allowed() };
  });
  router.handle(MakeDefaultBrowser, async () => {
    if (!allowed()) return { outcome: 'failed' } as const;
    const { makeDefaultBrowser } = await import('../platform/electron/default-browser.ts');
    return { outcome: await makeDefaultBrowser() };
  });
}
