/**
 * What the policy reference says of each policy beyond what its definition tells: what the
 * policy does, the formats that the schema of its value cannot say, and a value for the
 * examples. The texts live here and not in the definitions, so the browser does not carry
 * them on its start path ([ADR 0062](../../docs/adr/0062-policy-reference-generated-into-the-docs.md)).
 * Every policy of `allPolicies` needs an entry; `reference.ts` fails without one.
 */
import { localEndings } from '../../app/src/domain/navigation/https-first.ts';
import { defaultCheckPeriodMinutes } from '../../app/src/domain/updates/update-policies.ts';

/** The texts of one policy. Markdown, in the tone of the user guide. */
export interface PolicyNote {
  /** What the policy does, in a sentence or two. */
  readonly summary: string;
  /** Formats and rules that the schema of the value cannot say. */
  readonly details?: string;
  /**
   * The value of the examples. Booleans default to the opposite of the setting's default,
   * or `false`, and choices to their last value; other values need one. The reference checks
   * it against the policy.
   */
  readonly example?: unknown;
  /**
   * The value of the Windows example, when it differs, such as a path. The browser on Windows
   * checks it; the reference does not.
   */
  readonly windowsExample?: unknown;
}

/** The texts of every policy, by name. */
export const policyNotes: Readonly<Record<string, PolicyNote>> = {
  ApplicationLocaleValue: {
    summary:
      'The language of the menus, dialogs and pages of the browser: `system`, or a language code such as `en` or `de`.',
    details:
      'A code without a translation shows English. Unlike in Chromium, a code with a region, such as `de-DE`, is not valid.',
    example: 'de',
  },
  AutoHideToolbar: {
    summary:
      'Whether the tabs and the toolbar hide until they are needed, with the tab strip at the top and never in popups.',
    details:
      'As a mandatory policy, it also keeps the command that turns the hiding on and off from running, and the layout presets of the settings page and the setup guide that would change it cannot be chosen.',
  },
  AutoUpdateCheckPeriodMinutes: {
    summary: 'The minutes between two automatic checks for updates.',
    details: `Without the policy, the browser checks every ${String(defaultCheckPeriodMinutes)} minutes.`,
    example: 1440,
  },
  BlockThirdPartyCookies: {
    summary:
      'Keeps cookies away from requests, responses, frames and workers of other sites than the one of the page.',
    details:
      'Chromium blocks them from the next start of the browser, with the policies that the last start read. Private windows always block them.',
  },
  BookmarkBarEnabled: { summary: 'Shows or hides the bookmarks bar.' },
  CommandPaletteEnabled: {
    summary:
      'Turns the command palette and tab search on or off. While it is off, their shortcuts reach web pages.',
  },
  ContentBlockerAllowedSites: {
    summary:
      'The sites on which the content blocker is off, by host name or domain, such as `intranet.example.com`; a domain covers its hosts.',
    details:
      'Mandatory, the list replaces the one of people and they cannot change it, also not with the switches of the shield and of site information or an import of settings; `[]` allows no site. Recommended, it is the list that people start from.',
    example: ['intranet.example.com'],
  },
  ContentBlockerAnnoyancesEnabled: {
    summary: 'Turns the optional list of the content blocker against annoyances on or off.',
  },
  ContentBlockerCookieNoticesEnabled: {
    summary: 'Turns the optional list of the content blocker against cookie notices on or off.',
  },
  ContentBlockerEnabled: { summary: 'Turns the content blocker on or off.' },
  DefaultBrowserSettingEnabled: {
    summary:
      '`false` keeps people from making the browser their default browser. The setting then says that the organization manages it, and the browser refuses the change.',
  },
  DefaultSearchProviderSearchURL: {
    summary: 'The search address of the address bar and the new tab page.',
    details:
      "An https address with `{searchTerms}`, as in Chrome, or `%s` where the search terms go, such as `https://search.example.com/search?q={searchTerms}`. Chrome's other parameters, such as `{inputEncoding}`, are not replaced.",
    example: 'https://search.example.com/search?q={searchTerms}',
  },
  DeveloperToolsAvailability: {
    summary:
      '`2` keeps the developer tools closed: Inspect in the context menu does nothing, the menus have no Developer tools or grey it out, and F12 and the other keys of the developer tools reach the page. `0` and `1` allow them for web pages, as in Chromium.',
    details: 'The pages of the browser itself never get the developer tools.',
  },
  DnsOverHttpsMode: {
    summary:
      'How the browser looks up the addresses of sites: `automatic` uses DNS over HTTPS with the services of `DnsOverHttpsTemplates` or, without them, where the provider of the system offers it; `secure` only with the services of `DnsOverHttpsTemplates`; `off` never.',
    details: '`secure` without a service works like `automatic`.',
    example: 'secure',
  },
  DnsOverHttpsTemplates: {
    summary:
      'The DNS over HTTPS services that `DnsOverHttpsMode` uses: `https://` URI templates, separated by spaces.',
    details:
      'Templates that Chromium would refuse, such as ones with unbalanced braces or a variable in the host, are not valid.',
    example: 'https://dns.example.com/dns-query{?dns}',
  },
  DownloadDirectory: {
    summary: 'The folder where downloads are saved; empty for the downloads folder of the system.',
    details:
      'The browser replaces `${user_name}` and `${machine_name}`, as Chrome does on Linux, such as in `/home/${user_name}/Downloads`. It refuses the value with any other variable, such as `${user_home}` or the variables of Chrome on Windows and macOS (`${documents}`, `${users}`).',
    example: '/srv/downloads',
    windowsExample: 'D:\\Downloads',
  },
  HomepageLocation: {
    summary:
      'The page of the home button and of its shortcut, as an http or https address; empty for the new tab page.',
    details: 'An address without a scheme, such as `intranet.example.com`, gets `https://`.',
    example: 'https://intranet.example.com/',
  },
  HttpAllowlist: {
    summary:
      'Hosts that HTTPS-First leaves on their insecure address, such as `intranet.example.com`. `[*.]example.com` and `*.example.com` also name every host below `example.com`.',
    details: `IP addresses, names without a dot and names that end in ${localEndings.map((ending) => `\`${ending}\``).join(', ')} are never upgraded and need no entry.`,
    example: ['intranet.example.com', '[*.]example.org'],
  },
  HttpsOnlyMode: {
    summary:
      'Whether HTTPS-First loads sites over HTTPS and warns before an insecure connection: `disallowed` turns it off, `force_enabled` and `force_balanced_enabled` keep it on.',
    details:
      "The browser has one mode, so both values that keep it on do the same. Chrome's `allowed`, which leaves the choice to people, is not valid.",
    example: 'disallowed',
  },
  ImportEnabled: {
    summary:
      '`false` turns off the import from other browsers, on the settings page and in the setup guide.',
  },
  PictureInPictureEnabled: {
    summary:
      'Turns the picture in picture of the browser on or off: its button next to the address bar and its menu items.',
    details:
      'A video that shows in picture in picture stays there, and pages that offer picture in picture themselves keep it.',
  },
  PrivateModeAvailability: {
    summary: '`1` keeps people from opening private windows; `0` allows them.',
    details:
      "With `1`, the menus have no New private window or grey it out, and its shortcut reaches the page. Chrome's `2`, which makes every window private, is not supported and not valid.",
  },
  PromptForDownloadLocation: { summary: 'Whether the browser asks where to save each download.' },
  ReaderViewEnabled: {
    summary:
      'Turns the reader view on or off. While it is off, the browser checks no page for an article.',
  },
  RestoreOnStartup: {
    summary:
      "What the browser opens when it starts, with Chromium's numbers: `1` the last session, `4` the pages of `RestoreOnStartupURLs`, `5` a new tab page.",
    details:
      'After the browser did not quit normally, as after a crash, it brings the last session back; only a mandatory `RestoreOnStartup` keeps the start to its value then, as on shared computers.',
    example: 4,
  },
  RestoreOnStartupURLs: {
    summary: 'The pages that open at the start when `RestoreOnStartup` is `4`, in this order.',
    details:
      'An address without a scheme, such as `intranet.example.com`, gets `https://`. As in Chrome, the value is a list, also for one page.',
    example: ['https://intranet.example.com/', 'https://mail.example.com/'],
  },
  SetupGuideEnabled: {
    summary: '`false` keeps the setup guide from opening on the first start of a profile.',
    details: 'Starting the browser with `--no-first-run` does the same for one start.',
  },
  ShowHomeButton: { summary: 'Shows or hides the home button of the toolbar.' },
  SleepingTabsEnabled: {
    summary:
      'Whether tabs go to sleep by themselves after they were not used for a while. People can still put a tab to sleep from its menu.',
  },
  SleepingTabsTimeout: {
    summary:
      'How many seconds a tab stays unused before it goes to sleep, with the values of Microsoft Edge.',
    example: 1800,
  },
  SplitViewEnabled: {
    summary: 'Turns split view on or off. Off ends the split views that show.',
  },
  SSLErrorOverrideAllowed: {
    summary:
      '`false` keeps people from continuing to a site whose certificate is not trusted; certificates accepted earlier in the session are refused again.',
  },
  TabStripPosition: {
    summary: 'Where the tab strip is: at the top, at the bottom, or on the left or right side.',
    example: 'left',
  },
  TargetChannel: {
    summary: 'The update channel. The beta channel also receives the stable releases.',
    details:
      'A switch from beta to stable never installs an older version; the browser stays on its version until a stable release overtakes it.',
    example: 'stable',
  },
  TargetVersionPrefix: {
    summary:
      'Installs only versions that start with this prefix, such as `0.1`: the highest version of the feed that matches.',
    example: '0.1',
  },
  ToolbarPlacement: {
    summary:
      'Whether the address bar has a row of its own below the tabs (`own-row`) or shares the row of the tabs (`tab-row`).',
    details: 'It applies only with the tab strip at the top.',
  },
  UpdatePolicy: {
    summary:
      'How the browser updates itself: `0` not at all, `1` by itself, `2` only when people ask for it.',
    details:
      'With `2`, people check for updates in About, which also shows the state of the updates. A change applies at once: `0` stops the checks, cancels a download that runs and drops an update that is ready. Installations that the system or IT updates, such as the deb, rpm and MSI packages, never update themselves.',
    example: 0,
  },
  UpdateURL: {
    summary:
      'The address of an organization mirror of the update feed, instead of the website of the project.',
    details:
      'The browser reads `updates/v1/index.json` and `updates/v1/releases/<version>.json` below this address and checks their signatures as on the website.',
    example: 'https://updates.example.com/',
  },
  WorkspacesEnabled: {
    summary:
      'Turns workspaces on or off. Off shows the tabs of all workspaces of a window together; the workspaces come back when the policy turns them on again.',
  },
};
