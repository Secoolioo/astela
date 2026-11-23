import { expect, test } from '@playwright/test';
import { FixtureServer, launch, pressNative, type Browser } from './harness.ts';
import {
  clickNative,
  closeButtonOf,
  focusedView,
  loaded,
  openTab,
  runIn,
  shellCall,
  stateOf,
  typeNative,
} from './native.ts';

/**
 * A page that asks to stay, as one with changes that it has not saved does, is asked about
 * before people leave or reload it, and before they close its tab after typing into it
 * (ADR 0060). The question is a box of the system, which the tests record instead of showing.
 * They run without a DevTools client and give the pages native input, which Chromium needs to
 * ask at all.
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

/** A question of the box of the system, as the recorder took it. */
interface Question {
  readonly message: string;
  readonly buttons: readonly string[];
}

/**
 * Starts the browser without a DevTools client, and records the boxes of the system that wait
 * for their answer instead of showing them: each answers with the next of the answers that the
 * test gives, or with the second button, which stays, without one.
 */
async function start(): Promise<Browser> {
  const browser = await launch();
  await browser.cdp.close();
  await browser.main.evaluate(({ dialog }) => {
    const asked: Question[] = [];
    const answers: number[] = [];
    Object.assign(globalThis, { leaveQuestions: asked, leaveAnswers: answers });
    dialog.showMessageBoxSync = ((_window: unknown, options: Electron.MessageBoxSyncOptions) => {
      asked.push({ message: options.message, buttons: options.buttons ?? [] });
      return answers.shift() ?? 1;
    }) as typeof dialog.showMessageBoxSync;
  });
  return browser;
}

/** The questions that the box was asked, in their order. */
function questions(browser: Browser): Promise<Question[]> {
  return browser.main.evaluate(() => Reflect.get(globalThis, 'leaveQuestions') as Question[]);
}

/** Gives the next question its answer: the index of a button, 0 to leave. */
async function answer(browser: Browser, button: number): Promise<void> {
  await browser.main.evaluate((_electron, choice) => {
    (Reflect.get(globalThis, 'leaveAnswers') as number[]).push(choice);
  }, button);
}

/**
 * Types text into the field of a page, after a click into it, as a person does: into a page that
 * has the focus and shows. The browser gives the page of a new tab the focus a moment after it has
 * loaded, as in dialogs.spec.ts, and the input waits until the page has painted for the first
 * time: on macOS, a page that had the focus once got none of the input that came right after it
 * had loaded. Should the text still not arrive, the error tells what the page saw of the click and
 * the keys.
 */
