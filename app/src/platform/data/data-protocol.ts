import type { ProfileDatabase } from './profile-db.ts';

/** The calls that the data service answers: the methods of the profile database. */
export type DataApi = Pick<
  ProfileDatabase,
  | 'addVisit'
  | 'setTitle'
  | 'history'
  | 'deleteHistory'
  | 'clearHistory'
  | 'importHistory'
  | 'bookmarks'
  | 'addBookmark'
  | 'removeBookmark'
  | 'importBookmarks'
>;

/** Names of the calls. */
export type DataMethod = keyof DataApi;

/** Every call, for the service to check names against. */
export const dataMethods: readonly DataMethod[] = [
  'addVisit',
  'setTitle',
  'history',
  'deleteHistory',
  'clearHistory',
  'importHistory',
  'bookmarks',
  'addBookmark',
  'removeBookmark',
  'importBookmarks',
];

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
 * Answers a call with the database. Unknown methods and failures become errors in the
 * answer, so the service never stops on a bad call.
 * @param db - The database.
 * @param request - The call.
 */
export function answer(db: DataApi, request: DataRequest): DataResponse {
  if (!dataMethods.includes(request.method)) {
    return { id: request.id, error: `Unknown method ${request.method}` };
  }
  try {
    const result: unknown = Reflect.apply(db[request.method], db, [...request.params]);
    return { id: request.id, result };
  } catch (error) {
    return { id: request.id, error: String(error) };
  }
}
