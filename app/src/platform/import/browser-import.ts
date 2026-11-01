import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { ImportedBookmark, ImportedVisit } from '../data/profile-db.ts';
import { decodeMozLz4 } from './mozlz4.ts';

/** A profile of another browser that the import can read. */
export interface BrowserProfile {
  /** Identifies the profile in later calls; the import only reads profiles it found itself. */
  readonly id: string;
  /** The browser, such as "Google Chrome". */
  readonly browser: string;
  /** The profile's name in that browser. */
  readonly profile: string;
  /** Whether the browser keeps its open tabs in a form the import reads. */
  readonly tabs: boolean;
}

/** What to import. */
export interface ImportKinds {
  readonly bookmarks: boolean;
  readonly history: boolean;
  readonly tabs: boolean;
}

/** Titles of the folders that the import creates, in the language of the browser's UI. */
export interface ImportLabels {
  /** The folder that holds the imported bookmarks, such as "Imported from Firefox". */
  readonly folder: string;
  /** Firefox's bookmarks toolbar, menu, other bookmarks and mobile bookmarks. */
  readonly toolbar: string;
  readonly menu: string;
  readonly other: string;
  readonly mobile: string;
}

/** A window of open tabs to open again. */
export interface ImportedWindow {
  readonly tabs: readonly { readonly url: string; readonly title: string }[];
  /** Index of the tab that was active. */
  readonly active: number;
}

/** What an import did. Data that could not be read is named in `failed`. */
export interface ImportResult {
  readonly bookmarks: number;
  readonly history: number;
  readonly windows: readonly ImportedWindow[];
  readonly failed: readonly ('bookmarks' | 'history' | 'tabs')[];
}

/** Where the import looks for other browsers. */
export interface ImportEnvironment {
  readonly platform: string;
  readonly home: string;
  /** `%APPDATA%` and `%LOCALAPPDATA%` on Windows. */
  readonly appData?: string | undefined;
  readonly localAppData?: string | undefined;
  /** `$XDG_CONFIG_HOME` on Linux. */
  readonly configHome?: string | undefined;
  /** A folder for copies of the databases, which their browsers may hold open. */
  readonly temp: string;
}

/** Where the profile database receives imported data. */
export interface ImportTarget {
  /**
   * Adds bookmarks in a folder of the other bookmarks, in place of the folder of an earlier
   * import from the same source; returns how many there were.
   */
  importBookmarks(folderTitle: string, tree: readonly ImportedBookmark[], source: string): number;
  /** Adds pages to the history; returns how many were new. */
  importHistory(visits: readonly ImportedVisit[]): number;
}

type Family = 'chromium' | 'firefox';

interface Profile extends BrowserProfile {
  readonly family: Family;
  readonly path: string;
}

/** At most this many pages of a browser's history are imported, the most recent first. */
const historyLimit = 100_000;
/** At most this many tabs are opened again. */
const tabLimit = 500;

const webAddress = /^https?:\/\/\S+$/i;

/** The longest title and address the browser keeps, as its other data does. */
const titleLimit = 1024;
const urlLimit = 8192;

/** A bookmark to import, or `undefined` for an address that is not a web address or too long. */
function bookmarkOf(title: string, url: string): ImportedBookmark | undefined {
  if (!webAddress.test(url) || url.length > urlLimit) return undefined;
  return { title: (title || url).slice(0, titleLimit), url };
}

/**
 * Finds the profiles of other browsers on this computer and imports their bookmarks,
 * history and open tabs. It reads copies of the databases, so a browser that is open keeps
 * working, and it never writes to another browser's files.
 */
export class BrowserImporter {
  private readonly target: ImportTarget;
  private readonly environment: ImportEnvironment;

  /**
   * @param target - Receives the bookmarks and history.
   * @param environment - Where to look.
   */
  constructor(target: ImportTarget, environment: ImportEnvironment) {
    this.target = target;
    this.environment = environment;
  }

  /** The profiles of other browsers, Chromium-based browsers first. */
  findBrowsers(): BrowserProfile[] {
    return this.profiles().map(({ id, browser, profile, tabs }) => ({
      id,
      browser,
      profile,
      tabs,
    }));
  }

