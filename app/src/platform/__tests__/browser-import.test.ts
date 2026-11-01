import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportedBookmark, ImportedVisit } from '../data/profile-db.ts';
import { BrowserImporter, type ImportEnvironment } from '../import/browser-import.ts';
import { decodeMozLz4 } from '../import/mozlz4.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'import-'));
  dirs.push(dir);
  return dir;
};

/** Encodes text as `mozLz4` with one block of literals, which is valid LZ4. */
function mozLz4(text: string): Buffer {
  const data = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(12);
  header.write('mozLz40\0', 0, 'latin1');
  header.writeUInt32LE(data.length, 8);
  const lengths: number[] = [];
  let token = data.length << 4;
  if (data.length >= 15) {
    token = 0xf0;
    let rest = data.length - 15;
    while (rest >= 255) {
      lengths.push(255);
      rest -= 255;
    }
    lengths.push(rest);
  }
  return Buffer.concat([header, Buffer.from([token, ...lengths]), data]);
}

function chromeProfile(dir: string): void {
  mkdirSync(join(dir, 'Default'), { recursive: true });
  writeFileSync(
    join(dir, 'Local State'),
    JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' }, '../x': {} } } }),
  );
  writeFileSync(
    join(dir, 'Default', 'Bookmarks'),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks bar',
          children: [
            { type: 'url', name: 'News', url: 'https://news.example/' },
            { type: 'url', name: 'Script', url: 'javascript:alert(1)' },
            {
              type: 'folder',
              name: 'Work',
              children: [{ type: 'url', name: '', url: 'https://mail.example/' }],
            },
          ],
        },
        other: { type: 'folder', name: 'Other bookmarks', children: [] },
      },
    }),
  );
  const db = new DatabaseSync(join(dir, 'Default', 'History'));
  db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER,
    last_visit_time INTEGER, hidden INTEGER DEFAULT 0)`);
  // 13,000,000,000,000,000 microseconds after 1601 is 1,355,526,400,000 ms after 1970.
  db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)').run(
    'https://news.example/',
    'News',
    3,
    13_000_000_000_000_000,
  );
  db.prepare('INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?)').run(
    'file:///etc/passwd',
    'Local',
    1,
    13_000_000_000_000_000,
  );
  db.close();
}

function firefoxProfile(dir: string, withSession = true): void {
  const profile = join(dir, 'abc.default-release');
  mkdirSync(join(profile, 'sessionstore-backups'), { recursive: true });
  writeFileSync(
    join(dir, 'profiles.ini'),
    '[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=abc.default-release\nDefault=1\n\n[Install4F96D1932A9F858E]\nDefault=abc.default-release\n',
  );
  const db = new DatabaseSync(join(profile, 'places.sqlite'));
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT,
      visit_count INTEGER, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER,
      position INTEGER, title TEXT, guid TEXT);
    INSERT INTO moz_places VALUES (1, 'https://docs.example/', 'Docs', 2, 1700000000000000, 0);
    INSERT INTO moz_places VALUES (2, 'place:sort=8', NULL, 0, NULL, 0);
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________');
    INSERT INTO moz_bookmarks VALUES (2, 2, NULL, 1, 0, 'menu', 'menu________');
    INSERT INTO moz_bookmarks VALUES (3, 2, NULL, 1, 1, 'toolbar', 'toolbar_____');
    INSERT INTO moz_bookmarks VALUES (4, 1, 1, 3, 0, 'Docs', 'aaaaaaaaaaaa');
    INSERT INTO moz_bookmarks VALUES (5, 1, 2, 3, 1, 'Recent', 'bbbbbbbbbbbb');
    INSERT INTO moz_bookmarks VALUES (6, 3, NULL, 3, 2, '', 'cccccccccccc');
    INSERT INTO moz_bookmarks VALUES (7, 2, NULL, 2, 0, 'Reading', 'dddddddddddd');`);
  db.close();
  if (withSession) {
    writeFileSync(
      join(profile, 'sessionstore-backups', 'recovery.jsonlz4'),
      mozLz4(
        JSON.stringify({
          windows: [
            {
              selected: 3,
              tabs: [
                { index: 1, entries: [{ url: 'https://a.example/', title: 'A' }] },
                { index: 1, entries: [{ url: 'about:newtab' }] },
                {
                  index: 2,
                  entries: [
                    { url: 'https://b.example/' },
                    { url: 'https://c.example/', title: 'C' },
                  ],
                },
              ],
            },
            { tabs: [{ index: 1, entries: [{ url: 'about:blank' }] }] },
          ],
        }),
      ),
    );
  }
}

class Target {
  readonly bookmarks: [string, readonly ImportedBookmark[]][] = [];
  readonly visits: ImportedVisit[] = [];
  importBookmarks(folder: string, tree: readonly ImportedBookmark[]): number {
    this.bookmarks.push([folder, tree]);
    const count = (items: readonly ImportedBookmark[]): number =>
      items.reduce(
        (sum, item) => sum + (item.url === undefined ? count(item.children ?? []) : 1),
        0,
      );
    return count(tree);
  }
  importHistory(visits: readonly ImportedVisit[]): number {
    this.visits.push(...visits);
    return visits.length;
  }
}

const labels = {
  folder: 'Imported',
  toolbar: 'Toolbar',
  menu: 'Menu',
  other: 'Other',
  mobile: 'Mobile',
};
const everything = { bookmarks: true, history: true, tabs: true };

