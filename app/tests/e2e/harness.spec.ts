import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { join } from 'node:path';
import { FixtureServer, launch, pageReport, pressNative } from './harness.ts';
import { clickNative, openTab, runIn, stateOf } from './native.ts';

test('fails a test with a report of the browser process when the shell stops answering', async () => {
  const browser = await launch();
  // The shell asks the browser process for its state, which now never answers.
  await browser.main.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('shell.getState');
    ipcMain.handle('shell.getState', () => new Promise(() => undefined));
  });
  const started = Date.now();
  await expect(browser.close()).rejects.toThrow('The shell did not answer at the end of the test');
  // The test ends long before its time limit, and the browser has quit.
  expect(Date.now() - started).toBeLessThan(30_000);
  expect(browser.process.exitCode !== null || browser.process.signalCode !== null).toBe(true);
  const report = test.info().attachments.find((attachment) => attachment.name === 'browser');
  const text = readFileSync(report?.path ?? '', 'utf8');
  expect(text).toContain('The shell did not answer within 10 seconds');
  expect(text).toContain('Browser process: {"windows":[{');
  expect(text).toMatch(
    /^Processes of the computer: \d+(, \d+ of this user)? \((at most \d+|no limit|no known limit) for one user\)$/m,
  );
  expect(text).toMatch(/^Processes of the browser: [1-9]\d* \(.*\bastela\b/m);
});

test('records and stops a browser that does not let the harness connect', async () => {
  test.skip(process.platform === 'win32', 'Windows has no signal that stops a process');
  // Sampling the threads of the process can take a while.
  test.setTimeout(120_000);
  let pid: number | undefined;
  // Stopped right after it reported its start, the browser answers nothing, as one that hangs.
  const started = launch([], {
    onReady: (child) => {
      pid = child.pid;
      child.kill('SIGSTOP');
    },
  });
  // Depending on when the stop takes hold, the main process or the pages do not answer.
  await expect(started).rejects.toThrow(
    /The browser process did not answer within 10 seconds|connectOverCDP: Timeout/,
  );
  // The browser is gone, so it does not slow down the tests after it.
  await expect
    .poll(() => {
      try {
        process.kill(pid ?? 0, 0);
        return 'running';
      } catch {
        return 'gone';
      }
    })
    .toBe('gone');
  const record = test.info().attachments.find((attachment) => attachment.name === 'failed start');
  const text = readFileSync(record?.path ?? '', 'utf8');
  expect(text).toContain('The browser started, but the harness could not use it');
  // A stopped browser cannot list its pages either.
  expect(text).toContain('Pages of the browser not available');
  // The processes of the computer and of this user, among them those of the stopped browser.
  expect(text).toMatch(
    /^Processes of the computer: \d+, \d+ of this user \((at most \d+|no limit) for one user\)$/m,
  );
  expect(text).toMatch(/^Processes of the browser: [1-9]\d* \((.*, )?\d+ astela(, |\)$)/m);
  // On macOS the helpers of the browser take the product's name.
  if (process.platform === 'darwin') {
    expect(text).toMatch(/^Processes of the browser: .*\d+ Astela Helper/m);
  }
});

test('names the page that does not answer in the record of a start', async () => {
  const browser = await launch();
  try {
    // The new tab page runs a script that never ends, so it answers nothing, as a page whose
    // process hangs; the shell still answers.
    await browser.main.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => {
        return contents.getURL().startsWith('app://newtab');
      });
      void page?.executeJavaScript('for (;;) {}').catch(() => undefined);
    });
    const report = await pageReport(browser.devtools);
    expect(report).toMatch(/^page app:\/\/newtab\/: does not answer within 5 seconds$/m);
    expect(report).toMatch(/^page app:\/\/shell\/: answers .*app:\/\/shell\/ complete/m);
  } finally {
    // The busy page ends first, so the browser quits as it does after any test.
    await browser.main.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getURL().startsWith('app://newtab')) contents.forcefullyCrashRenderer();
      }
    });
    await browser.close();
  }
});

