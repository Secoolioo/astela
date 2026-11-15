import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { DataClient } from '../../platform/electron/data-service-client.ts';
import type { IpcRouter } from '../../platform/electron/ipc-router.ts';
import { Bookmarks, type BookmarkEntry } from '../bookmarks.ts';

// The bookmarks tell open pages of the browser about changes; there are none here.
vi.mock('electron', () => ({ webContents: { getAllWebContents: () => [] } }));

/** A profile database with bookmarks in memory, which records the calls that change them. */
class FakeData {
  readonly calls: unknown[][] = [];
  private nextId = 100;
  rows: BookmarkEntry[];

  constructor(rows: readonly BookmarkEntry[]) {
    this.rows = [...rows];
  }

  readonly call = (method: string, ...params: unknown[]): Promise<unknown> => {
    if (method !== 'bookmarkList') this.calls.push([method, ...params]);
    switch (method) {
      case 'bookmarkList':
        return Promise.resolve(this.rows);
      case 'addBookmark': {
        const [parentId, title, url] = params as [number, string, string];
        const id = this.nextId++;
        this.rows.push({ id, parentId, title, url });
        return Promise.resolve(id);
      }
      case 'updateBookmark': {
        const [id, title, , parentId] = params as [number, string, string | undefined, number?];
        this.rows = this.rows.map((row) =>
          row.id === id ? { ...row, title, parentId: parentId ?? row.parentId } : row,
        );
        return Promise.resolve(null);
      }
      case 'removeBookmarkUrl':
        this.rows = this.rows.filter((row) => row.url !== params[0]);
        return Promise.resolve(null);
      default:
        return Promise.reject(new Error(`Unexpected call ${method}`));
    }
  };
}

const folder = (id: number, parentId: number | null, title: string): BookmarkEntry => ({
  id,
  parentId,
  title,
  url: null,
});
const page = (id: number, parentId: number, title: string, url: string): BookmarkEntry => ({
  id,
  parentId,
  title,
  url,
});

/** The bookmarks of a profile with the two roots and some folders and pages. */
function bookmarksWith(rows: readonly BookmarkEntry[]): {
  bookmarks: Bookmarks;
  data: FakeData;
  changes: () => number;
} {
  const data = new FakeData([
    folder(1, null, 'Bookmarks bar'),
    folder(2, null, 'Other bookmarks'),
    ...rows,
  ]);
  let changes = 0;
  const bookmarks = new Bookmarks(
    data as unknown as DataClient,
    { publish: vi.fn() } as unknown as IpcRouter,
    {} as Session,
    () => (changes += 1),
    { warn: vi.fn() } as unknown as Logger,
  );
  return { bookmarks, data, changes: () => changes };
}

describe('Bookmarks', () => {
  it('offers the folders of both roots, each after the folder it is in, with its depth', async () => {
    const { bookmarks } = bookmarksWith([
      folder(10, 2, 'Travel'),
      folder(11, 1, 'Work'),
      page(12, 11, 'Plan', 'https://plan.example/'),
      folder(13, 11, 'Reports'),
      folder(14, 13, 'Old'),
      folder(15, 1, 'News'),
    ]);
    expect(await bookmarks.folders()).toEqual([
      { id: 1, title: 'Bookmarks bar', depth: 0 },
      { id: 11, title: 'Work', depth: 1 },
      { id: 13, title: 'Reports', depth: 2 },
      { id: 14, title: 'Old', depth: 3 },
      { id: 15, title: 'News', depth: 1 },
      { id: 2, title: 'Other bookmarks', depth: 0 },
      { id: 10, title: 'Travel', depth: 1 },
    ]);
  });

  it('offers folders down to 20 levels, and at most 500 of them', async () => {
    const deep = Array.from({ length: 25 }, (_, index) =>
      folder(10 + index, index === 0 ? 1 : 9 + index, `Level ${index + 1}`),
    );
    const deepest = await bookmarksWith(deep).bookmarks.folders();
    expect(deepest.at(-2)).toEqual({ id: 29, title: 'Level 20', depth: 20 });
    expect(deepest.map((entry) => entry.depth).filter((depth) => depth > 20)).toEqual([]);
    const many = Array.from({ length: 600 }, (_, index) =>
      folder(10 + index, 1, `Folder ${index}`),
    );
    expect(await bookmarksWith(many).bookmarks.folders()).toHaveLength(500);
  });

  it('finds the first bookmark of a page, the bookmarks bar first', async () => {
    const url = 'https://example.com/';
    const { bookmarks } = bookmarksWith([
      folder(10, 2, 'Other'),
      page(11, 10, 'Second', url),
      folder(12, 1, 'Bar folder'),
      page(13, 12, 'First', url),
      page(14, 1, 'Else', 'https://else.example/'),
    ]);
    expect(await bookmarks.firstOf(url)).toEqual({ id: 13, parentId: 12, title: 'First', url });
    expect(await bookmarks.firstOf('https://none.example/')).toBeUndefined();
  });

  it('reads the rows of a large tree once per load for the folders and the star', async () => {
    // 500 folders in the bookmarks bar, each with 20 bookmarks.
    const rows = Array.from({ length: 500 }, (_unused, index) => {
      const id = 10 + index * 21;
      return [
        folder(id, 1, `Folder ${index}`),
        ...Array.from({ length: 20 }, (_none, at) =>
          page(id + 1 + at, id, `Page ${at}`, `https://example.com/${index}/${at}`),
        ),
      ];
    }).flat();
    const { bookmarks, data } = bookmarksWith(rows);
    let reads = 0;
    // Every read of a row of the list counts, however the bookmarks walk it.
    data.rows = new Proxy(data.rows, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) reads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const count = data.rows.length;
    expect(await bookmarks.firstOf('https://example.com/499/19')).toMatchObject({
      title: 'Page 19',
    });
    expect(await bookmarks.folders()).toHaveLength(500);
    expect(bookmarks.contents(10)).toHaveLength(20);
    expect(reads).toBeLessThanOrEqual(count);
  });

  it('adds, renames, moves and removes bookmarks, and tells every change', async () => {
    const { bookmarks, data, changes } = bookmarksWith([folder(10, 2, 'Travel')]);
    const url = 'https://example.com/';
    const id = await bookmarks.add(url, '  ');
    expect(bookmarks.has(url)).toBe(true);
    expect(changes()).toBeGreaterThan(0);
    const added = changes();
    await bookmarks.update(id, 'Example', 10);
    expect(changes()).toBeGreaterThan(added);
    expect(await bookmarks.firstOf(url)).toEqual({ id, parentId: 10, title: 'Example', url });
    // A rename in the same folder leaves the bookmark where it is.
    await bookmarks.update(id, 'Example page', 10);
    await bookmarks.removeUrl(url);
    expect(bookmarks.has(url)).toBe(false);
    expect(data.calls).toEqual([
      ['addBookmark', 1, url, url],
      ['updateBookmark', id, 'Example', undefined, 10],
      ['updateBookmark', id, 'Example page', undefined, undefined],
      ['removeBookmarkUrl', url],
    ]);
  });
});
