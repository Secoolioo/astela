import { DatabaseSync } from 'node:sqlite';

/** A page in the history, with its most recent visit. */
export interface HistoryEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly visitCount: number;
  /** Milliseconds since 1970 of the most recent visit. */
  readonly lastVisit: number;
}

/** A bookmark or a folder of bookmarks. */
export interface BookmarkNode {
  readonly id: number;
  readonly title: string;
  /** The address of a bookmark; `undefined` for a folder. */
  readonly url?: string;
  readonly children?: readonly BookmarkNode[];
}

/** A bookmark or folder to import, as another browser stores it. */
export interface ImportedBookmark {
  readonly title: string;
  readonly url?: string;
  readonly children?: readonly ImportedBookmark[];
}

/** A page of another browser's history to import. */
export interface ImportedVisit {
  readonly url: string;
  readonly title: string;
  readonly visitCount: number;
  readonly lastVisit: number;
}

/** Ids of the two root folders: the bookmarks bar and the other bookmarks. */
export const bookmarkRoots = { bar: 1, other: 2 } as const;

/** Schema changes in order; the index plus one is the schema version after the step. */
const migrations: readonly string[] = [
  `CREATE TABLE places (
     id INTEGER PRIMARY KEY,
     url TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL DEFAULT '',
     visit_count INTEGER NOT NULL DEFAULT 0,
     last_visit INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX places_last_visit ON places(last_visit);
   CREATE VIRTUAL TABLE places_fts USING fts5(title, url, content='places', content_rowid='id');
   CREATE TRIGGER places_ai AFTER INSERT ON places BEGIN
     INSERT INTO places_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
   END;
   CREATE TRIGGER places_ad AFTER DELETE ON places BEGIN
     INSERT INTO places_fts(places_fts, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
   END;
   CREATE TRIGGER places_au AFTER UPDATE OF title, url ON places BEGIN
     INSERT INTO places_fts(places_fts, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
     INSERT INTO places_fts(rowid, title, url) VALUES (new.id, new.title, new.url);
   END;
   CREATE TABLE bookmarks (
     id INTEGER PRIMARY KEY,
     parent_id INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     url TEXT,
     position INTEGER NOT NULL DEFAULT 0,
     added_at INTEGER NOT NULL
   );
   CREATE INDEX bookmarks_parent ON bookmarks(parent_id, position);
   INSERT INTO bookmarks(id, parent_id, title, url, position, added_at) VALUES
     (1, NULL, 'Bookmarks bar', NULL, 0, 0),
     (2, NULL, 'Other bookmarks', NULL, 1, 0);`,
];

/** The schema version that this build writes. */
export const profileSchemaVersion = migrations.length;

/**
 * The profile database `profile.db`: history with full-text search and bookmarks. It runs
 * in the data service process, never in the browser process, because SQLite calls block.
 * Schema changes run as numbered migrations; before one runs on an existing database, a
 * copy is written next to it with `VACUUM INTO`. A database from a newer version is opened
 * read-only, so an older version never changes data it does not understand.
 */
export class ProfileDatabase {
  private readonly db: DatabaseSync;
  private readonly clock: () => number;
  /** Whether the database belongs to a newer version and must not be written. */
  readonly readOnly: boolean;

