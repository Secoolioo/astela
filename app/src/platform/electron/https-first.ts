import type {
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
} from 'electron';
import { httpsUpgradeOf } from '../../domain/navigation/https-first.ts';
import type { HeaderAdditions, RequestDecision, RequestInterceptor } from './request-pipeline.ts';

/** A navigation of a page that HTTPS-First sent to the secure address. */
interface Upgrade {
  /** The id of the request, which stays the same through redirects. */
  readonly request: number;
  /** The insecure address that the page asked for. */
  readonly insecure: string;
  readonly host: string;
  /** Stops a secure address that gives no answer in time. */
  readonly timer: ReturnType<typeof setTimeout>;
  /** Whether the secure address gave no answer in time, so the load was stopped. */
  slow: boolean;
}

/**
 * How long the secure address may take to answer before the warning shows, in milliseconds.
 * A server that drops the connections to its secure port would otherwise keep the tab loading
 * until the system gives up, which takes up to two minutes.
 */
export const secureAnswerTimeout = 10_000;

let siteParser: Promise<(host: string) => boolean> | undefined;

/**
 * Whether a host name ends in a public suffix, such as `.com` or `.co.uk`. Names of routers
 * and networks, such as `fritz.box` or `printer.corp`, end in none and have no certificate
 * that a browser trusts, so they keep their insecure address. The list loads with the first
 * address that needs it.
 */
function publicHost(host: string): Promise<boolean> {
  siteParser ??= import('tldts-experimental').then(
    ({ parse }) =>
      (name: string) =>
        parse(name).isIcann === true,
  );
  return siteParser.then((isPublic) => isPublic(host));
}

/** What HTTPS-First asks the browser. */
export interface HttpsFirstOptions {
  /** Whether HTTPS-First is on. */
  readonly enabled: () => boolean;
  /** Hosts that keep their insecure address, as the `HttpAllowlist` policy names them. */
  readonly allowlist: () => readonly string[];
}

/**
 * Loads sites over HTTPS. A page that navigates to an insecure address goes to the secure
 * one instead; when the site does not answer securely, the page shows a warning that offers
 * the insecure address. Continuing allows that host's insecure address for the rest of the
 * session, only in the session of the page, so a private window keeps its own exceptions.
 */
export class HttpsFirst implements RequestInterceptor {
  private readonly upgrades = new WeakMap<WebContents, Upgrade>();
  private readonly allowed = new WeakMap<Session, Set<string>>();
  private readonly options: HttpsFirstOptions;

  /** @param options - Whether HTTPS-First is on, and the hosts it leaves alone. */
  constructor(options: HttpsFirstOptions) {
    this.options = options;
  }

  /**
   * Sends a page's navigation to an insecure address to the secure one, and stops a secure
   * address that sends the page back to the insecure one.
   * @param details - The request.
   */
  async beforeRequest(
    details: OnBeforeRequestListenerDetails,
  ): Promise<RequestDecision | undefined> {
    const contents = details.webContents;
    if (details.resourceType !== 'mainFrame' || contents === undefined) return undefined;
    const host = hostOf(details.url);
    const upgrade = this.upgrades.get(contents);
    if (upgrade?.request === details.id) {
      // The secure address redirected back to the insecure one: the site has no secure
      // version, and the failed load shows the warning.
      if (details.url.startsWith('http:') && host === upgrade.host) return { cancel: true };
    } else {
      this.forget(contents);
    }
    if (host === undefined || !this.options.enabled()) return undefined;
    if (this.allowed.get(contents.session)?.has(host) === true) return undefined;
    const secure = httpsUpgradeOf(details.url, this.options.allowlist());
    if (secure === undefined || !(await publicHost(host))) return undefined;
    const timer = setTimeout(() => {
      const current = this.upgrades.get(contents);
      if (current?.request !== details.id || contents.isDestroyed()) return;
      current.slow = true;
      // The stopped load shows the warning, as a failed one does.
      contents.stop();
    }, secureAnswerTimeout);
    this.forget(contents);
    this.upgrades.set(contents, {
      request: details.id,
      insecure: details.url,
      host,
      timer,
      slow: false,
    });
    return { redirectURL: secure };
  }

  /**
   * Forgets a navigation once the secure address answers with anything but a redirect.
   * @param details - The response.
   */
  headersReceived(details: OnHeadersReceivedListenerDetails): HeaderAdditions | undefined {
    const contents = details.webContents;
    if (details.resourceType !== 'mainFrame' || contents === undefined) return undefined;
    const upgrade = this.upgrades.get(contents);
    if (upgrade?.request !== details.id) return undefined;
    // The secure address answered in time.
    clearTimeout(upgrade.timer);
    const redirect = details.statusCode >= 300 && details.statusCode < 400;
    if (!redirect) this.forget(contents);
    return undefined;
  }

  /**
   * The insecure address to offer in place of a page that did not load securely, or
   * `undefined` when HTTPS-First did not send the page to the secure address. A load that
   * was stopped offers it only when the secure address gave no answer in time.
   * @param contents - The page.
   * @param failed - The address that did not load.
   * @param stopped - Whether the load was stopped rather than failed.
   */
  insecureAddressFor(contents: WebContents, failed: string, stopped = false): string | undefined {
    const upgrade = this.upgrades.get(contents);
    if (upgrade === undefined || hostOf(failed) !== upgrade.host) return undefined;
    this.forget(contents);
    return stopped && !upgrade.slow ? undefined : upgrade.insecure;
  }

  /** Forgets the navigation of a page that HTTPS-First sent to the secure address. */
  private forget(contents: WebContents): void {
    const upgrade = this.upgrades.get(contents);
    if (upgrade === undefined) return;
    clearTimeout(upgrade.timer);
    this.upgrades.delete(contents);
  }

  /**
   * Allows the insecure address of a site for the rest of the session of a page.
   * @param contents - The page.
   * @param address - An address of the site.
   */
  allow(contents: WebContents, address: string): void {
    const host = hostOf(address);
    if (host === undefined) return;
    const hosts = this.allowed.get(contents.session) ?? new Set<string>();
    hosts.add(host);
    this.allowed.set(contents.session, hosts);
  }
}

function hostOf(address: string): string | undefined {
  try {
    return new URL(address).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
