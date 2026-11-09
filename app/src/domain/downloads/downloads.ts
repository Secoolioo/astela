/** Where a download stands. */
export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

/** A download as the list keeps it. */
export interface DownloadEntry {
  readonly id: number;
  /** The address it came from. */
  readonly url: string;
  /** The file it is saved to. */
  readonly path: string;
  /** Its size in bytes, or 0 while the site has not said. */
  readonly total: number;
  /** The bytes received so far. */
  readonly received: number;
  readonly state: DownloadState;
  /** When it started, in milliseconds since 1970. */
  readonly started: number;
}

/** A file name and its extension, which stays at the end when a number goes in between. */
const parts = /^(.+?)((?:\.tar)?\.[^.\s]{1,16})?$/i;

/**
 * A name that is free in a folder: the name itself, or the name with a number before its
 * extension, as other browsers write it, such as `report (1).pdf`.
 * @param name - The name that the site suggests.
 * @param taken - Whether a name is taken in the folder.
 */
export function freeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const [, base = name, extension = ''] = parts.exec(name) ?? [];
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = `${base} (${n})${extension}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${extension}`;
}

/**
 * How much of a download is done, from 0 to 1, or nothing while its size is unknown.
 * @param entry - The download.
 */
export function progressOf(entry: Pick<DownloadEntry, 'received' | 'total'>): number | undefined {
  return entry.total > 0 ? Math.min(1, entry.received / entry.total) : undefined;
}