  /**
   * Imports from a profile that {@link findBrowsers} found. Bookmarks go into a new folder of
   * the other bookmarks, which replaces the folder of an earlier import of the same profile.
   * Open tabs are returned, for the browser process to open.
   * @param id - The profile's id.
   * @param kinds - What to import.
   * @param labels - Folder titles.
   */
  importBrowser(id: string, kinds: ImportKinds, labels: ImportLabels): ImportResult {
    const profile = this.profiles().find((candidate) => candidate.id === id);
    if (profile === undefined) {
      throw new Error('Unknown browser profile');
    }
    const failed: ('bookmarks' | 'history' | 'tabs')[] = [];
    const attempt = <T>(kind: 'bookmarks' | 'history' | 'tabs', read: () => T, empty: T): T => {
      try {
        return read();
      } catch {
        failed.push(kind);
        return empty;
      }
    };
    const chromium = profile.family === 'chromium';
    const bookmarks = kinds.bookmarks
      ? attempt(
          'bookmarks',
          () => {
            const tree = chromium
              ? readChromiumBookmarks(profile.path)
              : this.withCopy(profile.path, 'places.sqlite', (db) =>
                  readFirefoxBookmarks(db, labels),
                );
            return this.target.importBookmarks(labels.folder, tree, profile.id);
          },
          0,
        )
      : 0;
    const history = kinds.history
      ? attempt(
          'history',
          () =>
            this.target.importHistory(
              chromium
                ? this.withCopy(profile.path, 'History', readChromiumHistory)
                : this.withCopy(profile.path, 'places.sqlite', readFirefoxHistory),
            ),
          0,
        )
      : 0;
    const windows =
      kinds.tabs && profile.tabs ? attempt('tabs', () => readFirefoxTabs(profile.path), []) : [];
    return { bookmarks, history, windows, failed };
  }

  private profiles(): Profile[] {
    return locations(this.environment).flatMap(({ browser, family, dir }) =>
      family === 'chromium' ? chromiumProfiles(browser, dir) : firefoxProfiles(browser, dir),
    );
  }

