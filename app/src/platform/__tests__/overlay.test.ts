import type { Input } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayContent } from '../../shared/ipc/overlay-contracts.ts';
import { shortcutTable } from '../../shared/shortcuts.ts';
import type { BrowserWindowController, OverlayHandle } from '../electron/browser-window.ts';
import type { IpcGate } from '../electron/ipc-gate.ts';
import type { IpcRouter } from '../electron/ipc-router.ts';
import { exitFallbackMs, WindowOverlay, type OverlayOpenOptions } from '../electron/overlay.ts';

type InputHandler = (event: { preventDefault(): void }, input: Input) => void;

// The view of the overlay, as far as the overlay uses it, which records what happens to it.
vi.mock('electron', () => ({
  WebContentsView: class {
    bounds: unknown;
    readonly webContents = {
      id: 41,
      focused: false,
      loading: false,
      crashed: false,
      loads: 0,
      handlers: new Map<string, InputHandler>(),
      focus(): void {
        this.focused = true;
      },
      isFocused(): boolean {
        return this.focused;
      },
      on(event: string, handler: InputHandler): void {
        this.handlers.set(event, handler);
      },
      loadURL(): Promise<void> {
        this.loads += 1;
        this.crashed = false;
        return Promise.resolve();
      },
      isLoading(): boolean {
        return this.loading;
      },
      isCrashed(): boolean {
        return this.crashed;
      },
      isDestroyed: (): boolean => false,
      close: (): void => undefined,
    };
    setBounds(bounds: unknown): void {
      this.bounds = bounds;
    }
    setBackgroundColor(): void {}
  },
}));

/** The view of the overlay, as the mock of Electron makes it. */
interface FakeView {
  readonly bounds: unknown;
  readonly webContents: {
    focused: boolean;
    loading: boolean;
    crashed: boolean;
    readonly loads: number;
    readonly handlers: Map<string, InputHandler>;
  };
}

/** Sends an event of the page's contents, such as a crash, as Electron does. */
function emitContents(view: FakeView | undefined, event: string): void {
  (view?.webContents.handlers.get(event) as (() => void) | undefined)?.();
}

/** A window with its views, whose focus, commands and events the tests read. */
function windowOf(): {
  window: BrowserWindowController;
  overlay: WindowOverlay;
  published: unknown[];
  children: FakeView[];
  focus: string[];
  executed: string[];
  emit: (event: string) => void;
} {
  const listeners = new Map<string, (() => void)[]>();
  const children: FakeView[] = [];
  const focus: string[] = [];
  const executed: string[] = [];
  const published: unknown[] = [];
  const listen = (event: string, listener: () => void): void => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  };
  const base = {
    isDestroyed: () => false,
    isFocused: () => true,
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    contentView: {
      addChildView: (view: FakeView) => {
        if (!children.includes(view)) children.push(view);
      },
      removeChildView: (view: FakeView) => {
        children.splice(children.indexOf(view), 1);
      },
    },
    on: listen,
    once: listen,
  };
  const window = {
    window: base,
    isPrivate: false,
    overlay: undefined as OverlayHandle | undefined,
    shellContents: { focus: () => void focus.push('shell'), isFocused: () => false },
    focusContent: () => void focus.push('content'),
    shortcuts: () => shortcutTable('linux'),
    execute: (command: string) => void executed.push(command),
  } as unknown as BrowserWindowController;
  const overlay = new WindowOverlay(window, {
    url: 'app://overlay/',
    preload: 'preload.js',
    partition: 'internal',
    appearanceArgument: () => '--appearance=light',
    languageArguments: [],
    gate: { registerView: () => ({ dispose: () => undefined }) } as unknown as IpcGate,
    router: {
      publish: (_event: unknown, _contents: unknown, content: unknown) =>
        void published.push(content),
    } as unknown as IpcRouter,
  });
  const emit = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return { window, overlay, published, children, focus, executed, emit };
}

const shield: OverlayContent = {
  kind: 'shield',
  anchor: { x: 1100, y: 8, width: 28, height: 28 },
  site: 'example.com',
  blocked: 2,
  on: true,
  available: true,
  failed: false,
};

const suggestions: OverlayContent = { kind: 'suggestions', items: [], selected: -1 };

/** A key press as Electron reports it before the page sees it. */
function key(name: string, type: Input['type'] = 'keyDown', more: Partial<Input> = {}): Input {
  return {
    type,
    key: name,
    code: name,
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: name === 'Alt' && type === 'keyDown',
    meta: false,
    location: 0,
    modifiers: [],
    ...more,
  };
}

