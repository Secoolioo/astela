import type { WebContents } from 'electron';

/** How long a choice of "Save … as" waits for its download, in milliseconds. */
const waitMs = 60_000;

/** The addresses that people chose to save from a context menu, until their download starts. */
const chosen = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Downloads the file of an address that people chose to save from the context menu, such as an
 * image or a video; its download asks where to save it, also while the settings save downloads
 * without a question (`web-requests.ts`).
 * @param contents - The page whose menu it was, whose session downloads the file.
 * @param url - The address of the file.
 */
export function saveAs(contents: WebContents, url: string): void {
  clearTimeout(chosen.get(url));
  const timer = setTimeout(() => chosen.delete(url), waitMs);
  timer.unref();
  chosen.set(url, timer);
  contents.downloadURL(url);
}

/**
 * Whether a download comes from a choice of "Save … as", which counts once.
 * @param url - The first address of the download, before any redirect.
 */
export function chosenToSave(url: string | undefined): boolean {
  const timer = url === undefined ? undefined : chosen.get(url);
  if (url === undefined || timer === undefined) return false;
  clearTimeout(timer);
  chosen.delete(url);
  return true;
}
