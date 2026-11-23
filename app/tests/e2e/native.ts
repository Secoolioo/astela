import { expect } from '@playwright/test';
import type { ShellState } from '../../src/shared/ipc/shell-contracts.ts';
import type { Browser } from './harness.ts';

/**
 * Helpers for tests that run without a DevTools client, as for the dialogs of pages: Playwright
 * would answer them itself. They reach the views of the browser through its main process and
 * give them native input, as a person does.
 */

/**
 * Runs a script in a view and gives its value; a promise that the script gives is waited for.
 * @param browser - The running browser.
 * @param prefix - The address of a web page, or the start of the address of one of the
 *   browser's own views, such as `app://shell`.
 * @param script - The script, an expression.
 */
export function runIn<R>(browser: Browser, prefix: string, script: string): Promise<R> {
  return browser.main.evaluate(
    ({ webContents }, { at, code }) => {
      const view = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() &&
            (at.startsWith('app://') ? contents.getURL().startsWith(at) : contents.getURL() === at),
        );
      if (view === undefined) throw new Error(`No view at ${at}`);
      return view.executeJavaScript(code) as Promise<R>;
    },
    { at: prefix, code: script },
  );
}

/**
 * Asks the shell of the first window through its own bridge, as its buttons do.
 * @param browser - The running browser.
 * @param channel - The channel, such as `tabs.activate`.
 * @param payload - The request.
 */
export function shellCall<R>(browser: Browser, channel: string, payload: unknown): Promise<R> {
  return runIn<R>(
    browser,
    'app://shell',
    `window.bridge.invoke(${JSON.stringify(channel)}, ${JSON.stringify(payload)})`,
  );
}

/** The state of the shell of the first window. */
export function stateOf(browser: Browser): Promise<ShellState> {
  return shellCall<ShellState>(browser, 'shell.getState', {});
}

/**
 * Waits until a page with an address has loaded.
 * @param browser - The running browser.
 * @param url - The address.
 */
export async function loaded(browser: Browser, url: string): Promise<void> {
  await expect
    .poll(() =>
      browser.main.evaluate(
        ({ webContents }, address) =>
          webContents
            .getAllWebContents()
            .some((contents) => contents.getURL() === address && !contents.isLoading()),
        url,
      ),
    )
    .toBe(true);
}

/**
 * Opens a new tab with an address, and waits until the shell shows it as the active tab and
 * its page has loaded.
 * @param browser - The running browser.
 * @param url - The address.
 * @returns The id of the tab.
 */
export async function openTab(browser: Browser, url: string): Promise<string> {
  const count = (await stateOf(browser)).tabs.length;
  const { tabId } = await shellCall<{ tabId: string }>(browser, 'tabs.open', { input: url });
  await expect
    .poll(async () => {
      const state = await stateOf(browser);
      return state.tabs.length === count + 1 && state.activeTabId === tabId;
    })
    .toBe(true);
  await loaded(browser, url);
  return tabId;
}