async function typeInto(browser: Browser, url: string, text: string): Promise<void> {
  await expect.poll(() => focusedView(browser)).toBe(url);
  await expect
    .poll(() =>
      runIn(browser, url, `performance.getEntriesByName('first-contentful-paint').length`),
    )
    .toBe(1);
  await runIn(
    browser,
    url,
    `(() => {
      const seen = [];
      Reflect.set(window, 'typedSeen', seen);
      for (const type of ['mousedown', 'focusin', 'keydown', 'input']) {
        document.addEventListener(type, (event) => seen.push(type + ':' + (event.target.id || event.target.nodeName)), true);
      }
      return true;
    })()`,
  );
  await clickNative(browser, url, `document.querySelector('#text')`);
  await typeNative(browser, url, text);
  try {
    await expect
      .poll(() => runIn(browser, url, `document.querySelector('#text').value`))
      .toBe(text);
  } catch (error) {
    const seen = await runIn(
      browser,
      url,
      `JSON.stringify({ seen: Reflect.get(window, 'typedSeen'), active: document.activeElement?.id || document.activeElement?.nodeName, focus: document.hasFocus(), visible: document.visibilityState, paints: performance.getEntriesByType('paint').map((entry) => entry.name) })`,
    );
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\nThe page saw ${String(seen)}; the focus: ${await focusedView(browser)}`,
      {
        cause: error,
      },
    );
  }
}

/** Goes to an address with the address bar and Enter, as a person does. */
async function enterAddress(browser: Browser, url: string): Promise<void> {
  await pressNative(browser, 'L', ['primary']);
  await browser.main.evaluate(async ({ webContents }, address) => {
    await webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('app://shell'))
      ?.insertText(address);
  }, url);
  await pressNative(browser, 'Enter');
}

/** The address of the active tab. */
async function activeUrl(browser: Browser): Promise<string | undefined> {
  const state = await stateOf(browser);
  return state.tabs.find((tab) => tab.id === state.activeTabId)?.url;
}

test('asks before the address bar leaves a page with unsaved text, and only then', async () => {
  const browser = await start();
  try {
    const draft = at('draft.html');
    await openTab(browser, draft);
    await typeInto(browser, draft, 'draft');
    await enterAddress(browser, at('second.html'));
    await expect
      .poll(() => questions(browser))
      .toEqual([{ message: `Leave ${site()}?`, buttons: ['Leave', 'Stay'] }]);
    // Stay keeps the page with what was typed into it.
    await new Promise((done) => setTimeout(done, 500));
    expect(await activeUrl(browser)).toBe(draft);
    expect(await runIn(browser, draft, `document.querySelector('#text').value`)).toBe('draft');
    await answer(browser, 0);
    await enterAddress(browser, at('second.html'));
    await expect.poll(() => activeUrl(browser)).toBe(at('second.html'));
    expect(await questions(browser)).toHaveLength(2);
    // A page that asks to stay, which nobody used, leaves without a question.
    const untouched = at('draft.html?untouched');
    await openTab(browser, untouched);
    await enterAddress(browser, at('index.html'));
    await expect.poll(() => activeUrl(browser)).toBe(at('index.html'));
    expect(await questions(browser)).toHaveLength(2);
  } finally {
    await browser.close();
  }
});

test('asks before F5 and the Reload button reload a page with unsaved text', async () => {
  const browser = await start();
  try {
    const draft = at('draft.html');
    await openTab(browser, draft);
    await typeInto(browser, draft, 'draft');
    const loads = (): Promise<unknown> => runIn(browser, draft, `sessionStorage.getItem('loads')`);
    // macOS has no F5 to reload; Cmd+R runs the same command there.
    await pressNative(browser, mac ? 'R' : 'F5', mac ? ['primary'] : [], draft);
    await expect
      .poll(() => questions(browser))
      .toEqual([{ message: `Reload ${site()}?`, buttons: ['Reload', 'Stay'] }]);
    await new Promise((done) => setTimeout(done, 500));
    expect(await loads()).toBe('1');
    expect(await runIn(browser, draft, `document.querySelector('#text').value`)).toBe('draft');
    await answer(browser, 0);
    await clickNative(
      browser,
      'app://shell',
      `document.querySelector('app-shell').shadowRoot.querySelector('button[aria-label="Reload"]')`,
    );
    await expect.poll(loads).toBe('2');
    expect(await questions(browser)).toHaveLength(2);
    expect((await questions(browser))[1]?.message).toBe(`Reload ${site()}?`);
  } finally {
    await browser.close();
  }
});

test('asks before Back and before a link of the page leave a page with unsaved text', async () => {
  const browser = await start();
  try {
    const draft = at('draft.html');
    const tabId = await openTab(browser, at('index.html'));
    await enterAddress(browser, draft);
    await expect.poll(() => activeUrl(browser)).toBe(draft);
    await loaded(browser, draft);
    await typeInto(browser, draft, 'draft');
    // Back within the same view, as the button of the toolbar goes.
    await shellCall(browser, 'tabs.action', { tabId, action: 'back' });
    await expect
      .poll(() => questions(browser))
      .toEqual([{ message: `Leave ${site()}?`, buttons: ['Leave', 'Stay'] }]);
    await new Promise((done) => setTimeout(done, 500));
    expect(await activeUrl(browser)).toBe(draft);
    // A link of the page itself.
    await answer(browser, 0);
    await clickNative(browser, draft, `document.querySelector('#away')`);
    await expect.poll(() => activeUrl(browser)).toBe(at('second.html'));
    expect(await questions(browser)).toHaveLength(2);
  } finally {
    await browser.close();
  }
});

test('asks before people close a tab whose page asks to stay and holds typed text', async () => {
  const browser = await start();
  try {
    // A page of the site hears whether a page that asks to stay was asked, with a gesture.
    await openTab(browser, at('index.html'));
    await runIn(
      browser,
      at('index.html'),
      `(() => { window.heard = []; new BroadcastChannel('asked').onmessage = (event) => heard.push(event.data); })()`,
    );
    const draft = at('draft.html');
    const tabId = await openTab(browser, draft);
    await typeInto(browser, draft, 'draft');
    // The close button: Cancel keeps the tab with its text.
    await clickNative(browser, 'app://shell', closeButtonOf(tabId));
    await expect
      .poll(() => questions(browser))
      .toEqual([{ message: `Leave ${site()}?`, buttons: ['Leave', 'Cancel'] }]);
    await new Promise((done) => setTimeout(done, 500));
    expect((await stateOf(browser)).tabs.some((tab) => tab.id === tabId)).toBe(true);
    expect(await runIn(browser, draft, `document.querySelector('#text').value`)).toBe('draft');
    // Ctrl+W asks the same; Leave closes the tab, which can open again.
    await pressNative(browser, 'W', ['primary'], draft);
    await expect.poll(async () => (await questions(browser)).length).toBe(2);
    expect((await stateOf(browser)).tabs.some((tab) => tab.id === tabId)).toBe(true);
    await answer(browser, 0);
    await pressNative(browser, 'W', ['primary'], draft);
    await expect
      .poll(async () => (await stateOf(browser)).tabs.some((tab) => tab.id === tabId))
      .toBe(false);
    expect(await questions(browser)).toHaveLength(3);
    await pressNative(browser, 'T', ['primary', 'shift']);
    await expect.poll(() => activeUrl(browser)).toBe(draft);
    // A page that asks to stay, which nobody used, closes at once and gets no gesture.
    const asks = at('asks.html');
    const untouched = await openTab(browser, asks);
    await clickNative(browser, 'app://shell', closeButtonOf(untouched));
    await expect
      .poll(async () => (await stateOf(browser)).tabs.some((tab) => tab.id === untouched))
      .toBe(false);
    // A page with typed text that does not ask to stay closes at once as well.
    const plain = at('draft.html?plain');
    const typed = await openTab(browser, plain);
    await typeInto(browser, plain, 'note');
    await clickNative(browser, 'app://shell', closeButtonOf(typed));
    await expect
      .poll(async () => (await stateOf(browser)).tabs.some((tab) => tab.id === typed))
      .toBe(false);
    expect(await questions(browser)).toHaveLength(3);
    expect(await runIn(browser, at('index.html'), 'window.heard')).toEqual([]);
  } finally {
    await browser.close();
  }
});
