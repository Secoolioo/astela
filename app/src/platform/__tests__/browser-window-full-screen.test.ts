import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindowOptions } from '../electron/browser-window.ts';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const same = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Whatever the browser asks of an object that the test does not care about does nothing. */
function lenient<T extends object>(target: T): T {
  return new Proxy(target, {
    get: (object, key, receiver) =>
      key in object || typeof key === 'symbol' || key === 'then'
        ? Reflect.get(object, key, receiver)
        : () => undefined,
  });
}

/**
 * A window as AppKit and Electron 45 handle it on macOS, as far as the browser uses it. Electron
 * keeps the place that a maximized window or a window in full screen goes back to from where
 * the window was when Electron last placed it, maximized it or put it in full screen
 * (`original_frame_`); a page's full screen (simple full screen) goes back there. AppKit marks
 * the window as in full screen as its animation starts, and Electron reports
 * 'enter-full-screen' and 'leave-full-screen' once the animations have ended; the test plays
 * those steps of AppKit itself.
 */
class FakeWindow extends EventEmitter {
  static last: FakeWindow | undefined;
  static readonly zoomed: Rect = { x: 0, y: 25, width: 1440, height: 875 };
  static readonly screen: Rect = { x: 0, y: 0, width: 1440, height: 900 };
  frame: Rect;
  original: Rect;
  zoomed = false;
  mask = false;
  simple = false;
  /** The frame that AppKit gives the window back when it leaves full screen. */
  saved: Rect | undefined;
  readonly calls: string[] = [];
  readonly contentView = lenient({});

  constructor(options: { x?: number; y?: number; width: number; height: number }) {
    super();
    this.frame = { x: options.x ?? 100, y: options.y ?? 40, ...size(options) };
    this.original = this.frame;
    const window = lenient(this);
    FakeWindow.last = window;
    return window;
  }

  isDestroyed(): boolean {
    return false;
  }
  isMinimized(): boolean {
    return false;
  }
  isFullScreen(): boolean {
    return this.mask;
  }
  isSimpleFullScreen(): boolean {
    return this.simple;
  }
  isMaximized(): boolean {
    return this.zoomed && !this.mask;
  }
  getBounds(): Rect {
    return this.frame;
  }
  getContentBounds(): Rect {
    return this.frame;
  }
  getNormalBounds(): Rect {
    return this.normal() ? this.frame : this.original;
  }
  maximize(): void {
    this.calls.push('maximize');
    if (this.isMaximized()) return;
    if (this.normal()) this.original = this.frame;
    // The zoom has ended when maximize() returns.
    this.place(FakeWindow.zoomed);
    this.emit('maximize');
  }
  setBounds(bounds: Rect): void {
    this.calls.push(`setBounds ${JSON.stringify(bounds)}`);
    if (this.mask) return;
    this.place(bounds);
    this.original = bounds;
  }
  setFullScreen(on: boolean): void {
    this.calls.push(`setFullScreen ${String(on)}`);
    if (on && this.normal()) this.original = this.frame;
  }
  setSimpleFullScreen(on: boolean): void {
    if (on === this.simple) return;
    this.simple = on;
    // Electron 45 takes no note of the place when a page's full screen starts.
    this.place(on ? FakeWindow.screen : this.original);
  }

  /** AppKit starts to move the window into full screen and marks it as in full screen. */
  startEntering(): void {
    this.mask = true;
    this.saved = this.frame;
    this.place(FakeWindow.screen);
  }
  /** Electron reports that the window is in full screen, once the animation has ended. */
  entered(): void {
    this.emit('enter-full-screen');
  }
  /** AppKit starts to move the window out of full screen, back to a frame. */
  startLeaving(frame: Rect | undefined = this.saved): void {
    this.mask = false;
    this.place(frame ?? this.frame);
  }
  /** Electron reports that the window left full screen, once the animation has ended. */
  left(): void {
    this.emit('leave-full-screen');
  }

  private normal(): boolean {
    return !this.zoomed && !this.mask && !this.simple;
  }
  private place(frame: Rect): void {
    this.frame = frame;
    this.zoomed = same(frame, FakeWindow.zoomed);
    this.emit('move');
    this.emit('resize');
  }
}

function size(options: { width: number; height: number }): { width: number; height: number } {
  return { width: options.width, height: options.height };
}

let contentsId = 0;

/** The web contents of a view, whose events the test sends. */
class FakeContents extends EventEmitter {
  readonly id = (contentsId += 1);
  constructor() {
    super();
    return lenient(this);
  }
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  isDestroyed(): boolean {
    return false;
  }
}

class FakeView {
  static readonly made: FakeView[] = [];
  readonly webContents: FakeContents;
  constructor(options: { webContents?: FakeContents } = {}) {
    this.webContents = options.webContents ?? new FakeContents();
    FakeView.made.push(this);
    return lenient(this);
  }
}

vi.mock('electron', () => ({
  BaseWindow: FakeWindow,
  WebContentsView: FakeView,
  screen: lenient({}),
}));

const { BrowserWindowController } = await import('../electron/browser-window.ts');

// The options that a window needs; the others are not given.
const options = {
  shellUrl: 'app://shell/',
  shellOrigin: 'app://shell',
  shellPreload: '/shell.js',
  pagePreload: '/page.js',
  internalPartition: 'internal',
  webPartition: 'web',
  newTabUrl: 'app://newtab/',
  languageArguments: [],
  backgroundColor: () => '#ffffff',
  appearanceArgument: () => '--appearance',
  tabStripPosition: () => 'top',
  blocking: () => 'none',
  gate: lenient({ registerView: () => ({ dispose: () => undefined }) }),
  router: lenient({}),
  logger: lenient({}),
  // The code for web pages and the window commands loads later; these tests need neither.
  webPages: () => new Promise(() => undefined),
  windowCommands: () => new Promise(() => undefined),
} as unknown as BrowserWindowOptions;

