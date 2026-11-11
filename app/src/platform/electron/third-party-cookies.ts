import type {
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
  WebFrameMain,
} from 'electron';
import type { RequestInterceptor } from './request-pipeline.ts';

/** The site of an address: its registrable domain, such as `example.co.uk`, or its host. */
type SiteOf = (url: string) => string | undefined;

let siteParser: Promise<SiteOf> | undefined;

/** Loads the list of public suffixes with the first request that needs it, not at the start. */
function loadSiteParser(): Promise<SiteOf> {
  siteParser ??= import('tldts-experimental').then(({ parse }) => (url: string) => {
    if (!/^https?:/i.test(url)) return undefined;
    const parsed = parse(url);
    return (parsed.domain ?? parsed.hostname ?? undefined)?.toLowerCase();
  });
  return siteParser;
}

/** What blocking third-party cookies asks the browser. */
export interface ThirdPartyCookiesOptions {
  /** Whether the pages of a session keep third-party cookies away, as the settings say. */
  readonly blocked: (session: Session) => boolean;
  /** Sites on whose pages third-party cookies stay allowed, such as a sign-in that needs them. */
  readonly allowedSites: () => readonly string[];
}

/**
 * Keeps cookies away from requests and frames of other sites than the page's own: the
 * requests are sent without cookies, the cookies of their responses are not stored, and
 * scripts of embedded frames of other sites find no cookies. The page's own site, by its
 * registrable domain, keeps its cookies.
 */
export class ThirdPartyCookies implements RequestInterceptor {
  private readonly options: ThirdPartyCookiesOptions;

  /** @param options - Whether cookies are blocked, and the sites that keep them. */
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
   * @param url - The frame's address.
   * @param top - The address of the page.
   * @param session - The session of the page.
   */
  async blocksFrame(url: string, top: string, session: Session): Promise<boolean> {
    if (!this.options.blocked(session)) return false;
    return this.otherSite(url, top);
  }

  private async fromOtherSite(details: {
    readonly url: string;
    readonly resourceType: string;
    readonly webContents?: WebContents | undefined;
    readonly frame?: WebFrameMain | null | undefined;
  }): Promise<boolean> {
    const contents = details.webContents;
    // A page's own address is never a third party, and requests without a page have none.
    if (details.resourceType === 'mainFrame' || contents === undefined) return false;
    if (!this.options.blocked(contents.session)) return false;
    return this.otherSite(details.url, topOf(details.frame) ?? contents.getURL());
  }

  private async otherSite(url: string, top: string): Promise<boolean> {
    const siteOf = await loadSiteParser();
    const [site, topSite] = [siteOf(url), siteOf(top)];
    if (site === undefined || topSite === undefined || site === topSite) return false;
    return !this.options
      .allowedSites()
      .some((allowed) => topSite === allowed || topSite.endsWith(`.${allowed}`));
  }
}

/** The address of the page that a frame belongs to; a frame that is gone has none. */
function topOf(frame: WebFrameMain | null | undefined): string | undefined {
  try {
    return frame?.top?.url || undefined;
  } catch {
    return undefined;
  }
}