/** A dialog of a page, as the overlay of the first window shows it over the page. */
export interface ShownDialog {
  readonly title: string;
  readonly message: string;
  /** The text of the field of `prompt()`, or `null` without one. */
  readonly value: string | null;
  /** Whether it offers to stop the site's dialogs. */
  readonly stop: boolean;
  readonly buttons: readonly string[];
  /** The text or the name of what has the focus in the question. */
  readonly focused: string;
  /** Where the overlay lies in the window. */
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * The dialog that the overlay of a window shows, or `null` while it shows none, also while the
 * overlay is not part of the window.
 * @param browser - The running browser.
 */
export function shownDialog(browser: Browser): Promise<ShownDialog | null> {
  return browser.main.evaluate(async ({ BaseWindow }) => {
    const view = BaseWindow.getAllWindows()
      .flatMap((window) => window.contentView.children)
      .find(
        (child): child is Electron.WebContentsView =>
          'webContents' in child &&
          (child as Electron.WebContentsView).webContents.getURL().startsWith('app://overlay'),
      );
    if (view === undefined) return null;
    const shown = (await view.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('overlay-page')?.shadowRoot;
      const form = root?.querySelector('.current form.sheet');
      if (!form) return null;
      const active = root.activeElement;
      return {
        title: form.querySelector('h2')?.textContent.trim() ?? '',
        message: form.querySelector('.message')?.textContent ?? '',
        value: form.querySelector('input[name="value"]')?.value ?? null,
        stop: form.querySelector('input[name="stop"]') !== null,
        buttons: [...form.querySelectorAll('.buttons button')].map((button) => button.textContent.trim()),
        focused: active?.getAttribute('name') ?? active?.textContent?.trim() ?? '',
      };
    })()`)) as Omit<ShownDialog, 'bounds'> | null;
    return shown === null ? null : { ...shown, bounds: view.getBounds() };
  });
}

/**
 * Waits until the overlay shows a dialog whose message contains a text, and gives it.
 * @param browser - The running browser.
 * @param message - Part of the message.
 * @param timeout - How long to wait at most, in milliseconds.
 */
export async function dialogWith(
  browser: Browser,
  message: string,
  timeout = 5000,
): Promise<ShownDialog> {
  let found: ShownDialog | null = null;
  await expect
    .poll(
      async () => {
        found = await shownDialog(browser);
        return found?.message.includes(message) === true;
      },
      { timeout },
    )
    .toBe(true);
  if (found === null) throw new Error('No dialog');
  return found;
}

/**
 * Waits until a web page has painted its first content: Chromium drops the native input for a
 * page until then, and on a slow machine, as on macOS in CI, that can come well after the page
 * has loaded. The browser's own views, such as the overlay, load before they show and so report
 * no first paint; a test waits for what they show before it clicks it.
 * @param browser - The running browser.
 * @param prefix - The start of the address of the view, or the whole address of a web page.
 */
async function painted(browser: Browser, prefix: string): Promise<void> {
  if (prefix.startsWith('app://')) return;
  await expect
    .poll(
      () =>
        browser.main.evaluate(async ({ webContents }, at) => {
          const view = webContents
            .getAllWebContents()
            .find(
              (contents) =>
                !contents.isDestroyed() &&
                (at.startsWith('app://')
                  ? contents.getURL().startsWith(at)
                  : contents.getURL() === at),
            );
          if (view === undefined) throw new Error(`No view at ${at}`);
          return (await view.executeJavaScript(
            `performance.getEntriesByName('first-contentful-paint').length > 0`,
          )) as boolean;
        }, prefix),
      { message: `The page at ${prefix} has not painted its first content`, timeout: 10_000 },
    )
    .toBe(true);
}

/**
 * Clicks an element of a view with native mouse events, at its middle, once the view has
 * painted its first content.
 * @param browser - The running browser.
 * @param prefix - The start of the address of the view.
 * @param element - A script that gives the element, such as `document.querySelector('a')`.
 */
export async function clickNative(
  browser: Browser,
  prefix: string,
  element: string,
): Promise<void> {
  await painted(browser, prefix);
  await browser.main.evaluate(
    async ({ webContents }, { at, code }) => {
      const view = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() &&
            (at.startsWith('app://') ? contents.getURL().startsWith(at) : contents.getURL() === at),
        );
      if (view === undefined) throw new Error(`No view at ${at}`);
      const point = (await view.executeJavaScript(`(() => {
        const element = ${code};
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      })()`)) as { x: number; y: number } | null;
      if (point === null) throw new Error(`Nothing to click in ${at}`);
      view.sendInputEvent({ type: 'mouseMove', ...point });
      view.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      view.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    },
    { at: prefix, code: element },
  );
}

/**
 * Types text into the focused field of a view with native keys, as a person does, once the view
 * has painted its first content.
 * @param browser - The running browser.
 * @param prefix - The start of the address of the view.
 * @param text - The text.
 */
export async function typeNative(browser: Browser, prefix: string, text: string): Promise<void> {
  await painted(browser, prefix);
  await browser.main.evaluate(
    ({ webContents }, { at, keys }) => {
      const view = webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() &&
            (at.startsWith('app://') ? contents.getURL().startsWith(at) : contents.getURL() === at),
        );
      if (view === undefined) throw new Error(`No view at ${at}`);
      for (const key of keys) {
        view.sendInputEvent({ type: 'keyDown', keyCode: key });
        view.sendInputEvent({ type: 'char', keyCode: key });
        view.sendInputEvent({ type: 'keyUp', keyCode: key });
      }
    },
    { at: prefix, keys: text.split('') },
  );
}

/**
 * The address of the view that has the keyboard focus, or `null` while none has it, after the
 * tasks that the browser process has queued until now, such as one that shows a question again.
 * @param browser - The running browser.
 */
export function focusedView(browser: Browser): Promise<string | null> {
  return browser.main.evaluate(async ({ webContents }) => {
    await new Promise((done) => setTimeout(done, 100));
    return (
      webContents
        .getAllWebContents()
        .find((contents) => !contents.isDestroyed() && contents.isFocused())
        ?.getURL() ?? null
    );
  });
}

/** The script that gives the close button of a tab in the shell. */
export function closeButtonOf(tabId: string): string {
  return `document.querySelector('app-shell').shadowRoot.querySelector('.tab[data-id="${tabId}"] .close')`;
}

/** The script that gives a button of the dialog that the overlay shows, by its text. */
export function dialogButton(text: string): string {
  return `[...document.querySelector('overlay-page').shadowRoot.querySelectorAll('.current form.sheet .buttons button')].find((button) => button.textContent.trim() === ${JSON.stringify(text)})`;
}
