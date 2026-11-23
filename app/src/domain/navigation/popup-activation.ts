/**
 * How long an input of a person lets a page open a window, in milliseconds: the lifespan of
 * the transient user activation of Chromium.
 */
export const activationLifespan = 5000;

/** An input that reaches a page, as Electron reports it. */
export interface PageInput {
  readonly type: string;
  /** The key of a key press, such as `Enter`. */
  readonly key?: string;
}

/** The inputs of a pointer that let a page open a window. */
const pointerActivations: ReadonlySet<string> = new Set(['mouseDown', 'touchEnd', 'gestureTap']);

/**
 * The keys that let a page open no window, as in Chromium: Escape, and the modifier keys, which
 * also start every shortcut of the browser and of the system, such as Control before Ctrl+T or
 * Alt before Alt+Tab.
 */
const keysWithoutActivation: ReadonlySet<string> = new Set([
  'Escape',
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Hyper',
  'Meta',
  'NumLock',
  'OS',
  'ScrollLock',
  'Shift',
  'Super',
  'Symbol',
  'SymbolLock',
]);

/**
 * Whether an input lets a page open a window, as the inputs of HTML that trigger an activation:
 * a press of a mouse button, the end of a touch or a tap, and a key press other than Escape and
 * a modifier key. The keys that the browser takes as its shortcuts never reach the page, so they
 * count as none.
 * @param input - The input.
 */
export function activates(input: PageInput): boolean {
  return input.type === 'keyDown'
    ? !keysWithoutActivation.has(input.key ?? '')
    : pointerActivations.has(input.type);
}

/**
 * When people gave each page an input last, which lets the page open one window within
 * {@link activationLifespan}: the window uses the activation up, so that one click opens one
 * window, as in Chromium. A page that opens a window without one is blocked.
 */
export class Activations<Page extends object> {
  private readonly times = new WeakMap<Page, number>();
  private readonly now: () => number;

  /** @param now - The time of a clock that only goes forward, in milliseconds. */
  constructor(now: () => number) {
    this.now = now;
  }

  /**
   * Takes note of an input of a person to a page.
   * @param page - The page.
   */
  activate(page: Page): void {
    this.times.set(page, this.now());
  }

  /**
   * Forgets the input of a page, as a new document of the page starts without one.
   * @param page - The page.
   */
  clear(page: Page): void {
    this.times.delete(page);
  }

  /**
   * Uses the activation of a page up, as a window that it opens does.
   * @param page - The page.
   * @returns Whether the page had an activation, so that it may open the window.
   */
  consume(page: Page): boolean {
    const at = this.times.get(page);
    this.times.delete(page);
    return at !== undefined && this.now() - at <= activationLifespan;
  }
}
