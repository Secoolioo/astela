import type { FiltersEngine, Request as EngineRequest, RequestType } from '@ghostery/adblocker';
import type { OnBeforeRequestListenerDetails } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { RequestDecision, RequestInterceptor } from '../electron/request-pipeline.ts';

/** Electron's resource types and the request types of the filter engine. */
const requestTypes: Readonly<Record<string, RequestType>> = {
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other',
};

/** Options of the {@link ContentBlocker}. */
export interface ContentBlockerOptions {
  /** Folder with `engine.bin`, built by `tools/blocker/build.ts`. */
  readonly dataDir: string;
  /** Whether blocking is on, read for every request. */
  readonly enabled: () => boolean;
  /** Called for every blocked request, with the id of the tab's web contents. */
  readonly onBlocked?: (webContentsId: number) => void;
  readonly logger: Logger;
}

/**
 * Blocks requests that the filter lists name, with the engine that `tools/blocker` built.
 * The engine loads with the first web page, not at the start: a browser that shows only
 * its own pages keeps neither its memory nor the work of collecting it. Requests wait for
 * the engine, so even the first page is filtered. Main-frame requests are not blocked: a
 * page the user opens is never replaced by an error page.
 */
export class ContentBlocker implements RequestInterceptor {
  private engine: Promise<LoadedEngine | undefined> | undefined;
  private readonly options: ContentBlockerOptions;

  /** @param options - Data folder, switch and callbacks. */
  constructor(options: ContentBlockerOptions) {
    this.options = options;
  }

  /** Loads the engine; resolves to `undefined` when the data is missing or broken. */
  load(): Promise<LoadedEngine | undefined> {
    this.engine ??= this.read();
    return this.engine;
  }

  async beforeRequest(
    details: OnBeforeRequestListenerDetails,
  ): Promise<RequestDecision | undefined> {
    if (details.resourceType === 'mainFrame') {
      // A page that starts loading loads the engine, so its frames find their rules.
      if (this.options.enabled() && /^https?:/i.test(details.url)) void this.load();
      return undefined;
    }
    const type = requestTypes[details.resourceType];
    if (type === undefined || !this.options.enabled() || !/^(?:https?|wss?):/i.test(details.url)) {
      return undefined;
    }
    const loaded = await this.load();
    if (loaded === undefined) {
      return undefined;
    }
    const request = loaded.Request.fromRawDetails({
      url: details.url,
      sourceUrl: pageUrl(details),
      type,
    });
    const { match } = loaded.engine.match(request);
    if (!match) {
      return undefined;
    }
    if (details.webContentsId !== undefined) {
      this.options.onBlocked?.(details.webContentsId);
    }
    return { cancel: true };
  }

  private async read(): Promise<LoadedEngine | undefined> {
    try {
      const [{ FiltersEngine: Engine, Request }, bytes] = await Promise.all([
        import('@ghostery/adblocker'),
        readFile(join(this.options.dataDir, 'engine.bin')),
      ]);
      const engine = Engine.deserialize(new Uint8Array(bytes));
      this.options.logger.info('Content blocker ready', { bytes: bytes.length });
      return { engine, Request };
    } catch (error) {
      this.options.logger.warn('Content blocker data is missing or invalid; nothing is blocked', {
        error: String(error),
      });
      return undefined;
    }
  }
}

/** The engine and the request class of the library, loaded together. */
interface LoadedEngine {
  readonly engine: FiltersEngine;
  readonly Request: typeof EngineRequest;
}

/** The page a request belongs to; a frame that is gone falls back to the referrer. */
function pageUrl(details: OnBeforeRequestListenerDetails): string {
  try {
    return details.frame?.top?.url ?? details.webContents?.getURL() ?? details.referrer;
  } catch {
    return details.referrer;
  }
}
