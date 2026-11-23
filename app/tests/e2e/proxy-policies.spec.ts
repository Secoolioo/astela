import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  launch,
  overlayAttached,
  overlayPage,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';
import { MachinePolicies } from './machine-policies.ts';

/** A server that logs what it was asked, as a proxy or as the site itself. */
interface LoggingServer {
  readonly server: Server;
  readonly port: number;
  /** What it was asked: `GET` with the address, or `CONNECT` with the host. */
  readonly asked: string[];
}

/**
 * A proxy that answers every page itself with its name as the title, and refuses tunnels for
 * secure addresses, so nothing leaves the machine.
 */
async function proxy(name: string): Promise<LoggingServer> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(`${request.method ?? ''} ${request.url ?? ''}`);
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<title>${name}</title>`);
  });
  server.on('connect', (request, socket) => {
    asked.push(`CONNECT ${request.url ?? ''}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: (server.address() as AddressInfo).port, asked };
}

/** The site itself, which the browser reaches without a proxy, and the proxy script. */
async function site(scriptProxy: () => number): Promise<LoggingServer> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(`${request.method ?? ''} ${request.url ?? ''}`);
    if (request.url === '/proxy.pac') {
      response.writeHead(200, { 'content-type': 'application/x-ns-proxy-autoconfig' });
      response.end(
        `function FindProxyForURL(url, host) { return 'PROXY 127.0.0.1:${String(scriptProxy())}'; }`,
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>direct</title>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: (server.address() as AddressInfo).port, asked };
}

let system: LoggingServer;
let managed: LoggingServer;
let direct: LoggingServer;

test.beforeAll(async () => {
  system = await proxy('system proxy');
  managed = await proxy('proxy of the policy');
  direct = await site(() => managed.port);
});
test.afterAll(async () => {
  for (const each of [system, managed, direct]) {
    await new Promise<void>((done) => each.server.close(() => done()));
  }
});
test.beforeEach(() => {
  for (const each of [system, managed, direct]) each.asked.length = 0;
});

/** An address of the test site, which the browser reaches directly through the host rules. */
const page = (path: string): string => `http://site.qa.test:${String(direct.port)}/${path}`;

/** Starts the browser with the system proxy in the environment, as Linux has it. */
function start(): Promise<Browser> {
  const env: Record<string, string> = {};
  for (const name of ['http_proxy', 'https_proxy']) {
    env[name] = `http://127.0.0.1:${String(system.port)}`;
    env[name.toUpperCase()] = env[name];
  }
  for (const name of ['all_proxy', 'no_proxy']) {
    env[name] = '';
    env[name.toUpperCase()] = '';
  }
  return launch([`--host-resolver-rules=MAP *.qa.test 127.0.0.1`], { env });
}

/** The address bar of a window. */
function addressBar(shell: Page): Locator {
  return shell.getByRole('textbox', { name: 'Address and search bar' });
}

/** Loads an address in the active tab of a window and gives the title of its page. */
async function titleOf(browser: Browser, url: string, shell = browser.shell): Promise<string> {
  await addressBar(shell).fill(url);
  await addressBar(shell).press('Enter');
  const loaded = await waitForPage(browser, (current) => current === url);
  await expect(loaded).not.toHaveTitle('');
  return loaded.title();
}

/** Reads the policies again, as the browser does when a window gets the focus. */
async function readPolicies(browser: Browser): Promise<void> {
  await browser.main.evaluate(({ BaseWindow }) => {
    BaseWindow.getAllWindows()[0]?.emit('focus');
  });
}

/** The records of the browser's log. */
function records(browser: Browser): string[] {
  return readFileSync(join(browser.profile, 'data', 'logs', 'main.log'), 'utf8').split('\n');
}

/** The records of the browser's log that name a policy as not applying or doing nothing. */
function problems(browser: Browser): string[] {
  return records(browser).filter((line) =>
    /"Policy (value ignored|value has no effect)"/.test(line),
  );
}

/** The shell of the private window, once the shortcut opened it. */
async function openPrivate(browser: Browser): Promise<Page> {
  await pressNative(browser, 'N', ['primary', 'shift']);
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const candidate of browser.cdp.contexts().flatMap((context) => context.pages())) {
        if (!candidate.url().startsWith('app://shell')) continue;
        if ((await shellState(candidate).catch(() => undefined))?.private === true) {
          found = candidate;
        }
      }
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('No private window');
  await expect(found.getByRole('tab')).toHaveCount(1);
  return found;
}

