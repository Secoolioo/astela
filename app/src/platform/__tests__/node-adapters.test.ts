import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from '../../domain/session/session.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import { writeFileAtomic, writeFileAtomicSync } from '../node/atomic-file.ts';
import { RotatingFileLogSink } from '../node/file-log-sink.ts';
import { JsonFileSettingsStore } from '../node/json-settings-store.ts';
import { SystemClock } from '../node/system-clock.ts';
import { createPolicyProviders } from '../policy/platform-providers.ts';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'adapters-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The permission bits of a file or folder. */
const modeOf = (path: string): number => statSync(path).mode & 0o777;
const posix = process.platform !== 'win32';

describe('atomic writes', () => {
  it('writes files and leaves no temporary files', async () => {
    const dir = tempDir();
    await writeFileAtomic(join(dir, 'a', 'x.json'), '{"a":1}');
    writeFileAtomicSync(join(dir, 'b', 'y.json'), new TextEncoder().encode('ok'));
    writeFileAtomicSync(join(dir, 'b', 'z.txt'), 'text');
    expect(readFileSync(join(dir, 'a', 'x.json'), 'utf8')).toBe('{"a":1}');
    expect(readFileSync(join(dir, 'b', 'y.json'), 'utf8')).toBe('ok');
    expect(readdirSync(join(dir, 'b')).toSorted()).toEqual(['y.json', 'z.txt']);
  });

  it.runIf(posix)('lets only the user read the files and the folders it makes', async () => {
    const dir = tempDir();
    await writeFileAtomic(join(dir, 'a', 'x.json'), '{}');
    writeFileAtomicSync(join(dir, 'b', 'y.json'), '{}');
    // A file of an older version that others could read gets the mode with its next save.
    writeFileSync(join(dir, 'old.json'), '{}', { mode: 0o644 });
    await writeFileAtomic(join(dir, 'old.json'), '{"saved":true}');
    expect(
      ['a', 'a/x.json', 'b', 'b/y.json', 'old.json'].map((name) => modeOf(join(dir, name))),
    ).toEqual([0o700, 0o600, 0o700, 0o600, 0o600]);
  });

  it.runIf(posix)('gives a file that a person saves the usual modes of the system', async () => {
    const dir = tempDir();
    const usual = 0o666 & ~process.umask();
    await writeFileAtomic(join(dir, 'settings.json'), '{}', 0o666);
    // The report of the self-test, which its caller reads, maybe as another user.
    writeFileAtomicSync(join(dir, 'report.json'), '{}', 0o666);
    expect([modeOf(join(dir, 'settings.json')), modeOf(join(dir, 'report.json'))]).toEqual([
      usual,
      usual,
    ]);
  });
});

const record = (n: number) => ({
  time: n,
  level: 'info' as const,
  scope: 's',
  message: 'x'.repeat(40),
});

describe('RotatingFileLogSink', () => {
  it('writes JSON lines and keeps a limited number of rotated files', () => {
    const dir = tempDir();
    const sink = new RotatingFileLogSink({
      directory: join(dir, 'logs'),
      name: 'main',
      maxBytes: 200,
      keep: 2,
    });
    for (let i = 0; i < 12; i += 1) {
      sink.write(record(i));
    }
    const files = readdirSync(join(dir, 'logs')).toSorted();
    expect(files).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    const last = readFileSync(join(dir, 'logs', 'main.log'), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(last.at(-1) ?? '{}')).toMatchObject({ time: 11 });
  });

  it.runIf(posix)('lets only the user read the logs that it writes and rotates', () => {
    const dir = tempDir();
    const sink = new RotatingFileLogSink({
      directory: join(dir, 'logs'),
      name: 'main',
      maxBytes: 200,
    });
    for (let i = 0; i < 6; i += 1) sink.write(record(i));
    expect(
      ['logs', 'logs/main.log', 'logs/main.1.log', 'logs/main.2.log'].map((name) =>
        modeOf(join(dir, name)),
      ),
    ).toEqual([0o700, 0o600, 0o600, 0o600]);
  });

  it('never throws when the directory cannot be written', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'blocked'), 'file, not a directory');
    const sink = new RotatingFileLogSink({ directory: join(dir, 'blocked'), name: 'main' });
    expect(() => sink.write(record(1))).not.toThrow();
  });
});

