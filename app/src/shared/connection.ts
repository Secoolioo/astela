import { newTabUrl } from './internal-pages.ts';

/**
 * How the address bar shows the connection of a page: `secure` over HTTPS with a certificate
 * that Chromium trusts, `insecure` without encryption to another computer or with a certificate
 * that is not trusted, also after people accepted it, `local` for a page that this computer
 * serves without encryption, `internal` for the browser's own pages, and `none` for pages
 * without a connection, such as the new tab page, or that could not load or crashed.
 */
export type ConnectionKind = 'secure' | 'insecure' | 'local' | 'internal' | 'none';

/**
 * What site information says about the connection of a page: `secure`, `insecure` without
 * encryption, `local` on this computer, `certificate` with a certificate that is not trusted,
 * `accepted` after people continued past the warning about its certificate, and `allowed-http`
 * after people opened its insecure address past the warning of HTTPS-First.
 */
export const siteConnections = [
  'secure',
  'insecure',
  'local',
  'certificate',
  'accepted',
  'allowed-http',
] as const;

/** What site information says about the connection of a page. */
export type SiteConnection = (typeof siteConnections)[number];

/** Why a certificate is not trusted, as site information names it. */
export const certificateReasons = ['authority', 'date', 'name', 'other'] as const;

/** Why a certificate is not trusted. */
export type CertificateReason = (typeof certificateReasons)[number];

/** What the connection of a page is known by. */
export interface ConnectionFacts {
  /** The address of the page. */
  readonly url: string;
  /** Why the tab shows no page, if it shows none. */
  readonly problem: { readonly kind: string } | null;
  /** Whether the page may have come with a certificate that people accepted. */
  readonly certificateException: boolean;
}

/**
 * Whether a host is this computer: `localhost` and its subdomains, the IPv4 loopback addresses
 * `127.0.0.0/8` and the IPv6 loopback address `[::1]`. Their connections do not leave the
 * computer.
 * @param host - The host, without the port; IPv6 addresses in brackets, as in an address.
 */
export function isLocalHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name === '[::1]' ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(name)
  );
}

/**
 * How the connection of a page shows in the address bar. A warning about the connection, of
 * HTTPS-First or about a certificate, is not secure; other pages that could not load, crashed
 * pages, the new tab page and empty pages show nothing.
 * @param facts - The page's address, its problem and its certificate exception.
 */
export function connectionKind(facts: ConnectionFacts): ConnectionKind {
  const problem = facts.problem?.kind;
  if (problem === 'insecure' || problem === 'certificate') return 'insecure';
  if (problem !== undefined) return 'none';
  const url = facts.url;
  if (url === newTabUrl || url === 'about:blank') return 'none';
  if (url.startsWith('app://')) return 'internal';
  if (/^https:/i.test(url)) return facts.certificateException ? 'insecure' : 'secure';
  if (!/^http:/i.test(url)) return 'none';
  return isLocalHost(hostnameOf(url)) ? 'local' : 'insecure';
}

/**
 * The host of a web address without its port, IPv6 addresses in brackets, in lower case.
 * @param url - The address.
 */
function hostnameOf(url: string): string {
  const host = /^https?:\/\/(?:[^@/?#\s]*@)?(\[[0-9a-f:.]+\]|[^/?#:@\s]+)/i.exec(url)?.[1];
  return host?.toLowerCase() ?? '';
}
