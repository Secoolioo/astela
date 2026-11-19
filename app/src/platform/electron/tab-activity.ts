import { webContents, type DownloadItem, type Input, type WebContents } from 'electron';
import type { SleepMode } from '../../domain/tabs/tab-service.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';

/**
 * Why a page stays awake: it uses a camera, a microphone or the screen that it was granted
 * (`capture`), downloads a file (`download`), plays a video or other media, also without
 * sound (`media`), shows a video in picture in picture (`pictureInPicture`), has the developer
 * tools open (`devtools`), is linked to a live page as the page that opened it or one that it
 * opened (`opener`), or, only for the browser's own sleep, people typed into it since it loaded
 * (`input`). Sound itself is the tab's own `audible` state.
 */
export type AwakeReason =
  'capture' | 'download' | 'media' | 'pictureInPicture' | 'devtools' | 'opener' | 'input';

/**
 * What the pages of tabs do that keeps them from sleeping, which only the browser process
 * sees: the cameras, microphones and screens that they were granted, their downloads that run,
 * their media that plays, their videos in picture in picture, their developer tools, the pages
 * that they opened, and the keys that people typed into them. It learns of grants and
 * downloads from the start, before a tab could sleep.
 */
export class TabActivity {
  private readonly now: () => number;
  /** Pages that were granted a camera, a microphone or the screen, until they navigate. */
  private readonly capture = new WeakSet<WebContents>();
  /**
   * The downloads of each page that are not done: running, paused, or stopped by an error
   * after which they can go on.
   */
  private readonly downloads = new WeakMap<WebContents, Set<DownloadItem>>();
  /** The pages with a download that runs, as the browser last counted them. */
  private readonly downloadingPages = new WeakSet<WebContents>();
  /** How many media of each page play, as Chromium reports them. */
  private readonly playing = new WeakMap<WebContents, number>();
  /** Pages that people typed into, until they load another document. */
  private readonly typed = new WeakSet<WebContents>();
  /**
   * Pages that showed a video in picture in picture when the browser last looked, until they
   * load another document.
   */
  private readonly pictured = new WeakSet<WebContents>();
  /** When each page last stopped being busy, in milliseconds of the wall clock. */
  private readonly ended = new WeakMap<WebContents, number>();
  private readonly watched = new WeakSet<WebContents>();
  private readonly changeEmitter = new Emitter<void>();

  /** Fires when a page becomes busy or stops being busy. */
  readonly onDidChange: Event<void> = this.changeEmitter.event;

  /** @param now - The time of the wall clock, in milliseconds. */
  constructor(now: () => number) {
    this.now = now;
  }

  /**
   * Follows what a page of a tab does that keeps it awake: media that play, the developer
   * tools, and the navigations that end a capture and what was typed.
   * @param contents - The page.
   */
  watch(contents: WebContents): void {
    if (this.watched.has(contents)) return;
    this.watched.add(contents);
    // A new document has none of the streams, players and typed text of the one before.
    const reset = (): void => {
      const captured = this.capture.delete(contents);
      const typed = this.typed.delete(contents);
      const pictured = this.pictured.delete(contents);
      const played = (this.playing.get(contents) ?? 0) > 0;
      this.playing.delete(contents);
      if (captured || typed || pictured || played) this.end(contents);
    };
    contents.on('did-navigate', reset);
    contents.on('render-process-gone', reset);
    contents.on('media-started-playing', () => {
      const count = this.playing.get(contents) ?? 0;
      this.playing.set(contents, count + 1);
      if (count === 0) this.changeEmitter.fire();
    });
    contents.on('media-paused', () => {
      const count = this.playing.get(contents) ?? 0;
      if (count === 0) return;
      this.playing.set(contents, count - 1);
      if (count === 1) this.end(contents);
    });
    contents.on('devtools-opened', () => this.changeEmitter.fire());
    contents.on('devtools-closed', () => this.end(contents));
  }

  /**
   * Takes note that a page was granted a camera, a microphone or the screen. The page counts
   * as using it until it navigates, as the browser cannot tell when its stream ends.
   * @param contents - The page.
   */
  capturing(contents: WebContents): void {
    this.watch(contents);
    if (this.capture.has(contents)) return;
    this.capture.add(contents);
    this.changeEmitter.fire();
  }

  /**
   * Takes note that people typed into a page, such as into a field or an editor. Its changes
   * may not be saved, so the browser does not put it to sleep by itself until it loads another
   * document; people still may.
   * @param contents - The page.
   */
  typing(contents: WebContents): void {
    this.watch(contents);
    if (this.typed.has(contents)) return;
    this.typed.add(contents);
    this.changeEmitter.fire();
  }

  /**
   * Takes note of whether a page shows a video in picture in picture, as picture in picture saw
   * when it last looked at the page, also while its button is off: a page that does stays
   * awake, and one that stopped was busy until now. The note ends when the page loads another
   * document, whose videos are not the ones before.
   * @param contents - The page.
   * @param shows - Whether it shows one.
   */
  pictureInPicture(contents: WebContents, shows: boolean): void {
    this.watch(contents);
    if (shows === this.pictured.has(contents)) return;
    if (shows) {
      this.pictured.add(contents);
      this.changeEmitter.fire();
    } else {
      this.pictured.delete(contents);
      this.end(contents);
    }
  }

