import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, shellState, waitForPage } from './harness.ts';

/** The names under which the systems keep the browser's policies. */
const brand = JSON.parse(readFileSync(new URL('../../../brand.json', import.meta.url), 'utf8')) as {
  readonly productName: string;
  readonly slug: string;
  readonly appId: string;
};
const linuxFile = `/etc/${brand.slug}/policies/managed/e2e-focus.json`;
const macFile = `/Library/Managed Preferences/${brand.appId}.plist`;
const windowsKey = `HKCU\\SOFTWARE\\Policies\\${brand.productName}`;

/** Runs a command as the administrator, who may change policies of the system. */
function asAdministrator(command: string, args: readonly string[], input?: string): void {
  const root = process.getuid?.() === 0;
  execFileSync(root ? command : 'sudo', root ? [...args] : ['-n', command, ...args], {
    input,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/** Turns the bookmarks bar on by a mandatory policy, as an administrator does. */
function showBookmarksBarByPolicy(): void {
  if (process.platform === 'win32') {
    execFileSync('reg', [
      'add',
      windowsKey,
      '/v',
      'BookmarkBarEnabled',
      '/t',
      'REG_DWORD',
      '/d',
      '1',
      '/f',
    ]);
  } else if (process.platform === 'darwin') {
    asAdministrator('mkdir', ['-p', '/Library/Managed Preferences']);
    asAdministrator(
      'tee',
      [macFile],
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict><key>BookmarkBarEnabled</key><true/></dict></plist>\n',
    );
    asAdministrator('chmod', ['644', macFile]);
  } else {
    asAdministrator('mkdir', ['-p', linuxFile.slice(0, linuxFile.lastIndexOf('/'))]);
    asAdministrator('tee', [linuxFile], '{ "BookmarkBarEnabled": true }\n');
  }
}

function removePolicy(): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('reg', ['delete', windowsKey, '/v', 'BookmarkBarEnabled', '/f'], {
        stdio: 'ignore',
      });
    } else {
      asAdministrator('rm', ['-f', process.platform === 'darwin' ? macFile : linuxFile]);
    }
  } catch {
    // Nothing was set.
  }
}

test('reads the policies again when a window gets the focus', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const browser = await launch();
  try {
    expect((await shellState(browser.shell)).bookmarksBar).toBe(null);
    showBookmarksBarByPolicy();
    await browser.main.evaluate(({ BaseWindow }) => {
      BaseWindow.getAllWindows()[0]?.emit('focus');
    });
    await expect.poll(async () => (await shellState(browser.shell)).bookmarksBar).not.toBe(null);
  } finally {
    removePolicy();
    await browser.close();
  }
});

/** Policies that a test sets, by name, as an administrator does. */
type PolicyValues = Readonly<Record<string, boolean | number>>;

const sleepFile = `/etc/${brand.slug}/policies/managed/e2e-sleep.json`;

/** Sets mandatory policies of the system: in the registry, the managed preferences or a file. */
function setPolicies(values: PolicyValues): void {
  if (process.platform === 'win32') {
    for (const [name, value] of Object.entries(values)) {
      execFileSync('reg', [
        'add',
        windowsKey,
        '/v',
        name,
        '/t',
        'REG_DWORD',
        '/d',
        String(Number(value)),
        '/f',
      ]);
    }
  } else if (process.platform === 'darwin') {
    const entries = Object.entries(values)
      .map(
        ([name, value]) =>
          `<key>${name}</key>${typeof value === 'boolean' ? `<${String(value)}/>` : `<integer>${String(value)}</integer>`}`,
      )
      .join('');
    asAdministrator('mkdir', ['-p', '/Library/Managed Preferences']);
    asAdministrator(
      'tee',
      [macFile],
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        `<plist version="1.0"><dict>${entries}</dict></plist>\n`,
    );
    asAdministrator('chmod', ['644', macFile]);
  } else {
    asAdministrator('mkdir', ['-p', sleepFile.slice(0, sleepFile.lastIndexOf('/'))]);
    asAdministrator('tee', [sleepFile], `${JSON.stringify(values)}\n`);
  }
}

/** Removes the policies that a test set. */
function removePolicies(values: PolicyValues): void {
  try {
    if (process.platform === 'win32') {
      for (const name of Object.keys(values)) {
        execFileSync('reg', ['delete', windowsKey, '/v', name, '/f'], { stdio: 'ignore' });
      }
    } else {
      asAdministrator('rm', ['-f', process.platform === 'darwin' ? macFile : sleepFile]);
    }
  } catch {
    // Nothing was set.
  }
}

test('shows sleeping tabs as managed when a policy sets them', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const policies = { SleepingTabsEnabled: false, SleepingTabsTimeout: 300 };
  setPolicies(policies);
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings/#tabs.sleep');
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const sleep = page.getByRole('switch', { name: /Put inactive tabs to sleep/ });
    await expect(sleep).not.toBeChecked();
    await expect(sleep).toBeDisabled();
    const after = page.getByRole('combobox', { name: 'Put tabs to sleep after' });
    await expect(after).toHaveValue('300');
    await expect(after.locator('option:checked')).toHaveText('5 minutes');
    await expect(after).toBeDisabled();
    await expect(page.getByText('Managed by your organization')).toHaveCount(2);
  } finally {
    removePolicies(policies);
    await browser.close();
  }
});
