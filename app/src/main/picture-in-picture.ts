import type { WebContents, WebFrameMain } from 'electron';
import * as v from 'valibot';
import type { Logger } from '../kernel/logging/logger.ts';
import {
  mediaLimits,
  type MediaOutcome,
  type MediaReport,
  type MediaRequest,
} from '../domain/media/media.ts';
import {
  chooseVideo,
  MediaOutcomeSchema,
  MediaReportSchema,
  pictureInPictureState,
} from '../domain/media/picture-in-picture.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { TabId } from '../domain/tabs/tab-service.ts';
import type {
  BrowserWindowController,
  PageEvent,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { TabActivity } from '../platform/electron/tab-activity.ts';
import type { PictureInPictureState } from '../shared/page-tools.ts';
import { PictureInPictureEnabledSetting } from './core-settings.ts';
import { PageScripts, type PageScriptCall } from './page-scripts.ts';

/** What picture in picture needs from the browser process. */
export interface PictureInPictureDependencies {
  readonly windows: WindowManager;
  readonly settings: SettingsService;
  /** The folder of the scripts that the browser runs in web pages. */
  readonly scripts: string;
  /** What the pages of tabs do, such as whether their media play, once its code has loaded. */
  readonly activity: () => TabActivity | undefined;
  readonly logger: Logger;
}

/** A frame of a page that the media script runs in. */
interface MediaTarget {
  readonly frame: WebFrameMain;
  /** Whether it is the main frame, where the script runs in the browser's isolated world. */
  readonly main: boolean;
  /** The address of the document that the browser chose; the script runs in no other. */
  readonly page: string;
}

/** A frame of a page that the media script was asked, with what it reported. */
interface FrameMedia extends MediaTarget {
  readonly report: MediaReport;
}

/** How long a look at the videos of a frame may take, in milliseconds. */
const lookTime = 3000;
/** How long a request that shows a video or ends picture in picture may take, in milliseconds. */
const actTime = 5000;
/**
 * How long after a click a request may still show a video, in milliseconds: the context menu
 * waits that long at most for a page to load, and a call must not show a video much later.
 */
const actWindow = 3000;
/** How long the media of a page stay quiet before the browser looks at its videos again. */
const quietTime = 150;
/** The least time between two looks at the videos of a page after its media, in milliseconds. */
const lookGap = 250;
/**
 * How long after the first of many changes of the media of a page the browser looks at its
 * videos all the same, in milliseconds, as they may never stay quiet.
 */
const longestWait = 1000;

/**
 * Picture in picture, which loads with the first video that plays or pauses while it is on. The
 * browser learns of no change of picture in picture, so it looks at the videos of a page with
 * the media script: after its media play or pause, when its tab shows, when its window gets the
 * focus, once a page that loaded meanwhile has loaded, for each click and before its tab goes
 * to sleep. That look is the only source of the state of a tab; one that the main frame did not
 * answer tells nothing. A click on the button, the menus or the command shows the video of the
 * page that suits it best in picture in picture, or ends picture in picture: the browser runs
 * the media script in the frame of the video with an activation of its own, as the click in the
 * browser's shell is none of the page's, at once and only in the document that it chose. At
 * most one tab shows a video in picture in picture, in all windows.
 */
export class PictureInPictureController {
  private readonly windows: WindowManager;
  private readonly settings: SettingsService;
  private readonly activity: () => TabActivity | undefined;
  private readonly logger: Logger;
  private readonly scripts: PageScripts;
  /**
   * The looks at the videos of pages that wait for their media to be quiet, with the time of the
   * first change that they wait for, by the monotonic clock.
   */
  private readonly timers = new Map<
    WebContents,
    { readonly timer: NodeJS.Timeout; readonly since: number }
  >();
  /** When the browser last looked at the videos of each page, by the monotonic clock. */
  private readonly lookedAt = new WeakMap<WebContents, number>();
  /** The number of the last look at each page; the answer of an older look comes too late. */
  private readonly looks = new WeakMap<WebContents, number>();
  /** What a click does on each page, one after the other. */
  private readonly clicks = new WeakMap<WebContents, Promise<void>>();
  /** The pages that are looked at once they have loaded, as they loaded when they were not. */
  private readonly loading = new WeakSet<WebContents>();
  /**
   * The frame of each page, other than the main frame, in which the browser showed a video in
   * picture in picture: a look asks it first, also when the page has more frames than it asks.
   */
  private readonly shownIn = new WeakMap<WebContents, WebFrameMain>();

  /** @param deps - What picture in picture needs. */
  constructor(deps: PictureInPictureDependencies) {
    this.windows = deps.windows;
    this.settings = deps.settings;
    this.activity = deps.activity;
    this.logger = deps.logger;
    this.scripts = new PageScripts(deps.scripts);
    deps.settings.onDidChange(({ keys }) => {
      if (!keys.includes(PictureInPictureEnabledSetting.key)) return;
      if (this.on()) this.lookAtActiveTabs();
      else this.turnOff();
    });
    this.lookAtActiveTabs();
  }

  /**
   * Takes note of what happened to the web page of a tab: once its media play or pause, the
   * browser looks at its videos when the tab is the active one of its window, or has a video in
   * picture in picture, after a short quiet time; other tabs are looked at when they show and
   * their media play, or they had a video.
   * @param window - The window of the tab.
   * @param id - The tab.
   * @param contents - Its page.
   * @param event - What happened.
   */
  page(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
    event: Extract<PageEvent, 'media' | 'shown'>,
  ): void {
    if (!this.on()) return;
    const tab = window.tabs.get(id);
    if (event === 'media') {
      if (window.tabs.active?.id === id || tab?.pictureInPicture === 'open') {
        this.soon(window, id, contents);
      }
    } else if (this.worthALook(window, id, contents)) {
      void this.look(window, id, contents);
    }
  }

  /**
   * Takes note that a window got the focus, as after the button of the picture in picture
   * window that goes back to its tab and ends picture in picture: the tabs with a video in
   * picture in picture and the active tab of the window are looked at again. While picture in
   * picture is off, only the pages that showed a video in it are, which stay awake until then.
   * @param window - The window.
   */
  focused(window: BrowserWindowController): void {
    const activity = this.activity();
    for (const other of this.windows.all) {
      for (const tab of other.tabs.allTabs) {
        const contents = other.webContentsOf(tab.id);
        if (contents === undefined) continue;
        if (tab.pictureInPicture === 'open' || activity?.showsPictureInPicture(contents) === true) {
          void this.look(other, tab.id, contents);
        }
      }
    }
    if (!this.on()) return;
    const active = window.tabs.active;
    const contents = active === undefined ? undefined : window.webContentsOf(active.id);
    if (active === undefined || contents === undefined || active.pictureInPicture === 'open') {
      return;
    }
    if (this.worthALook(window, active.id, contents)) void this.look(window, active.id, contents);
  }

  /**
   * Shows the video of a tab's page that suits picture in picture best in it, or ends picture in
   * picture, as the button that the tab showed says: pressed, it ends it, otherwise it starts
   * it. A page that ended or started picture in picture itself meanwhile only shows its state.
   * @param window - The window.
   * @param id - The tab.
   * @param pressed - Whether the button showed itself pressed when it was clicked. The browser
   *   may have looked at the page since, as after its media changed, and learned what the shell
   *   did not show yet; the click does what it showed. Without it, as for the command, the
   *   state of the tab counts once the click's turn comes.
   */
  toggle(window: BrowserWindowController, id: TabId, pressed?: boolean): Promise<void> {
    const contents = window.webContentsOf(id);
    if (!this.on() || contents === undefined) return Promise.resolve();
    return this.inTurn(contents, async () => {
      const open = pressed ?? window.tabs.get(id)?.pictureInPicture === 'open';
      // A look that tells nothing, as while the page loads, chooses no video either.
      const frames = await this.look(window, id, contents);
      const choice = frames === undefined ? undefined : chooseVideo(frames.map(reportOf));
      const target = choice === undefined ? undefined : frames?.[choice.frame];
      if (choice === undefined || target === undefined || !this.on()) return;
      if ((choice.kind === 'exit') !== open) return;
      await this.act(
        contents,
        target,
        choice.kind === 'exit'
          ? { kind: 'exit', page: target.page }
          : {
              kind: 'enter',
              index: choice.video,
              until: Date.now() + actWindow,
              page: target.page,
            },
      );
      await this.look(window, id, contents);
    });
  }

  /**
   * Shows the video that a context menu was opened for in picture in picture, or ends picture
   * in picture, where Chromium said that it shows. The media script runs in the frame of the
   * click, or in the highest frame above it of the same origin, which reaches the documents of
   * the frames of its origin; the point of the click counts in the main frame. In the main
   * frame, it waits for a page that still loads, at most until shortly after the click, and
   * runs only in the page that the menu was opened on.
   * @param window - The window of the tab.
   * @param id - The tab.
   * @param contents - The page of the tab.
   * @param menu - The frame of the click, the point in the view, the address of the video and
   *   of the page, and whether to show the video in picture in picture or to end picture in
   *   picture.
   */
  atPoint(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
    menu: {
      readonly frame: WebFrameMain | null | undefined;
      readonly x: number;
      readonly y: number;
      readonly src: string;
      readonly page: string;
      readonly enter: boolean;
    },
  ): Promise<void> {
    if (!this.on() || window.webContentsOf(id) !== contents) return Promise.resolve();
    const until = Date.now() + actWindow;
    return this.inTurn(contents, async () => {
      if (menu.frame?.isDestroyed() === true || menu.frame?.detached === true) return;
      const main = contents.mainFrame;
      const frame = rootOf(menu.frame ?? main);
      const inMain = frame.frameTreeNodeId === main.frameTreeNodeId;
      if (inMain && !(await loaded(contents, until))) return;
      const same = !contents.isDestroyed() && contents.getURL() === menu.page;
      if (!same || !this.on() || window.webContentsOf(id) !== contents || frame.isDestroyed()) {
        return;
      }
      const target = { frame, main: inMain, page: inMain ? menu.page : frame.url };
      // A point of the view is one in CSS pixels of the main frame once the zoom is out of it.
      const zoom = contents.getZoomFactor();
      await this.act(
        contents,
        target,
        menu.enter
          ? {
              kind: 'enterAt',
              point: inMain ? { x: menu.x / zoom, y: menu.y / zoom } : null,
              src: menu.src.slice(0, 8192),
              until,
              page: target.page,
            }
          : { kind: 'exit', page: target.page },
      );
      await this.look(window, id, contents);
    });
  }

  /**
   * Looks at the videos of the pages of tabs before they go to sleep: a page may show a video
   * in picture in picture that it started itself, which keeps its tab awake. It looks also while
   * picture in picture is off, as the page did it, not the browser; the tabs then keep their
   * state of `none`, and only what keeps a page awake learns of it (`TabActivity`).
   * @param window - The window of the tabs.
   * @param ids - The tabs.
   */
  async beforeSleep(window: BrowserWindowController, ids: readonly TabId[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const contents = window.webContentsOf(id);
        if (contents !== undefined) await this.look(window, id, contents);
      }),
    );
  }

  /** Whether picture in picture is on, which a setting or a policy can turn off. */
  private on(): boolean {
    return this.settings.get(PictureInPictureEnabledSetting);
  }

  /**
   * Whether a tab's page may have a video: its media play, or it had a video before, also in
   * picture in picture while picture in picture was off, or the browser showed one of its
   * videos in picture in picture, which a look while the page loaded did not see.
   */
  private worthALook(window: BrowserWindowController, id: TabId, contents: WebContents): boolean {
    const activity = this.activity();
    return (
      window.tabs.get(id)?.pictureInPicture !== 'none' ||
      this.shownIn.has(contents) ||
      activity?.plays(contents) === true ||
      activity?.showsPictureInPicture(contents) === true
    );
  }

  /** Looks at the active tab of every window that may have a video, as when it turns on. */
  private lookAtActiveTabs(): void {
    if (!this.on()) return;
    for (const window of this.windows.all) {
      const active = window.tabs.active;
      const contents = active === undefined ? undefined : window.webContentsOf(active.id);
      if (active !== undefined && contents !== undefined)
        this.page(window, active.id, contents, 'shown');
    }
  }

  /**
   * Looks at the videos of a page once its media were quiet for `quietTime`, and at the latest
   * `longestWait` after the first change, as a page can play and pause many times; at most once
   * in `lookGap`. Each change plans the look anew.
   */
  private soon(window: BrowserWindowController, id: TabId, contents: WebContents): void {
    const now = performance.now();
    const planned = this.timers.get(contents);
    if (planned !== undefined) clearTimeout(planned.timer);
    const since = planned?.since ?? now;
    const last = this.lookedAt.get(contents);
    const wait = Math.max(
      Math.min(quietTime, since + longestWait - now),
      last === undefined ? 0 : last + lookGap - now,
      0,
    );
    const timer = setTimeout(() => {
      this.timers.delete(contents);
      if (!contents.isDestroyed()) void this.look(window, id, contents);
    }, wait);
    this.timers.set(contents, { timer, since });
  }

  /**
   * Looks at the videos of a page again once it has loaded, if it is still the page of its tab
   * and worth a look then; once for each page, however often it was looked at meanwhile.
   */
  private afterLoad(window: BrowserWindowController, id: TabId, contents: WebContents): void {
    if (!this.on() || this.loading.has(contents) || contents.isDestroyed()) return;
    this.loading.add(contents);
    contents.once('did-stop-loading', () => {
      this.loading.delete(contents);
      if (
        this.on() &&
        !contents.isDestroyed() &&
        window.webContentsOf(id) === contents &&
        this.worthALook(window, id, contents)
      ) {
        this.soon(window, id, contents);
      }
    });
  }

  /**
   * Asks the frames of a tab's page about their videos and gives the tab the state that they
   * tell, unless a newer look started meanwhile. Electron runs a script in the main frame only
   * once every frame of the page has loaded, and then in whatever page has loaded by then, so a
   * page that loads is not asked, and is looked at again once it has loaded.
   * @returns The frames with their reports, the main frame first, or `undefined` for a look
   *   that tells nothing: the page loads, left the tab, moved to another address meanwhile, or
   *   its main frame did not answer. The tab then keeps its state.
   */
  private async look(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
  ): Promise<FrameMedia[] | undefined> {
    // A look at a page that loads asks nothing, but an older one that answers later comes from
    // the page before.
    const look = (this.looks.get(contents) ?? 0) + 1;
    this.looks.set(contents, look);
    const page = contents.isDestroyed() ? '' : contents.getURL();
    if (!runsNow(contents)) {
      this.afterLoad(window, id, contents);
      return undefined;
    }
    this.lookedAt.set(contents, performance.now());
    let frames: FrameMedia[];
    try {
      frames = await this.reports(contents, page);
    } catch (error) {
      // The page closed, or one of its frames went away while the browser listed them.
      this.logger.debug('The frames of a page could not be listed', { error: errorName(error) });
      return undefined;
    }
    if (contents.isDestroyed() || window.webContentsOf(id) !== contents) return undefined;
    if (!runsNow(contents)) this.afterLoad(window, id, contents);
    if (frames[0]?.main !== true || !runsNow(contents) || contents.getURL() !== page) {
      return undefined;
    }
    if (this.looks.get(contents) === look) {
      this.set(window, id, contents, pictureInPictureState(frames.map(reportOf)));
    }
    return frames;
  }

  /**
   * The reports of the frames of a page that the media script must ask on their own: the main
   * frame, the frame in which the browser showed a video in picture in picture, and each other
   * frame whose document the frame around it cannot reach, at most `mediaLimits.frames`. A
   * frame that does not answer in time, or answers what is no report, has none.
   * @param contents - The page.
   * @param page - The address of the page that the look is for.
   */
  private async reports(contents: WebContents, page: string): Promise<FrameMedia[]> {
    const main = contents.mainFrame;
    const others = main.framesInSubtree.filter(
      (frame) =>
        frame.frameTreeNodeId !== main.frameTreeNodeId &&
        frame.parent !== null &&
        !reaches(frame.parent, frame),
    );
    const shown = this.shownIn.get(contents);
    const first = others.find((frame) => frame.frameTreeNodeId === shown?.frameTreeNodeId);
    const frames = [
      main,
      ...(first === undefined ? others : [first, ...others.filter((frame) => frame !== first)]),
    ].slice(0, mediaLimits.frames);
    const answers = await Promise.all(
      frames.map(async (frame, index): Promise<FrameMedia | undefined> => {
        const target = { frame, main: index === 0, page: index === 0 ? page : frame.url };
        try {
          const answer = await this.run(
            contents,
            target,
            { kind: 'probe' },
            { timeoutMs: lookTime },
          );
          const parsed = v.safeParse(MediaReportSchema, answer);
          return parsed.success
            ? { frame, main: target.main, page: target.page, report: parsed.output }
            : undefined;
        } catch (error) {
          this.logger.debug('A frame could not be asked about its videos', {
            error: errorName(error),
          });
          return undefined;
        }
      }),
    );
    return answers.filter((answer) => answer !== undefined);
  }

  /**
   * Asks the media script of a frame to show a video in picture in picture, with an activation
   * that only that frame gets, or to end picture in picture, without one; at once, in the
   * document that the browser chose, or not at all.
   */
  private async act(
    contents: WebContents,
    target: MediaTarget,
    request: Exclude<MediaRequest, { readonly kind: 'probe' }>,
  ): Promise<MediaOutcome | undefined> {
    try {
      const answer = await this.run(contents, target, request, {
        gesture: request.kind !== 'exit',
        timeoutMs: actTime,
      });
      const parsed = v.safeParse(MediaOutcomeSchema, answer);
      if (parsed.success && !parsed.output.done) {
        this.logger.debug('Picture in picture did not change', {
          error: parsed.output.error ?? 'none',
        });
      }
      // A video that shows in a frame of its own is looked for there first from now on.
      if (parsed.success && parsed.output.done && request.kind !== 'exit') {
        if (target.main) this.shownIn.delete(contents);
        else this.shownIn.set(contents, target.frame);
      }
      return parsed.success ? parsed.output : undefined;
    } catch (error) {
      this.logger.debug('Picture in picture could not be asked', { error: errorName(error) });
      return undefined;
    }
  }

  /**
   * Runs the media script in a frame, at once and in the document of the target only: in the
   * browser's isolated world in the main frame.
   */
  private run(
    contents: WebContents,
    target: MediaTarget,
    request: MediaRequest,
    call: PageScriptCall,
  ): Promise<unknown> {
    if (target.frame.isDestroyed() || target.frame.detached) {
      return Promise.reject(new Error('The frame is gone'));
    }
    const checked = { ...call, page: target.page };
    return target.main
      ? this.scripts.inMainFrame(contents, 'media', request, checked)
      : this.scripts.inFrame(target.frame, 'media', request, checked);
  }

  /** Runs what a click does on a page after what the clicks before it did. */
  private inTurn(contents: WebContents, work: () => Promise<void>): Promise<void> {
    const done = (this.clicks.get(contents) ?? Promise.resolve())
      .then(work)
      .catch((error: unknown) => {
        this.logger.warn('Picture in picture failed', { error: errorName(error) });
      });
    this.clicks.set(contents, done);
    return done;
  }

  /**
   * Gives a tab a state of picture in picture. What keeps pages awake learns whether the page
   * shows a video in it also while picture in picture is off, and one that stopped counts as
   * used until now; the tab shows its state only while picture in picture is on. A video that
   * shows in picture in picture takes the place of the one that showed before, in any window,
   * which is looked at again.
   */
  private set(
    window: BrowserWindowController,
    id: TabId,
    contents: WebContents,
    state: PictureInPictureState,
  ): void {
    this.activity()?.pictureInPicture(contents, state === 'open');
    if (state !== 'open') this.shownIn.delete(contents);
    if (!this.on()) return;
    window.tabs.update(id, { pictureInPicture: state });
    if (state !== 'open') return;
    for (const other of this.windows.all) {
      for (const tab of other.tabs.allTabs) {
        if (tab.pictureInPicture !== 'open' || (other === window && tab.id === id)) continue;
        other.tabs.update(tab.id, { pictureInPicture: 'available' });
        const replaced = other.webContentsOf(tab.id);
        if (replaced !== undefined) this.soon(other, tab.id, replaced);
      }
    }
  }

  /**
   * Forgets every state and every look that waits, as when picture in picture turns off. A
   * video that shows in picture in picture stays, and keeps its page awake.
   */
  private turnOff(): void {
    for (const { timer } of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const window of this.windows.all) {
      for (const tab of window.tabs.allTabs) {
        if (tab.pictureInPicture !== 'none')
          window.tabs.update(tab.id, { pictureInPicture: 'none' });
      }
    }
  }
}