test('connects to a browser whose first page fails to load while the harness attaches', async () => {
  test.setTimeout(120_000);
  // The request of the link waits until the harness reached the browser process, and then
  // fails: the error page comes in a process of its own just when the harness would attach
  // to the pages, and an attachment at that moment would wait for that page forever.
  for (const delay of [0, 10, 20]) {
    const sockets: Socket[] = [];
    let released = false;
    const server = createServer((socket) => {
      // The browser resets the connection when its request fails, which is no error here.
      socket.on('error', () => undefined);
      // The browser can try the request once more, as on Windows; that try fails at once.
      if (released) socket.destroy();
      else sockets.push(socket);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const { port } = server.address() as AddressInfo;
    try {
      const browser = await launch(['--', `http://127.0.0.1:${String(port)}/fails`], {
        onMain: () => {
          setTimeout(() => {
            released = true;
            for (const socket of sockets) socket.destroy();
          }, delay);
          return Promise.resolve();
        },
      });
      await browser.close();
    } finally {
      server.close();
    }
  }
});

/** A text as a regular expression that matches it literally. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

test('records how far the browser got with a view whose first page does not come', async () => {
  test.setTimeout(90_000);
  const server = new FixtureServer();
  await server.start();
  // The answer of the page waits, so the first navigation of the tab's new web view does not
  // commit while the test runs, as in the tests on Windows that found no page.
  const release = server.hold('index.html');
  const url = `${server.origin}/index.html`;
  try {
    const browser = await launch();
    try {
      const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
      await address.fill(url);
      await address.press('Enter');
      await expect
        .poll(() => server.requests.some(({ path }) => path === '/index.html'))
        .toBe(true);
      // The session takes the new address of the tab within about a second.
      await expect
        .poll(() => {
          try {
            return readFileSync(join(browser.profile, 'data', 'session.json'), 'utf8').includes(
              url,
            );
          } catch {
            return false;
          }
        })
        .toBe(true);
    } finally {
      await browser.close();
    }
    const record = test.info().attachments.find((attachment) => attachment.name === 'browser');
    const text = readFileSync(record?.path ?? '', 'utf8');
    // The view without an address yet, with its process.
    expect(text).toMatch(
      /\{"id":\d+,"url":"","title":"","loading":true,"crashed":false,"focused":(true|false),"pid":\d+\}/,
    );
    expect(text).toMatch(
      /^A view has not shown its first page; the browser reported its start at \d+, and it is \d+ now\.$/m,
    );
    // Its navigation started and did not commit; its request went out and got no response, and
    // the server got it and did not answer.
    expect(text).toMatch(new RegExp(`^ {4}\\d+ start ${literal(url)} \\(process \\d+\\)$`, 'm'));
    expect(text).toMatch(
      new RegExp(`^ {4}\\d+ request sent ${literal(url)} \\(process \\d+\\)$`, 'm'),
    );
    expect(text).not.toContain(`commit ${url}`);
    expect(text).not.toMatch(new RegExp(`response \\d+ ${literal(url)}`));
    expect(text).toMatch(new RegExp(`^ {2}\\d+ ${literal(url)} not answered$`, 'm'));
    // The processes with their processor time, the network service among them.
    expect(text).toMatch(/^ {2}\d+ Browser, started \d+, \d+\.\d % CPU, /m);
    expect(text).toMatch(/^ {2}\d+ Utility network\.mojom\.NetworkService, started \d+, /m);
    // The write of the session that followed the new address.
    expect(text).toMatch(/^ {2}\d+ (rename|change) session\.json/m);
    // The pages that DevTools lists.
    expect(text).toMatch(/^Pages of the browser:$/m);
  } finally {
    release();
    await server.stop();
  }
});

test('clicks a page with native input once it has painted, as Chromium drops the input before', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const url = `${server.origin}/late-paint.html`;
    await openTab(browser, url);
    const count = (await stateOf(browser)).tabs.length;
    // The page has loaded, but paints its first content only a while later.
    await clickNative(browser, url, `document.querySelector('#open')`);
    await expect.poll(async () => (await stateOf(browser)).tabs.length).toBe(count + 1);
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('presses keys in a page with native input once it has painted, as Chromium drops them before', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const url = `${server.origin}/late-paint.html`;
    await openTab(browser, url);
    await browser.main.evaluate(({ webContents }, address) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === address)
        ?.focus();
    }, url);
    // The page has loaded and has the focus, but paints its first content only a while later.
    await pressNative(browser, 'X', [], url);
    await expect.poll(() => runIn<string[]>(browser, url, 'window.keys')).toEqual(['KeyX']);
  } finally {
    await browser.close();
    await server.stop();
  }
});
