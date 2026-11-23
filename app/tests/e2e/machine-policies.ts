import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const brand = JSON.parse(readFileSync(new URL('../../../brand.json', import.meta.url), 'utf8')) as {
  readonly slug: string;
};

/** The folders of the mandatory policies of Linux, from the outermost one. */
const folders = [
  `/etc/${brand.slug}`,
  `/etc/${brand.slug}/policies`,
  `/etc/${brand.slug}/policies/managed`,
];

/** Runs a command as the administrator, who may change policies of the system. */
function asAdministrator(command: string, args: readonly string[], input?: string): void {
  const root = process.getuid?.() === 0;
  execFileSync(root ? command : 'sudo', root ? [...args] : ['-n', command, ...args], {
    input,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

/**
 * Mandatory policies of the machine in one file of the policy folder of Linux, as an
 * administrator writes them, also those that only the machine may set. A test that uses them
 * runs only on a CI runner, which is thrown away, and removes them again with {@link remove}.
 */
export class MachinePolicies {
  private readonly file: string;
  /** The folders that the policies made, which go with them. */
  private readonly made: string[] = [];

  /** @param name - The name of the file, without `.json`. */
  constructor(name: string) {
    this.file = `${folders.at(-1) ?? ''}/${name}.json`;
  }

  /** Writes the file with these values, in place of the earlier ones. */
  set(values: Readonly<Record<string, unknown>>): void {
    for (const folder of folders) {
      if (!existsSync(folder)) {
        asAdministrator('mkdir', [folder]);
        this.made.push(folder);
      }
    }
    asAdministrator('tee', [this.file], `${JSON.stringify(values)}\n`);
  }

  /** Removes the file and the folders that it needed. */
  remove(): void {
    try {
      asAdministrator('rm', ['-f', this.file]);
      for (const folder of this.made.toReversed()) asAdministrator('rmdir', [folder]);
      this.made.length = 0;
    } catch {
      // Another file of policies keeps a folder.
    }
  }
}
