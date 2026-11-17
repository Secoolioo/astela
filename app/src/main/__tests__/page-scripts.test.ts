import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { WebContents, WebFrameMain } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageScripts, PageScriptTimeout, wrap } from '../page-scripts.ts';

/** An answer that nobody waits for. */
const ignore = (): void => undefined;

/** A page script as the build writes it in CommonJS. */
const script = `"use strict";Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});
var leaked = 1;
function run(request){ return { kind: request.kind, strict: (function(){ return this === undefined; })() }; }
exports.run = run;`;

describe('wrap', () => {
  it('runs a script of CommonJS for a request, keeps its strict mode and defines no globals', () => {
    const context: Record<string, unknown> = {};
    const result: unknown = runInNewContext(wrap(script, { kind: 'check' }), context);
    expect(result).toEqual({ kind: 'check', strict: true });
    expect(Object.keys(context)).toEqual([]);
  });

  it('gives the request as data, which cannot end the call', () => {
    const echo = 'exports.run = function (request) { return request; };';
    const request = { text: '"); globalThis.hacked = 1; ("', until: 5 };
    const context: Record<string, unknown> = {};
    expect(runInNewContext(wrap(echo, request), context)).toEqual(request);
    expect(context['hacked']).toBeUndefined();
  });
});

describe('PageScripts', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'page-scripts-'));
    writeFileSync(join(folder, 'reader.cjs'), script);
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(folder, { recursive: true, force: true });
  });

  it('runs a script in world 1002 of the main frame, with an activation only when asked', async () => {
    const calls: unknown[][] = [];
    const contents = {
      executeJavaScriptInIsolatedWorld: (...args: unknown[]): Promise<unknown> => {
        calls.push(args);
        const [, sources] = args as [number, { code: string }[]];
        return Promise.resolve(runInNewContext(sources[0]?.code ?? '', {}));
      },
    } as unknown as WebContents;
    const scripts = new PageScripts(folder);
    expect(
      await scripts.inMainFrame(contents, 'reader', { kind: 'check' }, { timeoutMs: 1000 }),
    ).toEqual({ kind: 'check', strict: true });
    await scripts.inMainFrame(
      contents,
      'reader',
      { kind: 'extract' },
      { gesture: true, timeoutMs: 1000 },
    );
    expect(calls.map(([world, , gesture]) => [world, gesture])).toEqual([
      [1002, false],
      [1002, true],
    ]);
  });

  it("runs a script in a frame's own world, and reads each script once", async () => {
    const calls: unknown[][] = [];
    const frame = {
      executeJavaScript: (code: string, gesture: boolean): Promise<unknown> => {
        calls.push([code, gesture]);
        return Promise.resolve(runInNewContext(code, {}));
      },
    } as unknown as WebFrameMain;
    const scripts = new PageScripts(folder);
    expect(await scripts.inFrame(frame, 'reader', { kind: 'a' }, { timeoutMs: 1000 })).toEqual({
      kind: 'a',
      strict: true,
    });
    // The file changes; the script was read already.
    writeFileSync(join(folder, 'reader.cjs'), 'exports.run = () => "new";');
    await scripts.inFrame(frame, 'reader', { kind: 'b' }, { gesture: true, timeoutMs: 1000 });
    expect(calls.map(([, gesture]) => gesture)).toEqual([false, true]);
    expect(String(calls[1]?.[0])).toContain('"use strict"');
  });

  it('gives up on a call after its time, and drops its late answer', async () => {
    let answer: (value: unknown) => void = ignore;
    let hang = false;
    const contents = {
      executeJavaScriptInIsolatedWorld: (): Promise<unknown> =>
        hang
          ? new Promise((done) => {
              answer = done;
            })
          : Promise.resolve('first'),
    } as unknown as WebContents;
    const scripts = new PageScripts(folder);
    // The first call reads the script, which the clock of the test does not wait for.
    expect(await scripts.inMainFrame(contents, 'reader', {}, { timeoutMs: 500 })).toBe('first');
    vi.useFakeTimers();
    hang = true;
    const settled = scripts.inMainFrame(contents, 'reader', {}, { timeoutMs: 500 }).then(
      () => 'answered',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(499);
    answer('too late?');
    await vi.advanceTimersByTimeAsync(0);
    expect(await settled).toBe('answered');
    hang = true;
    const late = scripts.inMainFrame(contents, 'reader', {}, { timeoutMs: 500 }).then(
      () => 'answered',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(500);
    answer({ readable: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(await late).toBeInstanceOf(PageScriptTimeout);
  });

  it('fails when the script is missing, and reads it again on the next call', async () => {
    rmSync(join(folder, 'reader.cjs'));
    const contents = {
      executeJavaScriptInIsolatedWorld: (_world: number, sources: { code: string }[]) =>
        Promise.resolve(runInNewContext(sources[0]?.code ?? '', {})),
    } as unknown as WebContents;
    const scripts = new PageScripts(folder);
    await expect(
      scripts.inMainFrame(contents, 'reader', { kind: 'check' }, { timeoutMs: 1000 }),
    ).rejects.toThrow('ENOENT');
    writeFileSync(join(folder, 'reader.cjs'), script);
    expect(
      await scripts.inMainFrame(contents, 'reader', { kind: 'check' }, { timeoutMs: 1000 }),
    ).toEqual({ kind: 'check', strict: true });
  });
});