/** What a frame reported. */
function reportOf(frame: FrameMedia): MediaReport {
  return frame.report;
}

/**
 * Whether the main frame of a page runs a script at once: it shows a page that has loaded, as
 * Electron holds a call back until then.
 */
function runsNow(contents: WebContents): boolean {
  return !contents.isDestroyed() && contents.getURL() !== '' && !contents.isLoadingMainFrame();
}

/**
 * Waits until the main frame of a page runs a script at once, at most until a time of the
 * clock.
 * @returns Whether it does.
 */
function loaded(contents: WebContents, until: number): Promise<boolean> {
  if (runsNow(contents)) return Promise.resolve(true);
  return new Promise((done) => {
    const stopped = (): void => {
      clearTimeout(timer);
      done(runsNow(contents));
    };
    const timer = setTimeout(
      () => {
        contents.off('did-stop-loading', stopped);
        done(false);
      },
      Math.max(0, until - Date.now()),
    );
    contents.once('did-stop-loading', stopped);
  });
}

/**
 * The frame that the media script runs in for a frame: the frame itself, or the highest frame
 * above it from where the script reaches its document, through frames of its origin.
 */
function rootOf(frame: WebFrameMain): WebFrameMain {
  let root = frame;
  for (let parent = root.parent; parent !== null && reaches(parent, root); parent = root.parent) {
    root = parent;
  }
  return root;
}

/**
 * Whether the media script in a frame reaches the document of a frame in it: both have the same
 * origin, and it is no opaque origin, as of a sandboxed frame, which reaches no other document.
 */
function reaches(parent: WebFrameMain, frame: WebFrameMain): boolean {
  return frame.origin !== 'null' && frame.origin === parent.origin;
}

/** The name of an error, for the log, which never holds an address of a page. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
