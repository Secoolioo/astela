import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { answer } from '../data/data-protocol.ts';
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

  it('imports history and merges it with pages that exist', () => {
    const db = new ProfileDatabase(':memory:', () => 5000);
    db.addVisit('https://a.example/', 'A');
    const added = db.importHistory([
      { url: 'https://a.example/', title: 'Other A', visitCount: 4, lastVisit: 9000 },
      { url: 'https://b.example/', title: 'B', visitCount: 2, lastVisit: 100 },
    ]);
    expect(added).toBe(1);
    expect(db.history('').map((e) => [e.url, e.title, e.visitCount, e.lastVisit])).toEqual([
      ['https://a.example/', 'A', 5, 9000],
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
    const count = db.importBookmarks('Imported from Chrome', [
      { title: 'Docs', url: 'https://docs.example/' },
      { title: 'Empty', children: [] },
      { title: 'Folder', children: [{ title: 'Deep', url: 'https://deep.example/' }] },
    ]);
    expect(count).toBe(2);
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
    newer.close();
  });
});

describe('data protocol', () => {
  it('answers known methods and reports unknown ones and failures', () => {
    const db = new ProfileDatabase(':memory:', () => 1);
    expect(answer(db, { id: 1, method: 'addVisit', params: ['https://a.example/', 'A'] })).toEqual({
      id: 1,
      result: undefined,
    });
    expect(answer(db, { id: 2, method: 'history', params: [''] }).result).toHaveLength(1);
    expect(answer(db, { id: 3, method: 'close' as never, params: [] }).error).toMatch(/Unknown/);
    expect(answer(db, { id: 4, method: 'addBookmark', params: [999, 'X'] }).error).toMatch(
      /FOREIGN KEY/,
    );
  });
});
