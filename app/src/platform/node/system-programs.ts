import { win32 } from 'node:path';

/**
 * The full path of a program of Windows in the system folder. Windows looks for a program
 * that is named without a path in the working directory first, and the browser can run in a
 * folder where web pages save files, such as the downloads folder.
 * @param name - The program, such as `reg`.
 */
export function windowsProgram(name: string): string {
  return win32.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', `${name}.exe`);
}
