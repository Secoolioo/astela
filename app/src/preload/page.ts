import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { applyAppearance } from './appearance.ts';
import { startOver, watchTabOut } from './tab-out.ts';

const scopeArgument = process.argv.find((arg) => arg.startsWith('--bridge-scope='));
const scopes = (scopeArgument?.slice('--bridge-scope='.length) ?? '').split(',').filter(Boolean);
applyAppearance();
// Tab past the end of the page, or Shift+Tab past its start, goes on in the toolbar, and the
// keys from the toolbar start the page over at its start or its end (`tab-out.ts`).
watchTabOut(window, document, (reverse) => ipcRenderer.send('page.tabOut', reverse));
ipcRenderer.on('page.tabIn', (_event, reverse: unknown) => startOver(document, reverse === true));

const inScope = (channel: string): boolean =>
  scopes.some((scope) => channel.startsWith(`${scope}.`));

/**
 * Bridge for internal pages. Each page may only use the channels of its own scopes, such as
 * `sandboxHelp.*`; the browser process checks the page's capability again, and sends events
 * only to pages that have the event's capability.
 */
contextBridge.exposeInMainWorld('bridge', {
  invoke(channel: string, payload: unknown): Promise<unknown> {
    if (!inScope(channel)) {
      return Promise.reject(new Error(`Channel ${channel} is not available on this page`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, listener: (payload: unknown) => void): () => void {
    if (!inScope(channel)) {
      throw new Error(`Event ${channel} is not available on this page`);
    }
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },
});
