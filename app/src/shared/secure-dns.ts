/**
 * How the browser looks up the addresses of sites: with DNS over HTTPS where the provider
 * of the system offers it (`automatic`), only with DNS over HTTPS (`secure`), or without it
 * (`off`).
 */
export const secureDnsModes = ['automatic', 'secure', 'off'] as const;

/** How the browser looks up the addresses of sites. */
export type SecureDnsMode = (typeof secureDnsModes)[number];

/** Providers of DNS over HTTPS that the settings page offers, with the address of each. */
export const secureDnsProviders = [
  { name: 'Cloudflare (1.1.1.1)', template: 'https://chrome.cloudflare-dns.com/dns-query' },
  { name: 'Google (Public DNS)', template: 'https://dns.google/dns-query{?dns}' },
  { name: 'Quad9 (9.9.9.9)', template: 'https://dns.quad9.net/dns-query' },
  { name: 'Mullvad', template: 'https://dns.mullvad.net/dns-query' },
] as const;

/** A host name, an IPv4 address or an IPv6 address in brackets, with an optional port. */
const authorityPattern =
  /^(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/i;

/**
 * Whether an address of a DNS over HTTPS service is one that Chromium takes: an https URI
 * template with a host and a valid port, whose only expressions name the variable `dns`,
 * such as `{?dns}`, outside the host. Chromium refuses other addresses.
 * @param template - The address.
 */
export function isSecureDnsTemplate(template: string): boolean {
  const match = /^https:\/\/([^/?#]*)(.*)$/is.exec(template);
  if (match === null) return false;
  const host = authorityPattern.exec(match[1] ?? '');
  if (host === null) return false;
  const port = host[1] === undefined ? 1 : Number(host[1]);
  if (port < 1 || port > 65_535) return false;
  // Braces outside such an expression would not expand.
  const literal = (match[2] ?? '').replace(/\{[+#./;?&]?dns\}/g, '');
  return !/[\s{}"<>\\^`|]/.test(literal);
}

/**
 * Whether addresses of DNS over HTTPS services, separated by spaces, are all valid; none,
 * for the provider of the system, is valid too.
 * @param value - The addresses.
 */
export function areSecureDnsTemplates(value: string): boolean {
  return value
    .split(/\s+/)
    .filter((part) => part !== '')
    .every(isSecureDnsTemplate);
}

/**
 * The options of the host resolver for a mode and the addresses of DNS over HTTPS services.
 * Only DNS over HTTPS without a service would find no address at all, so it falls back to
 * `automatic`.
 * @param mode - The mode.
 * @param templates - The addresses, separated by spaces; empty for the system's provider.
 */
export function hostResolverOptions(
  mode: SecureDnsMode,
  templates: string,
): { secureDnsMode: SecureDnsMode; secureDnsServers: string[] } {
  const servers = mode === 'off' ? [] : templates.split(/\s+/).filter((part) => part !== '');
  return {
    secureDnsMode: mode === 'secure' && servers.length === 0 ? 'automatic' : mode,
    secureDnsServers: servers,
  };
}
