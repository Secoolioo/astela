import { readFileSync } from 'node:fs';

/**
 * The Chromium feature that blocks third-party cookies in the network service: in requests
 * and responses, for the scripts of every frame, also of frames without an address of their
 * own, and for workers. Chromium reads it once, as it starts.
 */
export const thirdPartyCookieFeature = 'ForceThirdPartyCookieBlockingEnabled';

/** The values that decide the setting before the settings service has loaded. */
export interface CookieBlockingSources {
  /** Path of `settings.json`; a file that cannot be read holds no value of the user. */
  readonly settingsFile: string;
  /** The key of the setting in the file. */
  readonly key: string;
  /** The value of a mandatory policy, if one is set. */
  readonly mandatory: unknown;
  /** The value of a recommended policy, if one is set. */
  readonly recommended: unknown;
  /** The default of the setting. */
  readonly fallback: boolean;
}

/**
 * Whether third-party cookies are blocked at this start, before the settings service has
 * loaded, in its order: a mandatory policy, the user's value, a recommended policy, the
 * default. Values that are no boolean count as not set, as the settings service rejects them.
 * @param sources - Where the value comes from.
 */
export function cookiesBlockedAtStart(sources: CookieBlockingSources): boolean {
  if (typeof sources.mandatory === 'boolean') return sources.mandatory;
  const user = userValue(sources.settingsFile, sources.key);
  if (typeof user === 'boolean') return user;
  if (typeof sources.recommended === 'boolean') return sources.recommended;
  return sources.fallback;
}

/** The value that `settings.json` holds for a setting of the user, if any. */
function userValue(file: string, key: string): unknown {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const user: unknown = Reflect.get(parsed, 'user');
    return typeof user === 'object' && user !== null ? Reflect.get(user, key) : undefined;
  } catch {
    return undefined;
  }
}

/** The part of Electron's command line that features are added to. */
export interface FeatureSwitches {
  /** The value of a switch, or an empty string. */
  getSwitchValue(name: string): string;
  /** Adds a switch; Chromium reads the last value of a switch. */
  appendSwitch(name: string, value?: string): void;
}

/**
 * Enables a Chromium feature, together with those that the command line already enables.
 * @param commandLine - The command line of the browser process, before Chromium starts.
 * @param feature - The name of the feature.
 */
export function enableFeature(commandLine: FeatureSwitches, feature: string): void {
  const features = commandLine
    .getSwitchValue('enable-features')
    .split(',')
    .filter((name) => name !== '');
  if (features.includes(feature)) return;
  commandLine.appendSwitch('enable-features', [...features, feature].join(','));
}