describe('JsonFileSettingsStore', () => {
  it('debounces writes, sorts keys and writes rejected values separately', async () => {
    const dir = tempDir();
    const clock = new ManualClock();
    const store = new JsonFileSettingsStore(
      join(dir, 'settings.json'),
      join(dir, 'rejected.json'),
      clock,
      300,
    );
    const first = store.save({ user: { b: 1, a: 2 }, workspaces: {} }, []);
    const second = store.save({ user: { b: 2, a: 2 }, workspaces: { w: { z: 1, y: 0 } } }, [
      { key: 'k', value: 1, message: 'bad' },
    ]);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
    clock.advance(300);
    await Promise.all([first, second]);
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(
      `${JSON.stringify({ $schemaVersion: 1, user: { a: 2, b: 2 }, workspaces: { w: { y: 0, z: 1 } } }, null, 2)}\n`,
    );
    expect(JSON.parse(readFileSync(join(dir, 'rejected.json'), 'utf8'))).toEqual([
      { key: 'k', value: 1, message: 'bad' },
    ]);
    expect(await store.load()).toEqual({ user: { a: 2, b: 2 }, workspaces: { w: { y: 0, z: 1 } } });
    await store.flush();
    store.dispose();
  });

  it('starts empty without a file and moves a corrupt file aside', async () => {
    const dir = tempDir();
    const clock = new ManualClock(0, 42);
    const store = new JsonFileSettingsStore(
      join(dir, 'settings.json'),
      join(dir, 'rejected.json'),
      clock,
    );
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    writeFileSync(join(dir, 'settings.json'), '{ broken');
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    expect(existsSync(join(dir, 'settings.json.corrupt-42'))).toBe(true);
    writeFileSync(join(dir, 'settings.json'), '[1]');
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    writeFileSync(join(dir, 'settings.json'), '{"user": 1, "workspaces": {"a": {"x": 1}, "b": 2}}');
    expect(await store.load()).toEqual({ user: {}, workspaces: { a: { x: 1 } } });
  });

  it('keeps a file that exists but cannot be read', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'settings.json'));
    const store = new JsonFileSettingsStore(
      join(dir, 'settings.json'),
      join(dir, 'rejected.json'),
      new ManualClock(),
    );
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    await expect(store.save({ user: { a: 1 }, workspaces: {} }, [])).rejects.toThrow(
      /could not be read/,
    );
    expect(statSync(join(dir, 'settings.json')).isDirectory()).toBe(true);
  });

  it('reports write failures to every waiting caller', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'blocked'), 'file');
    const clock = new ManualClock();
    const store = new JsonFileSettingsStore(
      join(dir, 'blocked', 'settings.json'),
      join(dir, 'r.json'),
      clock,
    );
    const saved = store.save({ user: {}, workspaces: {} }, []);
    clock.advance(300);
    await expect(saved).rejects.toThrow(/ENOTDIR|EEXIST|ENOENT/);
  });
});

describe('SystemClock', () => {
  it('measures time and runs and cancels timers', async () => {
    const clock = new SystemClock();
    expect(clock.wallTime()).toBeGreaterThan(1_700_000_000_000);
    const start = clock.now();
    let fired = false;
    clock.setTimeout(() => (fired = true), 1);
    let cancelled = false;
    clock.setTimeout(() => (cancelled = true), 1).dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toBe(true);
    expect(cancelled).toBe(false);
    expect(clock.now()).toBeGreaterThan(start);
  });
});

