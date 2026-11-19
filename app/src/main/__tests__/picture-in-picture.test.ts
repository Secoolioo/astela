import type { WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaReport, MediaRequest } from '../../domain/media/media.ts';
import type { SettingDefinition } from '../../domain/settings/setting.ts';
import { TabService, type TabViewPort } from '../../domain/tabs/tab-service.ts';
import { Emitter } from '../../kernel/events/emitter.ts';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { PictureInPictureState } from '../../shared/page-tools.ts';

/** What the media script of each frame was asked, and how a frame answers. */
const scripts = vi.hoisted(() => {
  const calls: { frame: string; request: unknown; gesture: boolean }[] = [];
  /** Runs the media script of a fake frame. */
  const run = (
    frame: { readonly name: string; answer: (request: never) => unknown },
    request: never,
    gesture: boolean,
  ): Promise<unknown> => {
    calls.push({ frame: frame.name, request, gesture });
    return Promise.resolve(frame.answer(request));
  };
  return { calls, run };
});

/** A frame of a fake page, whose media script answers with its handler. */
class FakeFrame {
  readonly name: string;
  readonly origin: string;
  readonly parent: FakeFrame | null;
  readonly frameTreeNodeId: number;
  readonly children: FakeFrame[] = [];
  detached = false;
  /** The address of its document. */
  url: string;
  /** What the media script of the frame answers to a request. */
  answer: (request: MediaRequest) => unknown = () => report([]);
  private static next = 1;

  constructor(name: string, origin: string, parent: FakeFrame | null = null) {
    this.name = name;
    this.origin = origin;
    this.parent = parent;
    this.url = origin === 'null' ? 'about:srcdoc' : `${origin}/${name.replaceAll(' ', '-')}.html`;
    this.frameTreeNodeId = FakeFrame.next++;
    parent?.children.push(this);
  }

  get framesInSubtree(): FakeFrame[] {
    return [this, ...this.children.flatMap((child) => child.framesInSubtree)];
  }

  isDestroyed(): boolean {
    return false;
  }
}

/** The runner of page scripts, which refuses a call for a document as `PageScripts` does. */
vi.mock('../page-scripts.ts', () => ({
  PageScripts: class {
    inMainFrame(
      contents: { mainFrame: FakeFrame; getURL(): string; isLoadingMainFrame(): boolean },
      _name: string,
      request: never,
      call: { gesture?: boolean; page?: string },
    ): Promise<unknown> {
      if (
        call.page !== undefined &&
        (contents.isLoadingMainFrame() || contents.getURL() !== call.page)
      ) {
        return Promise.reject(new Error('Refused'));
      }
      return scripts.run(contents.mainFrame, request, call.gesture === true);
    }
    inFrame(
      frame: FakeFrame,
      _name: string,
      request: never,
      call: { gesture?: boolean; page?: string },
    ): Promise<unknown> {
      if (call.page !== undefined && frame.url !== call.page) {
        return Promise.reject(new Error('Refused'));
      }
      return scripts.run(frame, request, call.gesture === true);
    }
  },
}));

const { PictureInPictureController } = await import('../picture-in-picture.ts');

/** The report of a frame with videos, the first of them `[ready, playing, audible, area]`. */
function report(
  videos: readonly (readonly [boolean, boolean, boolean, number])[],
  pip = false,
): MediaReport {
  return {
    videos: videos.map(([ready, playing, audible, area]) => ({ ready, playing, audible, area })),
    pip,
  };
}