  /**
   * Whether a page showed a video in picture in picture when picture in picture last looked.
   * @param contents - The page.
   */
  showsPictureInPicture(contents: WebContents): boolean {
    return this.pictured.has(contents);
  }

  /**
   * Takes note of a download of a page. The page counts as busy while the download runs; one
   * that is paused, or stopped by an error after which it can go on, keeps nothing awake until
   * it runs again.
   * @param contents - The page that started it; none for a download that the list of downloads
   *   started again.
   * @param item - The download.
   */
  downloading(contents: WebContents | null | undefined, item: DownloadItem): void {
    if (contents === null || contents === undefined) return;
    let items = this.downloads.get(contents);
    if (items === undefined) {
      items = new Set();
      this.downloads.set(contents, items);
    }
    const open = items;
    open.add(item);
    const recount = (): void => this.recountDownloads(contents, open);
    item.on('updated', recount);
    item.once('done', () => {
      item.off('updated', recount);
      open.delete(item);
      recount();
    });
    recount();
  }

  /**
   * Why a page stays awake, or `undefined` when nothing keeps it.
   * @param contents - The page.
   * @param mode - Whether people put the tab to sleep, or the browser does by itself, which
   *   also leaves pages that people typed into.
   */
  awakeReason(contents: WebContents, mode: SleepMode): AwakeReason | undefined {
    return this.busyReason(contents, mode) ?? (this.linked(contents) ? 'opener' : undefined);
  }

  /**
   * Whether a page is busy for the browser's own sleep, also when people typed into it,
   * without the pages that it is linked to, which take longer to find.
   * @param contents - The page.
   */
  busy(contents: WebContents): boolean {
    return this.busyReason(contents, 'auto') !== undefined;
  }

  /**
   * Whether a video or other media of a page plays now, as Chromium reported it.
   * @param contents - The page.
   */
  plays(contents: WebContents): boolean {
    return (this.playing.get(contents) ?? 0) > 0;
  }

  /**
   * When a page last stopped being busy, in milliseconds of the wall clock.
   * @param contents - The page.
   * @returns The time, or `undefined` when it never was busy.
   */
  lastBusyAt(contents: WebContents): number | undefined {
    return this.ended.get(contents);
  }

  private busyReason(
    contents: WebContents,
    mode: SleepMode,
  ): Exclude<AwakeReason, 'opener'> | undefined {
    if (contents.isDestroyed()) return undefined;
    if (this.capture.has(contents)) return 'capture';
    if (this.downloadingPages.has(contents)) return 'download';
    if ((this.playing.get(contents) ?? 0) > 0) return 'media';
    if (this.pictured.has(contents)) return 'pictureInPicture';
    if (contents.isDevToolsOpened()) return 'devtools';
    return mode === 'auto' && this.typed.has(contents) ? 'input' : undefined;
  }

  /** Counts again whether a download of a page runs, and tells when that changed. */
  private recountDownloads(contents: WebContents, items: ReadonlySet<DownloadItem>): void {
    const runs = [...items].some((item) => item.getState() === 'progressing' && !item.isPaused());
    if (runs === this.downloadingPages.has(contents)) return;
    if (runs) {
      this.downloadingPages.add(contents);
      this.changeEmitter.fire();
    } else {
      this.downloadingPages.delete(contents);
      this.end(contents);
    }
  }

  /** Whether a page was opened by a live page, or opened one that is still open. */
  private linked(contents: WebContents): boolean {
    if (liveFrame(contents.opener)) return true;
    return webContents.getAllWebContents().some((other) => {
      const opener = other.opener;
      return (
        other !== contents &&
        !other.isDestroyed() &&
        liveFrame(opener) &&
        webContents.fromFrame(opener) === contents
      );
    });
  }

  /** Records that a page stopped being busy in one way. */
  private end(contents: WebContents): void {
    this.ended.set(contents, this.now());
    this.changeEmitter.fire();
  }
}

/**
 * Whether a key that reaches a page types text into it, deletes or pastes some: a key that
 * gives a character other than a space, also with AltGr, which reports Ctrl and Alt together,
 * Backspace, Delete, a key of an input method, and Ctrl or Command with V or X. Other
 * shortcuts, the arrows, the space bar and Enter, which also scroll or follow links, do not
 * count.
 * @param input - The key, as `before-input-event` gives it.
 */
export function typesText(
  input: Pick<Input, 'type' | 'key' | 'control' | 'alt' | 'meta'>,
): boolean {
  if (input.type !== 'keyDown') return false;
  if (input.key === 'Backspace' || input.key === 'Delete' || input.key === 'Process') return true;
  if (input.meta || (input.control && !input.alt)) {
    const key = input.key.toLowerCase();
    return key === 'v' || key === 'x';
  }
  // One character, which may take two code units, and no space.
  return /^\S$/u.test(input.key);
}

/** Whether a frame of a page is there and alive. */
function liveFrame(frame: Electron.WebFrameMain | null): frame is Electron.WebFrameMain {
  return frame !== null && !frame.isDestroyed();
}