  /** Runs a query on a copy of a database, with its write-ahead log, in a folder of its own. */
  private withCopy<T>(dir: string, name: string, read: (db: DatabaseSync) => T): T {
    const folder = mkdtempSync(join(this.environment.temp, 'import-'));
    try {
      copyFileSync(join(dir, name), join(folder, name));
      if (existsSync(join(dir, `${name}-wal`))) {
        copyFileSync(join(dir, `${name}-wal`), join(folder, `${name}-wal`));
      }
      const db = new DatabaseSync(join(folder, name));
      try {
        return read(db);
      } finally {
        db.close();
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

/** The folders where browsers keep their profiles, by system. */
function locations(
  environment: ImportEnvironment,
): { browser: string; family: Family; dir: string }[] {
  const { platform, home } = environment;
  const at = (browser: string, family: Family, ...parts: string[]) => ({
    browser,
    family,
    dir: join(...parts),
  });
  if (platform === 'win32') {
    const local = environment.localAppData ?? join(home, 'AppData', 'Local');
    const roaming = environment.appData ?? join(home, 'AppData', 'Roaming');
    return [
      at('Google Chrome', 'chromium', local, 'Google', 'Chrome', 'User Data'),
      at('Microsoft Edge', 'chromium', local, 'Microsoft', 'Edge', 'User Data'),
      at('Brave', 'chromium', local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      at('Vivaldi', 'chromium', local, 'Vivaldi', 'User Data'),
      at('Opera', 'chromium', roaming, 'Opera Software', 'Opera Stable'),
      at('Opera GX', 'chromium', roaming, 'Opera Software', 'Opera GX Stable'),
      at('Chromium', 'chromium', local, 'Chromium', 'User Data'),
      at('Firefox', 'firefox', roaming, 'Mozilla', 'Firefox'),
      at('Zen', 'firefox', roaming, 'zen'),
      at('LibreWolf', 'firefox', roaming, 'librewolf'),
      at('Floorp', 'firefox', roaming, 'Floorp'),
      at('Waterfox', 'firefox', roaming, 'Waterfox'),
    ];
  }
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return [
      at('Google Chrome', 'chromium', support, 'Google', 'Chrome'),
      at('Microsoft Edge', 'chromium', support, 'Microsoft Edge'),
      at('Brave', 'chromium', support, 'BraveSoftware', 'Brave-Browser'),
      at('Vivaldi', 'chromium', support, 'Vivaldi'),
      at('Opera', 'chromium', support, 'com.operasoftware.Opera'),
      at('Opera GX', 'chromium', support, 'com.operasoftware.OperaGX'),
      at('Chromium', 'chromium', support, 'Chromium'),
      at('Firefox', 'firefox', support, 'Firefox'),
      at('Zen', 'firefox', support, 'zen'),
      at('LibreWolf', 'firefox', support, 'librewolf'),
      at('Floorp', 'firefox', support, 'Floorp'),
      at('Waterfox', 'firefox', support, 'Waterfox'),
    ];
  }
  const config = environment.configHome ?? join(home, '.config');
  // Packages from Flatpak and Snap keep their profiles in folders of their own.
  const flatpak = (app: string, ...parts: string[]): string =>
    join(home, '.var', 'app', app, ...parts);
  return [
    at('Google Chrome', 'chromium', config, 'google-chrome'),
    at('Google Chrome', 'chromium', flatpak('com.google.Chrome', 'config', 'google-chrome')),
    at('Microsoft Edge', 'chromium', config, 'microsoft-edge'),
    at('Microsoft Edge', 'chromium', flatpak('com.microsoft.Edge', 'config', 'microsoft-edge')),
    at('Brave', 'chromium', config, 'BraveSoftware', 'Brave-Browser'),
    at(
      'Brave',
      'chromium',
      flatpak('com.brave.Browser', 'config', 'BraveSoftware', 'Brave-Browser'),
    ),
    at('Vivaldi', 'chromium', config, 'vivaldi'),
    at('Vivaldi', 'chromium', flatpak('com.vivaldi.Vivaldi', 'config', 'vivaldi')),
    at('Opera', 'chromium', config, 'opera'),
    at('Chromium', 'chromium', config, 'chromium'),
    at('Chromium', 'chromium', flatpak('org.chromium.Chromium', 'config', 'chromium')),
    at('Chromium', 'chromium', home, 'snap', 'chromium', 'common', 'chromium'),
    at('Firefox', 'firefox', home, '.mozilla', 'firefox'),
    at('Firefox', 'firefox', config, 'mozilla', 'firefox'),
    at('Firefox', 'firefox', flatpak('org.mozilla.firefox', '.mozilla', 'firefox')),
    at('Firefox', 'firefox', home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
    at('Zen', 'firefox', home, '.zen'),
    at('Zen', 'firefox', flatpak('app.zen_browser.zen', '.zen')),
    at('LibreWolf', 'firefox', home, '.librewolf'),
    at('LibreWolf', 'firefox', flatpak('io.gitlab.librewolf-community', '.librewolf')),
    at('Floorp', 'firefox', home, '.floorp'),
    at('Waterfox', 'firefox', home, '.waterfox'),
  ];
}

/** Whether a folder holds the data of a Chromium-based browser's profile. */
function usable(path: string): boolean {
  return existsSync(join(path, 'Bookmarks')) || existsSync(join(path, 'History'));
}

/** The profiles of a Chromium-based browser, as its `Local State` lists them. */
function chromiumProfiles(browser: string, dir: string): Profile[] {
  const make = (path: string, profile: string): Profile => ({
    id: `chromium:${path}`,
    browser,
    profile,
    tabs: false,
    family: 'chromium',
    path,
  });
  // Opera keeps the data of its only profile next to `Local State`.
  if (usable(dir)) return [make(dir, 'Default')];
  let names: [string, string][] = [];
  try {
    const state: unknown = JSON.parse(readFileSync(join(dir, 'Local State'), 'utf8'));
    const cache = field(field(state, 'profile'), 'info_cache');
    if (typeof cache === 'object' && cache !== null) {
      names = Object.entries(cache).map(([folder, info]) => {
        const name = field(info, 'name');
        return [folder, typeof name === 'string' && name !== '' ? name : folder];
      });
    }
  } catch {
    names = [['Default', 'Default']];
  }
  return names
    .filter(([folder]) => !folder.includes('/') && !folder.includes('\\') && folder !== '..')
    .map(([folder, name]) => make(join(dir, folder), name))
    .filter((profile) => usable(profile.path));
}

/** The profiles of a Firefox-based browser, as its `profiles.ini` lists them. */
function firefoxProfiles(browser: string, dir: string): Profile[] {
  let text: string;
  try {
    text = readFileSync(join(dir, 'profiles.ini'), 'utf8');
  } catch {
    return [];
  }
  const sections: Record<string, string>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\[Profile\d+\]$/.test(line.trim())) {
      sections.push({});
    } else if (line.trim().startsWith('[')) {
      sections.push({ ignore: '1' });
    } else {
      const match = /^([A-Za-z]+)=(.*)$/.exec(line.trim());
      const section = sections.at(-1);
      if (match?.[1] !== undefined && section !== undefined) section[match[1]] = match[2] ?? '';
    }
  }
  return sections
    .filter((section) => section['ignore'] === undefined && section['Path'] !== undefined)
    .map((section): Profile => {
      const relative = section['IsRelative'] !== '0';
      const path = relative ? join(dir, section['Path'] ?? '') : (section['Path'] ?? '');
      return {
        id: `firefox:${path}`,
        browser,
        profile: section['Name'] ?? section['Path'] ?? '',
        tabs: sessionFile(path) !== undefined,
        family: 'firefox',
        path,
      };
    })
    .filter((profile) => existsSync(join(profile.path, 'places.sqlite')));
}

/** A Chromium-based browser's bookmarks: the bookmarks bar, other and mobile bookmarks. */
function readChromiumBookmarks(dir: string): ImportedBookmark[] {
  const data: unknown = JSON.parse(readFileSync(join(dir, 'Bookmarks'), 'utf8'));
  const roots = field(data, 'roots');
  return ['bookmark_bar', 'other', 'synced'].flatMap((name) => {
    const node = chromiumNode(field(roots, name));
    return node === undefined ? [] : [node];
  });
}

function chromiumNode(node: unknown): ImportedBookmark | undefined {
  const title = field(node, 'name');
  const url = field(node, 'url');
  const children = field(node, 'children');
  const name = typeof title === 'string' ? title : '';
  if (field(node, 'type') === 'url' && typeof url === 'string') {
    return bookmarkOf(name, url);
  }
  if (Array.isArray(children)) {
    return {
      title: name.slice(0, titleLimit),
      children: children.flatMap((child: unknown) => {
        const converted = chromiumNode(child);
        return converted === undefined ? [] : [converted];
      }),
    };
  }
  return undefined;
}

/**
 * A Chromium-based browser's history. Its times count microseconds since 1601, which is
 * more than a JavaScript number holds exactly, so SQLite converts them.
 */
function readChromiumHistory(db: DatabaseSync): ImportedVisit[] {
  return visits(
    db.prepare(
      `SELECT url, title, visit_count, last_visit_time / 1000 - 11644473600000 AS visited
       FROM urls WHERE hidden = 0 AND (url LIKE 'http://%' OR url LIKE 'https://%')
       ORDER BY last_visit_time DESC LIMIT ?`,
    ),
  );
}

/** A Firefox-based browser's history; its times count microseconds since 1970. */
function readFirefoxHistory(db: DatabaseSync): ImportedVisit[] {
  return visits(
    db.prepare(
      `SELECT url, title, visit_count, last_visit_date / 1000 AS visited FROM moz_places
       WHERE last_visit_date IS NOT NULL AND hidden = 0
         AND (url LIKE 'http://%' OR url LIKE 'https://%')
       ORDER BY last_visit_date DESC LIMIT ?`,
    ),
  );
}

function visits(query: StatementSync): ImportedVisit[] {
  return query
    .all(historyLimit)
    .filter((row) => String(row['url']).length <= urlLimit)
    .map((row) => ({
      url: String(row['url']),
      title: typeof row['title'] === 'string' ? row['title'].slice(0, titleLimit) : '',
      visitCount: Math.max(1, Number(row['visit_count'])),
      lastVisit: Math.max(0, Number(row['visited'])),
    }));
}

/** A Firefox-based browser's bookmarks, under its four root folders. */
function readFirefoxBookmarks(db: DatabaseSync, labels: ImportLabels): ImportedBookmark[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.type, b.parent, b.title, b.guid, p.url FROM moz_bookmarks b
       LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`,
    )
    .all();
  const children = new Map<number, typeof rows>();
  for (const row of rows) {
    const parent = Number(row['parent']);
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [row]);
    else list.push(row);
  }
  const build = (id: number, seen: Set<number>): ImportedBookmark[] =>
    (children.get(id) ?? []).flatMap((row): ImportedBookmark[] => {
      const rowId = Number(row['id']);
      const title = typeof row['title'] === 'string' ? row['title'] : '';
      const url = row['url'];
      if (Number(row['type']) === 1 && typeof url === 'string') {
        const bookmark = bookmarkOf(title, url);
        return bookmark === undefined ? [] : [bookmark];
      }
      if (Number(row['type']) === 2 && !seen.has(rowId)) {
        return [
          { title: title.slice(0, titleLimit), children: build(rowId, new Set([...seen, rowId])) },
        ];
      }
      return [];
    });
  const roots: [string, string][] = [
    ['toolbar_____', labels.toolbar],
    ['menu________', labels.menu],
    ['unfiled_____', labels.other],
    ['mobile______', labels.mobile],
  ];
  return roots.flatMap(([guid, title]) => {
    const root = rows.find((row) => row['guid'] === guid);
    return root === undefined
      ? []
      : [{ title, children: build(Number(root['id']), new Set([Number(root['id'])])) }];
  });
}

/** The newest session file of a Firefox-based browser's profile, if it has one. */
function sessionFile(dir: string): string | undefined {
  const candidates = [
    join(dir, 'sessionstore-backups', 'recovery.jsonlz4'),
    join(dir, 'sessionstore.jsonlz4'),
    join(dir, 'sessionstore-backups', 'previous.jsonlz4'),
  ].filter((path) => existsSync(path));
  return candidates.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** The open tabs of a Firefox-based browser, window by window. */
function readFirefoxTabs(dir: string): ImportedWindow[] {
  const file = sessionFile(dir);
  if (file === undefined) return [];
  const session: unknown = JSON.parse(decodeMozLz4(readFileSync(file)));
  const windows = field(session, 'windows');
  let budget = tabLimit;
  return (Array.isArray(windows) ? windows : []).flatMap((window: unknown): ImportedWindow[] => {
    const tabs = field(window, 'tabs');
    const selected = Number(field(window, 'selected') ?? 1) - 1;
    const kept: { url: string; title: string; index: number }[] = [];
    (Array.isArray(tabs) ? tabs : []).forEach((tab: unknown, index: number) => {
      const entries = field(tab, 'entries');
      const current: unknown = Array.isArray(entries)
        ? entries[Number(field(tab, 'index') ?? entries.length) - 1]
        : undefined;
      const url = field(current, 'url');
      const title = field(current, 'title');
      if (budget > 0 && typeof url === 'string' && webAddress.test(url) && url.length <= urlLimit) {
        kept.push({
          url,
          title: typeof title === 'string' ? title.slice(0, titleLimit) : '',
          index,
        });
        budget -= 1;
      }
    });
    if (kept.length === 0) return [];
    const active = Math.max(
      0,
      kept.findIndex((tab) => tab.index >= selected),
    );
    return [{ tabs: kept.map(({ url, title }) => ({ url, title })), active }];
  });
}

/** A field of a parsed JSON value, or `undefined`. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (Reflect.get(value, name) as unknown)
    : undefined;
}
