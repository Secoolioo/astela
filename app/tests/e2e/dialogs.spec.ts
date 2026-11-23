import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FixtureServer, launch, pressNative, tabViews, type Browser } from './harness.ts';
import {
  clickNative,
  closeButtonOf,
  dialogButton,
  dialogWith,
  focusedView,
  loaded,
  openTab,
  runIn,
  shellCall,
  shownDialog,
  stateOf,
  typeNative,
} from './native.ts';

/**
 * The dialogs of pages: `alert()`, `confirm()` and `prompt()` ask over the page of their tab, in
 * the browser's own question, which leaves the tab strip to people (ADR 0060). The tests run
 * without a DevTools client, which would answer the dialogs itself.
 */

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

const at = (path: string): string => `${server.origin}/${path}`;
const site = (): string => new URL(server.origin).host;
const mac = process.platform === 'darwin';

/** Starts the browser without a DevTools client, as a person uses it. */
async function start(options: Parameters<typeof launch>[1] = {}): Promise<Browser> {
  const browser = await launch([], options);
  await browser.cdp.close();
  return browser;
}

/** What the dialogs of a page gave, in their order. */
function results(browser: Browser, url: string): Promise<string[]> {
  return runIn<string[]>(browser, url, 'window.results');
}

/** Whether the first window takes input, which a box of the system that waits would stop. */
function windowEnabled(browser: Browser): Promise<boolean | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.isEnabled());
}

/** The title of a tab, as the shell shows it. */
async function titleOf(browser: Browser, tabId: string): Promise<string | undefined> {
  return (await stateOf(browser)).tabs.find((tab) => tab.id === tabId)?.title;
}

/** Runs a script in the frame of a page at an address, and gives its value. */
function inFrame(browser: Browser, address: string, code: string): Promise<unknown> {
  return browser.main.evaluate(
    ({ webContents }, { url, script }) => {
      const found = webContents
        .getAllWebContents()
        .flatMap((contents) => contents.mainFrame.framesInSubtree)
        .find((each) => each.url === url);
      if (found === undefined) throw new Error('No frame yet');
      return found.executeJavaScript(script);
    },
    { url: address, script: code },
  );
}

/** Where the overlay's dialog shows its title, and whether the title shows whole. */
function titleLayout(browser: Browser): Promise<{ fits: boolean; inside: boolean }> {
  return runIn(
    browser,
    'app://overlay',
    `(() => {
      const form = document.querySelector('overlay-page').shadowRoot.querySelector('.current form.sheet');
      const title = form.querySelector('h2');
      const box = title.getBoundingClientRect();
      const around = form.getBoundingClientRect();
      return {
        fits: title.scrollWidth <= title.clientWidth,
        inside: box.right <= around.right && around.right <= window.innerWidth,
      };
    })()`,
  );
}

test('asks the alerts of a page over its tab, whose close button still closes it', async () => {
  const browser = await start();
  try {
    const tabId = await openTab(browser, at('dialog-loop.html'));
    const first = await dialogWith(browser, '(1)');
    expect(first).toMatchObject({
      title: `${site()} says`,
      message: 'Your computer is infected, call 0800 000 000 (1)',
      value: null,
      stop: false,
      buttons: ['OK'],
      focused: 'OK',
    });
    // The question covers the page of the tab alone; the tab strip and the window stay usable.
    const page = (await tabViews(browser)).find((view) => view.url.includes('dialog-loop'));
    expect(first.bounds).toEqual(page?.bounds);
    expect(await windowEnabled(browser)).toBe(true);
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await dialogWith(browser, '(2)');
    // The close button of the tab closes the tab and its question.
    await clickNative(browser, 'app://shell', closeButtonOf(tabId));
    await expect.poll(async () => (await stateOf(browser)).tabs.length).toBe(1);
    await expect.poll(() => shownDialog(browser)).toBeNull();
    expect(await windowEnabled(browser)).toBe(true);
    expect(
      await browser.main.evaluate(({ webContents }) =>
        webContents.getAllWebContents().some((view) => view.getURL().includes('dialog-loop')),
      ),
    ).toBe(false);
  } finally {
    await browser.close();
  }
});

