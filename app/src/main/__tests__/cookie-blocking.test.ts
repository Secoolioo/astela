import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cookiesBlockedAtStart, enableFeature } from '../cookie-blocking.ts';

const folders: string[] = [];

/** A `settings.json` with the given content, or a path without a file for `undefined`. */
function settingsFile(content?: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'cookie-blocking-'));
  folders.push(folder);
  const file = join(folder, 'settings.json');
  if (content !== undefined) writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('cookiesBlockedAtStart', () => {
  const key = 'privacy.blockThirdPartyCookies';
  const off = JSON.stringify({ user: { [key]: false } });

  it('follows the order of the settings: mandatory policy, user, recommended, default', () => {
    const base = { key, mandatory: undefined, recommended: undefined, fallback: true };
    expect(cookiesBlockedAtStart({ ...base, settingsFile: settingsFile() })).toBe(true);
    expect(cookiesBlockedAtStart({ ...base, settingsFile: settingsFile(off) })).toBe(false);
    expect(
      cookiesBlockedAtStart({ ...base, settingsFile: settingsFile(off), mandatory: true }),
    ).toBe(true);
    expect(
      cookiesBlockedAtStart({ ...base, settingsFile: settingsFile(), recommended: false }),
    ).toBe(false);
    expect(
      cookiesBlockedAtStart({ ...base, settingsFile: settingsFile(off), recommended: true }),
    ).toBe(false);
  });

  it('ignores files and values that are not valid, as the settings do', () => {
    const base = { key, mandatory: 'no', recommended: 1, fallback: true };
    for (const content of ['{', '[]', 'null', JSON.stringify({ user: { [key]: 'off' } })]) {
      expect(cookiesBlockedAtStart({ ...base, settingsFile: settingsFile(content) })).toBe(true);
    }
  });
});

describe('enableFeature', () => {
  it('adds a feature to those that the command line enables, once', () => {
    const switches = new Map<string, string>([['enable-features', 'Alpha,Beta']]);
    const commandLine = {
      getSwitchValue: (name: string) => switches.get(name) ?? '',
      appendSwitch: (name: string, value = '') => void switches.set(name, value),
    };
    enableFeature(commandLine, 'Gamma');
    expect(switches.get('enable-features')).toBe('Alpha,Beta,Gamma');
    enableFeature(commandLine, 'Gamma');
    expect(switches.get('enable-features')).toBe('Alpha,Beta,Gamma');
    switches.clear();
    enableFeature(commandLine, 'Gamma');
    expect(switches.get('enable-features')).toBe('Gamma');
  });
});
