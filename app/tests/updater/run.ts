/**
 * End-to-end update test on Windows (NSIS) and Linux (AppImage). It installs build 1 and
 * points it at a local signed feed through the real `UpdateURL` policy, so the shipped code
 * needs no test switch. Build 1 must first refuse a tampered feed, then download build 2
 * from a valid one and install it when it quits. Afterwards, build 2 must start.
 *
 * With a broken build 3, which fails to start on purpose, build 2 installs it, build 3
 * fails twice, and the boot guard must bring build 2 back at the third start.
 *
 * With `--live`, it proves the update from a published release to the next one instead. The
 * earlier release is installed without any policy, so it checks the live feed named in
 * brand.json, as it does for users. Once that feed lists the new release, the earlier one
 * must find it at its first check, download it and install it when it quits; afterwards,
 * the new release must start.
 *
 * Usage: node app/tests/updater/run.ts --old <packages 1> --new <packages 2>
 *   --old-version <v1> --new-version <v2> --key <private.pem>
 *   [--broken <packages 3> --broken-version <v3>]
 * Live: node app/tests/updater/run.ts --live --old <packages of the earlier release>
 *   --old-version <earlier version> --new-version <new version>
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8')) as {
  productName: string;
  slug: string;
  website: string;
};
const args = process.argv.slice(2);
const optional = (name: string): string | undefined =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;
const option = (name: string): string => {
  const value = optional(name);
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
};

/** A packaged build and its version. */
interface Build {
  readonly dir: string;
  readonly version: string;
}

/** The self-test report fields that the test checks. */
interface Report {
  readonly ok: boolean;
  readonly version: string;
}

/** The builds that the local feed publishes, and its private key. */
interface LocalFeed {
  readonly builds: readonly Build[];
  readonly key: string;
}

