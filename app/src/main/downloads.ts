import { app, shell, type DownloadItem, type Session } from 'electron';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { progressOf, type DownloadState } from '../domain/downloads/downloads.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import type { OverlayAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  DownloadAction,
  OpenDownloadsFolder,
  type OverlayContent,
} from '../shared/ipc/overlay-contracts.ts';
import { existingOverlay, overlayBySender, overlayOf, track } from './overlays.ts';

/** What the list of downloads needs from the composition root. */
export interface DownloadsDependencies {
  readonly data: DataClient;
  readonly windows: WindowManager;
  /** The session of web pages, which downloads a file again. */
  readonly webSession: () => Session;
  readonly overlay: OverlayOptions;
  readonly router: IpcRouter;
  readonly logger: Logger;
}

/** A download of the list, and the running download of this session, if it has one. */
interface Entry {
  /** Its id in this session, which the panel uses. */
  readonly id: number;
  /** Its id in the profile database, once it is there. */
  dbId: number | undefined;
  readonly url: string;
  readonly path: string;
  total: number;
  received: number;
  state: DownloadState;
  paused: boolean;
  item: DownloadItem | undefined;
}

/** Most downloads that the panel shows. */
const shownDownloads = 50;

/** How often the panel and the downloads button follow the progress, in milliseconds. */
const refreshInterval = 250;

/**
 * The list of downloads: the downloads of this session and those that the profile database
 * keeps from before, a panel at the downloads button, and the button's progress.
 */
export class Downloads {
  private readonly deps: DownloadsDependencies;
  /** Newest first. */
  private readonly entries: Entry[] = [];
  private readonly loaded: Promise<void>;
  private nextId = 1;
  private shown = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The button that each window's panel opened at. */
  private readonly anchors = new WeakMap<BrowserWindowController, OverlayAnchor>();

  /** @param deps - The data service, the windows and the overlay. */
  constructor(deps: DownloadsDependencies) {
    this.deps = deps;
    this.loaded = this.load();
    deps.router.handle(DownloadAction, ({ id, action }) => (this.act(id, action), null));
    deps.router.handle(OpenDownloadsFolder, (_request, { sender }) => {
      overlayBySender(sender.id)?.close();
      void shell.openPath(app.getPath('downloads'));
      return null;
    });
  }

  /** Shows the downloads button from now on, such as for its shortcut. */
  reveal(): void {
    this.shown = true;
  }

  /** How the downloads button looks: `null` hides it until the browser downloads something. */
  summary(): { readonly active: number; readonly progress: number | null } | null {
    if (!this.shown) return null;
    const active = this.entries.filter((entry) => entry.state === 'progressing');
    const sizes = active.map((entry) => progressOf(entry));
    const known = sizes.every((size) => size !== undefined) && active.length > 0;
    const total = active.reduce((sum, entry) => sum + entry.total, 0);
    const received = active.reduce((sum, entry) => sum + entry.received, 0);
    return { active: active.length, progress: known && total > 0 ? received / total : null };
  }

  /**
   * Follows a download that started, whose file was chosen already.
   * @param item - Electron's download.
   */
  track(item: DownloadItem): void {
    const entry: Entry = {
      id: this.nextId,
      dbId: undefined,
      url: item.getURL(),
      path: item.getSavePath(),
      total: item.getTotalBytes(),
      received: item.getReceivedBytes(),
      state: 'progressing',
      paused: item.isPaused(),
      item,
    };
    this.nextId += 1;
    this.entries.unshift(entry);
    this.shown = true;
    // The download joins the stored list after the list from before has loaded.
    void this.loaded.then(async () => {
      try {
        entry.dbId = await this.deps.data.call('addDownload', entry.url, entry.path, entry.total);
        if (entry.state !== 'progressing') this.save(entry);
      } catch (error: unknown) {
        this.deps.logger.warn('A download was not added to the list', { error: String(error) });
      }
    });
    item.on('updated', (_event, state) => {
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.paused = item.isPaused();
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      this.changed();
    });
    item.once('done', (_event, state) => {
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.paused = false;
      entry.state = state;
      entry.item = undefined;
      this.save(entry);
      this.changed();
    });
    this.changed();
  }

