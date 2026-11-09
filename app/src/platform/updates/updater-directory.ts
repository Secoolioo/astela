import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The per-user folder for update state, next to electron-updater's cache. It belongs to the
 * installation, not to a profile.
 * @param slug - Product slug.
 * @param env - Environment variables.
 * @param platform - The operating system.
 */
export function updaterDirectory(
  slug: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string {
  const base =
    platform === 'win32'
      ? (env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'))
      : platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches')
        : (env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'));
  return join(base, `${slug}-updater`);
}
