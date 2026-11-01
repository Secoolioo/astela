import { existsSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Clock } from '../../kernel/time/clock.ts';
import type { Disposable } from '../../shared/disposable.ts';
import type { SessionSnapshot } from '../../domain/session/session.ts';
import { writeFileAtomic } from './atomic-file.ts';

/**
 * Keeps the session in `session.json`: written atomically, at most once per second while
 * tabs change, and at once when the browser quits. The previous file stays as
 * `session.json.bak`, which is read when the current file is broken.
 */
export class JsonFileSessionStore implements Disposable {
  private readonly path: string;
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private pending: SessionSnapshot | undefined;
  private timer: Disposable | undefined;
  private writing: Promise<void> = Promise.resolve();

  /**
   * @param path - Path of `session.json`.
   * @param clock - Schedules the writes.
   * @param debounceMs - Delay before a write.
   */
  constructor(path: string, clock: Clock, debounceMs = 1000) {
    this.path = path;
    this.clock = clock;
    this.debounceMs = debounceMs;
  }

  /** Reads the stored session, or the backup when the file is broken; `undefined` if none. */
  async read(): Promise<unknown> {
    for (const file of [this.path, `${this.path}.bak`]) {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as unknown;
      } catch {
        // Missing or broken: try the backup.
      }
    }
    return undefined;
  }

  /**
   * Stores a session after the delay; a newer session replaces a pending one.
   * @param session - The tabs of the open windows.
   */
  schedule(session: SessionSnapshot): void {
    this.pending = session;
    this.timer ??= this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  /** Writes a pending session now, for example while the browser quits. */
  flush(): Promise<void> {
    this.timer?.dispose();
    this.timer = undefined;
    const session = this.pending;
    this.pending = undefined;
    if (session !== undefined) {
      this.writing = this.writing.then(() => this.write(session)).catch(() => undefined);
    }
    return this.writing;
  }

  /** Cancels a scheduled write. Call {@link JsonFileSessionStore.flush} first. */
  dispose(): void {
    this.timer?.dispose();
  }

  private async write(session: SessionSnapshot): Promise<void> {
    if (existsSync(this.path)) {
      renameSync(this.path, `${this.path}.bak`);
    }
    await writeFileAtomic(this.path, JSON.stringify(session));
  }
}
