import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The browser's own files in the profile, next to the files of Chromium: the settings, the
 * session with its backup and the marker of a running browser, the policy cache and the state
 * of the update feed. The data service keeps `profile.db` and its copies (`ProfileDatabase`).
 */
const ownFiles = [
  'settings.json',
  'settings.rejected.json',
  'session.json',
  'session.json.bak',
  'session.json.running',
  'policy-cache.json',
  'update-state.json',
];

/**
 * The browser's own folders in the profile, which hold only its own files: the logs and the
 * background of the new tab page.
 */
const ownFolders = ['logs', 'newtab'];

/**
 * Takes the rights of others from the browser's own files and folders in the profile that an
 * older version left readable for them, such as the rotated logs, the background of the new
 * tab page and the settings until their next change. The browser makes new files with the
 * modes of `atomic-file.ts`, but a mode applies only to a file that is new, and older versions
 * made theirs with the modes of the umask. The rights of the user stay as they are, a file
 * whose rights are right is not touched, and links and missing files are skipped.
 * Nothing needs it before the first window, so it runs once that window has loaded. Windows
 * keeps the rights of files apart from their modes.
 * @param profile - The profile folder.
 */
export async function keepOlderFilesPrivate(profile: string): Promise<void> {
  if (process.platform === 'win32') return;
  const folders = ownFolders.map((name) => join(profile, name));
  const inFolders = await Promise.all(
    folders.map((folder) =>
      readdir(folder).then(
        (names) => names.map((name) => join(folder, name)),
        () => [],
      ),
    ),
  );
  await Promise.all(
    [...ownFiles.map((name) => join(profile, name)), ...folders, ...inFolders.flat()].map(
      keepPrivate,
    ),
  );
}

/**
 * Takes the rights of the group and of others from a file or folder.
 * @param path - The file or folder.
 */
async function keepPrivate(path: string): Promise<void> {
  try {
    const file = await lstat(path);
    if (!file.isSymbolicLink() && (file.mode & 0o077) !== 0) await chmod(path, file.mode & 0o700);
  } catch {
    // A file that is missing or that another program holds keeps its mode until the next start.
  }
}
