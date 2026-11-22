import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchTabOut, type TabOutDocument } from '../tab-out.ts';

/** A document whose focused element and focus the tests set. */
class FakeDocument implements TabOutDocument {
  readonly body = {} as HTMLElement;
  activeElement: Element | null = this.body;
  focused = true;
  hasFocus(): boolean {
    return this.focused;
  }
}

/** An element of the page that can have the focus, or the element of one of its frames. */
const element = (): Element => ({}) as Element;

/** A key press as the page's window sees it first. */
function key(
  init: Partial<Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>> & {
    readonly isComposing?: boolean;
    readonly isTrusted?: boolean;
  } = {},
): Event {
  const { isTrusted = true, ...keys } = init;
  const event = new Event('keydown', { cancelable: true });
  // The keyboard's own keys are trusted; those that scripts make up are not.
  Object.defineProperty(event, 'isTrusted', { value: isTrusted });
  return Object.assign(event, {
    key: 'Tab',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...keys,
  });
}

let target: EventTarget;
let page: FakeDocument;
let sent: boolean[];

/**
 * The window of the page loses the focus, as Blink tells it once the focus left the page's frame,
 * for the browser or for a frame of the page, which then has the focus as `hasFocus` says.
 */
function blur(stays: boolean): void {
  page.focused = stays;
  target.dispatchEvent(new Event('blur'));
}

/** An element of the page gets the focus. */
function focusin(next: Element): void {
  page.activeElement = next;
  page.focused = true;
  target.dispatchEvent(new Event('focusin'));
}

beforeEach(() => {
  vi.useFakeTimers();
  target = new EventTarget();
  page = new FakeDocument();
  sent = [];
  watchTabOut(target, page, (reverse) => sent.push(reverse));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watchTabOut', () => {
  it('tells when Tab leaves the last element and the page gives the focus away, once', () => {
    page.activeElement = element();
    target.dispatchEvent(key());
    page.activeElement = page.body;
    blur(false);
    // Electron sends the focus round the page right away, which changes nothing.
    focusin(element());
    vi.runAllTimers();
    expect(sent).toEqual([false]);
  });

  it('tells when Shift+Tab leaves a page whose frame has no focus, once', () => {
    page.focused = false;
    target.dispatchEvent(key({ shiftKey: true }));
    vi.runAllTimers();
    vi.runAllTimers();
    expect(sent).toEqual([true]);
  });

  it('leaves alone a Tab that moves the focus within the page', () => {
    page.activeElement = element();
    target.dispatchEvent(key());
    focusin(element());
    vi.runAllTimers();
    expect(sent).toEqual([]);
  });

  it('leaves alone a Tab into a frame of the same process, which has the focus at once', () => {
    page.activeElement = element();
    target.dispatchEvent(key());
    page.activeElement = element();
    blur(true);
    vi.runAllTimers();
    expect(sent).toEqual([]);
  });

  it('waits for a frame of another process, which takes the focus or hands it on', () => {
    // The frame takes the focus a moment after the key.
    page.activeElement = element();
    target.dispatchEvent(key());
    page.activeElement = page.body;
    vi.advanceTimersByTime(1);
    page.activeElement = element();
    blur(true);
    // The frame has nothing to focus and gives the focus back to the next element of the page.
    target.dispatchEvent(key());
    page.activeElement = page.body;
    vi.advanceTimersByTime(1);
    focusin(element());
    vi.runAllTimers();
    expect(sent).toEqual([]);
    // Nothing after the frame either: the page gives the focus away once the frame is done.
    target.dispatchEvent(key());
    page.activeElement = page.body;
    vi.advanceTimersByTime(20);
    blur(false);
    vi.runAllTimers();
    expect(sent).toEqual([false]);
  });

  it('stops waiting for a frame of another process after a while', () => {
    target.dispatchEvent(key());
    vi.advanceTimersByTime(1000);
    blur(false);
    vi.runAllTimers();
    expect(sent).toEqual([]);
  });

  it('leaves alone keys that the page handled or made up, that carry other modifiers or type for an input method', () => {
    page.focused = false;
    const handled = key();
    target.dispatchEvent(handled);
    handled.preventDefault();
    vi.runAllTimers();
    const later = key();
    target.dispatchEvent(later);
    later.preventDefault();
    blur(false);
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      target.dispatchEvent(key(init));
    }
    target.dispatchEvent(key({ isComposing: true }));
    target.dispatchEvent(key({ isTrusted: false }));
    target.dispatchEvent(key({ key: 'Enter' }));
    vi.runAllTimers();
    expect(sent).toEqual([]);
  });

  it('leaves alone a window that loses the focus without a Tab, or the blur of an element', () => {
    page.activeElement = element();
    blur(false);
    vi.runAllTimers();
    page.focused = true;
    target.dispatchEvent(key());
    const ofElement = new Event('blur');
    Object.defineProperty(ofElement, 'target', { value: element() });
    page.focused = false;
    target.dispatchEvent(ofElement);
    focusin(element());
    vi.runAllTimers();
    expect(sent).toEqual([]);
  });
});