/** A page of a tab, with its main frame, which tells when it stops loading as Electron does. */
class FakePage extends EventEmitter {
  readonly main: FakeFrame;
  zoom = 1;
  destroyed = false;
  /** Whether its main frame loads, while Electron would hold back a script for it. */
  loading = false;
  constructor(origin = 'https://example.com') {
    super();
    this.main = new FakeFrame('main', origin);
  }
  get mainFrame(): FakeFrame {
    return this.main;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  getURL(): string {
    return this.main.url;
  }
  isLoadingMainFrame(): boolean {
    return this.loading;
  }
  /** Ends the load of the page. */
  loaded(): void {
    this.loading = false;
    this.emit('did-stop-loading');
  }
  getZoomFactor(): number {
    return this.zoom;
  }
  get contents(): WebContents {
    return this as unknown as WebContents;
  }
}

/** Views that do nothing, for the tabs of a fake window. */
class Views implements TabViewPort {
  create(): void {}
  show(): void {}
  destroy(): void {}
  load(): void {}
  run(): void {}
  sleep(): boolean {
    return true;
  }
}

/** A window with tabs of web pages, the last of which is active. */
function windowWith(count: number): { window: FakeWindow; ids: string[]; pages: FakePage[] } {
  const tabs = new TabService(new Views(), 'about:blank');
  const pages: FakePage[] = [];
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(tabs.open(`https://example.com/${String(index)}`));
    pages.push(new FakePage());
  }
  const window = {
    tabs,
    webContentsOf: (id: string) => pages[ids.indexOf(id)]?.contents,
  };
  return { window, ids, pages };
}

interface FakeWindow {
  readonly tabs: TabService;
  webContentsOf(id: string): WebContents | undefined;
}

/** A controller over windows, with picture in picture on unless told, and pages that play. */
function controllerOf(
  windows: FakeWindow[],
  playing: (contents: WebContents) => boolean = () => false,
) {
  const values = { on: true };
  const changes = new Emitter<{ readonly keys: readonly string[] }>();
  const settings = {
    get: (definition: SettingDefinition<unknown>) =>
      definition.key === 'pictureInPicture.enabled' ? values.on : undefined,
    onDidChange: changes.event,
  };
  const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
  // What keeps pages awake: the pages that show a video in picture in picture, and each note.
  const pictured = new Set<WebContents>();
  const notes: boolean[] = [];
  const activity = {
    plays: playing,
    pictureInPicture: (contents: WebContents, shows: boolean) => {
      notes.push(shows);
      if (shows) pictured.add(contents);
      else pictured.delete(contents);
    },
    showsPictureInPicture: (contents: WebContents) => pictured.has(contents),
  };
  const controller = new PictureInPictureController({
    windows: { all: windows } as never,
    settings: settings as never,
    scripts: '/nowhere',
    activity: () => activity as never,
    logger,
  });
  return {
    controller,
    pictured,
    notes,
    turn: (on: boolean) => {
      values.on = on;
      changes.fire({ keys: ['pictureInPicture.enabled'] });
    },
  };
}

/** The states of picture in picture of the tabs of a window. */
function states(window: FakeWindow): PictureInPictureState[] {
  return window.tabs.all.map((tab) => tab.pictureInPicture);
}

/** The calls of the media script, as the frame, the kind of the request and the activation. */
function asked(): string[] {
  return scripts.calls.map(({ frame, request, gesture }) => {
    const kind = (request as MediaRequest).kind;
    return `${frame} ${kind}${gesture ? ' with activation' : ''}`;
  });
}

afterEach(() => {
  scripts.calls.length = 0;
  vi.useRealTimers();
});

