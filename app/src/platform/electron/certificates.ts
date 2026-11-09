import type { App, WebContents } from 'electron';

/**
 * Exceptions for certificates that the user accepted after the warning, for the rest of
 * the session. An exception holds for one host and one certificate, by its fingerprint, so
 * a site that shows another certificate later is refused again.
 */
export class CertificateExceptions {
  private readonly allowed = new Set<string>();
  /** The certificate that each page was last refused, by the id of its web contents. */
  private readonly refused = new Map<number, string>();
  private readonly mayOverride: () => boolean;

  /** @param mayOverride - Whether a policy lets people continue after the warning. */
  constructor(mayOverride: () => boolean) {
    this.mayOverride = mayOverride;
  }

  /**
   * Accepts the certificates of the exceptions, and remembers which one a page was refused.
   * Certificates of embedded frames are refused without a warning.
   * @param app - The application.
   */
  attach(app: App): void {
    app.on(
      'certificate-error',
      (event, contents, url, _error, certificate, callback, isMainFrame) => {
        const key = `${hostOf(url)}|${certificate.fingerprint}`;
        if (this.allowed.has(key) && this.mayOverride()) {
          event.preventDefault();
          callback(true);
          return;
        }
        if (isMainFrame) this.refused.set(contents.id, key);
      },
    );
  }

  /**
   * Accepts, for this session, the certificate that a page was just refused.
   * @param contents - The page.
   * @returns Whether there was such a certificate and a policy allows it.
   */
  allow(contents: WebContents): boolean {
    const key = this.refused.get(contents.id);
    if (key === undefined || !this.mayOverride()) return false;
    this.allowed.add(key);
    return true;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
