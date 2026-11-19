import type { DownloadItem, WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The pages that exist, as `webContents.getAllWebContents()` lists them. */
const pages: FakePage[] = [];

vi.mock('electron', () => ({
  webContents: {
    getAllWebContents: () => pages,
    fromFrame: (frame: FakeFrame) => frame.page,
  },
}));

const { TabActivity, typesText } = await import('../electron/tab-activity.ts');

/** A frame of a page, which may go away. */
class FakeFrame {
  destroyed = false;
  readonly page: FakePage;
  constructor(page: FakePage) {
    this.page = page;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

/** A page that reports what it does as Electron does. */
class FakePage extends EventEmitter {
  destroyed = false;
  devTools = false;
  opener: FakeFrame | null = null;
  readonly mainFrame: FakeFrame = new FakeFrame(this);
  constructor() {
    super();
    pages.push(this);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isDevToolsOpened(): boolean {
    return this.devTools;
  }
  get contents(): WebContents {
    return this as unknown as WebContents;
  }
}

/** A download that runs until it is paused, stopped by an error or done, as Electron tells. */
class FakeDownload extends EventEmitter {
  state: 'progressing' | 'interrupted' | 'completed' = 'progressing';
  paused = false;
  getState(): string {
    return this.state;
  }
  isPaused(): boolean {
    return this.paused;
  }
  get item(): DownloadItem {
    return this as unknown as DownloadItem;
  }
  pause(): void {
    this.paused = true;
    this.emit('updated', {}, 'progressing');
  }
  /** Stops by an error after which the download can go on, which ends in no `done`. */
  interrupt(): void {
    this.state = 'interrupted';
    this.emit('updated', {}, 'interrupted');
  }
  resume(): void {
    this.paused = false;
    this.state = 'progressing';
    this.emit('updated', {}, 'progressing');
  }
  done(): void {
    this.state = 'completed';
    this.emit('done', {}, 'completed');
  }
}

/** A download that is done once it says so. */
function download(): FakeDownload {
  return new FakeDownload();
}

describe('TabActivity', () => {
  let now = 1000;
  let activity: InstanceType<typeof TabActivity>;
  let changes = 0;

  beforeEach(() => {
    pages.length = 0;
    now = 1000;
    changes = 0;
    activity = new TabActivity(() => now);
    activity.onDidChange(() => (changes += 1));
  });

  it('keeps a page awake that got a camera until it navigates or its renderer goes', () => {
    const page = new FakePage();
    activity.watch(page.contents);
    expect(activity.awakeReason(page.contents, 'manual')).toBeUndefined();
    activity.capturing(page.contents);
    activity.capturing(page.contents);
    expect([
      activity.awakeReason(page.contents, 'manual'),
      activity.busy(page.contents),
      changes,
    ]).toEqual(['capture', true, 1]);
    now = 5000;
    page.emit('did-navigate');
    expect(activity.awakeReason(page.contents, 'manual')).toBeUndefined();
    expect(activity.lastBusyAt(page.contents)).toBe(5000);
    expect(changes).toBe(2);
    // A page that was never watched is watched with its first grant.
    const other = new FakePage();
    activity.capturing(other.contents);
    now = 7000;
    other.emit('render-process-gone');
    expect(activity.awakeReason(other.contents, 'manual')).toBeUndefined();
    expect(activity.lastBusyAt(other.contents)).toBe(7000);
  });

  it('counts the downloads of a page until each is done', () => {
    const page = new FakePage();
    const first = download();
    const second = download();
    activity.downloading(page.contents, first.item);
    activity.downloading(page.contents, second.item);
    expect(activity.awakeReason(page.contents, 'manual')).toBe('download');
    first.done();
    expect(activity.awakeReason(page.contents, 'manual')).toBe('download');
    expect(activity.lastBusyAt(page.contents)).toBeUndefined();
    now = 3000;
    second.done();
    expect(activity.awakeReason(page.contents, 'manual')).toBeUndefined();
    expect(activity.lastBusyAt(page.contents)).toBe(3000);
    // The page became busy once and stopped once; a second download changed nothing.
    expect(changes).toBe(2);
    // A download that the list of downloads started again belongs to no page.
    const again = download();
    expect(() => activity.downloading(null, again.item)).not.toThrow();
    again.done();
    expect(changes).toBe(2);
    // A download that is done has no listener left.
    expect([second.listenerCount('updated'), second.listenerCount('done')]).toEqual([0, 0]);
  });

  it('keeps nothing awake with a download that is paused or stopped by an error, until it runs again', () => {
    const page = new FakePage();
    const paused = download();
    const failed = download();
    activity.downloading(page.contents, paused.item);
    activity.downloading(page.contents, failed.item);
    now = 2000;
    paused.pause();
    expect(activity.busy(page.contents)).toBe(true);
    // A network error leaves a download that can go on: Electron sends no `done` for it.
    failed.interrupt();
    expect([activity.awakeReason(page.contents, 'manual'), activity.busy(page.contents)]).toEqual([
      undefined,
      false,
    ]);
    expect(activity.lastBusyAt(page.contents)).toBe(2000);
    expect(changes).toBe(2);
    // Progress of a download that runs changes nothing; one that goes on again keeps it awake.
    failed.resume();
    failed.emit('updated', {}, 'progressing');
    expect(activity.awakeReason(page.contents, 'manual')).toBe('download');
    expect(changes).toBe(3);
    now = 4000;
    failed.done();
    expect(activity.busy(page.contents)).toBe(false);
    expect(activity.lastBusyAt(page.contents)).toBe(4000);
    paused.resume();
    expect(activity.busy(page.contents)).toBe(true);
    expect(changes).toBe(5);
  });

  it('keeps a page that people typed into awake for the browser alone, until it navigates', () => {
    const page = new FakePage();
    activity.typing(page.contents);
    activity.typing(page.contents);
    expect([
      activity.awakeReason(page.contents, 'auto'),
      activity.awakeReason(page.contents, 'manual'),
      activity.busy(page.contents),
      changes,
    ]).toEqual(['input', undefined, true, 1]);
    // A page in the same document keeps what was typed; another document starts anew.
    page.emit('did-navigate-in-page');
    expect(activity.busy(page.contents)).toBe(true);
    now = 6000;
    page.emit('did-navigate');
    expect(activity.awakeReason(page.contents, 'auto')).toBeUndefined();
    expect(activity.lastBusyAt(page.contents)).toBe(6000);
    expect(changes).toBe(2);
    // Other reasons come first, for either mode.
    activity.typing(page.contents);
    page.devTools = true;
    expect(activity.awakeReason(page.contents, 'auto')).toBe('devtools');
  });

  it('counts the media of a page that play, also after a page that was paused more often', () => {
    const page = new FakePage();
    activity.watch(page.contents);
    activity.watch(page.contents);
    page.emit('media-paused');
    expect(changes).toBe(0);
    page.emit('media-started-playing');
    page.emit('media-started-playing');
    expect(activity.awakeReason(page.contents, 'manual')).toBe('media');
    expect(activity.plays(page.contents)).toBe(true);
    page.emit('media-paused');
    expect(activity.awakeReason(page.contents, 'manual')).toBe('media');
    now = 4000;
    page.emit('media-paused');
    expect(activity.awakeReason(page.contents, 'manual')).toBeUndefined();
    expect(activity.plays(page.contents)).toBe(false);
    expect(activity.lastBusyAt(page.contents)).toBe(4000);
    // A new document has none of the media of the one before.
    page.emit('media-started-playing');
    page.emit('did-navigate');
    expect(activity.busy(page.contents)).toBe(false);
    expect(activity.plays(page.contents)).toBe(false);
    expect(changes).toBe(4);
  });

  it('keeps a page awake while its video shows in picture in picture, and counts it as busy until that stopped', () => {
    const page = new FakePage();
    activity.pictureInPicture(page.contents, false);
    expect([activity.busy(page.contents), activity.lastBusyAt(page.contents), changes]).toEqual([
      false,
      undefined,
      0,
    ]);
    activity.pictureInPicture(page.contents, true);
    activity.pictureInPicture(page.contents, true);
    expect([
      activity.awakeReason(page.contents, 'manual'),
      activity.busy(page.contents),
      activity.showsPictureInPicture(page.contents),
      changes,
    ]).toEqual(['pictureInPicture', true, true, 1]);
    // The window of picture in picture closed long after the video paused.
    now = 60_000;
    activity.pictureInPicture(page.contents, false);
    expect(activity.awakeReason(page.contents, 'auto')).toBeUndefined();
    expect(activity.showsPictureInPicture(page.contents)).toBe(false);
    expect(activity.lastBusyAt(page.contents)).toBe(60_000);
    expect(changes).toBe(2);
    // A new document has none of the videos of the one before.
    activity.pictureInPicture(page.contents, true);
    now = 70_000;
    page.emit('did-navigate');
    expect(activity.busy(page.contents)).toBe(false);
    expect(activity.lastBusyAt(page.contents)).toBe(70_000);
  });

  it('keeps a page awake while its developer tools are open', () => {
    const page = new FakePage();
    activity.watch(page.contents);
    page.devTools = true;
    page.emit('devtools-opened');
    expect(activity.awakeReason(page.contents, 'manual')).toBe('devtools');
    page.devTools = false;
    now = 9000;
    page.emit('devtools-closed');
    expect(activity.awakeReason(page.contents, 'manual')).toBeUndefined();
    expect(activity.lastBusyAt(page.contents)).toBe(9000);
    expect(changes).toBe(2);
  });

  it('keeps a page awake that a live page opened, or that opened one, but not as busy', () => {
    const opener = new FakePage();
    const opened = new FakePage();
    const alone = new FakePage();
    opened.opener = opener.mainFrame;
    expect(activity.awakeReason(opened.contents, 'manual')).toBe('opener');
    expect(activity.awakeReason(opener.contents, 'manual')).toBe('opener');
    expect(activity.awakeReason(alone.contents, 'manual')).toBeUndefined();
    expect(activity.busy(opened.contents)).toBe(false);
    // The link ends with the frame of the page that opened the other.
    opener.mainFrame.destroyed = true;
    expect(activity.awakeReason(opened.contents, 'manual')).toBeUndefined();
    expect(activity.awakeReason(opener.contents, 'manual')).toBeUndefined();
  });

  it('tells the keys that type, delete, paste or cut text from shortcuts and keys that move', () => {
    const key = (name: string, change: Partial<Record<'control' | 'alt' | 'meta', boolean>> = {}) =>
      typesText({ type: 'keyDown', key: name, control: false, alt: false, meta: false, ...change });
    expect(
      ['a', 'Z', '7', 'ß', '@', 'é', 'Backspace', 'Delete', 'Process'].map((each) => key(each)),
    ).toEqual(Array.from({ length: 9 }, () => true));
    expect(
      [' ', 'Enter', 'Tab', 'ArrowDown', 'PageDown', 'Escape', 'F5', 'Shift'].map((each) =>
        key(each),
      ),
    ).toEqual(Array.from({ length: 8 }, () => false));
    // AltGr reports Ctrl and Alt together, and types; Option types on macOS.
    expect(key('@', { control: true, alt: true })).toBe(true);
    expect(key('ø', { alt: true })).toBe(true);
    expect(key('v', { control: true })).toBe(true);
    expect(key('X', { meta: true })).toBe(true);
    expect(key('t', { control: true })).toBe(false);
    expect(key('a', { meta: true })).toBe(false);
    expect(typesText({ type: 'keyUp', key: 'a', control: false, alt: false, meta: false })).toBe(
      false,
    );
  });

  it('tells nothing about a page that is gone', () => {
    const page = new FakePage();
    activity.capturing(page.contents);
    page.destroyed = true;
    expect(activity.awakeReason(page.contents, 'manual')).toBeUndefined();
    expect(activity.busy(page.contents)).toBe(false);
  });
});