test('gives confirm() the answer: true for OK, false for Cancel and Escape', async () => {
  const browser = await start();
  try {
    const url = at('dialogs.html');
    await openTab(browser, url);
    const ask = (): Promise<unknown> =>
      runIn(browser, url, `setTimeout(() => ask('confirm', 'Sure?'), 0)`);
    await ask();
    expect(await dialogWith(browser, 'Sure?')).toMatchObject({
      title: `${site()} says`,
      buttons: ['Cancel', 'OK'],
      focused: 'OK',
    });
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => results(browser, url)).toEqual(['true']);
    await ask();
    await dialogWith(browser, 'Sure?');
    await clickNative(browser, 'app://overlay', dialogButton('Cancel'));
    await expect.poll(() => results(browser, url)).toEqual(['true', 'false']);
    await ask();
    await dialogWith(browser, 'Sure?');
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect.poll(() => results(browser, url)).toEqual(['true', 'false', 'false']);
    await expect.poll(() => shownDialog(browser)).toBeNull();
  } finally {
    await browser.close();
  }
});

test('answers the alert of a tab in the background at once, which holds no tab, and shows it with its tab', async () => {
  const browser = await start();
  try {
    const url = at('dialogs.html');
    const first = await openTab(browser, url);
    // A page that the first one opened shares its process.
    const opened = at('dialogs.html?opened');
    const count = (await stateOf(browser)).tabs.length;
    await clickNative(browser, url, `document.querySelector('#opened')`);
    await expect.poll(async () => (await stateOf(browser)).tabs.length).toBe(count + 1);
    await loaded(browser, opened);
    const later = (await stateOf(browser)).activeTabId ?? '';
    await shellCall(browser, 'tabs.activate', { tabId: first });
    await expect.poll(async () => (await stateOf(browser)).activeTabId).toBe(first);
    await runIn(browser, opened, `setTimeout(() => later('alert'), 0)`);
    // The page goes on at once, and so does the page in front, in the same process.
    await expect.poll(() => titleOf(browser, later)).toBe('Asked');
    expect(await results(browser, opened)).toEqual(['undefined']);
    expect(await runIn(browser, url, '1 + 1')).toBe(2);
    expect(await shownDialog(browser)).toBeNull();
    expect(await windowEnabled(browser)).toBe(true);
    // The message shows once its tab shows.
    await shellCall(browser, 'tabs.activate', { tabId: later });
    expect(await dialogWith(browser, 'From the background')).toMatchObject({
      title: `${site()} says`,
      buttons: ['OK'],
    });
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => shownDialog(browser)).toBeNull();
    expect(await results(browser, opened)).toEqual(['undefined']);
  } finally {
    await browser.close();
  }
});

test('gives confirm() and prompt() of a tab in the background Cancel at once, and shows nothing of them', async () => {
  const browser = await start();
  try {
    const first = (await stateOf(browser)).tabs[0]?.id ?? '';
    const url = at('dialogs.html?background');
    const later = await openTab(browser, url);
    await shellCall(browser, 'tabs.activate', { tabId: first });
    await expect.poll(async () => (await stateOf(browser)).activeTabId).toBe(first);
    for (const [kind, answer] of [
      ['confirm', 'false'],
      ['prompt', 'null'],
    ] as const) {
      await runIn(
        browser,
        url,
        `document.title = 'Waiting'; setTimeout(() => later('${kind}'), 0)`,
      );
      await expect.poll(() => titleOf(browser, later)).toBe('Asked');
      expect((await results(browser, url)).at(-1)).toBe(answer);
    }
    expect(await shownDialog(browser)).toBeNull();
    // Once the tab shows, the next dialog of its page is the first one that shows.
    await shellCall(browser, 'tabs.activate', { tabId: later });
    await runIn(browser, url, `setTimeout(() => ask('alert', 'In front'), 0)`);
    expect(await dialogWith(browser, 'In front')).toMatchObject({ stop: false });
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => results(browser, url)).toEqual(['false', 'null', 'undefined']);
  } finally {
    await browser.close();
  }
});

test('asks the alerts of pages that a link or a script of a page opened', async () => {
  const browser = await start();
  try {
    await openTab(browser, at('dialogs.html'));
    for (const [element, message] of [
      ['#blank', 'From a link'],
      ['#open', 'From a script'],
    ] as const) {
      const count = (await stateOf(browser)).tabs.length;
      await clickNative(browser, at('dialogs.html'), `document.querySelector('${element}')`);
      await expect.poll(async () => (await stateOf(browser)).tabs.length).toBe(count + 1);
      expect(await dialogWith(browser, message)).toMatchObject({ title: `${site()} says` });
      expect(await windowEnabled(browser)).toBe(true);
      await clickNative(browser, 'app://overlay', dialogButton('OK'));
      await expect.poll(() => shownDialog(browser)).toBeNull();
      // Back to the page that opened it.
      const opener = (await stateOf(browser)).tabs.find((tab) => tab.url === at('dialogs.html'));
      await shellCall(browser, 'tabs.activate', { tabId: opener?.id ?? '' });
    }
  } finally {
    await browser.close();
  }
});