const live = args.includes('--live');
const oldBuild: Build = { dir: resolve(option('old')), version: option('old-version') };
const newVersion = option('new-version');
const port = 8123;
const feedUrl = `http://127.0.0.1:${port}/`;
const windows = process.platform === 'win32';

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function run(command: string, commandArgs: readonly string[], input?: string): string {
  console.log(`$ ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout;
}

async function waitFor(
  what: string,
  seconds: number,
  test: () => boolean,
  running?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (!test()) {
    if (running !== undefined && running.exitCode !== null) {
      throw new Error(`The browser exited with ${running.exitCode} while waiting for ${what}`);
    }
    if (Date.now() > deadline) throw new Error(`Timed out after ${seconds} s: ${what}`);
    await sleep(500);
  }
}

/** Publishes all builds and a signed feed that lists the given ones, in a site folder. */
function buildSite(site: string, feed: LocalFeed, listed: readonly Build[], tamper: boolean): void {
  rmSync(site, { recursive: true, force: true });
  for (const build of feed.builds) {
    const target = join(site, 'download', `v${build.version}`);
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(build.dir)) {
      if (/\.(exe|AppImage|blockmap|yml)$/.test(name)) {
        copyFileSync(join(build.dir, name), join(target, name));
      }
    }
  }
  for (const build of listed) {
    run(process.execPath, [
      join(root, 'tools/feed/feed.ts'),
      'build',
      '--packages',
      build.dir,
      '--version',
      build.version,
      '--channel',
      'beta',
      '--key',
      feed.key,
      '--out',
      site,
      '--download-base',
      `download/v${build.version}/`,
    ]);
  }
  if (tamper) appendFileSync(join(site, 'updates/v1/index.json'), ' ');
}

function setPolicy(): void {
  if (windows) {
    run('reg', [
      'add',
      `HKLM\\SOFTWARE\\Policies\\${brand.productName}`,
      '/v',
      'UpdateURL',
      '/t',
      'REG_SZ',
      '/d',
      feedUrl,
      '/f',
    ]);
  } else {
    const dir = `/etc/${brand.slug}/policies/managed`;
    run('sudo', ['mkdir', '-p', dir]);
    run('sudo', ['tee', `${dir}/updates.json`], JSON.stringify({ UpdateURL: feedUrl }));
  }
}

/** Installs build 1 and returns the program to start. */
async function install(): Promise<string> {
  const file = readdirSync(oldBuild.dir).find((n) =>
    (windows ? /-setup\.exe$/ : /\.AppImage$/).test(n),
  );
  if (file === undefined) throw new Error('No package of build 1');
  if (windows) {
    run(join(oldBuild.dir, file), ['/S']);
    const exe = join(
      process.env['LOCALAPPDATA'] ?? '',
      'Programs',
      brand.slug,
      `${brand.slug}.exe`,
    );
    await waitFor('the installed program', 60, () => existsSync(exe));
    return exe;
  }
  const target = join(homedir(), 'Applications', `${brand.slug}.AppImage`);
  mkdirSync(join(homedir(), 'Applications'), { recursive: true });
  copyFileSync(join(oldBuild.dir, file), target);
  chmodSync(target, 0o755);
  return target;
}

interface Running {
  readonly child: ChildProcess;
  readonly profile: string;
}

function start(program: string, profile: string, keepRunning: boolean, report: string): Running {
  const childArgs = [`--user-data-dir=${profile}`, `--smoke-test=${report}`];
  if (keepRunning) childArgs.push('--smoke-test-keep-running');
  // Chromium refuses to start as root with its sandbox; only local containers run as root.
  if (!windows && process.getuid?.() === 0) childArgs.push('--no-sandbox');
  console.log(`$ ${program} ${childArgs.join(' ')}`);
  const child = spawn(program, childArgs, { stdio: 'inherit' });
  return { child, profile };
}

/** A record of the browser's JSON Lines log. */
interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly fields?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

function logLines(profile: string): LogLine[] {
  const file = join(profile, 'logs', 'main.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LogLine);
}

/** The browser's main process: the started program itself, or the child of the AppImage runtime. */
function browserPid(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error('No process id');
  if (windows) return child.pid;
  const ps = run('ps', ['-eo', 'pid=,ppid=,args=']);
  const rows = ps
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), args: match[3] ?? '' }));
  const descendants = new Set([child.pid]);
  for (let added = true; added;) {
    added = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        added = true;
      }
    }
  }
  // The AppImage runtime carries the same arguments; the browser is a descendant of it.
  const browser = rows.find(
    (row) =>
      row.pid !== child.pid &&
      descendants.has(row.pid) &&
      row.args.includes('--smoke-test=') &&
      !row.args.includes('--type='),
  );
  return browser?.pid ?? child.pid;
}

/** Asks the browser to quit the way a user or the system would. */
async function quit(running: Running): Promise<void> {
  const exited = new Promise<void>((done) => {
    if (running.child.exitCode !== null) done();
    else running.child.once('exit', () => done());
  });
  const pid = browserPid(running.child);
  if (windows) spawnSync('taskkill', ['/pid', String(pid)], { stdio: 'inherit' });
  else process.kill(pid, 'SIGTERM');
  await Promise.race([
    exited,
    sleep(60_000).then(() => {
      throw new Error('The browser did not quit within 60 s');
    }),
  ]);
}

/** Whether an update installer or the rollback installer (`installer-<version>.exe`) runs. */
function installerRunning(): boolean {
  const list = spawnSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' }).stdout;
  return /-setup\.exe|"installer-/i.test(list);
}

/**
 * Whether the browser has downloaded an update. Its check runs once per start, so a check
 * that failed or found nothing, or a disabled updater, ends the wait at once. The live test
 * reads these messages from published releases, so they must not change between releases.
 */
function updateReady(profile: string): boolean {
  for (const line of logLines(profile)) {
    if (line.message.startsWith('Update ready')) return true;
    if (
      line.message === 'Update failed' ||
      line.message === 'No update available' ||
      (line.message === 'Update service' && line.fields?.['state'] === 'disabled')
    ) {
      throw new Error(`${line.message} ${JSON.stringify(line.fields ?? {})}`);
    }
  }
  return false;
}

/**
 * Starts a build until it has downloaded an update, quits it and waits for the install.
 * @param from - The version that must be running before the update.
 * @param seconds - How long the check and the download may take.
 */
async function updateOnQuit(
  program: string,
  profile: string,
  from: string,
  seconds = 300,
): Promise<void> {
  const reportPath = join(profile, '..', `${basename(profile)}.json`);
  const running = start(program, profile, true, reportPath);
  try {
    await waitFor(
      'the downloaded update',
      seconds,
      () => updateReady(running.profile),
      running.child,
    );
    expectVersion(readReport(reportPath), from);
  } finally {
    // Printed after a failure too: download problems show up as warnings or errors, and a
    // stalled download as "Downloading update" without "Update ready".
    for (const line of logLines(profile)) {
      if (/update/i.test(line.message) || line.level === 'warn' || line.level === 'error') {
        const error = line.error === undefined ? {} : { error: line.error.message };
        const details = { ...line.fields, ...error };
        console.log(`  ${line.level} ${line.message} ${JSON.stringify(details)}`);
      }
    }
  }
  await quit(running);
  if (windows) {
    await sleep(5000);
    await waitFor('the installer to finish', 180, () => !installerRunning());
  }
}

/** The self-test report at a path, if the build wrote one. */
function readReport(path: string): Report | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Report) : undefined;
}

/** Runs the self-test of the installed build and returns its exit code and report. */
async function selfTest(
  program: string,
  profile: string,
): Promise<{ code: number | null; report?: Report }> {
  const reportPath = join(profile, '..', `${basename(profile)}.json`);
  const running = start(program, profile, false, reportPath);
  const code = await new Promise<number | null>((done) => running.child.once('exit', done));
  const report = readReport(reportPath);
  if (report === undefined) return { code };
  console.log(JSON.stringify(report));
  return { code, report };
}

function expectVersion(report: Report | undefined, version: string): void {
  if (report?.ok !== true || report.version !== version) {
    throw new Error(`Expected a working ${version}, found ${report?.version ?? 'nothing'}`);
  }
}

/** Updates through a local feed, then rolls back from a broken build. */
async function localTest(work: string): Promise<void> {
  const newBuild: Build = { dir: resolve(option('new')), version: newVersion };
  const brokenDir = optional('broken');
  const brokenBuild: Build | undefined =
    brokenDir === undefined
      ? undefined
      : { dir: resolve(brokenDir), version: option('broken-version') };
  const feed: LocalFeed = {
    builds: [oldBuild, newBuild, ...(brokenBuild === undefined ? [] : [brokenBuild])],
    key: resolve(option('key')),
  };
  const site = join(work, 'site');
  buildSite(site, feed, [newBuild], true);
  const server = spawn(
    process.execPath,
    [join(root, 'tools/feed/feed.ts'), 'serve', site, String(port)],
    { stdio: 'inherit' },
  );
  try {
    setPolicy();
    const program = await install();

    console.log('Build 1 must refuse a tampered feed.');
    const first = start(program, join(work, 'profile-1'), true, join(work, 'profile-1.json'));
    await waitFor(
      'the refused feed',
      150,
      () =>
        logLines(first.profile).some(
          (l) => l.message === 'Update failed' && l.fields?.['code'] === 'signature',
        ),
      first.child,
    );
    await quit(first);

    console.log('Build 1 must download build 2 from a valid feed and install it on quit.');
    buildSite(site, feed, [newBuild], false);
    await updateOnQuit(program, join(work, 'profile-2'), oldBuild.version);
    console.log('Build 2 must start.');
    expectVersion((await selfTest(program, join(work, 'profile-3'))).report, newBuild.version);
    console.log(`Update passed: ${oldBuild.version} → ${newBuild.version}`);

    if (brokenBuild === undefined) return;
    console.log('Build 2 must install the broken build 3.');
    buildSite(site, feed, [newBuild, brokenBuild], false);
    await updateOnQuit(program, join(work, 'profile-4'), newBuild.version);
    for (const attempt of [5, 6]) {
      const { code, report } = await selfTest(program, join(work, `profile-${attempt}`));
      if (code === 0 || report !== undefined) throw new Error('Build 3 started although broken');
    }
    console.log('The third start must restore build 2.');
    const rollbackStart = await selfTest(program, join(work, 'profile-7'));
    if (windows) {
      await sleep(5000);
      await waitFor('the reinstall to finish', 180, () => !installerRunning());
      expectVersion((await selfTest(program, join(work, 'profile-8'))).report, newBuild.version);
    } else {
      // The restored AppImage starts again with the same arguments and writes the report.
      const reportPath = join(work, 'profile-7.json');
      await waitFor('the restored build', 120, () => existsSync(reportPath));
      expectVersion(readReport(reportPath), newBuild.version);
    }
    if (rollbackStart.code !== 0) throw new Error('The rollback start did not exit cleanly');
    console.log(`Rollback passed: ${brokenBuild.version} → ${newBuild.version}`);
  } finally {
    server.kill();
  }
}

/** Whether the live index lists a version, fetched the way the browser fetches it. */
async function liveIndexLists(index: string, version: string): Promise<boolean> {
  try {
    const response = await fetch(index, { cache: 'no-store' });
    if (!response.ok) return false;
    const { releases } = (await response.json()) as { releases?: { version: string }[] };
    return releases?.some((release) => release.version === version) === true;
  } catch {
    return false;
  }
}

/** Updates the installed earlier release to the new one through the live feed. */
async function liveTest(work: string): Promise<void> {
  // The browser reads the index without a query that bypasses caches, so a copy cached
  // before the deployment could hide the new release from its only check.
  const index = new URL('updates/v1/index.json', brand.website).href;
  const deadline = Date.now() + 600_000;
  while (!(await liveIndexLists(index, newVersion))) {
    if (Date.now() > deadline) throw new Error(`${index} does not list ${newVersion}`);
    console.log(`Waiting until ${index} lists ${newVersion}`);
    await sleep(30_000);
  }
  const program = await install();
  console.log(
    `${oldBuild.version} must find ${newVersion} in the live feed and install it on quit.`,
  );
  // The first check runs 30 to 60 s after the start; the packages come from GitHub Releases.
  await updateOnQuit(program, join(work, 'profile-1'), oldBuild.version, 600);
  console.log(`${newVersion} must start.`);
  expectVersion((await selfTest(program, join(work, 'profile-2'))).report, newVersion);
  console.log(`Live update passed: ${oldBuild.version} → ${newVersion}`);
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'updater-'));
  await (live ? liveTest(work) : localTest(work));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