describe('decodeMozLz4', () => {
  it('decodes literals and matches that overlap what they write', () => {
    expect(decodeMozLz4(mozLz4('{"windows":[]}'))).toBe('{"windows":[]}');
    expect(decodeMozLz4(mozLz4('x'.repeat(400)))).toBe('x'.repeat(400));
    // "ab", then a match of 6 bytes at offset 2, then the literal "!".
    const block = Buffer.from([0x22, 0x61, 0x62, 0x02, 0x00, 0x10, 0x21]);
    const header = Buffer.alloc(12);
    header.write('mozLz40\0', 0, 'latin1');
    header.writeUInt32LE(9, 8);
    expect(decodeMozLz4(Buffer.concat([header, block]))).toBe('abababab!');
  });

  it('refuses other files and damaged blocks', () => {
    expect(() => decodeMozLz4(Buffer.from('{"windows":[]}'))).toThrow(/Not a mozLz4/);
    const header = Buffer.alloc(12);
    header.write('mozLz40\0', 0, 'latin1');
    header.writeUInt32LE(4, 8);
    expect(() =>
      decodeMozLz4(Buffer.concat([header, Buffer.from([0x10, 0x61, 0x09, 0x00])])),
    ).toThrow(/Damaged/);
    expect(() => decodeMozLz4(Buffer.concat([header, Buffer.from([0x50, 0x61])]))).toThrow(
      /Damaged/,
    );
    header.writeUInt32LE(0xffffffff, 8);
    expect(() => decodeMozLz4(Buffer.concat([header, Buffer.from([0x00])]))).toThrow(/Damaged/);
  });
});

describe('BrowserImporter', () => {
  it('finds and imports Chromium and Firefox profiles on Linux', () => {
    const home = tempDir();
    chromeProfile(join(home, '.config', 'google-chrome'));
    firefoxProfile(join(home, '.mozilla', 'firefox'));
    const target = new Target();
    const environment: ImportEnvironment = { platform: 'linux', home, temp: tempDir() };
    const importer = new BrowserImporter(target, environment);
    const [chrome, firefox] = importer.findBrowsers();
    expect(chrome).toEqual({
      id: `chromium:${join(home, '.config', 'google-chrome', 'Default')}`,
      browser: 'Google Chrome',
      profile: 'Person 1',
      tabs: false,
    });
    expect(firefox).toMatchObject({ browser: 'Firefox', profile: 'default-release', tabs: true });

    const fromChrome = importer.importBrowser(chrome?.id ?? '', everything, labels);
    expect(fromChrome).toEqual({ bookmarks: 2, history: 1, windows: [], failed: [] });
    expect(target.bookmarks[0]).toEqual([
      'Imported',
      [
        {
          title: 'Bookmarks bar',
          children: [
            { title: 'News', url: 'https://news.example/' },
            {
              title: 'Work',
              children: [{ title: 'https://mail.example/', url: 'https://mail.example/' }],
            },
          ],
        },
        { title: 'Other bookmarks', children: [] },
      ],
    ]);
    expect(target.visits).toEqual([
      { url: 'https://news.example/', title: 'News', visitCount: 3, lastVisit: 1_355_526_400_000 },
    ]);

    const fromFirefox = importer.importBrowser(firefox?.id ?? '', everything, labels);
    expect(fromFirefox.failed).toEqual([]);
    expect(target.bookmarks[1]).toEqual([
      'Imported',
      [
        { title: 'Toolbar', children: [{ title: 'Docs', url: 'https://docs.example/' }] },
        { title: 'Menu', children: [{ title: 'Reading', children: [] }] },
      ],
    ]);
    expect(target.visits.at(-1)).toEqual({
      url: 'https://docs.example/',
      title: 'Docs',
      visitCount: 2,
      lastVisit: 1_700_000_000_000,
    });
    expect(fromFirefox.windows).toEqual([
      {
        tabs: [
          { url: 'https://a.example/', title: 'A' },
          { url: 'https://c.example/', title: 'C' },
        ],
        active: 1,
      },
    ]);
    expect(() => importer.importBrowser('chromium:/etc', everything, labels)).toThrow(/Unknown/);
  });

  it('looks in the folders of Windows and macOS and reports what it could not read', () => {
    const home = tempDir();
    const local = join(home, 'Local');
    const roaming = join(home, 'Roaming');
    chromeProfile(join(local, 'Microsoft', 'Edge', 'User Data'));
    firefoxProfile(join(roaming, 'zen'), false);
    // Opera keeps its only profile next to its Local State.
    mkdirSync(join(roaming, 'Opera Software', 'Opera Stable'), { recursive: true });
    writeFileSync(join(roaming, 'Opera Software', 'Opera Stable', 'Bookmarks'), 'not json');
    const target = new Target();
    const windows = new BrowserImporter(target, {
      platform: 'win32',
      home,
      appData: roaming,
      localAppData: local,
      temp: tempDir(),
    });
    const found = windows.findBrowsers();
    expect(found.map(({ browser, profile, tabs }) => [browser, profile, tabs])).toEqual([
      ['Microsoft Edge', 'Person 1', false],
      ['Opera', 'Default', false],
      ['Zen', 'default-release', false],
    ]);
    expect(windows.importBrowser(found[1]?.id ?? '', everything, labels)).toEqual({
      bookmarks: 0,
      history: 0,
      windows: [],
      failed: ['bookmarks', 'history'],
    });
    expect(
      windows.importBrowser(
        found[2]?.id ?? '',
        { bookmarks: false, history: true, tabs: true },
        labels,
      ),
    ).toEqual({ bookmarks: 0, history: 1, windows: [], failed: [] });

    const mac = tempDir();
    chromeProfile(join(mac, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'));
    writeFileSync(
      join(mac, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'Local State'),
      'broken',
    );
    const macos = new BrowserImporter(new Target(), {
      platform: 'darwin',
      home: mac,
      temp: tempDir(),
    });
    expect(macos.findBrowsers().map(({ browser, profile }) => [browser, profile])).toEqual([
      ['Brave', 'Default'],
    ]);
  });
});
