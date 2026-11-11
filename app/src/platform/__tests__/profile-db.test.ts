import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { answer, type DataRequest, type DataResponse } from '../data/data-protocol.ts';
import { ProfileDatabase, bookmarkRoots, profileSchemaVersion } from '../data/profile-db.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDb = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-'));
  dirs.push(dir);
  return join(dir, 'profile.db');
};

describe('ProfileDatabase history', () => {
  it('records visits, searches by words and removes pages', () => {
    let now = 1000;
    const db = new ProfileDatabase(':memory:', () => now);
    db.addVisit('https://news.example/today', 'Today’s news');
    now = 2000;
    db.addVisit('https://shop.example/', '');
    db.setTitle('https://shop.example/', 'Garden shop');
    now = 3000;
    db.addVisit('https://news.example/today');
    const all = db.history('');
    expect(all.map((entry) => [entry.url, entry.title, entry.visitCount])).toEqual([
      ['https://news.example/today', 'Today’s news', 2],
      ['https://shop.example/', 'Garden shop', 1],
    ]);
    expect(db.history('gard').map((entry) => entry.url)).toEqual(['https://shop.example/']);
    expect(db.history('news tod').length).toBe(1);
    expect(db.history('"; DROP TABLE places;').length).toBe(0);
    expect(db.history('', 10, 3000).map((entry) => entry.url)).toEqual(['https://shop.example/']);
    db.deleteHistory([all[1]?.id ?? 0]);
    expect(db.history('garden')).toEqual([]);
    db.clearHistory();
    expect(db.history('')).toEqual([]);
    db.close();
  });

  it('removes the pages visited since a time, with their earlier visits', () => {
    let now = 1000;
    const db = new ProfileDatabase(':memory:', () => now);
    db.addVisit('https://old.example/', 'Old');
    now = 2000;
    db.addVisit('https://both.example/', 'Both');
    now = 5000;
    db.addVisit('https://new.example/', 'New');
    db.addVisit('https://both.example/');
    db.clearHistorySince(4000);
    expect(db.history('').map((entry) => entry.url)).toEqual(['https://old.example/']);
    expect(db.history('old').length).toBe(1);
    expect(db.history('both')).toEqual([]);
    db.clearHistorySince(0);
    expect(db.history('')).toEqual([]);
    db.close();
  });

  it('imports history and merges it with pages that exist', () => {
    const db = new ProfileDatabase(':memory:', () => 5000);
    db.addVisit('https://a.example/', 'A');
    const added = db.importHistory([
      { url: 'https://a.example/', title: 'Other A', visitCount: 4, lastVisit: 9000 },
      { url: 'https://b.example/', title: 'B', visitCount: 2, lastVisit: 100 },
    ]);
    expect(added).toBe(1);
    const pages = (): unknown[] =>
      db.history('').map((e) => [e.url, e.title, e.visitCount, e.lastVisit]);
    expect(pages()).toEqual([
      ['https://a.example/', 'A', 4, 9000],
      ['https://b.example/', 'B', 2, 100],
    ]);
    db.importHistory([{ url: 'https://b.example/', title: 'B', visitCount: 2, lastVisit: 100 }]);
    expect(pages()).toEqual([
      ['https://a.example/', 'A', 4, 9000],
      ['https://b.example/', 'B', 2, 100],
    ]);
  });
});

