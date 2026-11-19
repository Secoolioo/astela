import type { Session } from 'electron';
import { Lifecycle } from '../kernel/lifecycle/lifecycle.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { Clock } from '../kernel/time/clock.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import type { JsonFileSessionStore } from '../platform/node/session-store.ts';
import type { JsonFileSettingsStore } from '../platform/node/json-settings-store.ts';
import type { UpdateService } from '../domain/updates/update-service.ts';
import { relaunching } from './relaunch.ts';

/** What the browser keeps and closes when it quits. */
export interface ShutdownDependencies {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly settings: Pick<JsonFileSettingsStore, 'flush'>;
  readonly sessions: Pick<JsonFileSessionStore, 'schedule' | 'flush' | 'markClean'>;
  readonly windows: Pick<WindowManager, 'snapshot' | 'dispose'>;
  /**
   * The sessions of web pages used in this run, such as those of workspaces with cookies of
   * their own; those that keep their data on disk write their storage and cookies.
   */
  readonly web: Iterable<Session>;
  readonly data: Pick<DataClient, 'dispose'> & { settled(): Promise<void> };
  /** The update service, once it has started. */
  readonly updates: Pick<UpdateService, 'installOnExit' | 'dispose'> | undefined;
}

/**
 * Shuts the browser down: saves the settings, the session with the page states of now, such as
 * scroll positions, the storage and the cookies of web pages, waiting for them up to the time
 * limit of the lifecycle, then closes the windows and the data service, and installs an update
 * that is ready. Once the session is written, the browser marks that it quit normally.
 * @param dependencies - What to keep and to close.
 */
export async function shutDown(dependencies: ShutdownDependencies): Promise<void> {
  const { logger, windows, sessions, web } = dependencies;
  const lifecycle = new Lifecycle(logger, dependencies.clock, {});
  lifecycle.onWillShutdown((e) => {
    e.join(dependencies.settings.flush(), 'settings');
    const snapshot = windows.snapshot({ fresh: true });
    if (snapshot.windows.length > 0) sessions.schedule(snapshot);
    // A browser that stops before the session is written restores it at the next start.
    const session = sessions
      .flush()
      .then(() => sessions.markClean())
      .catch((error: unknown) =>
        logger.debug('The browser could not mark that it quit', { error: String(error) }),
      );
    e.join(session, 'session');
    // Changes sent to the profile database just before, such as a download that just
    // finished, are written before the data service stops.
    e.join(dependencies.data.settled(), 'data');
    for (const each of web) {
      if (!each.isPersistent()) continue;
      each.flushStorageData();
      e.join(each.cookies.flushStore(), 'cookies');
    }
  });
  await lifecycle.shutdown('quit');
  // A window that fails to close must not keep the browser from quitting.
  try {
    windows.dispose();
  } catch (error: unknown) {
    logger.error('A window did not close cleanly', error);
  }
  dependencies.data.dispose();
  // An installer would close the browser that a restart starts, so the update waits.
  if (!relaunching()) dependencies.updates?.installOnExit();
  dependencies.updates?.dispose();
  logger.info('Shutdown complete');
}