describe('createPolicyProviders', () => {
  const brand = {
    productName: 'Astela',
    slug: 'astela',
    appId: 'io.example.astela',
    repository: 'o/r',
    website: 'https://x/',
    tagline: '',
  };
  it('picks the provider of the platform', () => {
    expect(createPolicyProviders(brand, 'win32').map((p) => p.name)).toEqual(['windows-registry']);
    expect(createPolicyProviders(brand, 'darwin').map((p) => p.name)).toEqual([
      'macos-managed-preferences',
    ]);
    expect(createPolicyProviders(brand, 'linux').map((p) => p.name)).toEqual(['linux-json']);
  });

  it('loads the reading code with the first read', async () => {
    const files = new Map([['/etc/astela/policies/managed/a.json', '{"HomepageLocation":"x"}']]);
    const [provider] = createPolicyProviders(brand, 'linux', {
      runAsync: () => Promise.resolve({ status: 0, stdout: '' }),
      readFile: (path) => {
        const text = files.get(path);
        return text === undefined ? undefined : new TextEncoder().encode(text);
      },
      listDir: (path) => (path.endsWith('/managed') ? ['a.json'] : undefined),
      tempFile: (name) => name,
      remove: () => undefined,
    });
    const read = await provider?.load();
    expect(read?.values.map((value) => [value.name, value.value, value.level])).toEqual([
      ['HomepageLocation', 'x', 'mandatory'],
    ]);
    expect(read?.errors).toEqual([]);
  });
});

/** What a session store reads back: the parsed session, and whether the browser quit normally. */
async function readBack(store: {
  read(): Promise<{ readonly unclean: boolean; data(): Promise<unknown> }>;
}): Promise<{ data: unknown; unclean: boolean }> {
  const stored = await store.read();
  return { data: await stored.data(), unclean: stored.unclean };
}

