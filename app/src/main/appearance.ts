import { nativeTheme, webContents, type Session } from 'electron';
import { appearanceCss } from '../domain/appearance/appearance.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import { DisposableStore, toDisposable, type Disposable } from '../shared/disposable.ts';
import { AppearanceChanged } from '../shared/ipc/appearance-contracts.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import { AccentSetting, ColorModeSetting, DensitySetting } from './core-settings.ts';

const appearanceKeys = new Set([ColorModeSetting.key, AccentSetting.key, DensitySetting.key]);

/**
 * Applies the appearance settings: the color mode to Chromium, so pages and the window
 * follow it, and the accent and density as design tokens to every view of the browser's
 * own UI. New views get the tokens on their command line, so they paint with them at once;
 * open views get them as an event when they change.
 */
export class AppearanceController implements Disposable {
  private readonly subscriptions = new DisposableStore();
  private readonly settings: SettingsService;
  private readonly router: IpcRouter;
  private readonly internal: Session;
  private css: string;

  /**
   * @param settings - Loaded settings.
   * @param router - Publishes token changes.
   * @param internal - Session of the browser's own views.
   * @param onColorsChanged - Called after the light or dark colors changed, for example to
   *   repaint window backgrounds.
   */
  constructor(
    settings: SettingsService,
    router: IpcRouter,
    internal: Session,
    onColorsChanged: () => void,
  ) {
    this.settings = settings;
    this.router = router;
    this.internal = internal;
    this.css = this.currentCss();
    nativeTheme.themeSource = settings.get(ColorModeSetting);
    this.subscriptions.add(
      settings.onDidChange(({ keys }) => {
        if (!keys.some((key) => appearanceKeys.has(key))) {
          return;
        }
        nativeTheme.themeSource = settings.get(ColorModeSetting);
        const css = this.currentCss();
        if (css !== this.css) {
          this.css = css;
          this.publish();
        }
      }),
    );
    nativeTheme.on('updated', onColorsChanged);
    this.subscriptions.add(toDisposable(() => nativeTheme.off('updated', onColorsChanged)));
  }

  /** The command line argument that gives a new view the current tokens. */
  get argument(): string {
    return `--appearance=${encodeURIComponent(this.css)}`;
  }

  /** Stops following the settings. */
  dispose(): void {
    this.subscriptions.dispose();
  }

  private currentCss(): string {
    return appearanceCss({
      accent: this.settings.get(AccentSetting),
      density: this.settings.get(DensitySetting),
    });
  }

  private publish(): void {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.session === this.internal) {
        this.router.publish(AppearanceChanged, contents, this.css);
      }
    }
  }
}
