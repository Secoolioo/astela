import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FixtureServer, launch, pressNative, waitForPage } from './harness.ts';

const server = new FixtureServer();
const home = mkdtempSync(join(tmpdir(), 'e2e-home-'));

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
});

/** Where Chrome and Firefox keep their profiles on this system, below a home folder. */
function folders(): { env: Record<string, string>; chrome: string; firefox: string } {
  if (process.platform === 'win32') {
    return {
      env: { APPDATA: join(home, 'Roaming'), LOCALAPPDATA: join(home, 'Local') },
      chrome: join(home, 'Local', 'Google', 'Chrome', 'User Data'),
      firefox: join(home, 'Roaming', 'Mozilla', 'Firefox'),
    };
  }
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return {
      env: { HOME: home },
      chrome: join(support, 'Google', 'Chrome'),
      firefox: join(support, 'Firefox'),
    };
  }
  return {
    env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    chrome: join(home, '.config', 'google-chrome'),
    firefox: join(home, '.mozilla', 'firefox'),
  };
}

/** Writes text in Firefox's `mozLz4` format as one block of literals. */
function mozLz4(text: string): Buffer {
  const data = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(12);
  header.write('mozLz40\0', 0, 'latin1');
  header.writeUInt32LE(data.length, 8);
  const lengths: number[] = [];
  let rest = data.length - 15;
  while (rest >= 255) {
    lengths.push(255);
    rest -= 255;
  }
  return Buffer.concat([header, Buffer.from([0xf0, ...lengths, rest]), data]);
}

function createProfiles(chrome: string, firefox: string): void {
  const origin = server.origin;
  mkdirSync(join(chrome, 'Default'), { recursive: true });
  writeFileSync(
    join(chrome, 'Local State'),
    JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }),
  );
  writeFileSync(
    join(chrome, 'Default', 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks bar',
          children: [
            { type: 'url', name: 'Chrome home', url: `${origin}/index.html` },
            {
              type: 'folder',
              name: 'Work',
              children: [{ type: 'url', name: 'Chrome second', url: `${origin}/second.html` }],
            },
          ],
        },
        other: { type: 'folder', name: 'Other bookmarks', children: [] },
      },
    }),
  );
  const history = new DatabaseSync(join(chrome, 'Default', 'History'));
  history.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT,
    visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)`);
  history
    .prepare('INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, 2, ?)')
    .run(`${origin}/menus.html`, 'Visited in Chrome', 13_400_000_000_000_000);
  history.close();

  const profile = join(firefox, 'abc.default-release');
  mkdirSync(join(profile, 'sessionstore-backups'), { recursive: true });
  writeFileSync(
    join(firefox, 'profiles.ini'),
    '[Profile0]\nName=default-release\nIsRelative=1\nPath=abc.default-release\nDefault=1\n',
  );
  const places = new DatabaseSync(join(profile, 'places.sqlite'));
  places.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT,
      visit_count INTEGER, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER,
      position INTEGER, title TEXT, guid TEXT);
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________');
    INSERT INTO moz_bookmarks VALUES (2, 2, NULL, 1, 0, 'toolbar', 'toolbar_____');`);
  places
    .prepare('INSERT INTO moz_places VALUES (1, ?, ?, 3, 1760000000000000, 0)')
    .run(`${origin}/probe.html`, 'Visited in Firefox');
  places.exec(`INSERT INTO moz_bookmarks VALUES (3, 1, 1, 2, 0, 'Firefox probe', 'aaaaaaaaaaaa')`);
  places.close();
  writeFileSync(
    join(profile, 'sessionstore-backups', 'recovery.jsonlz4'),
    mozLz4(
      JSON.stringify({
        windows: [
          {
            selected: 2,
            tabs: [
              { index: 1, entries: [{ url: `${origin}/index.html`, title: 'Fixture home' }] },
              { index: 1, entries: [{ url: `${origin}/second.html`, title: 'Fixture second' }] },
            ],
          },
        ],
      }),
    ),
  );
}

test('imports bookmarks, history and open tabs from Chrome and Firefox profiles', async () => {
  const { env, chrome, firefox } = folders();
  createProfiles(chrome, firefox);
  const browser = await launch([], { env });
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('checkbox', { name: 'Open tabs' }).check();
    await settings.getByRole('button', { name: 'Import from Google Chrome' }).click();
    await expect(settings.getByRole('status').first()).toHaveText(
      'Imported. Bookmarks: 2, history: 1, tabs: 0.',
    );
    await settings.getByRole('button', { name: 'Import from Firefox' }).click();
    await expect(settings.getByRole('status').nth(1)).toHaveText(
      'Imported. Bookmarks: 1, history: 1, tabs: 2.',
    );
    // The tabs open in a new window, where only the active tab loads.
    await expect
      .poll(() =>
        browser.main.evaluate(({ webContents }) =>
          webContents.getAllWebContents().map((contents) => contents.getURL()),
        ),
      )
      .toEqual(
        expect.arrayContaining([`${server.origin}/second.html`, 'app://shell/', 'app://shell/']),
      );
    // Importing again replaces the folder of the first import and adds no pages twice.
    await settings.getByRole('button', { name: 'Import from Google Chrome' }).click();
    await expect(settings.getByRole('status').first()).toHaveText(
      'Imported. Bookmarks: 2, history: 0, tabs: 0.',
    );

    await pressNative(browser, 'O', ['primary', 'shift']);
    const bookmarks = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
    await expect(
      bookmarks.getByRole('button', { name: 'Imported from Google Chrome', exact: true }),
    ).toHaveCount(1);
    await expect(
      bookmarks.getByRole('button', { name: 'Imported from Firefox', exact: true }),
    ).toHaveCount(1);
    await bookmarks.getByRole('searchbox', { name: 'Search bookmarks' }).fill('probe');
    await expect(bookmarks.getByRole('button', { name: /^Firefox probe/ })).toBeVisible();

    await pressNative(browser, process.platform === 'darwin' ? 'Y' : 'H', ['primary']);
    const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
    await expect(history.getByRole('button', { name: /^Visited in Chrome/ })).toBeVisible();
    await expect(history.getByRole('button', { name: /^Visited in Firefox/ })).toBeVisible();
  } finally {
    await browser.close();
  }
});
