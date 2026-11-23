import * as v from 'valibot';
import { definePolicy } from './policy.ts';

// The lists of `URLBlocklist` and `URLAllowlist` take the filters of Chrome. As in Chrome, an
// entry that is no filter does not spoil the others, and only the first 1000 entries of each
// list count: a list that the browser refused as a whole would block nothing at all. So the
// schema takes any strings, of any length, as Chrome does, and `urlFilters` decides on each.

/** How many entries of each list count, as in Chrome. */
export const urlFilterLimit = 1000;

const filterList = v.array(v.string());

/** `URLBlocklist`: the addresses that pages may not load, as filters such as `example.com`. */
export const URLBlocklist = definePolicy({ name: 'URLBlocklist', schema: filterList });

/** `URLAllowlist`: the exceptions of `URLBlocklist`, as filters of the same format. */
export const URLAllowlist = definePolicy({ name: 'URLAllowlist', schema: filterList });

/**
 * Turns the host name of a filter into the form that Chromium gives the hosts of addresses: in
 * lower case and, for international names, in Punycode, or empty when it is no host name. The
 * browser passes `domainToASCII` of Node; without it, names only go to lower case.
 */
export type HostForm = (host: string) => string;

const lowerCase: HostForm = (host) => host.toLowerCase();

/** A condition on a parameter of the query: its key, and its value or the start of it. */
interface QueryCondition {
  readonly key: string;
  /** The value, or `undefined` for any value. */
  readonly value: string | undefined;
  /** Whether the value is only the start of the parameter's value, written with a final `*`. */
  readonly prefix: boolean;
}

/** One filter of a list, read as Chrome reads it. */
export interface UrlFilterEntry {
  /** The scheme, such as `https`, or empty for every scheme. */
  readonly scheme: string;
  /** The host, or empty for every host. */
  readonly host: string;
  /** Whether the hosts below {@link host} match too, as without a leading `.`. */
  readonly subdomains: boolean;
  /** The port, or 0 for every port. */
  readonly port: number;
  /** The start of the path, or empty for every path. */
  readonly path: string;
  readonly query: readonly QueryCondition[];
  /** Whether the entry comes from the allowlist. */
  readonly allow: boolean;
}

const schemeOnly = /^([a-z][a-z0-9+.-]*):(?:\/\/)?\*$/i;
const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i;
const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Reads a filter in Chrome's format, `[scheme://][.]host[:port][/path][?query]`: without a
 * scheme it matches every scheme, a host matches its subdomains unless it starts with `.`, an IP
 * address only itself, `*` every host, and `scheme://*` every address of a scheme; the path is
 * the start of the path, and the query lists `key=value` pairs that the address must have, with
 * a final `*` for the start of a value and a key alone for any value. `file://` filters name the
 * start of a path of local files.
 * @param filter - An entry of a list.
 * @param allow - Whether the entry comes from the allowlist.
 * @param hostForm - Turns its host into the form of the hosts of addresses.
 * @returns The filter, or `undefined` when the entry is none.
 */
export function parseUrlFilter(
  filter: string,
  allow: boolean,
  hostForm: HostForm = lowerCase,
): UrlFilterEntry | undefined {
  const text = filter.trim();
  if (text === '' || /\s/.test(text)) return undefined;
  const none = { host: '', subdomains: true, port: 0, path: '', query: [], allow };
  const wildcard = schemeOnly.exec(text);
  if (wildcard?.[1] !== undefined) return { ...none, scheme: wildcard[1].toLowerCase() };
  const schemed = withScheme.exec(text);
  const scheme = schemed?.[1]?.toLowerCase() ?? '';
  const [beforeQuery, queryText = ''] = splitAt((schemed?.[2] ?? text).split('#')[0] ?? '', '?');
  // A filter of local files names the start of their path; their addresses have no host.
  if (scheme === 'file') {
    const local = filePathForm(beforeQuery);
    return local === '' ? undefined : { ...none, scheme, path: local };
  }
  const pathStart = beforeQuery.indexOf('/');
  const path = pathStart === -1 ? '' : pathForm(beforeQuery.slice(pathStart));
  const authority = pathStart === -1 ? beforeQuery : beforeQuery.slice(0, pathStart);
  const address = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(authority);
  const rawHost = address?.[1] ?? '';
  const rawPort = address?.[2];
  if (rawHost === '') return undefined;
  let port = 0;
  if (rawPort !== undefined) {
    port = Number(rawPort);
    if (rawPort === '' || port < 1 || port > 65_535) return undefined;
  }
  const entry = { scheme, port, path, query: queryConditions(queryText), allow };
  if (rawHost === '*') return { ...entry, host: '', subdomains: true };
  const exact = rawHost.startsWith('.');
  const host = canonicalHost(exact ? rawHost.slice(1) : rawHost, hostForm);
  if (host === undefined) return undefined;
  return { ...entry, host, subdomains: !exact && !host.startsWith('[') && !ipv4.test(host) };
}

