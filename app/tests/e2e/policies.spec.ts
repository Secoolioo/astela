import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { launch, overlayPage, pressNative, shellState, waitForPage } from './harness.ts';

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
type PolicyValues = Readonly<Record<string, boolean | number | string>>;

const sleepFile = `/etc/${brand.slug}/policies/managed/e2e-sleep.json`;

/** Sets mandatory policies of the system: in the registry, the managed preferences or a file. */
function setPolicies(values: PolicyValues): void {
  if (process.platform === 'win32') {
    for (const [name, value] of Object.entries(values)) {
      const text = typeof value === 'string';
      execFileSync('reg', [
        'add',
        windowsKey,
        '/v',
        name,
        '/t',
        text ? 'REG_SZ' : 'REG_DWORD',
        '/d',
        text ? value : String(Number(value)),
        '/f',
      ]);
    }
  } else if (process.platform === 'darwin') {
    const entries = Object.entries(values)
      .map(([name, value]) => {
        const plist =
          typeof value === 'boolean'
            ? `<${String(value)}/>`
            : typeof value === 'string'
              ? `<string>${value}</string>`
              : `<integer>${String(value)}</integer>`;
        return `<key>${name}</key>${plist}`;
      })
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

test('offers only the layouts that a policy leaves, and keeps its setting when another applies', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const policies = { TabStripPosition: 'left' };
  setPolicies(policies);
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings/#layout');
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const cards = page.getByRole('radiogroup', { name: 'Layout' });
    // The tabs at the left leave Vertical, which the settings have; the other cards would move
    // the tabs and say who decides.
    await expect(cards.getByRole('radio', { name: 'Vertical' })).toBeChecked();
    await expect(cards.getByRole('radio', { name: 'Vertical' })).toBeEnabled();
    for (const name of ['Classic', 'Compact', 'Zen']) {
      await expect(cards.getByRole('radio', { name })).toBeDisabled();
    }
    await expect(cards.getByText('Managed by your organization')).toHaveCount(3);
    // A request for another preset sets the rest of it and leaves the tabs where they are.
    const result = await page.evaluate(() =>
      window.bridge.invoke('settings.applyLayoutPreset', { preset: 'compact' }),
    );
    expect(result).toEqual({
      applied: ['toolbar.placement', 'toolbar.autoHide', 'appearance.density'],
      locked: ['tabs.position'],
    });
    await expect(
      page.getByRole('status').filter({ hasText: 'Your own arrangement' }),
    ).toBeVisible();
    await expect(browser.shell.getByRole('tablist')).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
  } finally {
    removePolicies(policies);
    await browser.close();
  }
});

test('leaves out the command that turns hiding the toolbar on or off while a policy sets it', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const policies = { AutoHideToolbar: false };
  const browser = await launch([], {
    settings: {
      'toolbar.placement': 'tab-row',
      'keys.shortcuts': { 'toolbar.toggleAutoHide': ['F8'] },
    },
  });
  try {
    const hiding = async (): Promise<boolean> =>
      (await shellState(browser.shell)).layout.hiding !== null;
    /** The commands of the palette that turn hiding the toolbar on or off. */
    const offered = async (): Promise<number> => {
      await pressNative(browser, 'K', ['primary'], 'app://shell');
      const overlay = await overlayPage(browser);
      const dialog = overlay.getByRole('dialog', { name: 'Command palette' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox').fill('hiding the toolbar');
      await expect(dialog.getByRole('option').first()).toBeAttached();
      const count = await dialog
        .getByRole('option', { name: /^Turn hiding the toolbar on or off/ })
        .count();
      await pressNative(browser, 'Escape', [], 'app://overlay');
      await expect(dialog).toBeHidden();
      return count;
    };
    // Without the policy, the palette offers the command, and its key turns the hiding on.
    expect(await offered()).toBe(1);
    await pressNative(browser, 'F8', [], 'app://shell');
    await expect.poll(hiding).toBe(true);
    await pressNative(browser, 'F8', [], 'app://shell');
    await expect.poll(hiding).toBe(false);
    // The policy that sets the setting takes the command away, and its key changes nothing.
    setPolicies(policies);
    await browser.main.evaluate(({ BaseWindow }) => {
      BaseWindow.getAllWindows()[0]?.emit('focus');
    });
    await expect.poll(offered).toBe(0);
    await pressNative(browser, 'F8', [], 'app://shell');
    await new Promise((done) => setTimeout(done, 1000));
    expect(await hiding()).toBe(false);
  } finally {
    removePolicies(policies);
    await browser.close();
  }
});
