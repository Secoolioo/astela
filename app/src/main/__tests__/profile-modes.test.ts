import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keepOlderFilesPrivate } from '../profile-modes.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A profile folder as an older version left it, whose files and folders others may read. */
function olderProfile(): string {
  const profile = mkdtempSync(join(tmpdir(), 'profile-modes-'));
  dirs.push(profile);
  const files = {
    'settings.json': 0o644,
    'session.json': 0o644,
    'session.json.bak': 0o640,
    'policy-cache.json': 0o664,
    'update-state.json': 0o644,
    'logs/main.log': 0o644,
    'logs/main.1.log': 0o644,
    'logs/main.2.log': 0o644,
    'newtab/background-0123456789abcdef.png': 0o644,
    // Chromium's and those of other programs are not the browser's to change.
    Preferences: 0o644,
    'notes.txt': 0o644,
  };
  for (const folder of ['logs', 'newtab']) mkdirSync(join(profile, folder), { mode: 0o755 });
  for (const [name, mode] of Object.entries(files)) {
    writeFileSync(join(profile, name), '{}');
    chmodSync(join(profile, name), mode);
  }
  for (const folder of ['logs', 'newtab']) chmodSync(join(profile, folder), 0o755);
  return profile;
}

const modeOf = (path: string): number => statSync(path).mode & 0o777;

describe.runIf(process.platform !== 'win32')('keepOlderFilesPrivate', () => {
  it('takes the rights of others from the files and folders of the browser', async () => {
    const profile = olderProfile();
    await keepOlderFilesPrivate(profile);
    const names = [
      'settings.json',
      'session.json',
      'session.json.bak',
      'policy-cache.json',
      'update-state.json',
      'logs',
      'logs/main.log',
      'logs/main.1.log',
      'logs/main.2.log',
      'newtab',
      'newtab/background-0123456789abcdef.png',
      'Preferences',
      'notes.txt',
    ];
    expect(Object.fromEntries(names.map((name) => [name, modeOf(join(profile, name))]))).toEqual({
      'settings.json': 0o600,
      'session.json': 0o600,
      'session.json.bak': 0o600,
      'policy-cache.json': 0o600,
      'update-state.json': 0o600,
      logs: 0o700,
      'logs/main.log': 0o600,
      'logs/main.1.log': 0o600,
      'logs/main.2.log': 0o600,
      newtab: 0o700,
      'newtab/background-0123456789abcdef.png': 0o600,
      Preferences: 0o644,
      'notes.txt': 0o644,
    });
  });

  it('keeps the rights of the user and leaves links and missing files alone', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'profile-modes-'));
    dirs.push(profile);
    const outside = mkdtempSync(join(tmpdir(), 'profile-modes-outside-'));
    dirs.push(outside);
    // A file that the user made read-only stays read-only.
    writeFileSync(join(profile, 'settings.json'), '{}');
    chmodSync(join(profile, 'settings.json'), 0o444);
    // A link does not lend its target the mode.
    writeFileSync(join(outside, 'shared.json'), '{}');
    chmodSync(join(outside, 'shared.json'), 0o644);
    symlinkSync(join(outside, 'shared.json'), join(profile, 'session.json'));
    await expect(keepOlderFilesPrivate(profile)).resolves.toBeUndefined();
    expect([modeOf(join(profile, 'settings.json')), modeOf(join(outside, 'shared.json'))]).toEqual([
      0o400, 0o644,
    ]);
  });
});
