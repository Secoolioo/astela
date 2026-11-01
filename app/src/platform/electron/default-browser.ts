import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import { brand } from '../../shared/brand.ts';
import { userChoiceProgId } from '../../domain/default-browser/default-browser.ts';

/** What making the browser the default did: done, or the system settings opened to finish. */
export type DefaultBrowserOutcome = 'done' | 'settings' | 'failed';

/** The program id that the Windows installer registers for web links. */
const windowsProgId = `${brand.productName}URL`;

/**
 * Whether the system opens web links with this browser. On Windows, the user's choice in
 * the system settings decides; elsewhere, the registered handler of http and https links.
 */
export async function isDefaultBrowser(): Promise<boolean> {
  if (process.platform === 'win32') {
    const output = await new Promise<string>((done) => {
      execFile(
        'reg',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
          '/v',
          'ProgId',
        ],
        { windowsHide: true, timeout: 10_000 },
        (_error, stdout) => done(stdout),
      );
    });
    return userChoiceProgId(output) === windowsProgId;
  }
  return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http');
}

/**
 * Makes the browser the default browser. macOS asks the user to confirm; Windows lets only
 * the user choose, so its settings open on the page of this browser, which the installer
 * registered.
 */
export async function makeDefaultBrowser(): Promise<DefaultBrowserOutcome> {
  if (process.platform === 'win32') {
    try {
      await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${brand.productName}`);
      return 'settings';
    } catch {
      return 'failed';
    }
  }
  const http = app.setAsDefaultProtocolClient('http');
  const https = app.setAsDefaultProtocolClient('https');
  return http && https ? 'done' : 'failed';
}
