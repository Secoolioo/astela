import type { WebContents, WebFrameMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pageToolsWorld } from '../shared/isolated-worlds.ts';

/** The scripts that the browser runs in web pages, built into `out/preload/page-scripts`. */
export type PageScriptName = 'reader';

/** How a page script runs. */
export interface PageScriptCall {
  /**
   * Whether the call counts as an activation of the frame by the person, as a click does, which
   * only a request that acts for a click of the browser's own button gets.
   */
  readonly gesture?: boolean;
  /** How long the call may take, in milliseconds; a later answer is dropped. */
  readonly timeoutMs: number;
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

/**
 * Runs the browser's scripts in web pages: in the main frame in the browser's isolated world
 * 1002, which the page's scripts cannot reach, or in a frame of another site in that frame's
 * own world, as Electron gives frames no isolated worlds. It reads each script once. A call
 * that waits for a page that keeps loading ends after its time; its answer, should one still
 * come, is dropped. Every answer is untrusted, as a page may have changed the DOM it read, and
 * the caller checks it against a schema.
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
