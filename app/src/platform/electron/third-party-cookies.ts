import type {
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
  WebFrameMain,
} from 'electron';
import type { RequestInterceptor } from './request-pipeline.ts';

/**
 * The site of an address or an origin: its registrable domain, such as `example.co.uk`, or
 * its host. Other schemes than http(s) and ws(s), and opaque origins, have none.
 */
type SiteOf = (url: string) => string | undefined;

let siteParser: Promise<SiteOf> | undefined;

/** Loads the list of public suffixes with the first request that needs it, not at the start. */
function loadSiteParser(): Promise<SiteOf> {
  siteParser ??= import('tldts-experimental').then(({ parse }) => (url: string) => {
    if (!/^(https?|wss?):/i.test(url)) return undefined;
    const parsed = parse(url);
    return (parsed.domain ?? parsed.hostname ?? undefined)?.toLowerCase();
  });
  return siteParser;
}

/** What blocking third-party cookies asks the browser. */
export interface ThirdPartyCookiesOptions {
  /** Whether the pages of a session keep third-party cookies away, as the settings say. */
  readonly blocked: (session: Session) => boolean;
}

/**
 * Keeps cookies away from requests and frames of other sites than the page's own: the
 * requests are sent without cookies, the cookies of their responses are not stored, and
 * scripts of embedded frames of other sites find no cookies. The page's own site, by its
 * registrable domain, keeps its cookies. Sites compare by origin, which documents without an
 * address of their own, such as `about:blank` or `blob:` ones, take from the page that made
 * them; a page whose origin has no site, such as an opaque one, is no first party.
 */
export class ThirdPartyCookies implements RequestInterceptor {
  private readonly options: ThirdPartyCookiesOptions;

  /** @param options - Whether cookies are blocked. */
  constructor(options: ThirdPartyCookiesOptions) {
    this.options = options;
  }

  /** Decides nothing about where requests go. */
  beforeRequest(): undefined {
    return undefined;
  }

  /**
   * Sends a request to another site than the page's own without cookies.
   * @param details - The request.
   */
  async removedRequestHeaders(
    details: OnBeforeSendHeadersListenerDetails,
  ): Promise<readonly string[] | undefined> {
    return (await this.fromOtherSite(details)) ? ['cookie'] : undefined;
  }

  /**
   * Does not store the cookies of a response from another site than the page's own.
   * @param details - The response.
   */
  async removedResponseHeaders(
    details: OnHeadersReceivedListenerDetails,
  ): Promise<readonly string[] | undefined> {
    return (await this.fromOtherSite(details)) ? ['set-cookie'] : undefined;
  }

  /**
   * Whether an embedded frame belongs to another site than its page and gets no cookies.
   * @param origin - The frame's origin.
   * @param topOrigin - The origin of the page.
   * @param session - The session of the page.
   */
  async blocksFrame(origin: string, topOrigin: string, session: Session): Promise<boolean> {
    if (!this.options.blocked(session)) return false;
    return this.otherSite(origin, topOrigin);
  }

  private async fromOtherSite(details: {
    readonly url: string;
    readonly resourceType: string;
    readonly webContents?: WebContents | undefined;
    readonly frame?: WebFrameMain | null | undefined;
  }): Promise<boolean> {
    const contents = details.webContents;
    // A page's own address is never a third party. Requests without a page come from
    // workers, which the frames of other sites cannot start while their cookies are blocked.
    if (details.resourceType === 'mainFrame' || contents === undefined) return false;
    if (!this.options.blocked(contents.session)) return false;
    return this.otherSite(details.url, topOriginOf(details.frame) ?? mainOriginOf(contents));
  }

  /** Whether an address or origin belongs to another site than the page. */
  private async otherSite(url: string, top: string): Promise<boolean> {
    const siteOf = await loadSiteParser();
    const site = siteOf(url);
    // An address without a site, such as a `data:` one, has no cookies to keep away.
    return site !== undefined && siteOf(top) !== site;
  }
}

/** The origin of the page that a frame belongs to; a frame that is gone has none. */
function topOriginOf(frame: WebFrameMain | null | undefined): string | undefined {
  try {
    return frame?.top?.origin || undefined;
  } catch {
    return undefined;
  }
}

/** The origin of the page in a tab, or an opaque one when its frame is gone. */
function mainOriginOf(contents: WebContents): string {
  try {
    return contents.mainFrame.origin;
  } catch {
    return 'null';
  }
}