describe('ProfileDatabase bookmarks', () => {
  it('keeps folders and bookmarks in order and imports trees', () => {
    const db = new ProfileDatabase(':memory:', () => 1);
    const work = db.addBookmark(bookmarkRoots.bar, 'Work');
    db.addBookmark(work, 'Mail', 'https://mail.example/');
    db.addBookmark(bookmarkRoots.bar, 'News', 'https://news.example/');
    const count = db.importBookmarks(
      'Imported from Chrome',
      [
        { title: 'Docs', url: 'https://docs.example/' },
        { title: 'Empty', children: [] },
        { title: 'Folder', children: [{ title: 'Deep', url: 'https://deep.example/' }] },
      ],
      'chromium:/profiles/Default',
    );
    expect(count).toBe(2);
    // Another source keeps a folder of its own, even with the same title.
    db.importBookmarks(
      'Imported from Chrome',
      [{ title: 'Work', url: 'https://work.example/' }],
      'chromium:/profiles/Work',
    );
    // Importing again replaces the folder of the first import, whatever its title is now.
    expect(
      db.importBookmarks(
        'Importiert aus Chrome',
        [
          { title: 'Docs', url: 'https://docs.example/' },
          { title: 'Empty', children: [] },
          { title: 'Folder', children: [{ title: 'Deep', url: 'https://deep.example/' }] },
        ],
        'chromium:/profiles/Default',
      ),
    ).toBe(2);
    expect(db.bookmarks()).toEqual([
      {
        id: bookmarkRoots.bar,
        title: 'Bookmarks bar',
        children: [
          {
            id: work,
            title: 'Work',
            children: [{ id: expect.any(Number), title: 'Mail', url: 'https://mail.example/' }],
          },
          { id: expect.any(Number), title: 'News', url: 'https://news.example/' },
        ],
      },
      {
        id: bookmarkRoots.other,
        title: 'Other bookmarks',
        children: [
          {
            id: expect.any(Number),
            title: 'Imported from Chrome',
            children: [{ id: expect.any(Number), title: 'Work', url: 'https://work.example/' }],
          },
          {
            id: expect.any(Number),
            title: 'Importiert aus Chrome',
            children: [
              { id: expect.any(Number), title: 'Docs', url: 'https://docs.example/' },
              {
                id: expect.any(Number),
                title: 'Folder',
                children: [{ id: expect.any(Number), title: 'Deep', url: 'https://deep.example/' }],
              },
            ],
          },
        ],
      },
    ]);
    db.removeBookmark(work);
    db.removeBookmark(bookmarkRoots.bar);
    expect(db.bookmarks()[0]?.children?.map((node) => node.title)).toEqual(['News']);
  });

  it('lists, renames, moves and removes bookmarks', () => {
    const db = new ProfileDatabase(':memory:', () => 1);
    const work = db.addBookmark(bookmarkRoots.bar, 'Work');
    const inner = db.addBookmark(work, 'Inner');
    const mail = db.addBookmark(bookmarkRoots.bar, 'Mail', 'https://mail.example/');
    db.addBookmark(bookmarkRoots.other, 'Mail again', 'https://mail.example/');
    expect(db.bookmarkUrls()).toEqual(['https://mail.example/']);
    db.updateBookmark(mail, 'Post', 'https://post.example/', work);
    db.updateBookmark(work, 'Office', 'https://ignored.example/');
    expect(() => db.updateBookmark(work, 'Office', undefined, inner)).toThrow(/Cannot move/);
    expect(() => db.updateBookmark(work, 'Office', undefined, mail)).toThrow(/Cannot move/);
    db.updateBookmark(bookmarkRoots.bar, 'Renamed');
    db.updateBookmark(999, 'Missing');
    expect(db.bookmarkList()).toEqual([
      { id: bookmarkRoots.bar, parentId: null, title: 'Bookmarks bar', url: null },
      { id: bookmarkRoots.other, parentId: null, title: 'Other bookmarks', url: null },
      { id: work, parentId: bookmarkRoots.bar, title: 'Office', url: null },
      {
        id: expect.any(Number),
        parentId: bookmarkRoots.other,
        title: 'Mail again',
        url: 'https://mail.example/',
      },
      { id: inner, parentId: work, title: 'Inner', url: null },
      { id: mail, parentId: work, title: 'Post', url: 'https://post.example/' },
    ]);
    db.removeBookmarkUrl('https://mail.example/');
    expect(db.bookmarkUrls()).toEqual(['https://post.example/']);
  });
});

