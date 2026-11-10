import { describe, expect, it } from 'vitest';
import { quarantine } from '../node/quarantine.ts';

describe('quarantine', () => {
  it('marks a download that has no mark as coming from the web', async () => {
    const calls: string[][] = [];
    const marked = await quarantine(
      '/Users/a/Downloads/tool.dmg',
      'Astela',
      Date.UTC(2026, 10, 9),
      (file, args) => {
        calls.push([file, ...args]);
        return Promise.resolve(args[0] === '-p' ? 1 : 0);
      },
    );
    expect(marked).toBe(true);
    expect(calls).toEqual([
      ['/usr/bin/xattr', '-p', 'com.apple.quarantine', '/Users/a/Downloads/tool.dmg'],
      [
        '/usr/bin/xattr',
        '-w',
        'com.apple.quarantine',
        `0081;${Math.floor(Date.UTC(2026, 10, 9) / 1000).toString(16)};Astela;`,
        '/Users/a/Downloads/tool.dmg',
      ],
    ]);
  });

  it('keeps the mark that a file has already, and tells when no mark could be set', async () => {
    const calls: string[][] = [];
    expect(
      await quarantine('/d/a.zip', 'Astela', 0, (file, args) => {
        calls.push([file, ...args]);
        return Promise.resolve(0);
      }),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await quarantine('/d/a.zip', 'Astela', 0, () => Promise.resolve(null))).toBe(false);
  });
});
