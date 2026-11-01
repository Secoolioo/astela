import type { BrowserImporter } from '../import/browser-import.ts';
import type { ProfileDatabase } from './profile-db.ts';

/** The calls that the profile database answers. */
export type DatabaseApi = Pick<
  ProfileDatabase,
  | 'addVisit'
  | 'setTitle'
  | 'history'
  | 'deleteHistory'
  | 'clearHistory'
  | 'importHistory'
  | 'bookmarks'
  | 'bookmarkList'
  | 'bookmarkUrls'
  | 'addBookmark'
  | 'updateBookmark'
  | 'removeBookmark'
  | 'removeBookmarkUrl'
  | 'importBookmarks'
>;

/** The calls that the import from other browsers answers. */
export type ImportApi = Pick<BrowserImporter, 'findBrowsers' | 'importBrowser'>;

/** The calls that the data service answers. */
export type DataApi = DatabaseApi & ImportApi;

/** Names of the calls. */
export type DataMethod = keyof DataApi;

const databaseMethods: readonly string[] = [
  'addVisit',
  'setTitle',
  'history',
  'deleteHistory',
  'clearHistory',
  'importHistory',
  'bookmarks',
  'bookmarkList',
  'bookmarkUrls',
  'addBookmark',
  'updateBookmark',
  'removeBookmark',
  'removeBookmarkUrl',
  'importBookmarks',
] satisfies readonly (keyof DatabaseApi)[];

const importMethods: readonly string[] = [
  'findBrowsers',
  'importBrowser',
] satisfies readonly (keyof ImportApi)[];

/** A call from the browser process. */
export interface DataRequest {
  readonly id: number;
  readonly method: DataMethod;
  readonly params: readonly unknown[];
}

/** The answer of the data service. */
export interface DataResponse {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * Answers a call with the database or the import. Unknown methods and failures become
 * errors in the answer, so the service never stops on a bad call.
 * @param db - The database.
 * @param importer - The import from other browsers.
 * @param request - The call.
 */
export function answer(db: DatabaseApi, importer: ImportApi, request: DataRequest): DataResponse {
  const target = importMethods.includes(request.method)
    ? importer
    : databaseMethods.includes(request.method)
      ? db
      : undefined;
  const method: unknown = target === undefined ? undefined : Reflect.get(target, request.method);
  if (typeof method !== 'function') {
    return { id: request.id, error: `Unknown method ${request.method}` };
  }
  try {
    const result: unknown = Reflect.apply(method, target, [...request.params]);
    return { id: request.id, result };
  } catch (error) {
    return { id: request.id, error: String(error) };
  }
}
