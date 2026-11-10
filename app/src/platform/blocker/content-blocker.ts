import type { RequestType } from '@ghostery/adblocker';
import type { OnBeforeRequestListenerDetails, OnHeadersReceivedListenerDetails } from 'electron';
import type {
  HeaderAdditions,
  RequestDecision,
  RequestInterceptor,
} from '../electron/request-pipeline.ts';
import type { BlockerEngine } from './blocker-engine.ts';
import type {
  BlockerStatus,
  ContentBlockerOptions,
  FrameElements,
  FrameRules,
} from './blocker-types.ts';
import type { ReplacementResource } from './resource-protocol.ts';

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

export type {
  BlockerStatus,
  ContentBlockerOptions,
  ExtendedRule,
  ExtraLists,
  FrameElements,
  FrameRules,
} from './blocker-types.ts';

const noRules: FrameRules = { styles: '', scripts: [], extended: [], elements: false };

/**
 * Blocks requests that the filter lists name, with the engine that `tools/blocker` built.
 * The engine loads with the first web page, not at the start, and so does the code that
 * uses it (`blocker-engine.ts`): a browser that shows only its own pages keeps neither its
 * memory nor the work of collecting it. Requests wait for the engine, so even the first
 * page is filtered. Main-frame requests are not blocked: a page the user opens is never
 * replaced by an error page.
 */
export class ContentBlocker implements RequestInterceptor {
  private engine: Promise<BlockerEngine | undefined> | undefined;
  /** The engine once it has loaded, for the frames, which cannot wait for it. */
  private loaded: BlockerEngine | undefined;
  private current: BlockerStatus = 'idle';
  private readonly options: ContentBlockerOptions;

  /** @param options - Data folder, switch and callbacks. */
  constructor(options: ContentBlockerOptions) {
    this.options = options;
  }

  /** Loads the engine; resolves to `undefined` when the data is missing or broken. */
  load(): Promise<BlockerEngine | undefined> {
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
      return this.loaded.mainFrame(details.url);
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
    return loaded?.subresource(details, sourceUrl, type);
  }

  /**
   * Adds the content security policy that `$csp` filters set for a page.
   * @param details - The response of a page.
   */
  headersReceived(details: OnHeadersReceivedListenerDetails): HeaderAdditions | undefined {
    if (
      details.resourceType !== 'mainFrame' ||
      this.loaded === undefined ||
      !/^https?:/i.test(details.url) ||
      !this.options.enabled(details.url)
    ) {
      return undefined;
    }
    return this.loaded.headersReceived(details);
  }

  /**
   * A replacement resource of the filter data by its file name, for the resource scheme.
   * @param name - The file name.
   */
  resource(name: string): ReplacementResource | undefined {
    return this.loaded?.resource(name);
  }

  /**
   * The element hiding rules and scriptlets for a frame that starts. The frame waits for
   * them, so this answers at once: before the engine has loaded, there are none.
   * @param url - The frame's address.
   * @param top - The address of the page the frame belongs to.
   */
  frameRules(url: string, top: string = url): FrameRules {
    return this.applies(url, top) ? (this.loaded?.frameRules(url) ?? noRules) : noRules;
  }

  /**
   * The generic element hiding rules for the classes, ids and links of a frame.
   * @param url - The frame's address.
   * @param top - The address of the page the frame belongs to.
   * @param elements - What the frame reported.
   */
  elementRules(url: string, top: string, elements: FrameElements): string {
    return this.applies(url, top) ? (this.loaded?.elementRules(url, elements) ?? '') : '';
  }

  /**
   * The registrable domain of a page, such as `example.co.uk` for `www.example.co.uk`;
   * `undefined` before the filter engine has loaded or for anything but http and https.
   * @param url - The page's address.
   */
  domainOf(url: string): string | undefined {
    return /^https?:/i.test(url) ? this.loaded?.domainOf(url) : undefined;
  }

  /**
   * Whether a popup that a page opens is one that the filter lists block.
   * @param url - The address the popup would show.
   * @param openerUrl - The address of the page that opens it.
   */
  blocksPopup(url: string, openerUrl: string): boolean {
    return (
      /^https?:/i.test(url) &&
      /^https?:/i.test(openerUrl) &&
      this.options.enabled(openerUrl) &&
      (this.loaded?.blocksPopup(url, openerUrl) ?? false)
    );
  }

  /**
   * Loads the engines of the optional lists that are on, so that they apply from the next
   * request on; a group whose engine has loaded already costs nothing.
   */
  async loadExtras(): Promise<void> {
    await (await this.load())?.loadExtras();
  }

  /** Whether the cosmetic rules of the lists apply to a frame of a page. */
  private applies(url: string, top: string): boolean {
    return this.loaded !== undefined && /^https?:/i.test(url) && this.options.enabled(top);
  }

  private async read(): Promise<BlockerEngine | undefined> {
    try {
      const { openBlockerEngine } = await import('./blocker-engine.ts');
      this.loaded = await openBlockerEngine(this.options);
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

/**
 * The page a request belongs to. The first requests of a new page can arrive before the
 * browser process knows that the page is there: then the request's frame is still the page
 * before it, or has no address, and so has the tab. For a request of the top document, the
 * origin of the document that started it decides, or else its referrer, which names that
 * document; a request of an embedded frame belongs to the top page, which is there by then.
 */
function pageUrl(details: OnBeforeRequestListenerDetails): string {
  let top: string | undefined;
  let fromTop = true;
  try {
    top = details.frame?.top?.url;
    fromTop =
      details.frame === null || details.frame === undefined || details.frame.parent === null;
  } catch {
    // A frame that is gone has no address.
  }
  // The origin of the document that started a request is its page, also for what its style
  // sheets load; a style sheet names itself as the referrer of such requests.
  const initiator = details.initiatorOrigin;
  if (fromTop && initiator !== undefined && /^https?:/i.test(initiator)) return initiator;
  if ((fromTop || top === undefined || top === '') && details.referrer !== '') {
    return details.referrer;
  }
  if (top !== undefined && top !== '') return top;
  try {
    return details.webContents?.getURL() ?? '';
  } catch {
    return '';
  }
}