test('stops the dialogs of a site in its page once people tick the box', async () => {
  const browser = await start();
  try {
    const url = at('dialog-loop.html');
    await openTab(browser, url);
    await dialogWith(browser, '(1)');
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    const second = await dialogWith(browser, '(2)');
    expect(second.stop).toBe(true);
    await clickNative(
      browser,
      'app://overlay',
      `document.querySelector('overlay-page').shadowRoot.querySelector('.current input[name="stop"]')`,
    );
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    // The loop ends at once, and the page goes on running.
    await expect.poll(() => runIn(browser, url, 'document.title')).toBe('Loop ended');
    expect(await shownDialog(browser)).toBeNull();
    expect(await runIn(browser, url, '1 + 1')).toBe(2);
  } finally {
    await browser.close();
  }
});

test('counts the dialogs of a page with those of its embedded pages, and stops them all', async () => {
  const browser = await start();
  try {
    const url = at('dialogs.html?embed');
    await openTab(browser, url);
    const frame = `${server.origin.replace('127.0.0.1', 'localhost')}/dialogs.html?frame`;
    await expect
      .poll(() => inFrame(browser, frame, 'document.readyState').catch(() => 'none'))
      .toBe('complete');
    await runIn(browser, url, `setTimeout(() => ask('alert', 'From the page'), 0)`);
    expect(await dialogWith(browser, 'From the page')).toMatchObject({ stop: false });
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    // The second dialog of the page offers to stop its dialogs, whichever origin asks.
    await inFrame(browser, frame, `setTimeout(() => ask('alert', 'From the frame'), 0)`);
    expect(await dialogWith(browser, 'From the frame')).toMatchObject({
      title: `An embedded page at ${new URL(frame).host} says`,
      stop: true,
    });
    await clickNative(
      browser,
      'app://overlay',
      `document.querySelector('overlay-page').shadowRoot.querySelector('.current input[name="stop"]')`,
    );
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => shownDialog(browser)).toBeNull();
    // Neither the frame nor the page asks anymore.
    await inFrame(browser, frame, `setTimeout(() => ask('confirm', 'Frame again'), 0)`);
    await expect
      .poll(() => inFrame(browser, frame, 'window.results'))
      .toEqual(['undefined', 'false']);
    await runIn(browser, url, `setTimeout(() => ask('confirm', 'Page again'), 0)`);
    await expect.poll(() => results(browser, url)).toEqual(['undefined', 'false']);
    expect(await shownDialog(browser)).toBeNull();
  } finally {
    await browser.close();
  }
});

test('shows the whole host of a long address in the title of a dialog', async () => {
  const browser = await start();
  try {
    const { port } = new URL(server.origin);
    const host = `accounts.example.com.${'a'.repeat(63)}.${'b'.repeat(63)}.evil.localhost`;
    const url = `http://${host}:${port}/dialogs.html?alert=Your+session+expired`;
    await openTab(browser, url);
    expect(await dialogWith(browser, 'Your session expired')).toMatchObject({
      title: `${host}:${port} says`,
    });
    // The title breaks within the host, whose end, the site, stays in the question.
    expect(await titleLayout(browser)).toEqual({ fits: true, inside: true });
  } finally {
    await browser.close();
  }
});

test('keeps a question over its page while a shortcut gives the address bar the focus', async () => {
  const browser = await start();
  try {
    const url = at('dialogs.html');
    await openTab(browser, url);
    await runIn(browser, url, `setTimeout(() => ask('confirm', 'Delete all items?'), 0)`);
    expect(await dialogWith(browser, 'Delete all items?')).toMatchObject({ focused: 'OK' });
    await expect.poll(() => focusedView(browser)).toMatch(/^app:\/\/overlay/);
    await pressNative(browser, 'L', ['primary'], 'app://overlay');
    // The address bar keeps the focus, and the question waits over the page, which waits too.
    await expect.poll(() => focusedView(browser)).toMatch(/^app:\/\/shell/);
    expect(await focusedView(browser)).toMatch(/^app:\/\/shell/);
    expect((await shownDialog(browser))?.message).toBe('Delete all items?');
    await clickNative(browser, 'app://overlay', dialogButton('Cancel'));
    await expect.poll(() => results(browser, url)).toEqual(['false']);
  } finally {
    await browser.close();
  }
});

