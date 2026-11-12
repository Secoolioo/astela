import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { launch, pageReport } from './harness.ts';

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
