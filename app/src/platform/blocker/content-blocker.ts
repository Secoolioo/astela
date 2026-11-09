import type { FiltersEngine, Request as EngineRequest, RequestType } from '@ghostery/adblocker';
import type { OnBeforeRequestListenerDetails, OnHeadersReceivedListenerDetails } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../../kernel/logging/logger.ts';
import type {
  HeaderAdditions,
  RequestDecision,
  RequestInterceptor,
} from '../electron/request-pipeline.ts';
import { resourceUrl, type ReplacementResource } from './resource-protocol.ts';

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

/**
 * A procedural rule, such as `:has-text()`: the frame finds its elements itself, then marks
 * them with the attribute that the style sheet hides, or runs the directive on them.
 */
export interface ExtendedRule {
  /** The selector of the elements, parsed. */
  readonly ast: unknown;
  /** The attribute that hides an element, for hiding rules. */
  readonly attribute?: string | undefined;
  /** What to do with an element, such as removing it, for the other rules. */
  readonly directive?: unknown;
}

/** The rules for a frame that starts. */
export interface FrameRules {
  /** Element hiding rules of the frame's address, as a style sheet. */
  readonly styles: string;
  /** Scriptlets that run in the page's world before its own scripts. */
  readonly scripts: readonly string[];
  /** Procedural rules of the frame's address. */
  readonly extended: readonly ExtendedRule[];
  /** Whether the frame should report its elements for the generic hiding rules. */
  readonly elements: boolean;
}

/** The classes, ids and link targets that a frame reported. */
export interface FrameElements {
  readonly classes: readonly string[];
  readonly ids: readonly string[];
  readonly hrefs: readonly string[];
}

const noRules: FrameRules = { styles: '', scripts: [], extended: [], elements: false };

/** Where the content blocker is: not loaded yet, loading, working, or without usable data. */
export type BlockerStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** Options of the {@link ContentBlocker}. */
export interface ContentBlockerOptions {
  /** Folder with `engine.bin`, built by `tools/blocker/build.ts`. */
  readonly dataDir: string;
  /** Whether blocking is on for a page, by its address; read for every request. */
  readonly enabled: (pageUrl: string) => boolean;
  /** Called for every blocked request, with the id of the tab's web contents. */
  readonly onBlocked?: (webContentsId: number) => void;
  /** Called when the {@link ContentBlocker.status} changes. */
  readonly onStatus?: (status: BlockerStatus) => void;
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
  private current: BlockerStatus = 'idle';
  private readonly options: ContentBlockerOptions;

  /** @param options - Data folder, switch and callbacks. */
  constructor(options: ContentBlockerOptions) {
    this.options = options;
  }

  /** Loads the engine; resolves to `undefined` when the data is missing or broken. */
  load(): Promise<LoadedEngine | undefined> {
    if (this.engine === undefined) {
      this.setStatus('loading');
      this.engine = this.read();
    }
    return this.engine;
  }

  /** Whether the engine has loaded, is loading, or could not load, so the UI can tell. */
  get status(): BlockerStatus {
    return this.current;
  }

  private setStatus(status: BlockerStatus): void {
    if (status === this.current) return;
    this.current = status;
    this.options.onStatus?.(status);
  }

  /** The engine while it loads, for a frame that may wait for it; `undefined` otherwise. */
  loading(): Promise<unknown> | undefined {
    return this.loaded === undefined ? this.engine : undefined;
  }

  async beforeRequest(
    details: OnBeforeRequestListenerDetails,
  ): Promise<RequestDecision | undefined> {
    if (details.resourceType === 'mainFrame') {
      if (!this.options.enabled(details.url) || !/^https?:/i.test(details.url)) return undefined;
      // A page that starts loading loads the engine, so its frames find their rules. A page
      // is never blocked, but tracking parameters leave its address once the engine is there.
      if (this.loaded === undefined) {
        void this.load();
        return undefined;
      }
      const page = this.loaded.Request.fromRawDetails({
        url: details.url,
        sourceUrl: details.url,
        type: 'main_frame',
      });
      const rewritten = this.loaded.engine.match(page).rewrite?.url;
      return rewritten === undefined || rewritten === details.url
        ? undefined
        : { redirectURL: rewritten };
    }
    const type = requestTypes[details.resourceType];
    const sourceUrl = pageUrl(details);
    if (
      type === undefined ||
      !/^(?:https?|wss?):/i.test(details.url) ||
      !this.options.enabled(sourceUrl)
    ) {
      return undefined;
    }
    const loaded = await this.load();
    if (loaded === undefined) {
      return undefined;
    }
    const request = loaded.Request.fromRawDetails({
      url: details.url,
      sourceUrl,
      type,
    });
    const result = loaded.engine.match(request);
    if (!result.match) {
      // Tracking parameters leave the address of a request that is not blocked.
      const rewritten = result.rewrite?.url;
      return rewritten === undefined || rewritten === details.url
        ? undefined
        : { redirectURL: rewritten };
    }
    if (details.webContentsId !== undefined) {
      this.options.onBlocked?.(details.webContentsId);
    }
    // A harmless stand-in keeps pages working that wait for the file they asked for.
    return result.redirect === undefined
      ? { cancel: true }
      : { redirectURL: resourceUrl(result.redirect.filename) };
  }

