/**
 * The site that the title row of rows that hide names, next to the title that the page sets
 * itself (ADR 0058), so that a page cannot pass for another site there: the host of a web page,
 * with its port; the host of the page that made a `blob:` or `filesystem:` address; the address
 * of an empty page such as `about:blank`, which the page that opened it can fill; and the scheme
 * of any other address, such as `file:` or `data:`. The browser's own pages name none, as their
 * titles name them.
 * @param url - The address of the page.
 */
export function siteLabel(url: string): string {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  switch (scheme) {
    case undefined:
    case 'app':
      return '';
    case 'http':
    case 'https':
      return hostOf(url) ?? `${scheme}:`;
    case 'blob':
    case 'filesystem':
      // The address holds that of the page that made it, such as blob:https://a.example/…
      return hostOf(url.slice(scheme.length + 1)) ?? `${scheme}:`;
    case 'about':
      return url.replace(/[?#].*$/, '').toLowerCase();
    default:
      return `${scheme}:`;
  }
}

/** The host of a web address with its port, or `undefined` for an address without one. */
function hostOf(url: string): string | undefined {
  try {
    const { protocol, host } = new URL(url);
    return (protocol === 'http:' || protocol === 'https:') && host !== '' ? host : undefined;
  } catch {
    return undefined;
  }
}