test('keeps a question over its side of a split view while people work in the other side', async () => {
  const browser = await start();
  try {
    const left = at('dialogs.html?left');
    const leftTab = await openTab(browser, left);
    const count = (await stateOf(browser)).tabs.length;
    // Split view opens with Ctrl+Cmd+S on macOS, where Shift+Cmd+S means Save As.
    await pressNative(browser, 'S', mac ? ['control', 'primary'] : ['primary', 'shift'], left);
    await expect
      .poll(async () => {
        const state = await stateOf(browser);
        return state.tabs.length === count + 1 && state.activeTabId !== leftTab;
      })
      .toBe(true);
    const right = at('dialogs.html?right');
    const rightTab = (await stateOf(browser)).activeTabId ?? '';
    await shellCall(browser, 'tabs.navigate', { tabId: rightTab, input: right });
    await loaded(browser, right);
    // The left side is the active one while its page asks.
    await shellCall(browser, 'tabs.activate', { tabId: leftTab });
    await expect.poll(async () => (await stateOf(browser)).activeTabId).toBe(leftTab);
    expect((await stateOf(browser)).split).toMatchObject({ start: leftTab, end: rightTab });
    await runIn(browser, left, `setTimeout(() => ask('prompt', 'Left side?', 'x'), 0)`);
    const asked = await dialogWith(browser, 'Left side?');
    const pane = (await tabViews(browser)).find((view) => view.url === left);
    expect(asked.bounds).toEqual(pane?.bounds);
    await expect.poll(() => focusedView(browser)).toMatch(/^app:\/\/overlay/);
    await typeNative(browser, 'app://overlay', 'abc');
    await expect.poll(async () => (await shownDialog(browser))?.value).toBe('abc');
    // A click into the other side gives its page the focus and makes its tab the active one.
    await browser.main.evaluate(({ webContents }, address) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === address)
        ?.focus();
    }, right);
    await expect.poll(async () => (await stateOf(browser)).activeTabId).toBe(rightTab);
    // The question stays over its side with what was typed into it, and leaves the focus there.
    expect(await focusedView(browser)).toBe(right);
    expect(await shownDialog(browser)).toMatchObject({ message: 'Left side?', value: 'abc' });
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => results(browser, left)).toEqual(['abc']);
  } finally {
    await browser.close();
  }
});

test('gives a question that came while its window had no focus the focus with the window', async () => {
  const browser = await start();
  try {
    const url = at('dialogs.html');
    await openTab(browser, url);
    const first = await browser.main.evaluate(
      ({ BaseWindow }) => BaseWindow.getFocusedWindow()?.id ?? 0,
    );
    // People work in another window meanwhile.
    const other = await browser.main.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({ width: 400, height: 300 });
      window.focus();
      return window.id;
    });
    const focusedWindow = (): Promise<number | null> =>
      browser.main.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()?.id ?? null);
    await expect.poll(focusedWindow).toBe(other);
    await runIn(browser, url, `setTimeout(() => ask('confirm', 'Your session expires soon'), 0)`);
    await dialogWith(browser, 'Your session expires soon');
    await browser.main.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)?.focus(), first);
    await expect.poll(focusedWindow).toBe(first);
    await expect.poll(() => focusedView(browser)).toMatch(/^app:\/\/overlay/);
    // Enter answers it, as its OK has the focus.
    await typeNative(browser, 'app://overlay', '\r');
    await expect.poll(() => results(browser, url)).toEqual(['true']);
    await browser.main.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id)?.destroy(), other);
  } finally {
    await browser.close();
  }
});

test('lets people close a tab whose alerts came back with the session after a crash', async () => {
  // The page starts its loop a while after it loaded, once the harness has reached its pages;
  // a client of DevTools waits for a page that waits for an answer.
  const url = at('dialog-loop.html?wait=6000');
  const first = await start();
  await openTab(first, url);
  await dialogWith(first, '(1)', 15_000);
  // The session keeps the tab, which a crash brings back.
  const session = join(first.profile, 'data', 'session.json');
  await expect
    .poll(() => existsSync(session) && readFileSync(session, 'utf8').includes('dialog-loop'))
    .toBe(true);
  await first.crash();
  const browser = await start({ profile: first.profile });
  try {
    await dialogWith(browser, 'Your computer is infected', 20_000);
    expect(await windowEnabled(browser)).toBe(true);
    const state = await stateOf(browser);
    const tabId = state.tabs.find((tab) => tab.url.includes('dialog-loop'))?.id ?? '';
    expect(state.activeTabId).toBe(tabId);
    await clickNative(browser, 'app://shell', closeButtonOf(tabId));
    await expect
      .poll(async () => (await stateOf(browser)).tabs.some((tab) => tab.id === tabId))
      .toBe(false);
    await expect.poll(() => shownDialog(browser)).toBeNull();
  } finally {
    await browser.close();
  }
});