const original: Rect = { x: 100, y: 40, width: 800, height: 500 };

function windowOf(controller: unknown): FakeWindow {
  const window = FakeWindow.last;
  if (window === undefined || controller === undefined) throw new Error('No window');
  return window;
}

describe('BrowserWindowController on macOS, in full screen', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  });

  it('keeps a window in full screen that macOS started to move there before Electron reports it', () => {
    const controller = new BrowserWindowController(options, { bounds: original });
    const window = windowOf(controller);
    // The green button: macOS itself, without the browser.
    window.startEntering();
    expect(controller.fullScreen).toBe(true);
    expect(controller.normalPlace).toEqual({ bounds: original, maximized: false });
    window.entered();
    expect(controller.fullScreen).toBe(true);
  });

  it('does not keep the full screen of a page as people’s', () => {
    const controller = new BrowserWindowController(options, { bounds: original });
    const window = windowOf(controller);
    controller.tabs.open('https://example.com/');
    const page = FakeView.made.at(-1)?.webContents;
    // A page in full screen while macOS moves the window into a full screen that people did
    // not ask for, as Electron does for a page without the settings of the browser's tabs.
    page?.emit('enter-html-full-screen');
    window.startEntering();
    window.entered();
    expect(controller.fullScreen).toBe(false);
  });

  it('opens a maximized window in full screen at once, and keeps where it was before', () => {
    const controller = new BrowserWindowController(options, {
      bounds: original,
      maximized: true,
      fullScreen: true,
    });
    const window = windowOf(controller);
    expect(window.calls).toEqual(['maximize', 'setFullScreen true']);
    window.startEntering();
    window.entered();
    expect(controller.fullScreen).toBe(true);
    expect(controller.normalPlace).toEqual({ bounds: original, maximized: true });
  });

  it('asks macOS once more for the full screen of a window that opened in it, should macOS not start it', () => {
    // Right after a browser quit while its window moved into full screen, macOS can drop the
    // request of the window of the next start.
    const controller = new BrowserWindowController(options, { bounds: original, fullScreen: true });
    const window = windowOf(controller);
    expect(window.calls).toEqual(['setFullScreen true']);
    vi.advanceTimersByTime(1000);
    expect(window.calls).toEqual(['setFullScreen true', 'setFullScreen true']);
  });

  it('asks once only, when macOS started to move the window into full screen', () => {
    const controller = new BrowserWindowController(options, { bounds: original, fullScreen: true });
    const window = windowOf(controller);
    window.startEntering();
    vi.advanceTimersByTime(1000);
    expect(window.calls).toEqual(['setFullScreen true']);
  });

  it('keeps the place from before full screen while the window leaves it, and maximizes it again there', () => {
    const controller = new BrowserWindowController(options, {
      bounds: original,
      maximized: true,
      fullScreen: true,
    });
    const window = windowOf(controller);
    window.startEntering();
    window.entered();
    // macOS gives the window back a frame that is not zoomed, as on the runners of CI.
    const unzoomed: Rect = { x: 20, y: 30, width: 1200, height: 700 };
    window.startLeaving(unzoomed);
    expect(controller.fullScreen).toBe(false);
    expect(controller.normalPlace).toEqual({ bounds: original, maximized: true });
    window.left();
    vi.runAllTimers();
    expect(window.isMaximized()).toBe(true);
    expect(window.getNormalBounds()).toEqual(original);
    expect(controller.normalPlace).toEqual({ bounds: original, maximized: true });
  });

  it('leaves a window that macOS gives back maximized as it is', () => {
    const controller = new BrowserWindowController(options, {
      bounds: original,
      maximized: true,
      fullScreen: true,
    });
    const window = windowOf(controller);
    window.startEntering();
    window.entered();
    window.startLeaving();
    window.left();
    vi.runAllTimers();
    expect(window.calls).toEqual(['maximize', 'setFullScreen true']);
    expect(controller.normalPlace).toEqual({ bounds: original, maximized: true });
  });

  it('puts the window back where people moved it, and maximized, once a page leaves full screen', () => {
    const controller = new BrowserWindowController(options, { bounds: original });
    const window = windowOf(controller);
    controller.tabs.open('https://example.com/');
    const page = FakeView.made.at(-1)?.webContents;
    // People move the window, which Electron takes no note of.
    const moved: Rect = { x: 320, y: 200, width: 800, height: 500 };
    window.frame = moved;
    window.emit('move');
    page?.emit('enter-html-full-screen');
    expect(window.isSimpleFullScreen()).toBe(true);
    page?.emit('leave-html-full-screen');
    vi.runAllTimers();
    expect(window.getBounds()).toEqual(moved);
    window.maximize();
    page?.emit('enter-html-full-screen');
    page?.emit('leave-html-full-screen');
    vi.runAllTimers();
    expect(window.isMaximized()).toBe(true);
    expect(window.getNormalBounds()).toEqual(moved);
  });
});

describe('BrowserWindowController on Linux and Windows, in full screen', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
  });

  afterEach(() => {
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  });

  it('counts the full screen of the system as people’s once the system reports it', () => {
    const controller = new BrowserWindowController(options, { bounds: original });
    const window = windowOf(controller);
    window.startEntering();
    expect(controller.fullScreen).toBe(false);
    window.entered();
    expect(controller.fullScreen).toBe(true);
  });
});
