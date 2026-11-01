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

/** The rules for a frame that starts. */
export interface FrameRules {
  /** Element hiding rules of the frame's address, as a style sheet. */
  readonly styles: string;
  /** Scriptlets that run in the page's world before its own scripts. */
  readonly scripts: readonly string[];
  /** Whether the frame should report its elements for the generic hiding rules. */
  readonly elements: boolean;
}

/** The classes, ids and link targets that a frame reported. */
export interface FrameElements {
  readonly classes: readonly string[];
  readonly ids: readonly string[];
  readonly hrefs: readonly string[];
}

const noRules: FrameRules = { styles: '', scripts: [], elements: false };

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
  /** The engine once it has loaded, for the frames, which cannot wait for it. */
  private loaded: LoadedEngine | undefined;
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

  /** The engine while it loads, for a frame that may wait for it; `undefined` otherwise. */
  loading(): Promise<unknown> | undefined {
    return this.loaded === undefined ? this.engine : undefined;
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

  /**
   * The element hiding rules and scriptlets for a frame that starts. The frame waits for
   * them, so this answers at once: before the engine has loaded, there are none.
   * @param url - The frame's address.
   */
  frameRules(url: string): FrameRules {
    const page = this.page(url);
    if (page === undefined) {
      return noRules;
    }
    const { styles, scripts } = page.loaded.engine.getCosmeticsFilters({
      ...page.address,
      getRulesFromDOM: false,
      getExtendedRules: false,
    });
    return { styles, scripts, elements: true };
  }

  /**
   * The generic element hiding rules for the classes, ids and links of a frame.
   * @param url - The frame's address.
   * @param elements - What the frame reported.
   */
  elementRules(url: string, elements: FrameElements): string {
    const page = this.page(url);
    if (page === undefined) {
      return '';
    }
    return page.loaded.engine.getCosmeticsFilters({
      ...page.address,
      classes: [...elements.classes],
      ids: [...elements.ids],
      hrefs: [...elements.hrefs],
      getBaseRules: false,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromHostname: false,
      getRulesFromDOM: true,
    }).styles;
  }

  /** The loaded engine and the parts of an address that cosmetic rules need. */
  private page(
    url: string,
  ):
    | { loaded: LoadedEngine; address: { url: string; hostname: string; domain: string } }
    | undefined {
    const loaded = this.loaded;
    if (loaded === undefined || !this.options.enabled() || !/^https?:/i.test(url)) {
      return undefined;
    }
    const { hostname, domain } = loaded.Request.fromRawDetails({ url });
    return { loaded, address: { url, hostname, domain } };
  }

  private async read(): Promise<LoadedEngine | undefined> {
    try {
      const [{ FiltersEngine: Engine, Request }, bytes] = await Promise.all([
        import('@ghostery/adblocker'),
        readFile(join(this.options.dataDir, 'engine.bin')),
      ]);
      const engine = Engine.deserialize(new Uint8Array(bytes));
      this.options.logger.info('Content blocker ready', { bytes: bytes.length });
      this.loaded = { engine, Request };
      return this.loaded;
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