test('takes the dialogs of every new page from the handler of Electron', async () => {
  const browser = await start();
  try {
    await openTab(browser, at('index.html'));
    const handlers = await browser.main.evaluate(
      ({ webContents }, address) =>
        webContents
          .getAllWebContents()
          .filter((contents) => contents.getURL() === address)
          .map((contents) => {
            // Electron does not declare its internal event.
            const events = contents as unknown as NodeJS.EventEmitter;
            return {
              count: events.listenerCount('-run-dialog'),
              electrons: events
                .listeners('-run-dialog')
                .some((listener) => String(listener).includes('showMessageBox')),
            };
          }),
      at('index.html'),
    );
    expect(handlers).toEqual([{ count: 1, electrons: false }]);
  } finally {
    await browser.close();
  }
});

test('asks prompt() over the page, with the text that the page gives in its field', async () => {
  const browser = await start();
  try {
    const url = at('dialogs.html?prompt');
    await openTab(browser, url);
    expect(await dialogWith(browser, 'Your name?')).toMatchObject({
      title: `${site()} says`,
      value: 'x',
      buttons: ['Cancel', 'OK'],
      focused: 'value',
    });
    // The text of the field is chosen, so that typing takes its place.
    await typeNative(browser, 'app://overlay', 'Max');
    await expect.poll(async () => (await shownDialog(browser))?.value).toBe('Max');
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => results(browser, url)).toEqual(['Max']);
    await runIn(browser, url, `setTimeout(() => ask('prompt', 'Again?'), 0)`);
    await dialogWith(browser, 'Again?');
    await clickNative(browser, 'app://overlay', dialogButton('Cancel'));
    await expect.poll(() => results(browser, url)).toEqual(['Max', 'null']);
  } finally {
    await browser.close();
  }
});

test('names an embedded page of another origin whose prompt() asks', async () => {
  const browser = await start();
  try {
    await openTab(browser, at('dialogs.html?embed'));
    const frame = `${server.origin.replace('127.0.0.1', 'localhost')}/dialogs.html?frame`;
    await expect
      .poll(() => inFrame(browser, frame, 'document.readyState').catch(() => 'none'))
      .toBe('complete');
    await inFrame(browser, frame, `setTimeout(() => ask('prompt', 'In the frame'), 0)`);
    expect(await dialogWith(browser, 'In the frame')).toMatchObject({
      title: `An embedded page at ${new URL(frame).host} says`,
      value: '',
    });
    await typeNative(browser, 'app://overlay', 'y');
    await clickNative(browser, 'app://overlay', dialogButton('OK'));
    await expect.poll(() => inFrame(browser, frame, 'window.results')).toEqual(['y']);
  } finally {
    await browser.close();
  }
});

test('closes the question of a prompt with its tab, and asks no hang question meanwhile', async () => {
  const browser = await start();
  try {
    // The question whether to wait for a page that hangs is recorded instead of shown.
    await browser.main.evaluate(({ dialog }) => {
      const asked: string[] = [];
      Object.assign(globalThis, { hangQuestions: asked });
      dialog.showMessageBox = ((_window: unknown, options: Electron.MessageBoxOptions) => {
        asked.push(options.message);
        return new Promise(() => undefined);
      }) as typeof dialog.showMessageBox;
    });
    const hangQuestions = (): Promise<string[]> =>
      browser.main.evaluate(() => Reflect.get(globalThis, 'hangQuestions') as string[]);
    const unresponsive = (url: string): Promise<void> =>
      browser.main.evaluate(({ webContents }, address) => {
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === address)
          ?.emit('unresponsive');
      }, url);
    const waiting = at('dialogs.html?prompt');
    const tabId = await openTab(browser, waiting);
    await dialogWith(browser, 'Your name?');
    // The page waits for the answer and cannot respond: that is no hang.
    await unresponsive(waiting);
    await new Promise((done) => setTimeout(done, 500));
    expect(await hangQuestions()).toEqual([]);
    await clickNative(browser, 'app://shell', closeButtonOf(tabId));
    await expect
      .poll(async () => (await stateOf(browser)).tabs.some((tab) => tab.id === tabId))
      .toBe(false);
    await expect.poll(() => shownDialog(browser)).toBeNull();
    // A page that waits for no answer and hangs is asked about.
    const other = at('dialogs.html');
    await openTab(browser, other);
    await unresponsive(other);
    await expect.poll(hangQuestions).toEqual([`${site()} isn't responding`]);
  } finally {
    await browser.close();
  }
});