/**
 * Whether the policies block an address, by the filter that is most specific among those that
 * match it, as in Chrome: `*` counts least, a host without its subdomains more than one with
 * them, then the longer host, the longer path and the more conditions on the query; on a tie,
 * the allowlist wins. The browser's own pages and `about:` addresses are never blocked, and
 * `*` alone does not block the internal pages of Chromium that Chrome leaves out of it, such as
 * those of its PDF viewer and of the developer tools; a filter of their scheme does.
 */
export interface UrlFilter {
  /**
   * Whether the policies block an address.
   * @param url - The address of a page or a frame, as Chromium writes it.
   */
  blocks(url: string): boolean;
}

/** Entries of a list that do not count. */
export interface IgnoredFilter {
  readonly policy: 'URLBlocklist' | 'URLAllowlist';
  /** The places of the entries in the list, from 1. */
  readonly positions: readonly number[];
  readonly reason: 'not a filter' | 'beyond the limit';
}

/** The filters of the policies, and the entries that do not count. */
export interface UrlFilters {
  readonly filter: UrlFilter;
  /** How many entries of each list count. */
  readonly counts: Readonly<Record<IgnoredFilter['policy'], number>>;
  readonly ignored: readonly IgnoredFilter[];
}

/**
 * The schemes of Chromium's internal pages that `*` does not block, as in Chrome: its PDF viewer
 * and other parts that run as extensions, its new tab pages, and the developer tools.
 */
const pastWildcard: ReadonlySet<string> = new Set([
  'chrome-extension',
  'chrome-native',
  'chrome-search',
  'devtools',
]);

/**
 * Reads the lists of `URLBlocklist` and `URLAllowlist`.
 * @param blocklist - The blocked addresses, as filters.
 * @param allowlist - The exceptions.
 * @param hostForm - Turns the hosts of the filters into the form of the hosts of addresses.
 */
export function urlFilters(
  blocklist: readonly string[],
  allowlist: readonly string[],
  hostForm: HostForm = lowerCase,
): UrlFilters {
  const ignored: IgnoredFilter[] = [];
  const read = (list: readonly string[], allow: boolean): UrlFilterEntry[] => {
    const policy = allow ? 'URLAllowlist' : 'URLBlocklist';
    const invalid: number[] = [];
    const entries: UrlFilterEntry[] = [];
    for (const [index, text] of list.slice(0, urlFilterLimit).entries()) {
      const entry = parseUrlFilter(text, allow, hostForm);
      if (entry === undefined) invalid.push(index + 1);
      else entries.push(entry);
    }
    if (invalid.length > 0) ignored.push({ policy, positions: invalid, reason: 'not a filter' });
    if (list.length > urlFilterLimit) {
      const beyond = Array.from(
        { length: list.length - urlFilterLimit },
        (_, index) => urlFilterLimit + index + 1,
      );
      ignored.push({ policy, positions: beyond, reason: 'beyond the limit' });
    }
    return entries;
  };
  const blocked = read(blocklist, false);
  const allowed = read(allowlist, true);
  const entries = [...blocked, ...allowed];
  const blocks = (url: string): boolean => {
    if (entries.length === 0) return false;
    const parts = addressParts(url);
    if (parts === undefined || parts.scheme === 'app' || parts.scheme === 'about') return false;
    let best: UrlFilterEntry | undefined;
    for (const entry of entries) {
      if (matches(entry, parts) && (best === undefined || takesPrecedence(entry, best))) {
        best = entry;
      }
    }
    if (best === undefined || best.allow) return false;
    return !(isWildcard(best) && pastWildcard.has(parts.scheme));
  };
  return {
    filter: { blocks },
    counts: { URLBlocklist: blocked.length, URLAllowlist: allowed.length },
    ignored,
  };
}

/** The parts of an address that filters look at. */
interface AddressParts {
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  /** The parameters of the query as written, such as `v=1`. */
  readonly params: readonly string[];
}

const defaultPorts: Readonly<Record<string, number>> = {
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
  ftp: 21,
};

