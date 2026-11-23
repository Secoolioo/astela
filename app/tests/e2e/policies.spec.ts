import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  chooseMenuItem,
  FixtureServer,
  launch,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

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

/** A value of a policy in a property list of macOS. */
function plistValue(value: boolean | number | string): string {
  if (typeof value === 'boolean') return `<${String(value)}/>`;
  return typeof value === 'number'
    ? `<integer>${String(value)}</integer>`
    : `<string>${value}</string>`;
}

/**
 * Sets mandatory policies of the system: in the registry, the managed preferences or a file.
 * @param values - The policies.
 * @param file - The file of the policies on Linux.
 */
function setPolicies(values: PolicyValues, file = sleepFile): void {
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
      .map(([name, value]) => `<key>${name}</key>${plistValue(value)}`)
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
    asAdministrator('mkdir', ['-p', file.slice(0, file.lastIndexOf('/'))]);
    asAdministrator('tee', [file], `${JSON.stringify(values)}\n`);
  }
}

/**
 * Removes the policies that a test set.
 * @param values - The policies.
 * @param file - The file of the policies on Linux.
 */
function removePolicies(values: PolicyValues, file = sleepFile): void {
  try {
    if (process.platform === 'win32') {
      for (const name of Object.keys(values)) {
        execFileSync('reg', ['delete', windowsKey, '/v', name, '/f'], { stdio: 'ignore' });
      }
    } else {
      asAdministrator('rm', ['-f', process.platform === 'darwin' ? macFile : file]);
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

test('saves an image from its menu into the folder that a policy sets, without asking', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const server = new FixtureServer();
  await server.start();
  const folder = mkdtempSync(join(tmpdir(), 'managed-downloads-'));
  const file = `/etc/${brand.slug}/policies/managed/e2e-downloads.json`;
  // As Chrome does, a folder that an organization sets holds also what people save as.
  const policies = { DownloadDirectory: folder, PromptForDownloadLocation: false };
  setPolicies(policies, file);
  const browser = await launch();
  try {
    await recordMenus(browser);
    await browser.main.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () => {
        Object.assign(globalThis, { askedWhere: true });
        return Promise.resolve({ canceled: true, filePath: '' });
      };
    });
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/media.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/media.html'));
    await page.waitForFunction(
      () => (document.getElementById('image') as HTMLImageElement).naturalWidth > 0,
    );
    await page.click('#image', { button: 'right' });
    await chooseMenuItem(browser, [
      process.platform === 'darwin' ? 'Save Image As…' : 'Sa&ve image as…',
    ]);
    const saved = join(folder, 'image.png');
    await expect.poll(() => existsSync(saved), { timeout: 10_000 }).toBe(true);
    const fixture = resolve(import.meta.dirname, 'fixtures', 'image.png');
    await expect.poll(() => readFileSync(saved).equals(readFileSync(fixture))).toBe(true);
    expect(
      await browser.main.evaluate(() => (globalThis as { askedWhere?: boolean }).askedWhere),
    ).toBeUndefined();
  } finally {
    removePolicies(policies, file);
    await browser.close();
    await server.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A policy value as a test sets it, also a wrong one. */
type PolicyValue = string | number | boolean;

/** Mandatory and recommended values that a test sets as an administrator. */
interface LeveledValues {
  readonly mandatory: Readonly<Record<string, PolicyValue>>;
  readonly recommended: Readonly<Record<string, PolicyValue>>;
}

const linuxPolicyFolders = {
  mandatory: `/etc/${brand.slug}/policies/managed`,
  recommended: `/etc/${brand.slug}/policies/recommended`,
} as const;
const linuxIgnoredFile = 'e2e-ignored.json';

/**
 * Sets policies of the system with the types they have, also wrong ones: in the registry of the
 * user, in the managed preferences, which hold only mandatory values, or in a file of each folder.
 * @param values - The values to set.
 * @param created - Receives the folders that it creates, which the removal takes away again.
 */
function setTypedPolicies(values: LeveledValues, created: string[]): void {
  if (process.platform === 'win32') {
    for (const level of ['mandatory', 'recommended'] as const) {
      const key = level === 'mandatory' ? windowsKey : `${windowsKey}\\Recommended`;
      for (const [name, value] of Object.entries(values[level])) {
        const typed =
          typeof value === 'string'
            ? ['REG_SZ', value]
            : ['REG_DWORD', String(typeof value === 'boolean' ? Number(value) : value)];
        execFileSync('reg', [
          'add',
          key,
          '/v',
          name,
          '/t',
          typed[0] ?? '',
          '/d',
          typed[1] ?? '',
          '/f',
        ]);
      }
    }
    return;
  }
  if (process.platform === 'darwin') {
    const entries = Object.entries(values.mandatory)
      .map(([name, value]) => `<key>${name}</key>${plistValue(value)}`)
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
    return;
  }
  for (const level of ['mandatory', 'recommended'] as const) {
    const folder = linuxPolicyFolders[level];
    if (!existsSync(folder)) created.push(folder);
    asAdministrator('mkdir', ['-p', folder]);
    asAdministrator('tee', [`${folder}/${linuxIgnoredFile}`], `${JSON.stringify(values[level])}\n`);
  }
}

/** Removes what {@link setTypedPolicies} set, and the folders that it created. */
function removeTypedPolicies(values: LeveledValues, created: readonly string[]): void {
  try {
    if (process.platform === 'win32') {
      for (const level of ['mandatory', 'recommended'] as const) {
        const key = level === 'mandatory' ? windowsKey : `${windowsKey}\\Recommended`;
        for (const name of Object.keys(values[level])) {
          // A value that is not set makes reg fail; the others must still go.
          try {
            execFileSync('reg', ['delete', key, '/v', name, '/f'], { stdio: 'ignore' });
          } catch {
            // This value was not set.
          }
        }
      }
    } else if (process.platform === 'darwin') {
      asAdministrator('rm', ['-f', macFile]);
    } else {
      for (const folder of Object.values(linuxPolicyFolders)) {
        asAdministrator('rm', ['-f', `${folder}/${linuxIgnoredFile}`]);
      }
      for (const folder of created.toReversed()) asAdministrator('rmdir', [folder]);
    }
  } catch {
    // Nothing was set.
  }
}

/** A record of the browser's log, as JSON Lines hold them. */
interface LogRecord {
  readonly level: string;
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** The records of the browser's log. */
function logRecords(profile: string): LogRecord[] {
  return readFileSync(join(profile, 'data', 'logs', 'main.log'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogRecord);
}

/** The policy values that the log reports as ignored, by name, with their fields. */
function ignoredRecords(profile: string): Readonly<Record<string, unknown>>[] {
  return logRecords(profile)
    .filter((record) => record.message === 'Policy value ignored')
    .map((record) => record.fields ?? {});
}

/** The records of the reads of the policies, with the numbers of what did not apply. */
function readRecords(profile: string): Readonly<Record<string, unknown>>[] {
  return logRecords(profile)
    .filter((record) => record.message === 'Policies read')
    .map((record) => record.fields ?? {});
}

/** Opens a setting on the settings page from the address bar of the only tab. */
async function openSetting(browser: Browser, key: string): Promise<Page> {
  await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  const address = browser.shell.getByRole('textbox', {
    name: /^(Address and search bar|Adress- und Suchleiste)$/,
  });
  await address.fill(`app://settings/#${key}`);
  await address.press('Enter');
  return waitForPage(browser, (url) => url.startsWith('app://settings'));
}

test('logs every policy value that does not apply once and says so on the settings page', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const policies: LeveledValues = {
    mandatory: {
      ShowHomeButton: 'yes',
      RestoreOnStartup: 2,
      // A policy of Chrome that this browser does not have.
      NewTabPageLocation: 'https://intranet.example/',
      // The mode applies and locks the row of secure DNS; the services, with a brace that
      // does not close, do not.
      DnsOverHttpsMode: 'secure',
      DnsOverHttpsTemplates: 'https://dns.example/dns-query{?dns',
    },
    recommended: { UpdatePolicy: 0 },
  };
  // What the administrator sets once the problems are fixed.
  const fixed: LeveledValues = {
    mandatory: { ShowHomeButton: true, BookmarkBarEnabled: true },
    recommended: {},
  };
  const every: LeveledValues = {
    mandatory: { ...policies.mandatory, ...fixed.mandatory },
    recommended: policies.recommended,
  };
  // The registry of the user may not set the sensitive policies of secure DNS.
  const user = process.platform === 'win32';
  const created: string[] = [];
  try {
    setTypedPolicies(policies, created);
    const browser = await launch();
    try {
      // The managed preferences of macOS hold only mandatory values.
      const expected = [
        ...(user
          ? [{ name: 'DnsOverHttpsMode', level: 'mandatory', state: 'sensitive-requires-machine' }]
          : []),
        {
          name: 'DnsOverHttpsTemplates',
          level: 'mandatory',
          state: user ? 'sensitive-requires-machine' : 'invalid',
        },
        { name: 'NewTabPageLocation', level: 'mandatory', state: 'unknown' },
        { name: 'RestoreOnStartup', level: 'mandatory', state: 'invalid' },
        { name: 'ShowHomeButton', level: 'mandatory', state: 'invalid' },
        ...(process.platform === 'darwin'
          ? []
          : [{ name: 'UpdatePolicy', level: 'recommended', state: 'not-allowed-as-recommended' }]),
      ];
      const reported = (): Record<string, unknown>[] =>
        ignoredRecords(browser.profile)
          .map(({ name, level, state }) => ({ name, level, state }))
          .toSorted((a, b) => String(a.name).localeCompare(String(b.name)));
      // The log of what does not apply loads apart from the policies, so it may come late.
      await expect.poll(reported).toEqual(expected);
      expect(readRecords(browser.profile)).toEqual([{ ignored: expected.length, unreadable: 0 }]);
      for (const record of ignoredRecords(browser.profile)) {
        expect(record['source']).toEqual(expect.any(String));
        expect(record['scope']).toEqual(user ? 'user' : 'machine');
        expect(record['message']).toEqual(expect.any(String));
      }
      if (process.platform === 'linux') {
        expect(
          ignoredRecords(browser.profile).find((record) => record['name'] === 'ShowHomeButton'),
        ).toMatchObject({
          source: `${linuxPolicyFolders.mandatory}/${linuxIgnoredFile}`,
          scope: 'machine',
          message: 'Invalid type: Expected boolean but received "yes"',
        });
      }

      // Another read finds the same values that do not apply and logs nothing again; a valid
      // value that came with it shows that the read happened.
      setTypedPolicies(
        { ...policies, mandatory: { ...policies.mandatory, BookmarkBarEnabled: true } },
        created,
      );
      expect((await shellState(browser.shell)).bookmarksBar).toBe(null);
      const focus = (): Promise<void> =>
        browser.main.evaluate(({ BaseWindow }) => {
          BaseWindow.getAllWindows()[0]?.emit('focus');
        });
      await focus();
      await expect.poll(async () => (await shellState(browser.shell)).bookmarksBar).not.toBe(null);
      expect(reported()).toEqual(expected);
      expect(readRecords(browser.profile)).toHaveLength(1);

      const page = await openSetting(browser, 'home.button');
      const toggle = page.getByRole('switch', { name: /Show home button/ });
      await expect(toggle).not.toBeChecked();
      await expect(toggle).toBeEnabled();
      const homeNote = page.getByText(
        "Your organization's value for the policy ShowHomeButton is not valid and is ignored.",
      );
      await expect(homeNote).toBeVisible();
      // The reason in English is for the log; the page words it in its language.
      await expect(page.getByText('Invalid type')).toHaveCount(0);

      // The row of secure DNS shows the notes of both of its settings.
      const dns = page.getByRole('combobox', { name: 'Use secure DNS' });
      await dns.scrollIntoViewIfNeeded();
      const dnsRow = page.locator('.row').filter({ has: dns });
      if (user) {
        for (const policy of ['DnsOverHttpsMode', 'DnsOverHttpsTemplates']) {
          await expect(
            dnsRow.getByText(
              `Your organization's value for the policy ${policy} is ignored: only a mandatory policy for the whole computer may set it.`,
            ),
          ).toBeVisible();
        }
      } else {
        await expect(dns).toBeDisabled();
        await expect(dnsRow.getByText('Managed by your organization')).toBeVisible();
        await expect(
          dnsRow.getByText(
            "Your organization's value for the policy DnsOverHttpsTemplates is not valid and is ignored.",
          ),
        ).toBeVisible();
      }

      // Once the administrator fixed the values, the next read says that none are left, and
      // the notes go away.
      // The folders stay; the last removal takes them away if the test created them.
      removeTypedPolicies(every, []);
      setTypedPolicies(fixed, created);
      await focus();
      await expect
        .poll(() => readRecords(browser.profile).at(-1))
        .toEqual({ ignored: 0, unreadable: 0 });
      expect(readRecords(browser.profile)).toHaveLength(2);
      expect(reported()).toEqual(expected);
      await expect(toggle).toBeChecked();
      await expect(homeNote).toBeHidden();
      await expect(dnsRow.getByText(/Your organization's value/)).toHaveCount(0);
    } finally {
      await browser.close();
    }
  } finally {
    removeTypedPolicies(every, created);
  }
});

test('words the note of an ignored policy value in the language of the browser', async () => {
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  const policies: LeveledValues = { mandatory: { ShowHomeButton: 'yes' }, recommended: {} };
  const created: string[] = [];
  try {
    setTypedPolicies(policies, created);
    const browser = await launch([], { settings: { 'i18n.language': 'de' } });
    try {
      const page = await openSetting(browser, 'home.button');
      await expect(page.getByRole('switch', { name: /Startseiten-Schaltfläche/ })).toBeEnabled();
      await expect(
        page.getByText(
          'Der Wert deiner Organisation für die Richtlinie ShowHomeButton ist ungültig und wird ignoriert.',
        ),
      ).toBeVisible();
      await expect(page.getByText(/Invalid type|Your organization/)).toHaveCount(0);
    } finally {
      await browser.close();
    }
  } finally {
    removeTypedPolicies(policies, created);
  }
});

test('writes a warning that --safe-mode has no effect yet', async () => {
  const browser = await launch(['--safe-mode']);
  try {
    const records = logRecords(browser.profile);
    const start = records.find((record) => record.message === 'Starting');
    expect(start?.fields).toBeDefined();
    expect(start?.fields).not.toHaveProperty('safeMode');
    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: '--safe-mode is not available in this version and has no effect',
      }),
    );
  } finally {
    await browser.close();
  }
});
