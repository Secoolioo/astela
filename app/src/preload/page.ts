import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { applyAppearance } from './appearance.ts';

const scopeArgument = process.argv.find((arg) => arg.startsWith('--bridge-scope='));
const scope = scopeArgument?.slice('--bridge-scope='.length) ?? '';
applyAppearance();

const inScope = (channel: string): boolean => scope !== '' && channel.startsWith(`${scope}.`);

/**
 * Bridge for internal pages. Each page may only use the channels of its own scope, such as
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