/** An address as Chromium writes it: scheme, user part, host, port, path, query and fragment. */
const addressPattern =
  /^([a-z][a-z0-9+.-]*):(?:\/\/(?:[^@/?#]*@)?(\[[^\]/?#]*\]|[^:/?#]*)(?::(\d*))?)?([^?#]*)(?:\?([^#]*))?/i;

function addressParts(url: string): AddressParts | undefined {
  const match = addressPattern.exec(url);
  if (match === null) return undefined;
  const [, rawScheme = '', host = '', port = '', path = '', query = ''] = match;
  const scheme = rawScheme.toLowerCase();
  // The address of a blob or a file system counts by the address inside it, as in Chrome.
  if (scheme === 'blob' || scheme === 'filesystem')
    return addressParts(url.slice(scheme.length + 1));
  return {
    scheme,
    host: host.toLowerCase().replace(/\.$/, ''),
    port: port === '' ? (defaultPorts[scheme] ?? 0) : Number(port),
    path: scheme === 'file' ? driveForm(path) : path,
    params: query.split('&'),
  };
}

function matches(entry: UrlFilterEntry, address: AddressParts): boolean {
  if (entry.scheme !== '' && entry.scheme !== address.scheme) return false;
  if (entry.host !== '') {
    const below = entry.subdomains && address.host.endsWith(`.${entry.host}`);
    if (address.host !== entry.host && !below) return false;
  }
  if (entry.port !== 0 && entry.port !== address.port) return false;
  if (!address.path.startsWith(entry.path)) return false;
  return entry.query.every((condition) =>
    address.params.some((param) => {
      if (condition.value === undefined) return param.startsWith(`${condition.key}=`);
      const wanted = `${condition.key}=${condition.value}`;
      return condition.prefix ? param.startsWith(wanted) : param === wanted;
    }),
  );
}

/** Whether a filter decides over another that also matches, as Chrome orders them. */
function takesPrecedence(entry: UrlFilterEntry, other: UrlFilterEntry): boolean {
  if (isWildcard(other) !== isWildcard(entry)) return isWildcard(other);
  if (entry.subdomains !== other.subdomains) return !entry.subdomains;
  if (entry.host.length !== other.host.length) return entry.host.length > other.host.length;
  if (entry.path.length !== other.path.length) return entry.path.length > other.path.length;
  if (entry.query.length !== other.query.length) return entry.query.length > other.query.length;
  return entry.allow && !other.allow;
}

/** Whether a filter is `*`, which matches every address. */
function isWildcard(entry: UrlFilterEntry): boolean {
  return (
    entry.scheme === '' &&
    entry.host === '' &&
    entry.port === 0 &&
    entry.path === '' &&
    entry.query.length === 0
  );
}

function queryConditions(text: string): QueryCondition[] {
  return text
    .split('&')
    .filter((token) => token !== '')
    .map((token) => {
      const [key, value] = splitAt(token, '=');
      if (value === undefined) return { key, value: undefined, prefix: false };
      const prefix = value.endsWith('*');
      return { key, value: prefix ? value.slice(0, -1) : value, prefix };
    });
}

/** A text before and after the first separator, or the whole text alone. */
function splitAt(text: string, separator: string): [string, string?] {
  const at = text.indexOf(separator);
  return at === -1 ? [text] : [text.slice(0, at), text.slice(at + 1)];
}

/** A path in the form that addresses have, with its other characters than ASCII encoded. */
function pathForm(path: string): string {
  return path.replace(/[^\x21-\x7e]+/g, (characters) => encodeURIComponent(characters));
}

/**
 * The path of a filter of local files in the form of the addresses that Chromium gives them, as
 * Chrome reads such a filter as an address: `\` is `/`, a drive of Windows right after the two
 * slashes, as in `file://c:/Users`, starts the path, and its letter is upper case, as in
 * `file:///C:/Users/`. A server before the path, as in `file://server/share/`, does not count.
 * @param text - What follows `file://` in the filter, without its query.
 * @returns The start of the path, or empty for none.
 */
function filePathForm(text: string): string {
  const slashes = text.replaceAll('\\', '/');
  if (/^[a-z][:|]/i.test(slashes)) return driveForm(pathForm(`/${slashes}`));
  const start = slashes.indexOf('/');
  return start === -1 ? '' : driveForm(pathForm(slashes.slice(start)));
}

/** A path of a local file with the drive of Windows that it starts with, if any, upper case. */
function driveForm(path: string): string {
  return path.replace(/^\/([a-z])[:|]/i, (_match, drive: string) => `/${drive.toUpperCase()}:`);
}

/** A host in the form that addresses have, without a final dot, or `undefined` for none. */
function canonicalHost(host: string, hostForm: HostForm): string | undefined {
  if (host.startsWith('[')) return /^\[[0-9a-f:.]+\]$/i.test(host) ? host.toLowerCase() : undefined;
  const ascii = hostForm(host).replace(/\.$/, '');
  return /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(ascii) ? ascii : undefined;
}