/** Lets the answers that wait arrive. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('PictureInPictureController', () => {
  it('shows the video that plays in a frame of another site, with an activation only for that frame', async () => {
    const { window, ids, pages } = windowWith(1);
    const [page] = pages;
    const id = ids[0] ?? '';
    if (page === undefined) throw new Error('No page');
    // A frame of the same origin is reached from the main frame; one of another site is asked.
    const same = new FakeFrame('same', 'https://example.com', page.main);
    const other = new FakeFrame('other', 'https://video.test', page.main);
    const inside = new FakeFrame('inside other', 'https://video.test', other);
    page.main.answer = () => report([[true, false, false, 5000]]);
    let shown = false;
    other.answer = (request) => {
      if (request.kind === 'enter') {
        shown = true;
        return { done: true };
      }
      return report([[true, true, false, 100]], shown);
    };
    for (const reached of [same, inside]) {
      reached.answer = () => {
        throw new Error('A frame of the origin of the frame around it is no frame of its own');
      };
    }
    const { controller } = controllerOf([window]);
    window.tabs.update(id, { pictureInPicture: 'available' });
    await controller.toggle(window as never, id);
    expect(asked()).toEqual([
      'main probe',
      'other probe',
      'other enter with activation',
      'main probe',
      'other probe',
    ]);
    const enter = scripts.calls[2]?.request as Extract<MediaRequest, { kind: 'enter' }>;
    expect(enter.index).toBe(0);
    expect(enter.until - Date.now()).toBeGreaterThan(2000);
    expect(enter.until - Date.now()).toBeLessThanOrEqual(3000);
    expect(states(window)).toEqual(['open']);
  });

  it('does what the button showed: it ends picture in picture, or only shows what the page did itself', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    let pip = true;
    page.main.answer = (request) => {
      if (request.kind === 'exit') {
        pip = false;
        return { done: true };
      }
      if (request.kind === 'enter')
        throw new Error('The button showed that it ends picture in picture');
      return report([[true, true, false, 100]], pip);
    };
    const { controller } = controllerOf([window]);
    window.tabs.update(id, { pictureInPicture: 'open' });
    await controller.toggle(window as never, id);
    expect(asked()).toEqual(['main probe', 'main exit', 'main probe']);
    expect(states(window)).toEqual(['available']);
    // The page ended picture in picture itself while the button still showed it: a click only
    // shows that.
    scripts.calls.length = 0;
    window.tabs.update(id, { pictureInPicture: 'open' });
    await controller.toggle(window as never, id);
    expect(asked()).toEqual(['main probe']);
    expect(states(window)).toEqual(['available']);
    // The page started it itself while the button did not show it: a click only shows that too.
    scripts.calls.length = 0;
    pip = true;
    await controller.toggle(window as never, id);
    expect(asked()).toEqual(['main probe']);
    expect(states(window)).toEqual(['open']);
  });

  it('keeps one tab in picture in picture in all windows, and looks at the one that it replaced', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const first = windowWith(1);
    const second = windowWith(1);
    const [left] = first.pages;
    const [right] = second.pages;
    if (left === undefined || right === undefined) throw new Error('No page');
    left.main.answer = () => report([[true, true, false, 100]], true);
    right.main.answer = () => report([[true, true, false, 100]], true);
    const { controller } = controllerOf([first.window, second.window]);
    controller.focused(first.window as never);
    first.window.tabs.update(first.ids[0] ?? '', { pictureInPicture: 'open' });
    // The second window shows a video in picture in picture now, which took its place.
    second.window.tabs.update(second.ids[0] ?? '', { pictureInPicture: 'available' });
    controller.page(second.window as never, second.ids[0] ?? '', right.contents, 'shown');
    await vi.advanceTimersByTimeAsync(0);
    expect([states(first.window), states(second.window)]).toEqual([['available'], ['open']]);
    // The tab that showed it before is looked at again shortly after.
    scripts.calls.length = 0;
    left.main.answer = () => report([[true, false, false, 100]]);
    await vi.advanceTimersByTimeAsync(200);
    expect(asked()).toEqual(['main probe']);
    expect(states(first.window)).toEqual(['none']);
  });

  it('looks at the active tab once its media were quiet for 150 ms, or a second after they began to change, at most every 250 ms, and at other tabs once they show', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { window, ids, pages } = windowWith(2);
    const [background, active] = pages;
    if (background === undefined || active === undefined) throw new Error('No page');
    active.main.answer = () => report([[true, true, false, 100]]);
    background.main.answer = () => report([[true, true, false, 100]]);
    const playing = new Set<WebContents>([background.contents]);
    const { controller } = controllerOf([window], (contents) => playing.has(contents));
    const [first = '', second = ''] = ids;
    // Media events of the active tab come in a burst: one look after 150 ms.
    for (let event = 0; event < 5; event += 1) {
      controller.page(window as never, second, active.contents, 'media');
    }
    await vi.advanceTimersByTimeAsync(149);
    expect(asked()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked()).toEqual(['main probe']);
    expect(states(window)).toEqual(['none', 'available']);
    // The next event waits until 250 ms after the look before.
    controller.page(window as never, second, active.contents, 'media');
    await vi.advanceTimersByTimeAsync(249);
    expect(asked()).toEqual(['main probe']);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked()).toEqual(['main probe', 'main probe']);
    // Each event plans the look anew: one 100 ms after another moves it to 150 ms after that.
    scripts.calls.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    controller.page(window as never, second, active.contents, 'media');
    await vi.advanceTimersByTimeAsync(100);
    controller.page(window as never, second, active.contents, 'media');
    await vi.advanceTimersByTimeAsync(149);
    expect(asked()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked()).toEqual(['main probe']);
    // Media that never stay quiet are looked at a second after their first event.
    scripts.calls.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    for (let event = 0; event < 9; event += 1) {
      controller.page(window as never, second, active.contents, 'media');
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(asked()).toEqual([]);
    controller.page(window as never, second, active.contents, 'media');
    await vi.advanceTimersByTimeAsync(100);
    expect(asked()).toEqual(['main probe']);
    // A tab in the background is not looked at for its media, but once it shows and plays.
    scripts.calls.length = 0;
    controller.page(window as never, first, background.contents, 'media');
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked()).toEqual([]);
    controller.page(window as never, first, background.contents, 'shown');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked()).toEqual(['main probe']);
    expect(states(window)).toEqual(['available', 'available']);
    // A tab that shows without media, and that had none, is not looked at.
    scripts.calls.length = 0;
    playing.clear();
    window.tabs.update(first, { pictureInPicture: 'none' });
    controller.page(window as never, first, background.contents, 'shown');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked()).toEqual([]);
  });

  it('looks at a page while it is off only before its tab sleeps, forgets every state, and shows no state of a look that answers after', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    let answer: ((value: MediaReport) => void) | undefined;
    page.main.answer = () => new Promise<MediaReport>((done) => (answer = done));
    const { controller, turn, pictured } = controllerOf([window]);
    window.tabs.update(id, { pictureInPicture: 'open' });
    const looking = controller.beforeSleep(window as never, [id]);
    await settle();
    turn(false);
    expect(states(window)).toEqual(['none']);
    answer?.(report([[true, true, false, 1]], true));
    await looking;
    // The tab shows nothing, but its page stays awake with its video in picture in picture.
    expect(states(window)).toEqual(['none']);
    expect(pictured.has(page.contents)).toBe(true);
    scripts.calls.length = 0;
    page.main.answer = (request) => (request.kind === 'probe' ? report([], false) : { done: true });
    controller.page(window as never, id, page.contents, 'media');
    controller.page(window as never, id, page.contents, 'shown');
    await controller.toggle(window as never, id);
    const menu = { frame: null, x: 1, y: 1, src: '', page: page.getURL(), enter: true };
    await controller.atPoint(window as never, id, page.contents, menu);
    await new Promise((done) => setTimeout(done, 200));
    expect(asked()).toEqual([]);
    // A window that gets the focus has the page looked at again, whose window of picture in
    // picture may have closed meanwhile; then its tab may sleep again.
    controller.focused(window as never);
    await settle();
    expect(asked()).toEqual(['main probe']);
    expect(pictured.has(page.contents)).toBe(false);
    scripts.calls.length = 0;
    controller.focused(window as never);
    await settle();
    expect(asked()).toEqual([]);
    // Before its tab sleeps, the page is asked all the same, as it may show a video itself.
    page.main.answer = () => report([], true);
    await controller.beforeSleep(window as never, [id]);
    expect(asked()).toEqual(['main probe']);
    expect(states(window)).toEqual(['none']);
    expect(pictured.has(page.contents)).toBe(true);
  });

  it('asks the pages of tabs before they sleep, and takes no answer that is no report', async () => {
    const { window, ids, pages } = windowWith(2);
    const [first, second] = pages;
    if (first === undefined || second === undefined) throw new Error('No page');
    first.main.answer = () => report([], true);
    second.main.answer = () => ({ videos: [], pip: 'yes' });
    const { controller } = controllerOf([window]);
    await controller.beforeSleep(window as never, ids);
    expect(asked()).toEqual(['main probe', 'main probe']);
    expect(states(window)).toEqual(['open', 'none']);
  });

  it('gives the newest look the say, also when an older one answers after it', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    const answers: ((value: MediaReport) => void)[] = [];
    page.main.answer = () => new Promise<MediaReport>((done) => answers.push(done));
    const { controller } = controllerOf([window]);
    const older = controller.beforeSleep(window as never, [id]);
    const newer = controller.beforeSleep(window as never, [id]);
    await settle();
    answers[1]?.(report([[true, true, false, 1]]));
    await newer;
    answers[0]?.(report([], true));
    await older;
    expect(states(window)).toEqual(['available']);
  });

  it('shows the video of a context menu from the frame of the click, or the highest frame of its origin above it', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    const same = new FakeFrame('same', 'https://example.com', page.main);
    const other = new FakeFrame('other', 'https://video.test', page.main);
    const inner = new FakeFrame('inner', 'https://video.test', other);
    for (const frame of [page.main, same, other, inner]) {
      frame.answer = (request) => (request.kind === 'probe' ? report([]) : { done: true });
    }
    page.zoom = 2;
    const { controller } = controllerOf([window]);
    const menu = {
      x: 300,
      y: 100,
      src: 'https://example.com/clip.webm',
      page: page.getURL(),
      enter: true,
    };
    await controller.atPoint(window as never, id, page.contents, { ...menu, frame: same as never });
    const fromSame = scripts.calls.find(
      (call) => (call.request as MediaRequest).kind === 'enterAt',
    );
    expect(fromSame).toMatchObject({
      frame: 'main',
      gesture: true,
      request: { kind: 'enterAt', point: { x: 150, y: 50 }, src: menu.src, page: menu.page },
    });
    scripts.calls.length = 0;
    await controller.atPoint(window as never, id, page.contents, {
      ...menu,
      frame: inner as never,
    });
    const fromInner = scripts.calls.find(
      (call) => (call.request as MediaRequest).kind === 'enterAt',
    );
    expect(fromInner).toMatchObject({
      frame: 'other',
      gesture: true,
      request: { kind: 'enterAt', point: null, page: other.url },
    });
    // Its item that ends picture in picture ends it in the frame of the click, which Chromium
    // said shows the video in it, without an activation, and then looks at the page.
    scripts.calls.length = 0;
    other.answer = (request) => (request.kind === 'probe' ? report([], true) : { done: true });
    await controller.atPoint(window as never, id, page.contents, {
      ...menu,
      enter: false,
      frame: inner as never,
    });
    expect(asked()).toEqual(['other exit', 'main probe', 'other probe']);
    expect(scripts.calls[0]?.request).toEqual({ kind: 'exit', page: other.url });
    // A menu of a page that another one took the place of does nothing.
    scripts.calls.length = 0;
    await controller.atPoint(window as never, id, page.contents, {
      ...menu,
      page: 'https://example.com/before.html',
      frame: same as never,
    });
    expect(asked()).toEqual([]);
  });

  it('asks a sandboxed frame on its own, as frames of opaque origins reach no other document', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    // Electron names every opaque origin `null`, the same for frames that cannot reach each other.
    const outer = new FakeFrame('outer', 'null', page.main);
    const inner = new FakeFrame('inner', 'null', outer);
    for (const frame of [page.main, outer, inner]) {
      frame.answer = (request) => (request.kind === 'probe' ? report([]) : { done: true });
    }
    const { controller } = controllerOf([window]);
    await controller.beforeSleep(window as never, [id]);
    expect(asked()).toEqual(['main probe', 'outer probe', 'inner probe']);
    // A context menu of the inner frame runs the media script in that frame.
    scripts.calls.length = 0;
    await controller.atPoint(window as never, id, page.contents, {
      frame: inner as never,
      x: 10,
      y: 10,
      src: '',
      page: page.getURL(),
      enter: true,
    });
    expect(asked()).toContain('inner enterAt with activation');
    expect(asked().filter((call) => call.includes('enterAt'))).toHaveLength(1);
  });

  it('asks no frame of a page whose main frame loads, keeps the state of its tab, and looks once it has loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    const other = new FakeFrame('other', 'https://ads.test', page.main);
    page.main.answer = () => report([[true, true, false, 100]]);
    other.answer = (request) =>
      request.kind === 'probe' ? report([[true, true, false, 9000]]) : { done: true };
    // A video starts while the page still loads, as with frames of ads that keep it loading.
    page.loading = true;
    const { controller } = controllerOf([window], () => true);
    controller.page(window as never, id, page.contents, 'media');
    await vi.advanceTimersByTimeAsync(5000);
    controller.page(window as never, id, page.contents, 'shown');
    controller.focused(window as never);
    await controller.beforeSleep(window as never, [id]);
    expect(asked()).toEqual([]);
    expect(states(window)).toEqual(['none']);
    // The button does nothing meanwhile, also not with the video of the frame of another site.
    window.tabs.update(id, { pictureInPicture: 'available' });
    await controller.toggle(window as never, id);
    expect(asked()).toEqual([]);
    expect(states(window)).toEqual(['available']);
    // Once the page has loaded, the browser looks once, after the quiet time.
    expect(page.listenerCount('did-stop-loading')).toBe(1);
    window.tabs.update(id, { pictureInPicture: 'none' });
    page.loaded();
    await vi.advanceTimersByTimeAsync(149);
    expect(asked()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked()).toEqual(['main probe', 'other probe']);
    expect(states(window)).toEqual(['available']);
    expect(page.listenerCount('did-stop-loading')).toBe(0);
  });

  it('takes no state from a look that the main frame did not answer, or whose page moved or began to load, and acts on none', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    const other = new FakeFrame('other', 'https://ads.test', page.main);
    page.main.answer = () => Promise.reject(new Error('No answer in time'));
    other.answer = (request) =>
      request.kind === 'probe' ? report([[true, true, false, 9000]]) : { done: true };
    const { controller } = controllerOf([window]);
    await controller.beforeSleep(window as never, [id]);
    expect(states(window)).toEqual(['none']);
    window.tabs.update(id, { pictureInPicture: 'available' });
    await controller.toggle(window as never, id);
    expect(asked()).toEqual(['main probe', 'other probe', 'main probe', 'other probe']);
    expect(states(window)).toEqual(['available']);
    // The page went to another address while the frames answered.
    scripts.calls.length = 0;
    page.main.answer = () => {
      page.main.url = 'https://example.com/next.html';
      return report([[true, true, true, 100]]);
    };
    await controller.toggle(window as never, id);
    expect(asked()).toEqual(['main probe', 'other probe']);
    expect(states(window)).toEqual(['available']);
    // The page began to load another document while a frame of another site answered: nothing
    // acts until it has loaded, and then the browser looks again.
    scripts.calls.length = 0;
    page.main.answer = () => report([[true, true, true, 100]]);
    other.answer = () => {
      page.loading = true;
      return report([]);
    };
    await controller.toggle(window as never, id);
    expect(asked()).toEqual(['main probe', 'other probe']);
    expect(page.listenerCount('did-stop-loading')).toBe(1);
  });

  it('shows the video of a context menu while its page loads only once the page has loaded, at most 3 s after the click, and only in the page of the menu', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    page.main.answer = (request) => (request.kind === 'probe' ? report([]) : { done: true });
    const { controller } = controllerOf([window]);
    const menu = { frame: null, x: 10, y: 20, src: '', page: page.getURL(), enter: true };
    const shows = (): string[] => asked().filter((call) => call.includes('enterAt'));
    // The page loads for 2 s after the click: the video shows once it has loaded.
    page.loading = true;
    const clicked = Date.now();
    const first = controller.atPoint(window as never, id, page.contents, menu);
    await vi.advanceTimersByTimeAsync(2000);
    expect(asked()).toEqual([]);
    page.loaded();
    await first;
    expect(shows()).toEqual(['main enterAt with activation']);
    const request = scripts.calls[0]?.request as Extract<MediaRequest, { kind: 'enterAt' }>;
    expect(request).toMatchObject({ page: menu.page, point: { x: 10, y: 20 } });
    expect(request.until).toBe(clicked + 3000);
    // A page that loads for longer gets nothing, also once it has loaded.
    scripts.calls.length = 0;
    page.loading = true;
    const second = controller.atPoint(window as never, id, page.contents, menu);
    await vi.advanceTimersByTimeAsync(3000);
    await second;
    page.loaded();
    await vi.advanceTimersByTimeAsync(1000);
    expect(shows()).toEqual([]);
    expect(page.listenerCount('did-stop-loading')).toBe(0);
    // Nor does the page that took the place of the one that the menu was opened on.
    page.loading = true;
    const third = controller.atPoint(window as never, id, page.contents, menu);
    await vi.advanceTimersByTimeAsync(500);
    page.main.url = 'https://elsewhere.test/';
    page.loaded();
    await third;
    expect(shows()).toEqual([]);
  });

  it('shows the video of a context menu in a frame of another site at once while the page loads, and looks at the page once it has loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    const player = new FakeFrame('player', 'https://video.test', page.main);
    let pip = false;
    player.answer = (request) => {
      if (request.kind === 'probe') return report([[true, false, false, 100]], pip);
      pip = request.kind === 'enterAt';
      return { done: true };
    };
    page.loading = true;
    const { controller } = controllerOf([window]);
    const menu = { frame: player as never, x: 1, y: 1, src: '', page: page.getURL() };
    await controller.atPoint(window as never, id, page.contents, { ...menu, enter: true });
    expect(asked()).toEqual(['player enterAt with activation']);
    expect(states(window)).toEqual(['none']);
    page.loaded();
    await vi.advanceTimersByTimeAsync(150);
    expect(asked()).toEqual(['player enterAt with activation', 'main probe', 'player probe']);
    expect(states(window)).toEqual(['open']);
  });

  it('ends picture in picture from the context menu in the frame of the click, and asks the frame that it showed a video of first, also beyond the frames that it asks', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    // Frames of ads that were blocked, each of an opaque origin, before the frame of a player.
    const ads = Array.from(
      { length: 16 },
      (_, at) => new FakeFrame(`ad ${String(at)}`, 'null', page.main),
    );
    const player = new FakeFrame('player', 'https://video.test', page.main);
    let pip = false;
    player.answer = (request) => {
      if (request.kind === 'probe') return report([[true, false, false, 100]], pip);
      pip = request.kind === 'enterAt';
      return { done: true };
    };
    const { controller, notes } = controllerOf([window]);
    const menu = { frame: player as never, x: 10, y: 10, src: '', page: page.getURL() };
    await controller.atPoint(window as never, id, page.contents, { ...menu, enter: true });
    expect(asked()).toEqual([
      'player enterAt with activation',
      'main probe',
      'player probe',
      ...ads.slice(0, 14).map((ad) => `${ad.name} probe`),
    ]);
    expect(states(window)).toEqual(['open']);
    scripts.calls.length = 0;
    await controller.atPoint(window as never, id, page.contents, { ...menu, enter: false });
    expect(asked()[0]).toBe('player exit');
    expect(states(window)).toEqual(['none']);
    // Once the video no longer shows, the player waits its turn among the frames again.
    scripts.calls.length = 0;
    await controller.beforeSleep(window as never, [id]);
    expect(asked()).not.toContain('player probe');
    // What keeps the page awake learned that the video showed, and when it stopped.
    expect(notes).toEqual([true, false, false]);
  });

  it('tells what keeps pages awake whether a video shows in picture in picture, so that a tab counts as used until it stopped', async () => {
    const { window, ids, pages } = windowWith(1);
    const id = ids[0] ?? '';
    const page = pages[0];
    if (page === undefined) throw new Error('No page');
    let pip = false;
    page.main.answer = (request) => {
      if (request.kind === 'probe') return report([[true, true, false, 100]], pip);
      pip = request.kind === 'enter';
      return { done: true };
    };
    const { controller, pictured } = controllerOf([window]);
    window.tabs.update(id, { pictureInPicture: 'available' });
    await controller.toggle(window as never, id);
    expect(states(window)).toEqual(['open']);
    expect(pictured.has(page.contents)).toBe(true);
    // The window of picture in picture closed, which the browser learns when it looks again.
    pip = false;
    controller.focused(window as never);
    await settle();
    expect(states(window)).toEqual(['available']);
    expect(pictured.has(page.contents)).toBe(false);
  });
});