describe('ProfileDatabase downloads', () => {
  it('lists downloads newest first, records their progress and removes them', () => {
    let now = 1000;
    const db = new ProfileDatabase(':memory:', () => (now += 1));
    const report = db.addDownload('https://a.example/report.pdf', '/d/report.pdf', 200);
    const image = db.addDownload('https://a.example/image.png', '/d/image.png', 0);
    db.updateDownload(report, 200, 200, 'completed');
    db.updateDownload(image, 50, 0, 'progressing');
    expect(db.downloads()).toEqual([
      {
        id: image,
        url: 'https://a.example/image.png',
        path: '/d/image.png',
        total: 0,
        received: 50,
        state: 'progressing',
        started: 1002,
      },
      {
        id: report,
        url: 'https://a.example/report.pdf',
        path: '/d/report.pdf',
        total: 200,
        received: 200,
        state: 'completed',
        started: 1001,
      },
    ]);
    // A download that was running when the browser stopped did not finish.
    db.interruptDownloads();
    expect(db.downloads().map((entry) => entry.state)).toEqual(['interrupted', 'completed']);
    db.removeDownloads([report]);
    expect(db.downloads().map((entry) => entry.id)).toEqual([image]);
    expect(db.downloads(0)).toEqual([]);
    db.close();
  });

  it('keeps the most recent thousand downloads', () => {
    const db = new ProfileDatabase(':memory:');
    let last = 0;
    for (let n = 0; n < 1005; n += 1) last = db.addDownload(`https://a.example/${n}`, `/d/${n}`, 1);
    const kept = db.downloads(2000);
    expect(kept).toHaveLength(1000);
    expect(kept[0]?.id).toBe(last);
    expect(kept.at(-1)?.url).toBe('https://a.example/5');
    db.close();
  });
});

describe('ProfileDatabase migrations', () => {
  it('migrates a database, keeps a copy of older versions and opens newer ones read-only', () => {
    const path = tempDb();
    const first = new ProfileDatabase(path);
    first.addVisit('https://a.example/', 'A');
    first.close();
    const raw = new DatabaseSync(path);
    raw.exec(`PRAGMA user_version = ${profileSchemaVersion + 1}`);
    raw.close();
    const newer = new ProfileDatabase(path);
    expect(newer.readOnly).toBe(true);
    newer.addVisit('https://b.example/', 'B');
    expect(newer.history('').map((entry) => entry.url)).toEqual(['https://a.example/']);
    // What the user asks for fails visibly instead of seeming to work.
    expect(() => newer.clearHistory()).toThrow(/read-only/);
    expect(() => newer.addBookmark(bookmarkRoots.bar, 'News', 'https://news.example/')).toThrow(
      /read-only/,
    );
    expect(() => newer.importBookmarks('Imported', [], 'source')).toThrow(/read-only/);
    newer.close();
  });

  it('adds the source of imported folders to a database of the first version', () => {
    const path = tempDb();
    new ProfileDatabase(path).close();
    const raw = new DatabaseSync(path);
    // The first version had neither the source of folders nor the list of downloads.
    raw.exec(
      'ALTER TABLE bookmarks DROP COLUMN source; DROP TABLE downloads; PRAGMA user_version = 1',
    );
    raw.close();
    const db = new ProfileDatabase(path);
    expect(db.importBookmarks('Imported', [{ title: 'A', url: 'https://a.example/' }], 'x')).toBe(
      1,
    );
    db.close();
    expect(existsSync(`${path}.v1.bak`)).toBe(true);
  });

  it('adds the list of downloads to a database of the second version', () => {
    const path = tempDb();
    new ProfileDatabase(path).close();
    const raw = new DatabaseSync(path);
    raw.exec('DROP TABLE downloads; PRAGMA user_version = 2');
    raw.close();
    const db = new ProfileDatabase(path);
    const id = db.addDownload('https://a.example/a.zip', '/d/a.zip', 10);
    expect(db.downloads().map((entry) => entry.id)).toEqual([id]);
    db.close();
    expect(existsSync(`${path}.v2.bak`)).toBe(true);
  });
});

describe('data protocol', () => {
  it('answers known methods and reports unknown ones and failures', () => {
    const db = new ProfileDatabase(':memory:', () => 1);
    const importer = {
      findBrowsers: () => [],
      importBrowser: () => ({ bookmarks: 0, history: 0, windows: [], failed: [] }),
    };
    const call = (id: number, method: string, params: unknown[]): DataResponse =>
      answer(db, importer, { id, method: method as DataRequest['method'], params });
    expect(call(1, 'addVisit', ['https://a.example/', 'A'])).toEqual({ id: 1, result: undefined });
    expect(call(2, 'history', ['']).result).toHaveLength(1);
    expect(call(3, 'close', []).error).toMatch(/Unknown/);
    expect(call(4, 'addBookmark', [999, 'X']).error).toMatch(/FOREIGN KEY/);
    expect(call(5, 'findBrowsers', []).result).toEqual([]);
  });
});
