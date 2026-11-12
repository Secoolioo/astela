import { afterEach, describe, expect, it, vi } from 'vitest';

/** What the main script did with the user defaults and the start, in order. */
const calls = vi.hoisted((): unknown[][] => []);
vi.mock('electron', () => ({
  app: { isPackaged: false, exit: () => undefined },
  systemPreferences: {
    registerDefaults: (defaults: unknown) => calls.push(['registerDefaults', defaults]),
    setUserDefault: (...args: unknown[]) => calls.push(['setUserDefault', ...args]),
  },
}));
vi.mock('../bootstrap.ts', () => ({
  bootstrap: () => {
    calls.push(['bootstrap']);
    return Promise.resolve();
  },
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform');

/**
 * Runs the main script of the browser process as on a system and tells what it did.
 * @param system - The system.
 */
async function start(system: NodeJS.Platform): Promise<unknown[][]> {
  Object.defineProperty(process, 'platform', { value: system });
  calls.length = 0;
  vi.resetModules();
  await import('../index.ts');
  return [...calls];
}

afterEach(() => {
  if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
});

describe('the main script', () => {
  it('tells AppKit on macOS to ignore the windows it kept, before the start begins', async () => {
    // AppKit reads the default when it handles the launch, after the main script; registered,
    // the default holds for this process only and writes nothing to the preferences.
    expect(await start('darwin')).toEqual([
      ['registerDefaults', { ApplePersistenceIgnoreState: true }],
      ['bootstrap'],
    ]);
  });

  it('leaves the user defaults alone on the other systems, which have none', async () => {
    expect(await start('linux')).toEqual([['bootstrap']]);
    expect(await start('win32')).toEqual([['bootstrap']]);
  });
});
