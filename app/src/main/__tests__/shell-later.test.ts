import { describe, expect, it } from 'vitest';
import { shellLaterChannels } from '../../shared/ipc/shell-channels.ts';
import { registerLaterShellHandlers, type LaterShellDependencies } from '../shell-later.ts';

/** The handlers of the chunk, by their channels, for a window that the tests make up. */
function handlersFor(window: unknown): Map<string, (request: unknown, event: unknown) => unknown> {
  const handlers = new Map<string, (request: unknown, event: unknown) => unknown>();
  const router = {
    handle: (
      contract: { readonly channel: string },
      handler: (request: unknown, event: unknown) => unknown,
    ) => {
      handlers.set(contract.channel, handler);
    },
  };
  const windows = { forShell: () => window };
  registerLaterShellHandlers({ router, windows } as unknown as LaterShellDependencies);
  return handlers;
}

describe('registerLaterShellHandlers', () => {
  it('handles every channel that the shell sends to the chunk that loads later', () => {
    const handled = [...handlersFor(undefined).keys()];
    // A channel without its handler would fail only when the shell first sends on it.
    expect(handled.toSorted()).toEqual([...shellLaterChannels].toSorted());
  });

  it('closes a tab with Delete as the window closes tabs, and keeps the focus in the strip', () => {
    const calls: string[] = [];
    let keeping = false;
    let focused = true;
    const window = {
      shellContents: { isFocused: () => focused },
      keepingFocus: (change: () => void) => {
        keeping = true;
        change();
        keeping = false;
      },
      // The close of the window asks a page that holds typed text before it closes.
      tabAction: (id: string, action: string) => calls.push(`${action} ${id} ${String(keeping)}`),
      tabs: {
        activate: (id: string) => calls.push(`activate ${id} ${String(keeping)}`),
        close: (id: string) => calls.push(`tabs.close ${id}`),
      },
    };
    const key = handlersFor(window).get('tabs.key');
    key?.({ tabId: 'a', action: 'close' }, { sender: {} });
    key?.({ tabId: 'b', action: 'activate' }, { sender: {} });
    // Focus that moved on meanwhile goes where the change of the active tab takes it.
    focused = false;
    key?.({ tabId: 'c', action: 'close' }, { sender: {} });
    expect(calls).toEqual(['close a true', 'activate b true', 'close c false']);
  });
});