/** Makes a workspace that keeps its cookies apart, which the window then shows with a new tab. */
async function isolatedWorkspace(browser: Browser, name: string): Promise<void> {
  await browser.shell.getByRole('button', { name: /^Workspace / }).click();
  const dialog = (await overlayPage(browser)).getByRole('dialog', { name: 'Workspaces' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'New workspace' }).click();
  const field = dialog.getByRole('textbox', { name: 'Name' });
  await expect(field).toBeFocused();
  await field.fill(name);
  await dialog.getByRole('checkbox', { name: 'Keep its cookies and sign-ins apart' }).check();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect.poll(() => overlayAttached(browser)).toBe(false);
  await expect(
    browser.shell.getByRole('button', { name: `Workspace ${name}`, exact: true }),
  ).toBeVisible();
  await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
    'title',
    'New tab',
  );
}

test('sends every window through the proxy of the policies and gives the sign-in only to its servers', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away; the
  // proxy of the system comes from the environment only on Linux.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  test.skip(process.platform !== 'linux', 'The system proxy of the test is a Linux setting');
  // The file of the policies goes again also when the browser does not start.
  const policies = new MachinePolicies('e2e-proxy');
  try {
    policies.set({
      ProxyMode: 'fixed_servers',
      ProxyServer: `127.0.0.1:${String(managed.port)}`,
      ProxyBypassList: 'localhost',
      AuthServerAllowlist: '*.qa.test',
    });
    const browser = await start();
    try {
      expect(await titleOf(browser, page('first'))).toBe('proxy of the policy');
      expect(managed.asked).toContain(`GET ${page('first')}`);
      // A workspace that keeps its data apart and a private window have sessions of their own.
      await isolatedWorkspace(browser, 'Bank');
      expect(await titleOf(browser, page('isolated'))).toBe('proxy of the policy');
      const privateShell = await openPrivate(browser);
      expect(await titleOf(browser, page('private'), privateShell)).toBe('proxy of the policy');
      expect(managed.asked).toEqual(
        expect.arrayContaining([`GET ${page('private')}`, `GET ${page('isolated')}`]),
      );
      expect(system.asked).toEqual([]);
      expect(direct.asked).toEqual([]);
      // The servers of the sign-in of the system reach the network service through Electron's
      // switch, which it reads again when that service starts anew.
      expect(
        await browser.main.evaluate(({ app }) =>
          app.commandLine.getSwitchValue('auth-server-whitelist'),
        ),
      ).toBe('*.qa.test');
      expect(problems(browser)).toEqual([]);
    } finally {
      await browser.close();
    }
  } finally {
    policies.remove();
  }
});

test('follows a change of the proxy policies at the next read of the policies', async () => {
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  test.skip(process.platform !== 'linux', 'The system proxy of the test is a Linux setting');
  const policies = new MachinePolicies('e2e-proxy');
  try {
    policies.set({ ProxyMode: 'pac_script', ProxyPacUrl: page('proxy.pac') });
    const browser = await start();
    try {
      // The script decides: it sends the pages to the proxy of the policy.
      expect(await titleOf(browser, page('scripted'))).toBe('proxy of the policy');
      expect(direct.asked).toContain('GET /proxy.pac');
      expect(system.asked).toEqual([]);
      // direct uses no proxy, and a ProxyServer does nothing in that mode, which the log says.
      policies.set({ ProxyMode: 'direct', ProxyServer: `127.0.0.1:${String(managed.port)}` });
      await readPolicies(browser);
      await expect.poll(() => problems(browser).length).toBe(1);
      expect(problems(browser)[0]).toContain('ProxyMode direct does not use it');
      expect(await titleOf(browser, page('direct'))).toBe('direct');
      expect(direct.asked).toContain('GET /direct');
      // Without the policies, the browser goes back to the proxy of the system.
      policies.remove();
      await readPolicies(browser);
      await expect
        .poll(() =>
          records(browser).some((line) => /"Network policies applied".*"proxy":"none"/.test(line)),
        )
        .toBe(true);
      expect(await titleOf(browser, page('system'))).toBe('system proxy');
      expect(system.asked).toContain(`GET ${page('system')}`);
    } finally {
      await browser.close();
    }
  } finally {
    policies.remove();
  }
});