  /**
   * @param path - Path of `profile.db`, or `:memory:` in tests.
   * @param clock - Current time in milliseconds since 1970.
   */
  constructor(path: string, clock: () => number = Date.now) {
    this.clock = clock;
    const probe = new DatabaseSync(path);
    const version = Number(probe.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0);
    this.readOnly = version > profileSchemaVersion;
    if (this.readOnly) {
      probe.close();
      this.db = new DatabaseSync(path, { readOnly: true });
      return;
    }
    this.db = probe;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    if (version > 0 && version < profileSchemaVersion && path !== ':memory:') {
      this.db.exec(`VACUUM INTO '${`${path}.v${version}.bak`.replaceAll("'", "''")}'`);
    }
    for (let step = version; step < profileSchemaVersion; step += 1) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(migrations[step] ?? '');
        this.db.exec(`PRAGMA user_version = ${step + 1}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  /**
   * Records a visit of a page.
   * @param url - The page's address.
   * @param title - Its title, if known yet.
   */
  addVisit(url: string, title = ''): void {
    if (this.readOnly) return;
    this.db
      .prepare(
        `INSERT INTO places(url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1, last_visit = excluded.last_visit,
           title = CASE WHEN excluded.title = '' THEN title ELSE excluded.title END`,
      )
      .run(url, title, this.clock());
  }

  /**
   * Updates the title of a page in the history.
   * @param url - The page's address.
   * @param title - Its new title.
   */
  setTitle(url: string, title: string): void {
    if (this.readOnly) return;
    this.db.prepare('UPDATE places SET title = ? WHERE url = ?').run(title, url);
  }

  /**
   * Pages of the history, newest first, optionally matching search terms.
   * @param query - Words that the title or address must contain; empty for all pages.
   * @param limit - The most pages to return.
   * @param before - Only pages visited before this time.
   */
  history(query: string, limit = 100, before = Number.MAX_SAFE_INTEGER): HistoryEntry[] {
    const terms = ftsQuery(query);
    const rows =
      terms === ''
        ? this.db
            .prepare(
              `SELECT id, url, title, visit_count, last_visit FROM places
               WHERE last_visit < ? ORDER BY last_visit DESC LIMIT ?`,
            )
            .all(before, limit)
        : this.db
            .prepare(
              `SELECT p.id, p.url, p.title, p.visit_count, p.last_visit FROM places_fts f
               JOIN places p ON p.id = f.rowid
               WHERE places_fts MATCH ? AND p.last_visit < ? ORDER BY p.last_visit DESC LIMIT ?`,
            )
            .all(terms, before, limit);
    return rows.map((row) => ({
      id: Number(row['id']),
      url: String(row['url']),
      title: String(row['title']),
      visitCount: Number(row['visit_count']),
      lastVisit: Number(row['last_visit']),
    }));
  }

  /**
   * Removes pages from the history.
   * @param ids - The pages.
   */
  deleteHistory(ids: readonly number[]): void {
    if (this.readOnly) return;
    const statement = this.db.prepare('DELETE FROM places WHERE id = ?');
    this.transaction(() => ids.forEach((id) => statement.run(id)));
  }

  /** Removes the whole history. */
  clearHistory(): void {
    if (this.readOnly) return;
    this.db.exec("DELETE FROM places; INSERT INTO places_fts(places_fts) VALUES('rebuild');");
  }

  /**
   * Adds pages of another browser's history; pages that exist keep the newer visit and
   * the sum of the visits.
   * @param visits - The pages.
   * @returns How many pages were new.
   */
  importHistory(visits: readonly ImportedVisit[]): number {
    if (this.readOnly) return 0;
    const before = this.count('places');
    const statement = this.db.prepare(
      `INSERT INTO places(url, title, visit_count, last_visit) VALUES (?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + excluded.visit_count,
         last_visit = max(last_visit, excluded.last_visit),
         title = CASE WHEN title = '' THEN excluded.title ELSE title END`,
    );
    this.transaction(() => {
      for (const visit of visits) {
        statement.run(visit.url, visit.title, visit.visitCount, visit.lastVisit);
      }
    });
    return this.count('places') - before;
  }

  /** The bookmarks: the bookmarks bar and the other bookmarks, with their folders. */
  bookmarks(): BookmarkNode[] {
    const rows = this.db
      .prepare('SELECT id, parent_id, title, url FROM bookmarks ORDER BY parent_id, position, id')
      .all();
    const children = new Map<number, BookmarkNode[]>();
    const nodes = new Map<
      number,
      { id: number; title: string; url?: string; parent: number | null }
    >();
    for (const row of rows) {
      const url = row['url'];
      nodes.set(Number(row['id']), {
        id: Number(row['id']),
        title: String(row['title']),
        ...(typeof url === 'string' ? { url } : {}),
        parent: row['parent_id'] === null ? null : Number(row['parent_id']),
      });
    }
    const build = (id: number): BookmarkNode => {
      const node = nodes.get(id);
      const kids = (children.get(id) ?? []).map((child) => build(child.id));
      return node?.url === undefined
        ? { id, title: node?.title ?? '', children: kids }
        : { id, title: node.title, url: node.url };
    };
    for (const node of nodes.values()) {
      if (node.parent !== null) {
        const list = children.get(node.parent) ?? [];
        list.push({ id: node.id, title: node.title });
        children.set(node.parent, list);
      }
    }
    return [build(bookmarkRoots.bar), build(bookmarkRoots.other)];
  }

  /**
   * Adds a bookmark or a folder at the end of a folder.
   * @param parent - The folder.
   * @param title - Its title.
   * @param url - The address of a bookmark; omitted for a folder.
   * @returns The new id.
   */
  addBookmark(parent: number, title: string, url?: string): number {
    if (this.readOnly) return 0;
    const position = Number(
      this.db.prepare('SELECT count(*) AS n FROM bookmarks WHERE parent_id = ?').get(parent)?.[
        'n'
      ] ?? 0,
    );
    const result = this.db
      .prepare(
        'INSERT INTO bookmarks(parent_id, title, url, position, added_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(parent, title, url ?? null, position, this.clock());
    return Number(result.lastInsertRowid);
  }

  /**
   * Removes a bookmark or a folder with everything in it. The root folders stay.
   * @param id - The bookmark or folder.
   */
  removeBookmark(id: number): void {
    if (this.readOnly || id === bookmarkRoots.bar || id === bookmarkRoots.other) return;
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  /**
   * Imports another browser's bookmarks into a new folder of the other bookmarks.
   * @param folderTitle - Title of the new folder, such as "Imported from Chrome".
   * @param tree - The bookmarks and folders.
   * @returns How many bookmarks were imported.
   */
  importBookmarks(folderTitle: string, tree: readonly ImportedBookmark[]): number {
    if (this.readOnly) return 0;
    let count = 0;
    const add = (parent: number, items: readonly ImportedBookmark[]): void => {
      for (const item of items) {
        if (item.url !== undefined) {
          this.addBookmark(parent, item.title, item.url);
          count += 1;
        } else if (item.children !== undefined && item.children.length > 0) {
          add(this.addBookmark(parent, item.title), item.children);
        }
      }
    };
    this.transaction(() => add(this.addBookmark(bookmarkRoots.other, folderTitle), tree));
    return count;
  }

  /** Closes the database. */
  close(): void {
    this.db.close();
  }

  private count(table: 'places' | 'bookmarks'): number {
    return Number(this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'] ?? 0);
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Turns search words into an FTS5 query that matches every word as a prefix. */
function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((word) => word.replaceAll('"', '').trim())
    .filter((word) => word !== '')
    .map((word) => `"${word}"*`)
    .join(' ');
}
