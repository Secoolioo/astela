import type { App, Session } from 'electron';
import type { Blocking } from '../domain/blocker/blocking.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import { CertificateExceptions } from '../platform/electron/certificates.ts';
import { HttpsFirst } from '../platform/electron/https-first.ts';
import { RequestPipeline } from '../platform/electron/request-pipeline.ts';
import { ThirdPartyCookies } from '../platform/electron/third-party-cookies.ts';
import { blockerFrames, type BlockerFrames } from './blocker-frames.ts';
import {
  BlockerAnnoyancesSetting,
  BlockerCookieNoticesSetting,
  BlockThirdPartyCookiesSetting,
  ContentBlockerSetting,
  HttpAllowlistSetting,
  HttpsFirstSetting,
} from './core-settings.ts';

/** What the code for the requests of web pages needs from the composition root. */
export interface WebRequestOptions {
  readonly app: App;
  readonly settings: SettingsService;
  /** Folder of the content blocker's data. */
  readonly blockerDir: string;
  /**
   * Whether Chromium blocks third-party cookies itself, in every session, since the start;
   * the pipeline and the frames keep them away only without it.
   */
  readonly nativeCookieBlocking: boolean;
  /** Whether a session is one of private windows, which always keep third-party cookies away. */
  readonly isPrivate: (session: Session) => boolean;
  /** Whether a session holds web content. */
  readonly isWebSession: (session: Session) => boolean;
  /** Whether the content blocker works on a page, as the settings and the exceptions say. */
  readonly blocking: (url: string) => Blocking;
  /** Counts a request that the content blocker blocked for the page that made it. */
  readonly onBlocked: (contentsId: number) => void;
  /** Called when the content blocker has loaded or could not load. */
  readonly onStatus: () => void;
  /** Whether a policy lets people continue to a site whose certificate is not trusted. */
  readonly certificateOverride: () => boolean;
  readonly logger: Logger;
}

/**
 * The code for the requests of web pages: the steps of the request pipeline, HTTPS-First,
 * the third-party cookies and the content blocker, with the exceptions for certificates and
 * the answers to the frames of web pages. It loads with the first request or frame of a web
 * page, not at the start: the browser's own pages need none of it.
 */
export interface WebRequests {
  readonly pipeline: RequestPipeline;
  readonly httpsFirst: HttpsFirst;
  readonly blocker: ContentBlocker;
  /** The certificates that people accepted after the warning, for their session. */
  readonly certificates: CertificateExceptions;
  readonly frames: BlockerFrames;
}

/**
 * Makes the code for the requests of web pages. HTTPS-First sends pages to the secure
 * address first; the content blocker follows, and its engine loads with the first web page.
 * @param options - Settings, sessions and callbacks.
 */
export function webRequests(options: WebRequestOptions): WebRequests {
  const { settings } = options;
  const pipeline = new RequestPipeline();
  const httpsFirst = new HttpsFirst({
    enabled: () => settings.get(HttpsFirstSetting),
    allowlist: () => settings.get(HttpAllowlistSetting),
  });
  pipeline.add(httpsFirst);
  // Private windows always keep third-party cookies away; regular ones as the settings say.
  // When Chromium blocks them since the start, it does so for every session more precisely,
  // and leaves the partitioned cookies that cannot track across sites.
  const thirdPartyCookies = new ThirdPartyCookies({
    blocked: (s) =>
      !options.nativeCookieBlocking &&
      (options.isPrivate(s) || settings.get(BlockThirdPartyCookiesSetting)),
  });
  pipeline.add(thirdPartyCookies);
  const blocker = new ContentBlocker({
    dataDir: options.blockerDir,
    // Off everywhere wins; a page whose address is not known yet is blocked as usual.
    enabled: (page) => settings.get(ContentBlockerSetting) && options.blocking(page) !== 'off',
    onBlocked: options.onBlocked,
    onStatus: options.onStatus,
    extras: () => [
      ...(settings.get(BlockerCookieNoticesSetting) ? (['cookies'] as const) : []),
      ...(settings.get(BlockerAnnoyancesSetting) ? (['annoyances'] as const) : []),
    ],
    logger: options.logger.child('blocker'),
  });
  pipeline.add(blocker);
  // Certificates that the user accepted after the warning hold for this session. Their errors
  // come from requests, which wait for this code, so none comes before it.
  const certificates = new CertificateExceptions(options.certificateOverride);
  certificates.attach(options.app);
  const frames = blockerFrames(blocker, options.isWebSession, (origin, topOrigin, frameSession) =>
    thirdPartyCookies.blocksFrame(origin, topOrigin, frameSession),
  );
  return { pipeline, httpsFirst, blocker, certificates, frames };
}