  /**
   * Adds the content security policy that `$csp` filters set for a page.
   * @param details - The response of a page.
   */
  headersReceived(details: OnHeadersReceivedListenerDetails): HeaderAdditions | undefined {
    const loaded = this.loaded;
    if (
      details.resourceType !== 'mainFrame' ||
      loaded === undefined ||
      !/^https?:/i.test(details.url) ||
      !this.options.enabled(details.url)
    ) {
      return undefined;
    }
    const directives = loaded.engine.getCSPDirectives(
      loaded.Request.fromRawDetails({
        url: details.url,
        sourceUrl: details.url,
        type: 'main_frame',
      }),
    );
    return directives === undefined ? undefined : { 'Content-Security-Policy': [directives] };
  }

  /**
   * A replacement resource of the filter data by its file name, for the resource scheme.
   * @param name - The file name.
   */
  resource(name: string): ReplacementResource | undefined {
    const resource = this.loaded?.engine.resources.getResource(name);
    return resource === undefined
      ? undefined
      : { body: resource.body, contentType: resource.contentType };
  }

  /**
   * The element hiding rules and scriptlets for a frame that starts. The frame waits for
   * them, so this answers at once: before the engine has loaded, there are none.
   * @param url - The frame's address.
   * @param top - The address of the page the frame belongs to.
   */
  frameRules(url: string, top: string = url): FrameRules {
    const page = this.page(url, top);
    if (page === undefined) {
      return noRules;
    }
    const { styles, scripts, extended } = page.loaded.engine.getCosmeticsFilters({
      ...page.address,
      getRulesFromDOM: false,
      getExtendedRules: true,
    });
    return {
      styles,
      scripts,
      extended: extended.map(({ ast, attribute, directive }) => ({ ast, attribute, directive })),
      elements: true,
    };
  }

  /**
   * The generic element hiding rules for the classes, ids and links of a frame.
   * @param url - The frame's address.
   * @param top - The address of the page the frame belongs to.
   * @param elements - What the frame reported.
   */
  elementRules(url: string, top: string, elements: FrameElements): string {
    const page = this.page(url, top);
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

  /**
   * The registrable domain of a page, such as `example.co.uk` for `www.example.co.uk`;
   * `undefined` before the filter engine has loaded or for anything but http and https.
   * @param url - The page's address.
   */
  domainOf(url: string): string | undefined {
    if (this.loaded === undefined || !/^https?:/i.test(url)) return undefined;
    const { domain, hostname } = this.loaded.Request.fromRawDetails({ url });
    return domain === '' ? hostname : domain;
  }

  /**
   * Whether a popup that a page opens is one that the filter lists block.
   * @param url - The address the popup would show.
   * @param openerUrl - The address of the page that opens it.
   */
  blocksPopup(url: string, openerUrl: string): boolean {
    const loaded = this.loaded;
    if (
      loaded?.popups === undefined ||
      !/^https?:/i.test(url) ||
      !/^https?:/i.test(openerUrl) ||
      !this.options.enabled(openerUrl)
    ) {
      return false;
    }
    const request = loaded.Request.fromRawDetails({
      url,
      sourceUrl: openerUrl,
      type: 'main_frame',
    });
    return loaded.popups.match(request).match;
  }

  /** The loaded engine and the parts of an address that cosmetic rules need. */
  private page(
    url: string,
    top: string,
  ):
    | { loaded: LoadedEngine; address: { url: string; hostname: string; domain: string } }
    | undefined {
    const loaded = this.loaded;
    if (loaded === undefined || !/^https?:/i.test(url) || !this.options.enabled(top)) {
      return undefined;
    }
    const { hostname, domain } = loaded.Request.fromRawDetails({ url });
    return { loaded, address: { url, hostname, domain } };
  }

  private async read(): Promise<LoadedEngine | undefined> {
    try {
      const [{ FiltersEngine: Engine, Request }, bytes, popupBytes] = await Promise.all([
        import('@ghostery/adblocker'),
        readFile(join(this.options.dataDir, 'engine.bin')),
        // The filters with `$popup`, which the engine itself does not support; optional.
        readFile(join(this.options.dataDir, 'popups.bin')).catch(() => undefined),
      ]);
      const engine = Engine.deserialize(new Uint8Array(bytes));
      const popups =
        popupBytes === undefined ? undefined : Engine.deserialize(new Uint8Array(popupBytes));
      this.options.logger.info('Content blocker ready', { bytes: bytes.length });
      this.loaded = { engine, popups, Request };
      this.setStatus('ready');
      return this.loaded;
    } catch (error) {
      this.options.logger.error(
        'Content blocker data is missing or invalid; nothing is blocked',
        error,
      );
      this.setStatus('failed');
      return undefined;
    }
  }
}

/** The engine and the request class of the library, loaded together. */
interface LoadedEngine {
  readonly engine: FiltersEngine;
  /** An engine of the popup filters alone, matched against the addresses of popups. */
  readonly popups: FiltersEngine | undefined;
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