  /**
   * Opens the panel of the list at the downloads button of a window.
   * @param window - The window.
   * @param anchor - The button.
   */
  open(window: BrowserWindowController, anchor: OverlayAnchor): void {
    this.shown = true;
    this.anchors.set(window, anchor);
    const overlay = overlayOf(window, this.deps.overlay, this.deps.router);
    overlay.open(this.panel(anchor));
    track(window, overlay);
    this.deps.windows.refreshShells();
    // The list from before fills the panel once it has loaded.
    void this.loaded.then(() => this.changed());
  }

  private async load(): Promise<void> {
    try {
      // Downloads that ran when the browser stopped did not finish.
      await this.deps.data.call('interruptDownloads');
      const stored = await this.deps.data.call('downloads', shownDownloads);
      for (const row of stored) {
        this.entries.push({
          id: this.nextId,
          dbId: row.id,
          url: row.url,
          path: row.path,
          total: row.total,
          received: row.received,
          state: row.state,
          paused: false,
          item: undefined,
        });
        this.nextId += 1;
      }
    } catch (error: unknown) {
      this.deps.logger.warn('The list of downloads could not be read', { error: String(error) });
    }
  }

  private act(id: number, action: string): void {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (entry === undefined) return;
    const item = entry.item;
    switch (action) {
      case 'pause':
        item?.pause();
        break;
      case 'resume':
        if (item?.canResume() === true) item.resume();
        break;
      case 'cancel':
        item?.cancel();
        break;
      case 'open':
        if (entry.state === 'completed' && existsSync(entry.path)) {
          void shell.openPath(entry.path).then((failure) => {
            if (failure !== '')
              this.deps.logger.warn('A download could not be opened', { failure });
          });
        }
        break;
      case 'folder':
        if (existsSync(entry.path)) shell.showItemInFolder(entry.path);
        else void shell.openPath(app.getPath('downloads'));
        break;
      case 'retry':
        if (entry.state === 'cancelled' || entry.state === 'interrupted') {
          this.remove(entry);
          this.deps.webSession().downloadURL(entry.url);
        }
        break;
      case 'remove':
        if (entry.state !== 'progressing') this.remove(entry);
        break;
    }
    this.changed();
  }

  /** Removes a download from the list; its file stays. */
  private remove(entry: Entry): void {
    this.entries.splice(this.entries.indexOf(entry), 1);
    if (entry.dbId === undefined) return;
    this.deps.data.call('removeDownloads', [entry.dbId]).catch((error: unknown) => {
      this.deps.logger.warn('A download was not removed from the list', { error: String(error) });
    });
  }

  private save(entry: Entry): void {
    if (entry.dbId === undefined) return;
    this.deps.data
      .call('updateDownload', entry.dbId, entry.received, entry.total, entry.state)
      .catch((error: unknown) => {
        this.deps.logger.warn('A download was not saved', { error: String(error) });
      });
  }

  private panel(anchor: OverlayAnchor): OverlayContent {
    return {
      kind: 'downloads',
      anchor,
      items: this.entries.slice(0, shownDownloads).map((entry) => ({
        id: entry.id,
        name: basename(entry.path).slice(0, 1000),
        state: entry.state,
        received: entry.received,
        total: entry.total,
        paused: entry.paused,
        exists: entry.state === 'completed' && existsSync(entry.path),
      })),
    };
  }

  /** Brings the open panels and the downloads buttons up to date, a few times a second. */
  private changed(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      for (const window of this.deps.windows.all) {
        const overlay = existingOverlay(window);
        const anchor = this.anchors.get(window);
        if (overlay?.content?.kind === 'downloads' && anchor !== undefined) {
          overlay.update(this.panel(anchor));
        }
      }
      this.deps.windows.refreshShells();
    }, refreshInterval);
  }
}
