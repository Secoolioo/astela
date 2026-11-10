import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type {
  PolicyProvider,
  PolicyReadError,
  PolicyReadResult,
  PolicyScope,
  RawPolicyValue,
} from '../../domain/policy/policy.ts';
import type * as RegistryExport from './registry-export.ts';
import { windowsProgram } from '../node/system-programs.ts';

/** The converter of macOS for property lists, by its full path. */
const plutil = '/usr/bin/plutil';

/** The outcome of a program that a policy provider ran. */
export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
}

/** System access used by the policy providers; replaced by fakes in tests. */
export interface PolicyIo {
  /** Runs a program without blocking. Never rejects. */
  runAsync(command: string, args: readonly string[]): Promise<RunResult>;
  /** Reads a file, or returns `undefined` if it does not exist. */
  readFile(path: string): Uint8Array | undefined;
  /** Lists a directory, or returns `undefined` if it does not exist. */
  listDir(path: string): string[] | undefined;
  /** Returns a path for a temporary file. */
  tempFile(name: string): string;
  /** Deletes a file if it exists. */
  remove(path: string): void;
}

/** {@link PolicyIo} backed by Node.js. */
export const nodePolicyIo: PolicyIo = {
  runAsync(command, args) {
    return new Promise((done) => {
      execFile(
        command,
        [...args],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 },
        (error, stdout) => {
          const code = typeof error?.code === 'number' ? error.code : null;
          done({ status: error === null ? 0 : code, stdout });
        },
      );
    });
  },
  readFile(path) {
    try {
      return readFileSync(path);
    } catch {
      return undefined;
    }
  },
  listDir(path) {
    try {
      return readdirSync(path);
    } catch {
      return undefined;
    }
  },
  tempFile(name) {
    return join(tmpdir(), `${process.pid}-${name}`);
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

const hives: readonly [string, PolicyScope][] = [
  ['HKLM', 'machine'],
  ['HKCU', 'user'],
];

/**
 * Reads policies from `HKLM` and `HKCU` with `reg export`, which needs no native module.
 * The export is UTF-16LE, so non-ASCII values survive.
 */
export class WindowsRegistryPolicyProvider implements PolicyProvider {
  readonly name = 'windows-registry';
  private readonly io: PolicyIo;
  private readonly root: string;

  /**
   * @param io - System access.
   * @param root - Policy key below the hive, such as `SOFTWARE\Policies\Astela`.
   */
  constructor(io: PolicyIo, root: string) {
    this.io = io;
    this.root = root;
  }

  /**
   * Exports both hives at the same time instead of one after the other. The parser of
   * registry exports loads with the first read, so other systems never load it.
   */
  async load(): Promise<PolicyReadResult> {
    const parser = await import('./registry-export.ts');
    return combine(
      await Promise.all(
        hives.map(async ([hive, scope]) => {
          const file = this.io.tempFile(`policies-${hive}.reg`);
          try {
            const run = await this.io.runAsync(windowsProgram('reg'), this.exportArgs(hive, file));
            return this.read(parser, hive, scope, file, run);
          } finally {
            this.io.remove(file);
          }
        }),
      ),
    );
  }

  private exportArgs(hive: string, file: string): string[] {
    return ['export', `${hive}\\${this.root}`, file, '/y'];
  }

  private read(
    parser: typeof RegistryExport,
    hive: string,
    scope: PolicyScope,
    file: string,
    run: RunResult,
  ): PolicyReadResult {
    // Exit code 1 means that the key does not exist, which is the normal case.
    if (run.status !== 0) {
      return { values: [], errors: [] };
    }
    const bytes = this.io.readFile(file);
    if (bytes === undefined) {
      return {
        values: [],
        errors: [{ source: hive, message: 'The registry export was not written' }],
      };
    }
    const text = new TextDecoder('utf-16le').decode(bytes);
    return parser.registryPolicies(parser.parseRegistryExport(text), this.root, scope);
  }
}

/** Joins the results of several reads in order. */
function combine(results: readonly PolicyReadResult[]): PolicyReadResult {
  return {
    values: results.flatMap((result) => result.values),
    errors: results.flatMap((result) => result.errors),
  };
}

/**
 * Reads managed preferences that configuration profiles (MDM) install for the bundle ID.
 * Values in these files are enforced, so they are mandatory policies.
 */
export class MacManagedPreferencesPolicyProvider implements PolicyProvider {
  readonly name = 'macos-managed-preferences';
  private readonly io: PolicyIo;
  private readonly bundleId: string;
  private readonly userName: string;

  /**
   * @param io - System access.
   * @param bundleId - The app's bundle ID.
   * @param userName - Name of the current user, for user-level profiles.
   */
  constructor(io: PolicyIo, bundleId: string, userName: string) {
    this.io = io;
    this.bundleId = bundleId;
    this.userName = userName;
  }

  /**
   * Converts both files at the same time. The parser of property lists loads with the first
   * file, so other systems never load it.
   */
  async load(): Promise<PolicyReadResult> {
    const files = this.files();
    if (files.length === 0) return { values: [], errors: [] };
    const { parsePlist } = await import('./plist.ts');
    return combine(
      await Promise.all(
        files.map(async ([path, scope]) =>
          this.read(parsePlist, path, scope, await this.io.runAsync(plutil, plutilArgs(path))),
        ),
      ),
    );
  }

  /** The profiles that exist, so that missing ones cost no process start. */
  private files(): [string, PolicyScope][] {
    const files: [string, PolicyScope][] = [
      [`/Library/Managed Preferences/${this.bundleId}.plist`, 'machine'],
      [`/Library/Managed Preferences/${this.userName}/${this.bundleId}.plist`, 'user'],
    ];
    return files.filter(([path]) => this.io.readFile(path) !== undefined);
  }

  private read(
    parsePlist: (xml: string) => unknown,
    path: string,
    scope: PolicyScope,
    run: RunResult,
  ): PolicyReadResult {
    if (run.status !== 0) {
      return { values: [], errors: [{ source: path, message: 'plutil could not read the file' }] };
    }
    try {
      const root = parsePlist(run.stdout);
      if (
        typeof root !== 'object' ||
        root === null ||
        Array.isArray(root) ||
        root instanceof Date ||
        root instanceof Uint8Array
      ) {
        return {
          values: [],
          errors: [{ source: path, message: 'The property list is not a dictionary' }],
        };
      }
      return {
        values: Object.entries(root).map(([name, value]) => ({
          name,
          value,
          level: 'mandatory',
          scope,
          source: path,
        })),
        errors: [],
      };
    } catch (error) {
      return { values: [], errors: [{ source: path, message: String(error) }] };
    }
  }
}

/** XML instead of JSON, because `<date>` and `<data>` values cannot be converted to JSON. */
function plutilArgs(path: string): string[] {
  return ['-convert', 'xml1', '-o', '-', path];
}

/**
 * Reads JSON files from `<dir>/managed` (mandatory) and `<dir>/recommended`. Files are
 * applied in alphabetical order; a later file overrides an earlier one.
 */
export class LinuxJsonPolicyProvider implements PolicyProvider {
  readonly name = 'linux-json';
  private readonly io: PolicyIo;
  private readonly directory: string;

  /**
   * @param io - System access.
   * @param directory - Policy directory, such as `/etc/astela/policies`.
   */
  constructor(io: PolicyIo, directory: string) {
    this.io = io;
    this.directory = directory;
  }

  load(): Promise<PolicyReadResult> {
    return Promise.resolve(this.read());
  }

  private read(): PolicyReadResult {
    const values: RawPolicyValue[] = [];
    const errors: PolicyReadError[] = [];
    for (const [folder, level] of [
      ['managed', 'mandatory'],
      ['recommended', 'recommended'],
    ] as const) {
      // Linux paths, also when the tests run on Windows.
      const dir = posix.join(this.directory, folder);
      const merged = new Map<string, RawPolicyValue>();
      for (const file of (this.io.listDir(dir) ?? [])
        .filter((f) => f.endsWith('.json'))
        .toSorted()) {
        const path = posix.join(dir, file);
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(this.io.readFile(path)));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            errors.push({ source: path, message: 'Expected a JSON object' });
            continue;
          }
          for (const [name, value] of Object.entries(parsed)) {
            merged.set(name, { name, value, level, scope: 'machine', source: path });
          }
        } catch (error) {
          errors.push({ source: path, message: `Invalid JSON: ${String(error)}` });
        }
      }
      values.push(...merged.values());
    }
    return { values, errors };
  }
}
