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

/** One address of a DNS over HTTPS service, or several separated by spaces. */
export const secureDnsTemplatesPattern =
  /^(?:https:\/\/[^\s"<>\\^`|]+(?:\s+https:\/\/[^\s"<>\\^`|]+)*)?$/;

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
