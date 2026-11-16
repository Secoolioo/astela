import { existsSync, renameSync } from 'node:fs';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import type { Clock } from '../../kernel/time/clock.ts';
import type { Disposable } from '../../shared/disposable.ts';
import {
  parseSession,
  sessionBudget,
  withoutTabHistories,
  type SessionSnapshot,
} from '../../domain/session/session.ts';
import { writeFileAtomic } from './atomic-file.ts';

/** What the session file held at the start. */
export interface StoredSession {
  /**
   * Whether the browser that wrote it did not quit normally, as after a crash, a kill or a
   * forced shutdown of the system: the marker `session.json.running` was left.
   */
  readonly unclean: boolean;
  /**
   * Reads the stored session, or the backup when the file is broken; `undefined` when there is
   * none. The file is read at once, and so is the backup when there is no file, but they are
   * parsed only here, as only a start that restores the session needs it.
   */
  data(): Promise<unknown>;
}

/**
 * Keeps the session in `session.json`: written atomically, at most once per second while
 * tabs change, at most once in 30 seconds while only titles of pages change, and at once
 * when the browser quits, with at most 4 MiB of page states. The previous file stays as
 * `session.json.bak`, which is read when the current file is broken. While the browser runs,
 * the empty file `session.json.running` shows that it has not quit yet; a normal quit removes
 * it after the last write of the session.
 */
export class JsonFileSessionStore implements Disposable {
  private readonly path: string;
  /** The marker of a browser that runs. */
  private readonly marker: string;
  /** Whether the browser quits, after which it marks itself as running no more. */
  private quitting = false;
  private marking: Promise<void> = Promise.resolve();
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private readonly laterMs: number;
  private pending: SessionSnapshot | undefined;
  /** Gives the session at the time of the write, newer than `pending`. */
  private take: (() => SessionSnapshot | undefined) | undefined;
  private timer: Disposable | undefined;
  /** When the timer fires, on the clock. */
  private due = 0;
  private writing: Promise<void> = Promise.resolve();

  /**
   * @param path - Path of `session.json`.
   * @param clock - Schedules the writes.
   * @param debounceMs - Delay before a write.
   * @param laterMs - Delay before a write of changes that can wait, such as new titles.
   */
  constructor(path: string, clock: Clock, debounceMs = 1000, laterMs = 30_000) {
    this.path = path;
    this.marker = `${path}.running`;
    this.clock = clock;
    this.debounceMs = debounceMs;
    this.laterMs = laterMs;
  }

  /**
   * Reads the stored session, or the backup when the file is missing or broken, and whether the
   * browser that wrote it quit normally.
   */
  async read(): Promise<StoredSession> {
    const [unclean, text] = await Promise.all([
      access(this.marker).then(
        () => true,
        () => false,
      ),
      readFile(this.path, 'utf8').catch(() => undefined),
    ]);
    const backup = `${this.path}.bak`;
    // Without the file, the backup is read at once, so that the first window does not wait for
    // it; a broken file leaves the backup until the session is asked for.
    const spare =
      text === undefined ? await readFile(backup, 'utf8').catch(() => undefined) : undefined;
    return {
      unclean,
      data: async () => {
        const reads =
          text === undefined ? [() => spare] : [() => text, () => readFile(backup, 'utf8')];
        for (const read of reads) {
          try {
            const content = await read();
            if (content !== undefined) return JSON.parse(content) as unknown;
          } catch {
            // Missing or broken: try the backup.
          }
        }
        return undefined;
      },
    };
  }

  /**
   * Marks the browser as running, until {@link JsonFileSessionStore.markClean}; once the
   * browser quits, it marks nothing more.
   * @returns When the marker is written; it fails when the file cannot be written.
   */
  markRunning(): Promise<void> {
    return this.mark(async () => {
      if (!this.quitting) await writeFile(this.marker, '');
    });
  }

  /**
   * Removes the marker of a running browser, after the last write of the session when the
   * browser quits normally.
   * @returns When the marker is gone; it fails when the file cannot be removed.
   */
  markClean(): Promise<void> {
    this.quitting = true;
    return this.mark(() => rm(this.marker, { force: true }));
  }

  /** Changes the marker after the changes before, one at a time. */
  private mark(change: () => Promise<void>): Promise<void> {
    const changed = this.marking.then(change);
    this.marking = changed.catch(() => undefined);
    return changed;
  }

  /**
   * Stores a session after the delay; a newer session replaces a pending one.
   * @param session - The tabs of the open windows.
   */
  schedule(session: SessionSnapshot): void {
    this.pending = session;
    this.take = undefined;
    this.arm(this.debounceMs);
  }

  /**
   * Stores the session after the longer delay, for a change that can wait, such as a new title
   * of a page: a page whose title changes all the time would otherwise write the whole session
   * every second. The session is taken only when it is written, and a change that cannot wait
   * writes it sooner.
   * @param take - Gives the tabs of the open windows, or `undefined` when none are kept.
   */
  scheduleLater(take: () => SessionSnapshot | undefined): void {
    this.take = take;
    this.arm(this.laterMs);
  }

  /** Writes a pending session now, for example while the browser quits. */
  flush(): Promise<void> {
    const session = this.takePending();
    if (session !== undefined) {
      this.writing = this.writing.then(() => this.write(session)).catch(() => undefined);
    }
    return this.writing;
  }

  /**
   * Writes the session at once without the back and forward lists of its tabs, into the file and
   * into its backup, so that no earlier file keeps them, as after the whole history was cleared:
   * the pending session, or else the stored one. Each tab keeps the entry that it shows.
   * @returns When both files are written; it fails when they cannot be.
   */
  forgetHistories(): Promise<void> {
    const pending = this.takePending();
    const forgotten = this.writing.then(async () => {
      const session = pending ?? parseSession(await (await this.read()).data());
      // Files that hold no session that can be read may still hold the lists.
      if (session === undefined) {
        await rm(this.path, { force: true });
        await rm(`${this.path}.bak`, { force: true });
        return;
      }
      const text = await this.serialize(withoutTabHistories(session));
      await writeFileAtomic(this.path, text);
      await writeFileAtomic(`${this.path}.bak`, text);
    });
    this.writing = forgotten.catch(() => undefined);
    return forgotten;
  }

  /** Cancels a scheduled write. Call {@link JsonFileSessionStore.flush} first. */
  dispose(): void {
    this.timer?.dispose();
  }

  /** Starts the timer of a write, unless one fires before the delay is over. */
  private arm(delay: number): void {
    const due = this.clock.now() + delay;
    if (this.timer !== undefined && this.due <= due) return;
    this.timer?.dispose();
    this.due = due;
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  /** The session that waits to be written, which is then no longer pending. */
  private takePending(): SessionSnapshot | undefined {
    this.timer?.dispose();
    this.timer = undefined;
    const session = this.take?.() ?? this.pending;
    this.take = undefined;
    this.pending = undefined;
    return session;
  }

  private async write(session: SessionSnapshot): Promise<void> {
    const text = await this.serialize(session);
    if (existsSync(this.path)) {
      renameSync(this.path, `${this.path}.bak`);
    }
    await writeFileAtomic(this.path, text);
  }

  /** The text of a session file, with at most 4 MiB of page states. */
  private async serialize(session: SessionSnapshot): Promise<string> {
    const text = JSON.stringify(session);
    // Only a file larger than the budget can hold more page states than it allows.
    if (text.length <= sessionBudget) return text;
    const { fitSession } = await import('../../domain/session/fit-session.ts');
    return JSON.stringify(fitSession(session));
  }
}
