import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HidingRows, Insets, WindowHost } from '../electron/browser-window.ts';
import { hidingRows } from '../electron/hiding-rows.ts';

/** Where the system's pointer is, in the coordinates of the screen, and how often it was asked. */
const cursor = { x: 0, y: 0, asked: 0 };

// The screen tells where the system's pointer is.
vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => {
      cursor.asked += 1;
      return { x: cursor.x, y: cursor.y };
    },
  },
}));

/** A view of the window, by its name. */
interface FakeView {
  readonly name: string;
}

/** What the fake window shows and how it is, which a test changes. */
interface FakeState {
  autoHide: boolean;
  placement: 'own-row' | 'tab-row';
  tabStrip: 'top' | 'bottom' | 'left' | 'right';
  density: 'compact' | 'normal' | 'comfortable';
  integrated: boolean;
  popup: boolean;
  windowFocused: boolean;
  shellFocused: boolean;
  fullScreen: boolean;
  find: boolean;
  popover: { kind: string } | null;
  problem: { kind: string } | null;
  covering: number | undefined;
  active: { id: number; url: string } | undefined;
  shown: FakeView[];
  /** Where the content area is, below the rows, as the window lays it out. */
  insets: Insets;
}

/** The content area below rows of 80 pixels, as the window lays it out. */
const insets: Insets = { top: 80, right: 0, bottom: 0, left: 0 };

/**
 * A window on Linux with the browser's title bar and the rows of the tabs and the toolbar,
 * which records what happens to its views; its layout lays the rows out as the window does.
 */
function windowOf(change: Partial<FakeState> = {}): {
  rows: HidingRows;
  state: FakeState;
  calls: string[];
  stack: FakeView[];
  shellEvents: Map<string, () => void>;
  close: () => void;
  /** The views of the two tabs of the window, of which the first shows. */
  views: readonly [FakeView, FakeView];
} {
  const calls: string[] = [];
  const pageA: FakeView = { name: 'a' };
  const pageB: FakeView = { name: 'b' };
  const shell = {
    name: 'shell',
    setBounds: (bounds: { height: number }): number =>
      calls.push(`bounds ${String(bounds.height)}`),
  };
  const stack: FakeView[] = [shell, pageA];
  const shellEvents = new Map<string, () => void>();
  let closed: (() => void) | undefined;
  const state: FakeState = {
    autoHide: true,
    placement: 'tab-row',
    tabStrip: 'top',
    density: 'normal',
    integrated: true,
    popup: false,
    windowFocused: true,
    shellFocused: false,
    fullScreen: false,
    find: false,
    popover: null,
    problem: null,
    covering: undefined,
    active: { id: 1, url: 'https://a.example/' },
    shown: [pageA],
    insets,
    ...change,
  };
  const base = {
    isDestroyed: (): boolean => false,
    isFullScreen: (): boolean => state.fullScreen,
    isFocused: (): boolean => state.windowFocused,
    // The content of the window starts at 100, 50 on the screen.
    getContentBounds: () => ({ x: 100, y: 50, width: 800, height: 600 }),
    once: (event: string, handler: () => void): void => {
      if (event === 'closed') closed = handler;
    },
    contentView: {
      addChildView: (view: FakeView): void => {
        const at = stack.indexOf(view);
        if (at >= 0) stack.splice(at, 1);
        stack.push(view);
        calls.push(`top ${view.name}`);
      },
    },
    setWindowButtonVisibility: (shown: boolean): void => {
      calls.push(`buttons ${shown ? 'shown' : 'hidden'}`);
    },
    setWindowButtonPosition: (at: { x: number; y: number }): void => {
      calls.push(`buttons at ${String(at.x)} ${String(at.y)}`);
    },
  };
  const entries = new Map([
    [1, { view: pageA }],
    [2, { view: pageB }],
  ]);
  const host = {
    window: {
      window: base,
      shell,
      shellContents: {
        on: (event: string, handler: () => void): void => {
          shellEvents.set(event, handler);
        },
        isFocused: (): boolean => state.shellFocused,
        isDestroyed: (): boolean => false,
      },
      get popup(): boolean {
        return state.popup;
      },
      get findOpen(): boolean {
        return state.find;
      },
      get overlay() {
        return { popover: state.popover, raise: (): number => calls.push('overlay') };
      },
      tabs: {
        get active() {
          return state.active;
        },
        get: (id: number) => (entries.has(id) ? { problem: state.problem } : undefined),
      },
      focusContent: (): number => calls.push('page focused'),
    },
    options: {
      titleBar: () => ({ density: state.density, integrated: state.integrated }),
      tabStripPosition: () => state.tabStrip,
      toolbarPlacement: () => state.placement,
      autoHideToolbar: () => ({ value: state.autoHide, locked: false }),
    },
    entries,
    get shown(): FakeView[] {
      return state.shown;
    },
    shownViewOf: (entry: { view: FakeView }): FakeView => entry.view,
    coveringTab: (): number | undefined => state.covering,
    layout: (): void => rows.layout(800, 600, state.insets),
    publish: (): number => calls.push('shell told'),
  };
  const rows = hidingRows(host as unknown as WindowHost);
  return { rows, state, calls, stack, shellEvents, close: () => closed?.(), views: [pageA, pageB] };
}

