import { app, webContents, type Details, type WebContents } from 'electron';
import type { Logger } from '../../kernel/logging/logger.ts';

/** The name under which Chromium starts its network service as a utility process. */
export const networkServiceName = 'network.mojom.NetworkService';

/**
 * How long a page waits between two looks. The browser hands a main-frame navigation of its own
 * pages over to {@link watch} once it has waited that long.
 */
export const lookInterval = 10_000;

/**
 * Looks in a row at the same network service after which a service that has still not answered
 * is ended: the page has waited 30 s by then, and the service did not change for 20 s. On the
 * macOS runners, healthy network services answered within 13.2 s of 19,109 starts.
 */
export const endAfter = 3;

/** Looks at a page that waits, after which the browser stops looking at it. */
export const maxLooks = 6;

/** How often a view loads its page again before it shows a page; then the browser gives up. */
export const maxLoads = 4;

/** What the browser saw at its looks at a page that waits, since the view last showed a page. */
export interface Looks {
  /** The looks so far, the last one included. */
  readonly count: number;
  /**
   * The process of the network service at the last look; none when no service ran then, or when
   * the page loaded again after the service went away, as its navigation waits for the next one.
   */
  readonly service: number | undefined;
  /** The looks in a row that saw that service. */
  readonly same: number;
}

/**
 * What the browser does at a look: load the page again, end the network service, look again
 * later, or stop looking.
 */
export type Step = 'load' | 'end' | 'wait' | 'stop';

/**
 * Decides what the browser does when it looks at a page of its own whose main frame still waits
 * for the first response of its navigation. Chromium asks the network service to read the
 * headers of every response that does not come from the network, those of `app://` too, and
 * continues the navigation only with its answer; a service that went away took that answer with
 * it, and one that hangs never gives it. The page loads again at the first look, since the
 * service may have gone away before, and whenever another service runs than at the last look; a
 * new navigation waits for the service that runs, which costs nothing when that one is only slow.
 * A service that did not change for {@link endAfter} looks is ended, once in a run, so that
 * Chromium starts a new one; a service that is only slow would be slow again.
 * @param previous - What the earlier looks saw, if any.
 * @param service - The process of the network service that runs now, if any.
 * @param mayEnd - Whether the browser may still end a network service in this run.
 */
export function nextLook(
  previous: Looks | undefined,
  service: number | undefined,
  mayEnd: boolean,
): { readonly looks: Looks; readonly step: Step } {
  const count = (previous?.count ?? 0) + 1;
  const same = service !== undefined && previous?.service === service ? previous.same + 1 : 1;
  const looks = { count, service, same };
  const replaced =
    previous?.service !== undefined && service !== undefined && service !== previous.service;
  if (previous === undefined || replaced) return { looks, step: 'load' };
  if (service !== undefined && same >= endAfter && mayEnd) return { looks, step: 'end' };
  return { looks, step: count < maxLooks ? 'wait' : 'stop' };
}

/** A page of the browser that waits for the first response of its navigation. */
interface Wait {
  /** The address of the navigation. */
  url: string;
  /** Whether that navigation is still the latest of the view. */
  current: () => boolean;
  looks: Looks | undefined;
  loads: number;
  timer: NodeJS.Timeout | undefined;
  gaveUp: boolean;
}

const waits = new WeakMap<WebContents, Wait>();
const followed = new WeakSet<WebContents>();
let listening = false;
let ended = false;

/**
 * Takes over a main-frame navigation of one of the browser's own pages that still waits for its
 * first response {@link lookInterval} after it started, and looks after it until it commits:
 * the page loads again when the network service went away or another one runs, and a service
 * that does not answer is ended. Web pages are never handed over: a web page that loads again
 * could send a form a second time. Every step is logged, so that a record of a start shows it.
 * @param view - The view of the page.
 * @param url - The address of the navigation.
 * @param current - Whether that navigation is still the latest of the view.
 * @param logger - Where the steps go.
 */
export function watch(
  view: WebContents,
  url: string,
  current: () => boolean,
  logger: Logger,
): void {
  if (!url.startsWith('app://')) return;
  if (!listening) {
    listening = true;
    app.on('child-process-gone', (_event, details) => gone(details, logger));
  }
  if (!followed.has(view)) {
    followed.add(view);
    // A page that commits got its answer; the next wait of the view starts from nothing.
    view.on('did-navigate', () => {
      clearTimeout(waits.get(view)?.timer);
      waits.delete(view);
    });
  }
  let wait = waits.get(view);
  if (wait === undefined) {
    wait = { url, current, looks: undefined, loads: 0, timer: undefined, gaveUp: false };
    waits.set(view, wait);
  } else {
    wait.url = url;
    wait.current = current;
  }
  look(view, wait, logger);
}

function look(view: WebContents, wait: Wait, logger: Logger): void {
  clearTimeout(wait.timer);
  wait.timer = undefined;
  if (view.isDestroyed() || !wait.current() || !view.isWaitingForResponse()) return;
  const service = app
    .getAppMetrics()
    .find((metric) => metric.serviceName === networkServiceName)?.pid;
  const { looks, step } = nextLook(wait.looks, service, !ended);
  wait.looks = looks;
  if (step === 'load') {
    load(view, wait, logger, 'A page of the browser waited for the network service', {
      looks: looks.count,
      service,
    });
    return;
  }
  if (step === 'end' && service !== undefined) {
    ended = true;
    logger.warn('The network service did not answer a page of the browser and is ended', {
      id: view.id,
      url: wait.url,
      looks: looks.count,
      service,
    });
    try {
      process.kill(service, 'SIGKILL');
    } catch {
      // It went away by itself in the meantime.
    }
  }
  if (step !== 'stop') wait.timer = setTimeout(() => look(view, wait, logger), lookInterval);
}

/**
 * Loads the page of a view again, unless it did so {@link maxLoads} times since it last showed
 * a page; then it says once that it gives up.
 */
function load(
  view: WebContents,
  wait: Wait,
  logger: Logger,
  message: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  if (wait.loads >= maxLoads) {
    if (!wait.gaveUp) {
      wait.gaveUp = true;
      logger.warn('A page of the browser still waits for the network service; it is left', {
        id: view.id,
        url: wait.url,
        loads: wait.loads,
      });
    }
    return;
  }
  wait.loads += 1;
  logger.warn(`${message}; it loads again`, { id: view.id, url: wait.url, ...fields });
  // A new navigation ends the one that waited. Electron marks the promise of every load as
  // handled, so the load that this ends fails without an unhandled rejection, as this one may.
  void view.loadURL(wait.url);
}

function gone(details: Details, logger: Logger): void {
  if (details.type !== 'Utility' || details.serviceName !== networkServiceName) return;
  for (const view of webContents.getAllWebContents()) {
    const wait = waits.get(view);
    if (wait === undefined) continue;
    clearTimeout(wait.timer);
    wait.timer = undefined;
    if (view.isDestroyed() || !wait.current() || !view.isWaitingForResponse()) continue;
    // The navigation that starts now waits for the next service, whichever process it gets.
    if (wait.looks !== undefined) wait.looks = { ...wait.looks, service: undefined, same: 0 };
    load(view, wait, logger, 'The network service went away while a page of the browser waited', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  }
}
