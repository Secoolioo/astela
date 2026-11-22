import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebAuthnAccount, WebContents, WebFrameMain } from 'electron';
import type { BrowserWindowController } from '../../platform/electron/browser-window.ts';
import type { IpcRouter } from '../../platform/electron/ipc-router.ts';
import type { OverlayOpenOptions, OverlayOptions } from '../../platform/electron/overlay.ts';
import type { OverlayContent } from '../../shared/ipc/overlay-contracts.ts';

/** The overlay of the window, which shows one content at a time, as the real one does. */
const overlay = {
  content: null as OverlayContent | null,
  options: {} as OverlayOpenOptions,
  opened: [] as (OverlayContent | null)[],
  get yieldsToQuestions(): boolean {
    return this.content === null || this.options.yieldsToQuestions === true;
  },
  open(content: OverlayContent | null, options: OverlayOpenOptions = {}): void {
    const before = this.options.onClose;
    this.options = options;
    this.content = content;
    this.opened.push(content);
    before?.();
  },
  close(): void {
    const before = this.options.onClose;
    this.content = null;
    this.options = {};
    before?.();
  },
  whenIdle(): void {},
};

vi.mock('../overlays.ts', () => ({
  overlayOf: () => overlay,
  overlayBySender: () => overlay,
  questionKeys: {},
  track: () => undefined,
}));

const { questionsPerPage, securityKeyPrompts } = await import('../webauthn-prompt.ts');

/** A page with the listeners that the questions add and take away. */
function fakeContents(): WebContents {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const contents = {
    isDestroyed: () => false,
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return contents;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      return contents.on(event, listener);
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
      return contents;
    },
  };
  return contents as unknown as WebContents;
}

/** How often the questions asked the browser about frames, which costs a call into Chromium. */
let frameLooks = 0;

/** A frame of the page, of a site with a domain. */
function fakeFrame(routingId: number): WebFrameMain & { readonly send: ReturnType<typeof vi.fn> } {
  return {
    processId: 7,
    routingId,
    origin: 'https://keys.example',
    isDestroyed: () => {
      frameLooks += 1;
      return false;
    },
    get detached() {
      frameLooks += 1;
      return false;
    },
    send: vi.fn(),
  } as unknown as WebFrameMain & { readonly send: ReturnType<typeof vi.fn> };
}

const accounts: WebAuthnAccount[] = [
  { credentialId: 'one', userHandle: 'u1', name: 'one@keys.example', displayName: 'One' },
  { credentialId: 'two', userHandle: 'u2', name: 'two@keys.example', displayName: 'Two' },
];

describe('securityKeyPrompts', () => {
  let contents: WebContents;
  let window: BrowserWindowController;
  let prompts: ReturnType<typeof securityKeyPrompts>;

  beforeEach(() => {
    vi.useFakeTimers();
    overlay.content = null;
    overlay.options = {};
    overlay.opened = [];
    frameLooks = 0;
    contents = fakeContents();
    window = {
      window: {
        isDestroyed: () => false,
        getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      },
      activeTabContents: contents,
      tabs: { onDidChange: () => ({ dispose: () => undefined }) },
      paneOf: () => undefined,
    } as unknown as BrowserWindowController;
    const router = { handle: vi.fn() } as unknown as IpcRouter;
    prompts = securityKeyPrompts({} as OverlayOptions, router);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once per frame and for a few frames of a page, however often a page asks', async () => {
    const frame = fakeFrame(1);
    for (let request = 0; request < 1000; request++) {
      prompts.report(window, contents, frame, 'start', request);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(overlay.opened).toHaveLength(1);
    expect(overlay.content).toMatchObject({ kind: 'securityKey', site: 'keys.example' });
    // The ends of requests that it never asked for cost nothing.
    for (let request = 1; request < 1000; request++) {
      prompts.report(window, contents, frame, 'end', request);
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(overlay.content).not.toBeNull();
    prompts.report(window, contents, frame, 'end', 0);
    await vi.advanceTimersByTimeAsync(10);
    expect(overlay.content).toBeNull();

    // Many frames that ask at once get no more than a few questions.
    const frames = Array.from({ length: 1000 }, (_unused, index) => fakeFrame(100 + index));
    frames.forEach((each, request) => prompts.report(window, contents, each, 'start', request));
    await vi.advanceTimersByTimeAsync(300);
    frames.forEach((each, request) => prompts.report(window, contents, each, 'end', request));
    await vi.advanceTimersByTimeAsync(10);
    expect(overlay.content).toBeNull();
    expect(overlay.opened.length - 1).toBeLessThanOrEqual(questionsPerPage);
    expect(frameLooks).toBeLessThan(questionsPerPage * questionsPerPage * 4 + 100);
  });

  it('ends the choice of an account with the request that found the accounts', async () => {
    const frame = fakeFrame(1);
    prompts.report(window, contents, frame, 'start', 4);
    await vi.advanceTimersByTimeAsync(300);
    const answer = vi.fn();
    prompts.chooseAccount(window, contents, frame, 'keys.example', accounts, answer);
    expect(overlay.content).toMatchObject({ kind: 'securityKey', accounts: [{}, {}] });
    // The question for the key gave way to the choice, and cancelled nothing.
    expect(frame.send).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    // The site's timeout ends the request: the choice goes with it.
    prompts.report(window, contents, frame, 'end', 4);
    expect(answer).toHaveBeenCalledWith();
    await vi.advanceTimersByTimeAsync(10);
    expect(overlay.content).toBeNull();

    // A choice of another frame of the page stays until its own request ends.
    const other = fakeFrame(2);
    const later = vi.fn();
    prompts.report(window, contents, other, 'start', 0);
    prompts.chooseAccount(window, contents, other, 'keys.example', accounts, later);
    prompts.report(window, contents, frame, 'end', 5);
    expect(later).not.toHaveBeenCalled();
    expect(overlay.content).toMatchObject({ kind: 'securityKey', accounts: [{}, {}] });
  });

  it('signs in with the only account of a key at once', () => {
    const answer = vi.fn();
    const [only] = accounts;
    if (only === undefined) throw new Error('No account');
    prompts.chooseAccount(window, contents, fakeFrame(1), 'keys.example', [only], answer);
    expect(answer).toHaveBeenCalledWith('one');
    expect(overlay.opened).toHaveLength(0);
  });
});
