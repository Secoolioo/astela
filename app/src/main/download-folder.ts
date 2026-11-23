import { hostname, userInfo } from 'node:os';

/**
 * The folder where downloads are saved, with the variables of Chrome's download folder that
 * every system knows replaced, as Chromium on Linux replaces them: `${user_name}`, the name of
 * the user's account, and `${machine_name}`, the name of the computer. The setting keeps them,
 * as the policy `DownloadDirectory` gives them and its schema allows no other; the browser
 * replaces them where it saves a download, opens the folder or shows it, so that its start
 * carries none of this.
 * @param folder - The folder of the setting, or that of the system.
 */
export function expandFolder(folder: string): string {
  if (!folder.includes('${')) return folder;
  let user: string;
  try {
    user = userInfo().username;
  } catch {
    // The user has no entry in the system's list of users.
    user = process.env['USER'] ?? process.env['USERNAME'] ?? '';
  }
  return folder.replaceAll('${user_name}', user).replaceAll('${machine_name}', hostname());
}