/** The names of the views from the bottom to the top. */
const names = (stack: readonly FakeView[]): string[] => stack.map((view) => view.name);

describe('hidingRows', () => {
  // On macOS only an edge of the rows stays (see below); these are the rows of Windows and Linux.
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'linux' });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  });

  it('shows the rows of a new window for a moment, then lets them hide', () => {
    const { rows, calls, stack } = windowOf();
    rows.layout(800, 600, insets);
    // The shell shrinks to its rows before it goes above the page.
    expect(calls).toEqual(['shell told', 'bounds 80', 'top shell', 'overlay']);
    expect(names(stack)).toEqual(['a', 'shell']);
    expect(rows.hiding).toEqual({ shown: true, rest: 'title', height: 40 });
    calls.length = 0;
    vi.advanceTimersByTime(1499);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    // The shell hears of it at once, and stays above the page until it drew the rows hidden.
    expect(calls).toEqual(['shell told', 'bounds 80']);
    expect(names(stack)).toEqual(['a', 'shell']);
    expect(rows.hiding).toEqual({ shown: false, rest: 'title', height: 40 });
    calls.length = 0;
    rows.hold({ pointer: false, focus: false, hidden: true });
    // The page goes above the shell before the shell grows again.
    expect(calls).toEqual(['top a', 'overlay', 'bounds 600']);
    expect(names(stack)).toEqual(['shell', 'a']);
    // The page starts below the title row, and stays where it is while the rows show.
    expect(rows.pageTop()).toBe(40);
  });

  it('holds the rows while the pointer is over them or an element of the shell has the focus', () => {
    const { rows, state, calls, shellEvents } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    rows.hold({ pointer: true, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(true);
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    // The focus in the shell holds them only while the shell has the focus of the window.
    rows.hold({ pointer: false, focus: true, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    state.shellFocused = true;
    shellEvents.get('focus')?.();
    expect(rows.hiding?.shown).toBe(true);
    state.shellFocused = false;
    shellEvents.get('blur')?.();
    expect(rows.hiding?.shown).toBe(false);
    expect(calls).not.toContain('page focused');
  });

  it('gives the page the keys when the focus leaves the shell elements of rows that hide', () => {
    const { rows, state, calls } = windowOf({ shellFocused: true });
    const focused = (): number => calls.filter((call) => call === 'page focused').length;
    rows.layout(800, 600, insets);
    rows.hold({ pointer: false, focus: true, hidden: false });
    vi.advanceTimersByTime(1500);
    expect(rows.hiding?.shown).toBe(true);
    // The focus leaves the controls, and the rows hide: the page gets the keys once.
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    expect(focused()).toBe(1);
    // Also while the pointer holds the rows.
    rows.hold({ pointer: true, focus: true, hidden: false });
    rows.hold({ pointer: true, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(true);
    expect(focused()).toBe(2);
    // Not while another window has the focus, nor when nothing left.
    state.windowFocused = false;
    rows.hold({ pointer: false, focus: true, hidden: false });
    rows.hold({ pointer: false, focus: false, hidden: false });
    rows.hold({ pointer: true, focus: false, hidden: false });
    expect(focused()).toBe(2);
  });

  it('gives the page the keys when the rows hide while the shell has the focus but none of its controls', () => {
    // A click on the title row gives the shell the focus of the window, and no control of it.
    const { rows, state, calls } = windowOf({ shellFocused: true });
    const focused = (): number => calls.filter((call) => call === 'page focused').length;
    rows.layout(800, 600, insets);
    rows.hold({ pointer: true, focus: false, hidden: false });
    vi.advanceTimersByTime(1500);
    expect(focused()).toBe(0);
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    expect(focused()).toBe(1);
    // Rows that hide while the shell does not have the focus leave it where it is.
    state.shellFocused = false;
    rows.hold({ pointer: true, focus: false, hidden: false });
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    expect(focused()).toBe(1);
    // Nor do rows that hide over a problem, which the shell shows.
    state.shellFocused = true;
    state.problem = { kind: 'crashed' };
    rows.hold({ pointer: true, focus: false, hidden: false });
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(focused()).toBe(1);
  });

  it('keeps the shell above the pages until it drew the rows hidden, or for 250 ms', () => {
    const { rows, state, calls, stack } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    expect(names(stack)).toEqual(['a', 'shell']);
    // The shell drew the rows hidden: the page goes above it.
    rows.hold({ pointer: false, focus: false, hidden: true });
    expect(names(stack)).toEqual(['shell', 'a']);
    // What the shell drew before the rows showed again counts for nothing once they hide.
    state.find = true;
    rows.layout(800, 600, insets);
    expect(names(stack)).toEqual(['a', 'shell']);
    state.find = false;
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(false);
    expect(names(stack)).toEqual(['a', 'shell']);
    // Without a word from the shell, as while its window is minimized, the page goes above it
    // after 250 ms.
    calls.length = 0;
    vi.advanceTimersByTime(249);
    expect(names(stack)).toEqual(['a', 'shell']);
    vi.advanceTimersByTime(1);
    expect(names(stack)).toEqual(['shell', 'a']);
    expect(calls).toEqual(['top a', 'overlay', 'bounds 600']);
    // Rows that show again before the shell drew them hidden keep the shell above the page.
    rows.hold({ pointer: true, focus: false, hidden: false });
    rows.hold({ pointer: false, focus: false, hidden: false });
    rows.hold({ pointer: true, focus: false, hidden: false });
    vi.advanceTimersByTime(250);
    expect(names(stack)).toEqual(['a', 'shell']);
  });

  it('holds the rows for the find bar, a popover and every open native menu', () => {
    const { rows, state } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    state.find = true;
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(true);
    state.find = false;
    state.popover = { kind: 'menu' };
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(true);
    state.popover = null;
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(false);
    const first = rows.menu();
    const second = rows.menu();
    expect(rows.hiding?.shown).toBe(true);
    first();
    first();
    expect(rows.hiding?.shown).toBe(true);
    second();
    expect(rows.hiding?.shown).toBe(false);
  });

  it('shows the rows for a moment when the visible tab or its site changes', () => {
    const { rows, state } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    // Another page of the same site does not show them.
    state.active = { id: 1, url: 'https://a.example/other' };
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(false);
    state.active = { id: 1, url: 'https://b.example/' };
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(rows.hiding?.shown).toBe(false);
    state.active = { id: 2, url: 'https://b.example/' };
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(true);
    // A closed window forgets its moment.
    const { rows: closing, calls, close } = windowOf();
    closing.layout(800, 600, insets);
    calls.length = 0;
    close();
    vi.advanceTimersByTime(1500);
    expect(calls).toEqual([]);
  });

  it('lets the rows lie as always once the setting shows them, and in popups', () => {
    const { rows, state, calls, stack } = windowOf();
    rows.layout(800, 600, insets);
    state.autoHide = false;
    calls.length = 0;
    rows.layout(800, 600, insets);
    expect(rows.hiding).toBe(null);
    expect(rows.pageTop()).toBe(undefined);
    expect(names(stack)).toEqual(['shell', 'a']);
    expect(calls).toEqual(['shell told', 'top a', 'overlay', 'bounds 600']);
    vi.advanceTimersByTime(1500);
    // Nor does a site that changed meanwhile show them for a moment once they hide again.
    state.active = { id: 1, url: 'https://b.example/' };
    rows.layout(800, 600, insets);
    state.autoHide = true;
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(false);
    const popup = windowOf({ popup: true });
    popup.rows.layout(800, 600, insets);
    expect(popup.rows.hiding).toBe(null);
    expect(names(popup.stack)).toEqual(['shell', 'a']);
  });

  it('keeps the rows where they always are while no page covers the content area', () => {
    const { rows, state, stack } = windowOf({ problem: { kind: 'crashed' } });
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    // The shell shows the problem in the content area, below its rows.
    expect(rows.hiding?.shown).toBe(true);
    expect(rows.pageTop()).toBe(undefined);
    expect(names(stack)).toEqual(['shell', 'a']);
    state.problem = null;
    state.shown = [];
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(true);
    expect(rows.pageTop()).toBe(undefined);
  });

  it('never shows the rows over a page in full screen', () => {
    const { rows, state, stack } = windowOf({ covering: 1 });
    rows.layout(800, 600, insets);
    rows.hold({ pointer: true, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    expect(names(stack)).toEqual(['shell', 'a']);
    state.covering = undefined;
    rows.layout(800, 600, insets);
    expect(rows.hiding?.shown).toBe(true);
  });

  it('keeps a raised shell above the pages of a split view and above a page attached later', () => {
    const { rows, state, stack, views } = windowOf();
    state.shown = [...views];
    stack.push(views[1]);
    rows.layout(800, 600, insets);
    expect(names(stack)).toEqual(['a', 'b', 'shell']);
    vi.advanceTimersByTime(1500);
    rows.hold({ pointer: false, focus: false, hidden: true });
    // Both pages go back above the shell, from left to right.
    expect(names(stack)).toEqual(['shell', 'a', 'b']);
    // Only a raised shell goes back above a page that the window attaches.
    stack.push({ name: 'c' });
    rows.attached();
    expect(names(stack)).toEqual(['shell', 'a', 'b', 'c']);
    rows.hold({ pointer: true, focus: false, hidden: false });
    stack.push({ name: 'd' });
    rows.attached();
    expect(names(stack).at(-1)).toBe('shell');
  });

  it('holds the rows while the pointer of the system is over a region of them that moves the window', () => {
    const { rows, calls, close } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    rows.hold({ pointer: true, focus: false, hidden: false });
    // The shell loses the pointer over the free room of its rows, 20 px below their top.
    Object.assign(cursor, { x: 500, y: 70 });
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(rows.hiding?.shown).toBe(true);
    // A change of the focus keeps the rows while the pointer stays.
    rows.hold({ pointer: false, focus: true, hidden: false });
    rows.hold({ pointer: false, focus: false, hidden: false });
    vi.advanceTimersByTime(200);
    expect(rows.hiding?.shown).toBe(true);
    // Below the rows of 80 px, the pointer is over the page: the rows hide.
    Object.assign(cursor, { x: 500, y: 130 });
    vi.advanceTimersByTime(199);
    expect(rows.hiding?.shown).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rows.hiding?.shown).toBe(false);
    // Nor do they wait for the pointer when it left them, as beside the window.
    rows.hold({ pointer: true, focus: false, hidden: false });
    Object.assign(cursor, { x: 50, y: 70 });
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    // The shell that gets the pointer again tells by itself when it leaves.
    rows.hold({ pointer: true, focus: false, hidden: false });
    Object.assign(cursor, { x: 500, y: 70 });
    rows.hold({ pointer: false, focus: false, hidden: false });
    rows.hold({ pointer: true, focus: false, hidden: false });
    Object.assign(cursor, { x: 500, y: 300 });
    vi.advanceTimersByTime(1000);
    expect(rows.hiding?.shown).toBe(true);
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(rows.hiding?.shown).toBe(false);
    // A closed window stops asking.
    rows.hold({ pointer: true, focus: false, hidden: false });
    Object.assign(cursor, { x: 500, y: 70 });
    rows.hold({ pointer: false, focus: false, hidden: false });
    calls.length = 0;
    close();
    Object.assign(cursor, { x: 500, y: 300 });
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
  });

  it('follows the pointer also over rows no higher than what stays of them, which lie below the page', () => {
    const { rows, stack } = windowOf({ insets: { ...insets, top: 40 } });
    rows.layout(800, 600, { ...insets, top: 40 });
    vi.advanceTimersByTime(1500);
    rows.hold({ pointer: true, focus: false, hidden: false });
    expect(names(stack)).toEqual(['shell', 'a']);
    Object.assign(cursor, { x: 500, y: 80 });
    rows.hold({ pointer: false, focus: false, hidden: false });
    vi.advanceTimersByTime(1000);
    expect(rows.hiding?.shown).toBe(true);
    // 40 px below the top of the content, the pointer is over the page.
    Object.assign(cursor, { x: 500, y: 90 });
    vi.advanceTimersByTime(200);
    expect(rows.hiding?.shown).toBe(false);
  });

  it('lets the rows go after 10 s over a region that moves the window, should the system not tell', () => {
    const { rows } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    rows.hold({ pointer: true, focus: false, hidden: false });
    Object.assign(cursor, { x: 500, y: 70 });
    rows.hold({ pointer: false, focus: false, hidden: false });
    vi.advanceTimersByTime(9800);
    expect(rows.hiding?.shown).toBe(true);
    vi.advanceTimersByTime(200);
    expect(rows.hiding?.shown).toBe(false);
  });

  it('asks the system nothing while the rows hide or the shell has the pointer', () => {
    const { rows } = windowOf();
    rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    cursor.asked = 0;
    Object.assign(cursor, { x: 500, y: 70 });
    rows.hold({ pointer: false, focus: true, hidden: false });
    rows.hold({ pointer: false, focus: false, hidden: false });
    rows.hold({ pointer: true, focus: false, hidden: false });
    vi.advanceTimersByTime(1000);
    expect(cursor.asked).toBe(0);
    rows.hold({ pointer: false, focus: false, hidden: false });
    expect(cursor.asked).toBe(1);
  });

  it('keeps the shell below the pages while its rows are no higher than what stays of them', () => {
    const { rows, stack } = windowOf();
    rows.layout(800, 40, { ...insets, top: 40 });
    expect(rows.hiding?.shown).toBe(true);
    expect(names(stack)).toEqual(['shell', 'a']);
  });
});

describe('hidingRows on macOS', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
  });

  it('hides the three buttons of the window with the rows, and puts them back in their row', () => {
    const { rows, calls } = windowOf();
    rows.layout(800, 600, insets);
    // An edge of four pixels stays, where the pointer shows the rows.
    expect(rows.hiding).toEqual({ shown: true, rest: 'edge', height: 4 });
    expect(calls.filter((call) => call.startsWith('buttons'))).toEqual([]);
    vi.advanceTimersByTime(1500);
    expect(calls.filter((call) => call.startsWith('buttons'))).toEqual(['buttons hidden']);
    calls.length = 0;
    rows.hold({ pointer: true, focus: false, hidden: false });
    expect(calls.filter((call) => call.startsWith('buttons'))).toEqual([
      'buttons shown',
      'buttons at 14 13',
    ]);
  });

  it('keeps the buttons in full screen, and leaves those of the system title bar alone', () => {
    const fullScreen = windowOf({ fullScreen: true, placement: 'own-row' });
    fullScreen.rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    expect(fullScreen.rows.hiding?.shown).toBe(false);
    expect(fullScreen.calls.filter((call) => call.startsWith('buttons'))).toEqual([]);
    const system = windowOf({ integrated: false });
    system.rows.layout(800, 600, insets);
    vi.advanceTimersByTime(1500);
    expect(system.rows.hiding?.shown).toBe(false);
    expect(system.calls.filter((call) => call.startsWith('buttons'))).toEqual([]);
  });
});
