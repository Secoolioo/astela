/** At most this many links open from one start, so a long command line cannot flood a window. */
const linkLimit = 50;

/**
 * The web addresses that another app asked the browser to open, from the arguments it was
 * started with. Switches are skipped; after `--`, every argument counts as an address, which
 * is how the browser registers itself, so an address can never pass for a switch. Only http
 * and https addresses open.
 * @param args - The arguments after the program itself.
 */
export function linksFromArguments(args: readonly string[]): string[] {
  const links: string[] = [];
  let switches = true;
  for (const arg of args) {
    if (switches && arg === '--') {
      switches = false;
    } else if (
      (!switches || !arg.startsWith('-')) &&
      /^https?:\/\/\S+$/i.test(arg) &&
      arg.length <= 8192 &&
      links.length < linkLimit
    ) {
      links.push(arg);
    }
  }
  return links;
}
