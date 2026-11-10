import { protocol, type Session } from 'electron';
import { resourceScheme } from '../blocker/resource-protocol.ts';
import { appScheme, appSourceRoutes } from './app-protocol-routes.ts';

/**
 * Registers the browser's schemes as privileged, standard and secure; Electron allows one
 * such call, before the app is ready. `app://` serves the browser's own pages with a code
 * cache, and the content blocker's replacement resources come from a scheme that web pages
 * may fetch from, whatever their content security policy allows.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    {
      scheme: resourceScheme,
      // The stand-ins replace files that the page's policy allowed, so the policy does not
      // apply to them a second time.
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Serves the browser's own pages from the bundled renderer files. Only sessions of the
 * browser's own views get the handler; web sessions get a handler that refuses every
 * request, so web content can never load `app://` resources.
 */
export class AppProtocol {
  private readonly root: string;
  private readonly hosts: ReadonlySet<string>;

  /**
   * @param root - Directory of the bundled renderer files.
   * @param hosts - Internal hosts, such as `shell`.
   */
  constructor(root: string, hosts: ReadonlySet<string>) {
    this.root = root;
    this.hosts = hosts;
  }

  /**
   * Serves internal pages in a session of the browser's own views.
   * @param session - The internal session.
   */
  serve(session: Session): void {
    session.protocol.registerSource(appScheme, {
      routes: appSourceRoutes(this.root, this.hosts),
    });
  }

  /**
   * Refuses every `app://` request in a web session.
   * @param session - A session used by web tabs.
   */
  refuse(session: Session): void {
    session.protocol.handle(appScheme, () => new Response(null, { status: 403 }));
  }
}