/** A session of one window whose tab went from one page to another. */
function travelled(title: string): SessionSnapshot {
  return {
    version: 1,
    windows: [
      {
        tabs: [
          {
            url: 'https://b.example/',
            title,
            history: {
              views: [
                {
                  entries: [
                    { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
                    { url: 'https://b.example/', title, pageState: 'REVG' },
                  ],
                  index: 1,
                },
              ],
              view: 0,
            },
          },
        ],
        active: 0,
      },
    ],
  };
}

/** The entries that each tab of the windows of a session file keeps. */
function entriesOf(file: string): unknown[] {
  const session = JSON.parse(readFileSync(file, 'utf8')) as SessionSnapshot;
  return session.windows.flatMap((window) =>
    window.tabs.map((tab) => tab.history?.views.map((view) => view.entries)),
  );
}

describe('JsonFileSessionStore', () => {
  it('writes the newest session after the delay, keeps a backup and reads it back', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const dir = tempDir();
    const clock = new ManualClock();
    const file = join(dir, 'session.json');
    const store = new JsonFileSessionStore(file, clock, 1000);
    expect(await readBack(store)).toEqual({ data: undefined, unclean: false });
    const one = {
      version: 1 as const,
      windows: [{ tabs: [{ url: 'https://a.example/', title: 'A' }], active: 0 }],
    };
    const two = {
      version: 1 as const,
      windows: [{ tabs: [{ url: 'https://b.example/', title: 'B' }], active: 0 }],
    };
    store.schedule(one);
    store.schedule(two);
    expect(existsSync(file)).toBe(false);
    clock.advance(1000);
    await store.flush();
    expect(await readBack(store)).toEqual({ data: two, unclean: false });
    store.schedule(one);
    await store.flush();
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8'))).toEqual(two);
    writeFileSync(file, '{broken');
    expect(await readBack(store)).toEqual({ data: two, unclean: false });
    rmSync(file);
    expect(await readBack(store)).toEqual({ data: two, unclean: false });
    store.dispose();
  });

  it('keeps the back and forward history of tabs and whether windows were in full screen', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const file = join(tempDir(), 'session.json');
    const store = new JsonFileSessionStore(file, new ManualClock(), 1000);
    const session = {
      version: 1 as const,
      windows: [
        {
          tabs: [
            {
              url: 'https://b.example/',
              title: 'B',
              history: {
                views: [
                  { entries: [{ url: 'app://newtab/', title: 'New tab' }], index: 0 },
                  {
                    entries: [
                      { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
                      { url: 'https://b.example/', title: 'B' },
                    ],
                    index: 1,
                  },
                ],
                view: 1,
              },
            },
          ],
          active: 0,
          fullScreen: true,
        },
      ],
    };
    store.schedule(session);
    await store.flush();
    expect(await readBack(store)).toEqual({ data: session, unclean: false });
    store.dispose();
  });

  it('writes at most 4 MiB of page states, and keeps those that the active tabs show', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const file = join(tempDir(), 'session.json');
    const store = new JsonFileSessionStore(file, new ManualClock(), 1000);
    const state = 'A'.repeat(3 * 1024 * 1024);
    const shown = (url: string): SessionSnapshot['windows'][number]['tabs'][number] => ({
      url,
      title: url,
      history: { views: [{ entries: [{ url, title: url, pageState: state }], index: 0 }], view: 0 },
    });
    store.schedule({
      version: 1,
      windows: [{ tabs: [shown('https://a.example/'), shown('https://b.example/')], active: 1 }],
    });
    await store.flush();
    const written = (await (await store.read()).data()) as SessionSnapshot;
    expect(
      written.windows[0]?.tabs.map((tab) => tab.history?.views[0]?.entries[0]?.pageState?.length),
    ).toEqual([undefined, state.length]);
    store.dispose();
  });

  it('tells whether the browser that wrote the session did not quit normally', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const file = join(tempDir(), 'session.json');
    const marker = `${file}.running`;
    const store = new JsonFileSessionStore(file, new ManualClock(), 1000);
    await store.markRunning();
    expect(existsSync(marker)).toBe(true);
    // The next start, after a crash, finds the marker.
    expect(await readBack(new JsonFileSessionStore(file, new ManualClock(), 1000))).toEqual({
      data: undefined,
      unclean: true,
    });
    await store.markClean();
    expect(existsSync(marker)).toBe(false);
    expect((await store.read()).unclean).toBe(false);
    // Once the browser quits, nothing marks it as running again, also not a late first window.
    await store.markRunning();
    expect(existsSync(marker)).toBe(false);
    // A mark of a running browser that is still on its way when the browser quits leaves none.
    const other = new JsonFileSessionStore(join(tempDir(), 'session.json'), new ManualClock());
    void other.markRunning();
    await other.markClean();
    expect((await other.read()).unclean).toBe(false);
    // A marker that cannot be written fails, so the browser can say so.
    const missing = new JsonFileSessionStore(
      join(tempDir(), 'gone', 'session.json'),
      new ManualClock(),
    );
    await expect(missing.markRunning()).rejects.toThrow(/ENOENT/);
    store.dispose();
  });

  it.runIf(posix)('lets only the user read the marker of a running browser', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const file = join(tempDir(), 'session.json');
    const store = new JsonFileSessionStore(file, new ManualClock(), 1000);
    await store.markRunning();
    expect(modeOf(`${file}.running`)).toBe(0o600);
    store.dispose();
  });

  it('reads the file at once, but parses it only when the start asks for the session', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const file = join(tempDir(), 'session.json');
    writeFileSync(file, JSON.stringify(travelled('B')));
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const stored = await new JsonFileSessionStore(file, new ManualClock()).read();
      // A later change of the file does not change what the start reads.
      writeFileSync(file, '{broken');
      expect(parse).not.toHaveBeenCalled();
      expect(await stored.data()).toEqual(travelled('B'));
    } finally {
      parse.mockRestore();
    }
  });

  it('reads the backup at once when there is no file, so the session needs no read later', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const file = join(tempDir(), 'session.json');
    writeFileSync(`${file}.bak`, JSON.stringify(travelled('B')));
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const stored = await new JsonFileSessionStore(file, new ManualClock()).read();
      // The start has the backup already: the first window does not wait for a read.
      rmSync(`${file}.bak`);
      expect(parse).not.toHaveBeenCalled();
      expect(await stored.data()).toEqual(travelled('B'));
      // Without a backup either, there is no session, and nothing is read for it later.
      const none = await new JsonFileSessionStore(file, new ManualClock()).read();
      writeFileSync(`${file}.bak`, JSON.stringify(travelled('C')));
      expect(await none.data()).toBeUndefined();
    } finally {
      parse.mockRestore();
    }
  });

  it('writes a change of titles alone after the longer delay, with the session of then', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const clock = new ManualClock();
    const file = join(tempDir(), 'session.json');
    const store = new JsonFileSessionStore(file, clock, 1000, 30_000);
    let title = 'Ticking 1';
    const take = vi.fn(() => travelled(title));
    store.scheduleLater(take);
    title = 'Ticking 2';
    store.scheduleLater(take);
    clock.advance(29_999);
    expect(existsSync(file)).toBe(false);
    expect(take).not.toHaveBeenCalled();
    title = 'Ticking 3';
    clock.advance(1);
    await vi.waitFor(() => expect(existsSync(file)).toBe(true));
    expect(take).toHaveBeenCalledTimes(1);
    expect((await readBack(store)).data).toEqual(travelled('Ticking 3'));
    // Another change writes within the short delay, with the titles of then.
    store.scheduleLater(take);
    store.schedule(travelled('Moved'));
    clock.advance(1000);
    await vi.waitFor(() =>
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(travelled('Moved')),
    );
    expect(take).toHaveBeenCalledTimes(1);
    // A new title while a sooner write waits goes with that write.
    store.schedule(travelled('Moved again'));
    title = 'Ticking 4';
    store.scheduleLater(take);
    clock.advance(1000);
    await vi.waitFor(() =>
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(travelled('Ticking 4')),
    );
    // When no session can be taken, as after the last window closed, the one that waits is
    // written.
    store.schedule(travelled('Kept'));
    store.scheduleLater(() => undefined);
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(travelled('Kept'));
    store.dispose();
  });

  it('forgets the back and forward lists in the file and in its backup at once', async () => {
    const { JsonFileSessionStore } = await import('../node/session-store.ts');
    const clock = new ManualClock();
    const file = join(tempDir(), 'session.json');
    const store = new JsonFileSessionStore(file, clock, 1000);
    store.schedule(travelled('B'));
    await store.flush();
    store.schedule(travelled('B'));
    await store.flush();
    const kept = [[[{ url: 'https://b.example/', title: 'B', pageState: 'REVG' }]]];
    // The session that waits, which the browser just built, goes into both files.
    store.schedule(travelled('B'));
    await store.forgetHistories();
    expect(entriesOf(file)).toEqual(kept);
    expect(entriesOf(`${file}.bak`)).toEqual(kept);
    clock.advance(1000);
    await store.flush();
    expect(entriesOf(file)).toEqual(kept);
    // Without one, as while only private windows are open, the stored session loses its lists.
    store.schedule(travelled('B'));
    await store.flush();
    store.schedule(travelled('B'));
    await store.flush();
    await store.forgetHistories();
    expect(entriesOf(file)).toEqual(kept);
    expect(entriesOf(`${file}.bak`)).toEqual(kept);
    // Files without a session that can be read go.
    writeFileSync(file, '{broken');
    writeFileSync(`${file}.bak`, 'https://a.example/');
    await store.forgetHistories();
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.bak`)).toBe(false);
    store.dispose();
  });
});
