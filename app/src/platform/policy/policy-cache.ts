import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RawPolicyValue } from '../../domain/policy/policy.ts';
import type { PolicyCache } from '../../domain/policy/policy-service.ts';

/** Keeps the last successfully read policy values in a JSON file. */
export class JsonFilePolicyCache implements PolicyCache {
  private readonly path: string;

  /** @param path - Cache file, inside the profile directory. */
  constructor(path: string) {
    this.path = path;
  }

  read(): readonly RawPolicyValue[] | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return Array.isArray(parsed) && parsed.every(isRawPolicyValue) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  write(values: readonly RawPolicyValue[]): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(values));
    } catch {
      // The cache is an optimization; failing to write it must not break startup.
    }
  }
}

function isRawPolicyValue(value: unknown): value is RawPolicyValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Partial<Record<keyof RawPolicyValue, unknown>>;
  return (
    typeof item.name === 'string' &&
    typeof item.source === 'string' &&
    (item.level === 'mandatory' || item.level === 'recommended') &&
    (item.scope === 'machine' || item.scope === 'user')
  );
}
