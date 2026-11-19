import type { WebContents, WebFrameMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pageToolsWorld } from '../shared/isolated-worlds.ts';

/**
 * The scripts that the browser runs in web pages, built into `out/preload/page-scripts`: that of
 * the reader view, and that of picture in picture.
 */
export type PageScriptName = 'reader' | 'media';

/** How a page script runs. */
export interface PageScriptCall {
  /**
   * Whether the call counts as an activation of the frame by the person, as a click does, which
   * only a request that acts for a click of the browser's own button gets.
   */
  readonly gesture?: boolean;
  /** How long the call may take, in milliseconds; a later answer is dropped. */
  readonly timeoutMs: number;
  /**
   * The address of the document that the call is for. With it, the call runs at once or not at
   * all: it is refused (`PageScriptRefused`) when the frame shows another address, or while the
   * main frame loads, as Electron would hold a call back until every frame of the page has
   * loaded and then run it in whatever page has loaded by then.
   */
  readonly page?: string;
}

/**
 * The source of a page script as code that gives the result of its `run()` for a request. The
 * script is the body of a function with `module` and `exports`, so that its `"use strict"` stays
 * a directive and it defines no globals; the request goes in as JSON.
 * @param source - The script, as the build writes it in CommonJS.
 * @param request - The request.
 */
export function wrap(source: string, request: unknown): string {
  return (
    '(function(){var module={exports:{}};' +
    `(function(module,exports){${source}\n})(module,module.exports);` +
    `return module.exports.run(${JSON.stringify(request)});})()`
  );
}

/** Thrown when a page script did not answer in time. */
export class PageScriptTimeout extends Error {
  constructor(name: string) {
    super(`The page script ${name} did not answer in time`);
    this.name = 'PageScriptTimeout';
  }
}

/** Thrown when a page script that must run at once would wait, or run in another document. */
export class PageScriptRefused extends Error {
  constructor(name: string) {
    super(`The page script ${name} did not run, as its page loads or shows another address`);
    this.name = 'PageScriptRefused';
  }
}

/**
 * Runs the browser's scripts in web pages: in the main frame in the browser's isolated world
 * 1002, which the page's scripts cannot reach, or in a frame of another site in that frame's
 * own world, as Electron gives frames no isolated worlds. It reads each script once. A call
 * that waits for a page that keeps loading ends after its time; its answer, should one still
 * come, is dropped. A call for the document at an address runs at once or not at all. Every
 * answer is untrusted, as a page may have changed the DOM it read, and the caller checks it
 * against a schema.
 */
export class PageScripts {
  private readonly folder: string;
  private readonly sources = new Map<PageScriptName, Promise<string>>();

  /** @param folder - The folder of the built page scripts. */
  constructor(folder: string) {
    this.folder = folder;
  }

  /**
   * Runs a page script in the isolated world of the browser in the main frame of a page.
   * @param contents - The page.
   * @param name - The script.
   * @param request - What the script is asked.
   * @param call - The time limit, and whether the call counts as an activation.
   * @returns The answer, unchecked.
   */
  async inMainFrame(
    contents: WebContents,
    name: PageScriptName,
    request: unknown,
    call: PageScriptCall,
  ): Promise<unknown> {
    const code = wrap(await this.source(name), request);
    // Electron's own test, right before the call: it waits while nothing has loaded yet or the
    // main frame loads.
    if (
      call.page !== undefined &&
      (contents.isDestroyed() ||
        contents.getURL() === '' ||
        contents.isLoadingMainFrame() ||
        contents.getURL() !== call.page)
    ) {
      throw new PageScriptRefused(name);
    }
    return within(
      contents.executeJavaScriptInIsolatedWorld(pageToolsWorld, [{ code }], call.gesture === true),
      call.timeoutMs,
      name,
    );
  }

  /**
   * Runs a page script in a frame, in the frame's own world.
   * @param frame - The frame.
   * @param name - The script.
   * @param request - What the script is asked.
   * @param call - The time limit, and whether the call counts as an activation.
   * @returns The answer, unchecked.
   */
  async inFrame(
    frame: WebFrameMain,
    name: PageScriptName,
    request: unknown,
    call: PageScriptCall,
  ): Promise<unknown> {
    const code = wrap(await this.source(name), request);
    if (
      call.page !== undefined &&
      (frame.isDestroyed() || frame.detached || frame.url !== call.page)
    ) {
      throw new PageScriptRefused(name);
    }
    return within(frame.executeJavaScript(code, call.gesture === true), call.timeoutMs, name);
  }

  /** The source of a script, read once; a read that failed is tried again the next time. */
  private source(name: PageScriptName): Promise<string> {
    let source = this.sources.get(name);
    if (source === undefined) {
      source = readFile(join(this.folder, `${name}.cjs`), 'utf8');
      this.sources.set(name, source);
      source.catch(() => this.sources.delete(name));
    }
    return source;
  }
}

/** The answer of a call, or a `PageScriptTimeout` once its time is over. */
function within(answer: Promise<unknown>, ms: number, name: string): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new PageScriptTimeout(name)), ms);
  });
  return Promise.race([answer, late]).finally(() => clearTimeout(timer));
}