/** Sends a key press to the page of the overlay; whether the page still gets it. */
function press(view: FakeView | undefined, input: Input): boolean {
  let prevented = false;
  view?.webContents.handlers.get('before-input-event')?.(
    { preventDefault: () => void (prevented = true) },
    input,
  );
  return !prevented;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WindowOverlay', () => {
  it('shows a popover over the window, takes the focus and tells which button it belongs to', () => {
    const { window, overlay, published, children } = windowOf();
    const options: OverlayOpenOptions = { popover: { kind: 'shield', folder: null } };
    overlay.open(shield, options);
    expect(children).toHaveLength(1);
    expect(children[0]?.bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(children[0]?.webContents.focused).toBe(true);
    expect(published).toEqual([shield]);
    expect(window.overlay).toBe(overlay);
    expect(overlay.coversWindow).toBe(true);
    expect(overlay.popover).toEqual({ kind: 'shield', folder: null });
    // Only popovers that say so give way to the questions of sites.
    expect(overlay.yieldsToQuestions).toBe(false);
    overlay.open(shield, { ...options, yieldsToQuestions: true });
    expect(overlay.yieldsToQuestions).toBe(true);
  });

  it('keeps the view in the window until the popover has left the page, or a moment at most', () => {
    const { window, overlay, published, children, focus } = windowOf();
    overlay.open(shield);
    overlay.close();
    expect(published.at(-1)).toBeNull();
    expect(window.overlay).toBeUndefined();
    expect(overlay.popover).toBeNull();
    expect(overlay.yieldsToQuestions).toBe(true);
    // The focus goes back to the page at once; the view stays while the popover leaves.
    expect(focus).toEqual(['content']);
    expect(children).toHaveLength(1);
    overlay.exited();
    expect(children).toHaveLength(0);
    // Without the word of the page, the view leaves after the fallback.
    overlay.open(shield);
    overlay.close();
    vi.advanceTimersByTime(exitFallbackMs - 1);
    expect(children).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(children).toHaveLength(0);
  });

  it('gives the focus back to the shell after a popover that the keyboard opened there', () => {
    const { overlay, focus } = windowOf();
    overlay.open(shield, { focusBack: 'shell' });
    overlay.close();
    expect(focus).toEqual(['shell']);
  });

  it('lets a popover that opens take the place of one that leaves, and keeps the view', () => {
    const { overlay, children } = windowOf();
    overlay.open(shield);
    overlay.close();
    overlay.open(shield);
    vi.advanceTimersByTime(exitFallbackMs * 2);
    expect(children).toHaveLength(1);
    // A page that reports the end of an earlier exit takes nothing away.
    overlay.exited();
    expect(children).toHaveLength(1);
  });

  it('takes the view away at once for the suggestions, a change of size and close now', () => {
    const { overlay, children, focus, emit } = windowOf();
    const bounds = { x: 100, y: 40, width: 600, height: 300 };
    overlay.open(suggestions, { bounds });
    expect(children[0]?.bounds).toEqual(bounds);
    // A list below the address bar leaves the focus where the typing goes on.
    expect(children[0]?.webContents.focused).toBe(false);
    expect(overlay.coversWindow).toBe(false);
    overlay.close();
    expect(children).toHaveLength(0);
    expect(focus).toEqual([]);
    overlay.open(shield);
    emit('resize');
    expect(children).toHaveLength(0);
    overlay.open(shield);
    overlay.close();
    // A popover that still leaves goes at once as well.
    overlay.close('now');
    expect(children).toHaveLength(0);
  });

  it('calls what the content asked for once, when it closes or something takes its place', () => {
    const { overlay } = windowOf();
    const closed: string[] = [];
    overlay.open(shield, { onClose: () => void closed.push('first') });
    overlay.open(shield, { onClose: () => void closed.push('second') });
    expect(closed).toEqual(['first']);
    overlay.close();
    overlay.close();
    expect(closed).toEqual(['first', 'second']);
  });

  it('closes with Escape, or leaves it to a page that handles it, never while text is composed', () => {
    const { overlay, children } = windowOf();
    overlay.open(shield);
    expect(press(children[0], key('Escape', 'keyDown', { isComposing: true }))).toBe(true);
    expect(overlay.content).toEqual(shield);
    expect(press(children[0], key('Escape'))).toBe(false);
    expect(overlay.content).toBeNull();
    overlay.exited();
    overlay.open(shield, { keys: { escape: 'page' } });
    expect(press(children[0], key('Escape'))).toBe(true);
    expect(overlay.content).toEqual(shield);
  });

  it('closes with Escape itself while the page loads or does not answer', () => {
    const { overlay, children } = windowOf();
    overlay.open(shield, { keys: { escape: 'page' } });
    const view = children[0];
    if (view === undefined) throw new Error('No view');
    // The first popover of a window may come before its page.
    view.webContents.loading = true;
    expect(press(view, key('Escape', 'keyDown', { isComposing: true }))).toBe(true);
    expect(overlay.content).toEqual(shield);
    expect(press(view, key('Escape'))).toBe(false);
    expect(overlay.content).toBeNull();
    // Nothing showed that could leave, so the view leaves at once.
    expect(children).toHaveLength(0);
    view.webContents.loading = false;
    overlay.open(shield, { keys: { escape: 'page' } });
    emitContents(view, 'unresponsive');
    expect(overlay.content).toBeNull();
    expect(children).toHaveLength(0);
    // While the page hangs, the next popover closes with Escape too, until the page answers.
    overlay.open(shield, { keys: { escape: 'page' } });
    expect(press(view, key('Escape'))).toBe(false);
    expect(overlay.content).toBeNull();
    emitContents(view, 'responsive');
    overlay.open(shield, { keys: { escape: 'page' } });
    expect(press(view, key('Escape'))).toBe(true);
    expect(overlay.content).toEqual(shield);
  });

  it('leaves the window when its page crashes, and loads the page again for the next popover', () => {
    const { overlay, children, window } = windowOf();
    overlay.open(shield, { keys: { escape: 'page' } });
    const view = children[0];
    if (view === undefined) throw new Error('No view');
    expect(view.webContents.loads).toBe(1);
    view.webContents.crashed = true;
    emitContents(view, 'render-process-gone');
    expect(overlay.content).toBeNull();
    expect(window.overlay).toBeUndefined();
    expect(children).toHaveLength(0);
    overlay.open(shield);
    expect(children).toHaveLength(1);
    expect(view.webContents.loads).toBe(2);
    // A page that did not crash loads once.
    overlay.close('now');
    overlay.prepare();
    overlay.open(shield);
    expect(view.webContents.loads).toBe(2);
  });

  it('loads the page again after its process ended, also when Chromium calls it a clean exit', () => {
    const { overlay, children, published } = windowOf();
    overlay.open(shield, { keys: { escape: 'page' } });
    const view = children[0];
    if (view === undefined) throw new Error('No view');
    // With the sandbox of Linux, a renderer that crashed can count as one that exited cleanly,
    // which Electron does not count as crashed.
    emitContents(view, 'render-process-gone');
    expect(view.webContents.crashed).toBe(false);
    expect(overlay.content).toBeNull();
    expect(children).toHaveLength(0);
    // The page that ended has nothing to clear.
    expect(published).toEqual([shield]);
    overlay.open(shield, { keys: { escape: 'page' } });
    expect(view.webContents.loads).toBe(2);
    overlay.close('now');
    overlay.open(shield);
    expect(view.webContents.loads).toBe(2);
  });

  it('closes for a shortcut of the window and runs it, unless the popover takes it', () => {
    const { overlay, children, executed } = windowOf();
    overlay.open(shield);
    expect(press(children[0], key('t', 'keyDown', { control: true, code: 'KeyT' }))).toBe(false);
    expect(overlay.content).toBeNull();
    expect(executed).toEqual(['tab.new']);
    const asked: string[] = [];
    overlay.open(shield, {
      keys: { onCommand: (command) => (asked.push(command), command === 'menu.open') },
    });
    expect(press(children[0], key('F10'))).toBe(false);
    expect(asked).toEqual(['menu.open']);
    expect(overlay.content).toEqual(shield);
    expect(executed).toEqual(['tab.new']);
    // A key that is no shortcut goes on to the page.
    expect(press(children[0], key('a'))).toBe(true);
  });

  it.runIf(process.platform !== 'darwin')(
    'closes a menu with Alt alone, but not after another key or the loss of the focus',
    () => {
      const { overlay, children, emit } = windowOf();
      overlay.open(shield, { keys: { closeOnAlt: true } });
      press(children[0], key('Alt'));
      press(children[0], key('ArrowDown'));
      press(children[0], key('Alt', 'keyUp'));
      expect(overlay.content).toEqual(shield);
      press(children[0], key('Alt'));
      emit('blur');
      press(children[0], key('Alt', 'keyUp'));
      expect(overlay.content).toEqual(shield);
      press(children[0], key('Alt'));
      press(children[0], key('Alt', 'keyUp'));
      expect(overlay.content).toBeNull();
    },
  );

  it('makes its view ready without making it part of the window', () => {
    const { overlay, children, published } = windowOf();
    overlay.prepare();
    expect(overlay.contents).toBeDefined();
    expect(children).toHaveLength(0);
    const contents = overlay.contents;
    overlay.prepare();
    overlay.open(shield);
    expect(overlay.contents).toBe(contents);
    expect(published).toEqual([shield]);
  });
});
