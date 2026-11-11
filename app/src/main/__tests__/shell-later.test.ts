import { describe, expect, it } from 'vitest';
import { shellLaterChannels } from '../../shared/ipc/shell-channels.ts';
import { registerLaterShellHandlers, type LaterShellDependencies } from '../shell-later.ts';

describe('registerLaterShellHandlers', () => {
  it('handles every channel that the shell sends to the chunk that loads later', () => {
    const handled: string[] = [];
    const router = {
      handle: (contract: { readonly channel: string }) => {
        handled.push(contract.channel);
      },
    };
    registerLaterShellHandlers({ router } as unknown as LaterShellDependencies);
    // A channel without its handler would fail only when the shell first sends on it.
    expect(handled.toSorted()).toEqual([...shellLaterChannels].toSorted());
  });
});
