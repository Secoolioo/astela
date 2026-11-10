import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

const app = resolve(import.meta.dirname, '../../app');

/** The parts of the packaging configuration that the tests read. */
interface PackagingConfig {
  readonly mac: {
    readonly entitlements: string;
    readonly extendInfo: Readonly<Record<string, string>>;
  };
}

describe('packaging configuration', () => {
  it('lets macOS give sites the devices and the location they can ask for', async () => {
    const module: unknown = await import(
      pathToFileURL(resolve(app, 'electron-builder.config.mjs')).href
    );
    const config = (module as { default: PackagingConfig }).default;
    for (const key of [
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSLocationUsageDescription',
      'NSLocationWhenInUseUsageDescription',
    ]) {
      assert.ok((config.mac.extendInfo[key] ?? '').length > 0, `${key} is missing`);
    }
    // Under the hardened runtime, macOS refuses what the entitlements do not name.
    const entitlements = readFileSync(resolve(app, config.mac.entitlements), 'utf8');
    for (const key of [
      'com.apple.security.device.camera',
      'com.apple.security.device.audio-input',
      'com.apple.security.personal-information.location',
    ]) {
      assert.ok(entitlements.includes(`<key>${key}</key>`), `${key} is missing`);
    }
  });
});
