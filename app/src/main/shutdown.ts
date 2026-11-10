import type { Session } from 'electron';
import { Lifecycle } from '../kernel/lifecycle/lifecycle.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { Clock } from '../kernel/time/clock.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import type { JsonFileSessionStore } from '../platform/node/session-store.ts';
import type { JsonFileSettingsStore } from '../platform/node/json-settings-store.ts';
import type { UpdateService } from '../domain/updates/update-service.ts';

/** What the browser keeps and closes when it quits. */
export interface ShutdownDependencies {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly settings: Pick<JsonFileSettingsStore, 'flush'>;
  readonly sessions: Pick<JsonFileSessionStore, 'schedule' | 'flush'>;
  readonly windows: Pick<WindowManager, 'snapshot' | 'dispose'>;
  /** The session of web pages, whose storage and cookies are written to disk. */
  readonly web: Session;
  readonly data: Pick<DataClient, 'dispose'>;
  /** The update service, once it has started. */
  readonly updates: Pick<UpdateService, 'installOnExit' | 'dispose'> | undefined;
}

/**
 * Shuts the browser down: saves the settings, the session, the storage and the cookies of web
 * pages, waiting for them up to the time limit of the lifecycle, then closes the windows and
 * the data service, and installs an update that is ready.
 * @param dependencies - What to keep and to close.
 */
export async function shutDown(dependencies: ShutdownDependencies): Promise<void> {
  const { logger, windows, sessions, web } = dependencies;
  const lifecycle = new Lifecycle(logger, dependencies.clock, {});
  lifecycle.onWillShutdown((e) => {
    e.join(dependencies.settings.flush(), 'settings');
    const snapshot = windows.snapshot();
    if (snapshot.windows.length > 0) sessions.schedule(snapshot);
    e.join(sessions.flush(), 'session');
    web.flushStorageData();
    e.join(web.cookies.flushStore(), 'cookies');
  });
  await lifecycle.shutdown('quit');
  // A window that fails to close must not keep the browser from quitting.
  try {
    windows.dispose();
  } catch (error: unknown) {
    logger.error('A window did not close cleanly', error);
  }
  dependencies.data.dispose();
  dependencies.updates?.installOnExit();
  dependencies.updates?.dispose();
  logger.info('Shutdown complete');
}
