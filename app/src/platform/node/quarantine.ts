import { execFile } from 'node:child_process';

/** Runs a program and tells its exit code, or `null` when it could not run. */
export type ProgramRunner = (file: string, args: readonly string[]) => Promise<number | null>;

const runProgram: ProgramRunner = (file, args) =>
  new Promise((done) => {
    execFile(file, [...args], { timeout: 5000 }, (error) => {
      done(error === null ? 0 : typeof error.code === 'number' ? error.code : null);
    });
  });

/** The program of macOS that reads and writes the extended attributes of files. */
const xattr = '/usr/bin/xattr';

/** The attribute that marks a file as coming from the internet. */
const attribute = 'com.apple.quarantine';

/**
 * Marks a downloaded file as coming from the internet, as other browsers on macOS do, so
 * Gatekeeper checks it before it opens. A file that has the mark already keeps its own.
 * @param path - The downloaded file.
 * @param agent - The name of the browser, which macOS shows when it asks about the file.
 * @param now - The current time, in milliseconds since the epoch.
 * @param run - Runs a program; Node.js by default.
 * @returns Whether the file has the mark now.
 */
export async function quarantine(
  path: string,
  agent: string,
  now: number,
  run: ProgramRunner = runProgram,
): Promise<boolean> {
  if ((await run(xattr, ['-p', attribute, path])) === 0) return true;
  // The flags of a download from the web, then the time in seconds, in hexadecimal.
  const value = `0081;${Math.floor(now / 1000).toString(16)};${agent};`;
  return (await run(xattr, ['-w', attribute, value, path])) === 0;
}
