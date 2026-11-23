/**
 * The low-entropy client hints that Chromium sends with every request to a secure site.
 * Blink adds them to the requests of a page, but Chromium's browser process adds them to
 * navigations only through a delegate that Electron does not have, so the request pipeline
 * adds them to the requests of documents and frames itself.
 */

/** The names of the hints, in the order in which Chromium sends them. */
export const clientHintNames = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'] as const;

/** The characters and versions of Chromium's GREASE brand, chosen by the major version. */
const greaseCharacters = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
const greaseVersions = ['8', '99', '24'];

/** The names of the systems in `sec-ch-ua-platform`. */
const platformNames: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

/**
 * The hints of a navigation, with the brand list that Blink reports for a build of Chromium
 * without a brand of its own: Chromium and a GREASE brand, in an order that the major version
 * chooses, as `navigator.userAgentData.brands` gives them.
 * @param chrome - The version of Chromium, such as `156.0.8078.80`.
 * @param platform - The system the browser runs on.
 */
export function navigationHints(
  chrome: string,
  platform: NodeJS.Platform,
): Readonly<Record<(typeof clientHintNames)[number], string>> {
  const major = Number.parseInt(chrome, 10);
  const grease = `"Not${greaseCharacters[major % 11] ?? ' '}A${greaseCharacters[(major + 1) % 11] ?? ' '}Brand";v="${greaseVersions[major % 3] ?? '8'}"`;
  const chromium = `"Chromium";v="${String(major)}"`;
  return {
    'sec-ch-ua': major % 2 === 0 ? `${grease}, ${chromium}` : `${chromium}, ${grease}`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${platformNames[platform] ?? 'Unknown'}"`,
  };
}

/**
 * Whether a request to an address carries client hints: Chromium sends them only to
 * potentially trustworthy origins, which are https and the local host over http.
 * @param address - The address of the request.
 */
export function takesClientHints(address: string): boolean {
  const url = URL.parse(address);
  if (url?.protocol === 'https:') return true;
  if (url?.protocol !== 'http:') return false;
  const host = url.hostname;
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}
