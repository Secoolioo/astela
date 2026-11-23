import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { open, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The mode of the browser's own files in the profile: only the user may read them, as
 * Chromium makes its files next to them. The umask stays as it is, so downloads and the files
 * that people save get the modes they always get.
 */
export const privateFileMode = 0o600;

/** The mode of the browser's own folders in the profile, which only the user may enter. */
export const privateFolderMode = 0o700;

/**
 * Writes a file so that readers see either the old or the new content, never a partial
 * file: the data goes to a temporary file, is flushed to disk and then renamed over the
 * target. The new file has the mode, also when an older one had another; a folder that it
 * makes is the user's alone.
 * @param path - Target file.
 * @param data - New content.
 * @param mode - The mode of the file before the umask: by default only the user may read it;
 *   `0o666` for a file that a person saves, such as exported settings, as for a download.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode: number = privateFileMode,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: privateFolderMode });
  const temp = `${path}.${process.pid}.tmp`;
  const handle = await open(temp, 'w', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
}

/**
 * Synchronous variant of {@link writeFileAtomic}, for shutdown and startup paths.
 * @param path - Target file.
 * @param data - New content.
 * @param mode - The mode of the file before the umask: by default only the user may read it;
 *   `0o666` for a file that the caller names and reads, such as the report of the self-test.
 */
export function writeFileAtomicSync(
  path: string,
  data: string | Uint8Array,
  mode: number = privateFileMode,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: privateFolderMode });
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, 'w', mode);
  try {
    writeSync(fd, typeof data === 'string' ? Buffer.from(data) : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}
