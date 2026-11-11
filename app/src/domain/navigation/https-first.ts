/**
 * Endings of names that exist only in local networks or for tests, whose sites seldom have a
 * certificate that browsers trust.
 */
const localEndings = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.test',
  '.example',
  '.invalid',
];

const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Whether an allowlist names a host: `example.com` names that host, `[*.]example.com` and
 * `*.example.com` also every host below it.
 * @param allowlist - The entries, as the `HttpAllowlist` policy writes them.
 * @param host - A host name in lower case.
 */
export function allowlistHas(allowlist: readonly string[], host: string): boolean {
  return allowlist.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    const wildcard = /^(?:\[\*\.\]|\*\.)/.exec(pattern)?.[0];
    const domain = wildcard === undefined ? pattern : pattern.slice(wildcard.length);
    return (
      domain !== '' && (host === domain || (wildcard !== undefined && host.endsWith(`.${domain}`)))
    );
  });
}

/** An insecure address: its user part, host, port and the rest. */
const insecureAddress = /^http:\/\/((?:[^@/?#]*@)?)(\[[^\]/?#]*\]|[^:/?#]*)(?::(\d*))?([/?#].*)?$/i;

/**
 * The secure address that HTTPS-First loads in place of an insecure one, or `undefined` when
 * the address stays as it is: other schemes, ports other than 80, IP addresses, names
 * without a dot and names of local networks, and the hosts of the allowlist.
 * @param address - The address a page asked for, as Chromium writes it.
 * @param allowlist - Hosts that keep their insecure address.
 */
export function httpsUpgradeOf(
  address: string,
  allowlist: readonly string[] = [],
): string | undefined {
  const match = insecureAddress.exec(address);
  if (match === null) return undefined;
  const [, user = '', name = '', port, rest = '/'] = match;
  if (port !== undefined && port !== '' && port !== '80') return undefined;
  const host = name.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || ipv4.test(host)) return undefined;
  if (localEndings.some((ending) => host.endsWith(ending))) return undefined;
  if (allowlistHas(allowlist, host)) return undefined;
  return `https://${user}${host}${rest}`;
}
