import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseFromMenu, launch, openBrowserMenu, type Browser } from './harness.ts';

// The update policies of a running browser, on Linux, where an AppImage updates itself.

const brand = JSON.parse(readFileSync(new URL('../../../brand.json', import.meta.url), 'utf8')) as {
  readonly slug: string;
};
const folder = `/etc/${brand.slug}/policies/managed`;
const file = `${folder}/e2e-updates.json`;
// The browser takes the variable of an AppImage as the sign that it updates itself.
const appImage = join(tmpdir(), 'e2e-not-an-appimage');

/** Runs a command as the administrator, who may change policies of the system. */
function asAdministrator(command: string, args: readonly string[], input?: string): void {
  const root = process.getuid?.() === 0;
  execFileSync(root ? command : 'sudo', root ? [...args] : ['-n', command, ...args], {
    input,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/**
 * Sets the mandatory policies of the system, as an administrator does.
 * @param values - The policies.
 * @param created - Receives the folder when it creates it, which the removal takes away again.
 */
function setPolicies(values: Readonly<Record<string, unknown>>, created: string[]): void {
  if (!existsSync(folder) && !created.includes(folder)) created.push(folder);
  asAdministrator('mkdir', ['-p', folder]);
  asAdministrator('tee', [file], `${JSON.stringify(values)}\n`);
}

/** Removes what {@link setPolicies} set, and the folder if it created it. */
function removePolicies(created: readonly string[]): void {
  try {
    asAdministrator('rm', ['-f', file]);
    for (const made of created) asAdministrator('rmdir', [made]);
  } catch {
    // Nothing was set.
  }
}

/**
 * A mirror of the update feed that has no feed and notes the paths that the browser asks. It
 * can hold its answers, as a slow mirror does, until the test lets them go.
 */
interface Mirror {
  readonly url: string;
  readonly paths: string[];
  /** Holds the answers from now on. */
  hold(): void;
  /** Sends the answers that it holds, and answers at once from now on. */
  release(): void;
  close(): Promise<void>;
}

async function startMirror(): Promise<Mirror> {
  const paths: string[] = [];
  let held: (() => void)[] | undefined;
  const server: Server = createServer((request, response) => {
    paths.push(request.url ?? '/');
    const answer = (): void => void response.writeHead(404).end();
    if (held === undefined) answer();
    else held.push(answer);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}/mirror/`,
    paths,
    hold: () => {
      held ??= [];
    },
    release: () => {
      const answers = held ?? [];
      held = undefined;
      for (const answer of answers) answer();
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

/** The records of the update service in the browser's log, one for each service it made. */
function serviceRecords(profile: string): Readonly<Record<string, unknown>>[] {
  const log = join(profile, 'data', 'logs', 'main.log');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { message: string; fields?: Record<string, unknown> })
    .filter((record) => record.message === 'Update service')
    .map((record) => record.fields ?? {});
}

/** What the About box showed, each time it opened. */
interface AboutBox {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
}

/**
 * Answers the boxes of the browser in its process and notes them: the answers given here in
 * turn, then the first button. A box answered with `wait` stays, as a person leaves it open,
 * until the browser closes it.
 */
async function answerBoxes(browser: Browser, answers: readonly (number | 'wait')[]): Promise<void> {
  await browser.main.evaluate(({ dialog }, given) => {
    const shown: unknown[] = [];
    const queue = [...given];
    Object.assign(globalThis, { e2eBoxes: shown });
    dialog.showMessageBox = ((_window: unknown, options: Electron.MessageBoxOptions) => {
      shown.push({
        message: options.message,
        detail: options.detail ?? '',
        buttons: options.buttons ?? [],
      });
      const answer = queue.shift() ?? 0;
      if (answer !== 'wait') return Promise.resolve({ response: answer, checkboxChecked: false });
      return new Promise((resolve) => {
        options.signal?.addEventListener('abort', () =>
          resolve({ response: options.cancelId ?? 0, checkboxChecked: false }),
        );
      });
    }) as typeof dialog.showMessageBox;
  }, answers);
}

function boxes(browser: Browser): Promise<AboutBox[]> {
  return browser.main.evaluate(() => Reflect.get(globalThis, 'e2eBoxes') as AboutBox[]);
}

const skipReason = 'Changes the policies of the system, on Linux';

test('stops the updates at once when a policy turns them off, and About says why', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined || process.platform !== 'linux', skipReason);
  const mirror = await startMirror();
  const created: string[] = [];
  try {
    setPolicies({ UpdateURL: mirror.url }, created);
    const browser = await launch([], { env: { APPIMAGE: appImage } });
    try {
      await expect
        .poll(() => serviceRecords(browser.profile))
        .toEqual([expect.objectContaining({ state: 'idle', feed: mirror.url })]);
      setPolicies({ UpdatePolicy: 0, UpdateURL: mirror.url }, created);
      // Administrators expect a change of policy to show when they come back to the browser.
      await browser.main.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.emit('focus');
      });
      await expect
        .poll(() => serviceRecords(browser.profile).at(-1))
        .toMatchObject({ state: 'disabled', feed: mirror.url });
      await answerBoxes(browser, []);
      await chooseFromMenu(await openBrowserMenu(browser), ['About Astela']);
      await expect.poll(() => boxes(browser)).toHaveLength(1);
      const [about] = await boxes(browser);
      expect(about?.detail.split('\n')[0]).toBe('Your organization turned off updates.');
      expect(about?.buttons).toEqual([]);
      expect(mirror.paths).toEqual([]);
    } finally {
      await browser.close();
    }
  } finally {
    removePolicies(created);
    await mirror.close();
  }
});

test('checks for updates from About when a policy allows them only on request', async () => {
  test.skip(process.env['CI'] === undefined || process.platform !== 'linux', skipReason);
  const mirror = await startMirror();
  const created: string[] = [];
  try {
    setPolicies({ UpdatePolicy: 2, UpdateURL: mirror.url }, created);
    const browser = await launch([], { env: { APPIMAGE: appImage } });
    try {
      // The updates start after the first window; About shows their state from then on.
      await expect
        .poll(() => serviceRecords(browser.profile))
        .toEqual([expect.objectContaining({ state: 'idle', feed: mirror.url })]);
      // The mirror is slow, so the check takes a while.
      mirror.hold();
      await answerBoxes(browser, [1, 'wait']);
      await chooseFromMenu(await openBrowserMenu(browser), ['About Astela']);
      await expect.poll(() => boxes(browser)).toHaveLength(2);
      const [first, checking] = await boxes(browser);
      expect(first?.detail.split('\n')[0]).toBe('Astela has not checked for updates yet.');
      expect(first?.buttons).toEqual(['OK', 'Check for updates']);
      // About says at once that it checks, and the check asks the mirror of the policy.
      expect(checking?.message).toBe(first?.message);
      expect(checking?.detail.split('\n')[0]).toBe('Checking for updates…');
      expect(checking?.buttons).toEqual([]);
      await expect.poll(() => mirror.paths).toContain('/mirror/updates/v1/index.json');
      // Asked for again meanwhile, the window keeps its one About.
      await chooseFromMenu(await openBrowserMenu(browser), ['About Astela']);
      await browser.shell.waitForTimeout(1000);
      expect(await boxes(browser)).toHaveLength(2);
      // The mirror has no feed: About closes and opens again with the reason, in the words of
      // the browser.
      mirror.release();
      await expect.poll(() => boxes(browser)).toHaveLength(3);
      const [, , answered] = await boxes(browser);
      expect(answered?.detail.split('\n')[0]).toBe(
        'The last check for updates failed. The update server did not send the update information.',
      );
      expect(answered?.buttons).toEqual(['OK', 'Check for updates']);
      await browser.shell.waitForTimeout(500);
      expect(await boxes(browser)).toHaveLength(3);
    } finally {
      await browser.close();
    }
  } finally {
    removePolicies(created);
    await mirror.close();
  }
});
