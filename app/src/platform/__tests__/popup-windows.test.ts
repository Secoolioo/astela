import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindowController } from '../electron/browser-window.ts';
import { followActivation, pageActivations } from '../electron/page-activation.ts';
import { openForPopup, tabWindowOf } from '../electron/popup-windows.ts';

/** The listeners of the browser process for the messages of frames. */
const ipc = vi.hoisted(() => ({
  listeners: new Map<string, (event: { readonly sender: unknown }) => void>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (event: { readonly sender: unknown }) => void) => {
      ipc.listeners.set(channel, listener);
    },
  },
}));

/** A window as far as the tabs of popups need one. */
interface FakeWindow {
  readonly popup: boolean;
  readonly isPrivate: boolean;
  readonly closing: boolean;
  readonly tabs: { readonly workspace: string; readonly open: ReturnType<typeof vi.fn> };
  readonly window: { readonly focus: ReturnType<typeof vi.fn> };
  windows?: unknown;
}

function fakeWindow(
  kind: Partial<Pick<FakeWindow, 'popup' | 'isPrivate' | 'closing'>> & {
    readonly workspace?: string;
  },
): FakeWindow {
  return {
    popup: kind.popup ?? false,
    isPrivate: kind.isPrivate ?? false,
    closing: kind.closing ?? false,
    tabs: { workspace: kind.workspace ?? 'w1', open: vi.fn() },
    window: { focus: vi.fn() },
  };
}

/** The windows of a browser, the one that had the focus last first, and the popup among them. */
function browserWith(
  byFocus: FakeWindow[],
  popup: FakeWindow,
): {
  readonly popup: BrowserWindowController;
  readonly open: ReturnType<typeof vi.fn>;
} {
  const open = vi.fn();
  const windows = { byFocus: [popup, ...byFocus], open };
  for (const window of [popup, ...byFocus]) window.windows = windows;
  return { popup: popup as unknown as BrowserWindowController, open };
}

describe('tabWindowOf', () => {
  it('finds the regular window used last that shows the workspace of the popup', () => {
    const other = fakeWindow({ workspace: 'w2' });
    const used = fakeWindow({});
    const older = fakeWindow({});
    const { popup } = browserWith([other, used, older], fakeWindow({ popup: true }));
    expect(tabWindowOf(popup)).toBe(used);
  });

  it('leaves out other popups, windows that close and windows of the other kind', () => {
    const { popup } = browserWith(
      [fakeWindow({ popup: true }), fakeWindow({ closing: true }), fakeWindow({ isPrivate: true })],
      fakeWindow({ popup: true }),
    );
    expect(tabWindowOf(popup)).toBeUndefined();
    const regular = fakeWindow({});
    const privateWindow = fakeWindow({ isPrivate: true });
    const { popup: privatePopup } = browserWith(
      [regular, privateWindow],
      fakeWindow({ popup: true, isPrivate: true }),
    );
    expect(tabWindowOf(privatePopup)).toBe(privateWindow);
  });
});

describe('openForPopup', () => {
  it('opens the tab in the window that takes the tabs of the popup, in front unless asked', () => {
    const target = fakeWindow({});
    const { popup } = browserWith([target], fakeWindow({ popup: true }));
    openForPopup(popup, 'https://example.org/', true);
    expect(target.tabs.open).toHaveBeenCalledWith('https://example.org/', { activate: true });
    expect(target.window.focus).toHaveBeenCalledTimes(1);
    openForPopup(popup, 'https://example.org/later', false);
    expect(target.tabs.open).toHaveBeenLastCalledWith('https://example.org/later', {
      activate: false,
    });
    expect(target.window.focus).toHaveBeenCalledTimes(1);
  });

  it('opens a window of the kind and workspace of the popup when none takes its tabs', () => {
    const { popup, open } = browserWith(
      [fakeWindow({ workspace: 'w2' })],
      fakeWindow({ popup: true, isPrivate: true }),
    );
    openForPopup(popup, 'https://example.org/', true);
    expect(open).toHaveBeenCalledWith('https://example.org/', { private: true, workspace: 'w1' });
  });
});

/** A page that reports input as Electron does. */
function page(): WebContents & EventEmitter {
  return new EventEmitter() as WebContents & EventEmitter;
}

describe('followActivation', () => {
  it('lets a press of the mouse, a touch or a tap of a page open one window', () => {
    for (const input of [{ type: 'mouseDown' }, { type: 'touchEnd' }, { type: 'gestureTap' }]) {
      const contents = page();
      followActivation(contents);
      contents.emit(input.type === 'mouseDown' ? 'before-mouse-event' : 'input-event', {}, input);
      expect(pageActivations.consume(contents)).toBe(true);
      expect(pageActivations.consume(contents)).toBe(false);
    }
  });

  it('lets the next document of a page open nothing for an input of the one before', () => {
    const contents = page();
    followActivation(contents);
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    contents.emit('did-navigate', {}, 'https://example.org/next');
    expect(pageActivations.consume(contents)).toBe(false);
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    expect(pageActivations.consume(contents)).toBe(true);
  });

  it('counts a click that a frame of a followed page reports, such as that of a screen reader', () => {
    const contents = page();
    followActivation(contents);
    const report = ipc.listeners.get('page.activation');
    report?.({ sender: contents });
    expect(pageActivations.consume(contents)).toBe(true);
    expect(pageActivations.consume(contents)).toBe(false);
    // A view whose input is not followed gets nothing for the clicks that it reports.
    const other = page();
    report?.({ sender: other });
    expect(pageActivations.consume(other)).toBe(false);
  });

  it('leaves the keys to the window, which knows its shortcuts, and ignores moves', () => {
    const contents = page();
    followActivation(contents);
    contents.emit('input-event', {}, { type: 'keyDown', key: 'k' });
    contents.emit('input-event', {}, { type: 'rawKeyDown', key: 'k' });
    contents.emit('before-mouse-event', {}, { type: 'mouseMove' });
    contents.emit('before-mouse-event', {}, { type: 'mouseUp' });
    expect(pageActivations.consume(contents)).toBe(false);
  });
});
