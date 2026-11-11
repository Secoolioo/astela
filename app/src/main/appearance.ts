import { nativeTheme, webContents, type Session } from 'electron';
import {
  isAccentPreset,
  presetAccentColors,
  type AccentColors,
} from '../domain/appearance/accent-presets.ts';
import { appearanceCss } from '../domain/appearance/appearance.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import { DisposableStore, toDisposable, type Disposable } from '../shared/disposable.ts';
import { AppearanceChanged } from '../shared/ipc/appearance-contracts.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import {
  AccentSetting,
  ColorModeSetting,
  CustomThemeSetting,
  DensitySetting,
  TextSizeSetting,
  ThemeSetting,
  UiFontSetting,
} from './core-settings.ts';
import { themeColors, windowColors } from '../shared/themes.ts';
import { setWindowColors } from './window-background.ts';

const appearanceKeys = new Set([
  ColorModeSetting.key,
  ThemeSetting.key,
  CustomThemeSetting.key,
  AccentSetting.key,
  DensitySetting.key,
  TextSizeSetting.key,
  UiFontSetting.key,
]);

/**
 * Applies the appearance settings: the color mode to Chromium, so pages and the window
 * follow it, and the accent, density, text size and font as design tokens to every view of the browser's
 * own UI. New views get the tokens on their command line, so they paint with them at once;
 * open views get them as an event when they change. The color math for a custom accent
 * loads with the first custom accent; the presets need none.
 */
export class AppearanceController implements Disposable {
  private readonly subscriptions = new DisposableStore();
  private readonly settings: SettingsService;
  private readonly router: IpcRouter;
  private readonly internal: Session;
  private css: string;
  /** The colors of new windows, as JSON, to repaint open windows when the theme changes them. */
  private windowColors = '';
  private readonly onColorsChanged: () => void;
  /** Computes the colors of a custom accent, once its code has loaded. */
  private solve: ((accent: string) => AccentColors) | undefined;

  /**
   * @param settings - Loaded settings.
   * @param router - Publishes token changes.
   * @param internal - Session of the browser's own views.
   * @param onColorsChanged - Called after the light or dark colors changed, for example to
   *   repaint window backgrounds.
   * @param solve - Computes the colors of a custom accent, when one is set at the start.
   */
  constructor(
    settings: SettingsService,
    router: IpcRouter,
    internal: Session,
    onColorsChanged: () => void,
    solve?: (accent: string) => AccentColors,
  ) {
    this.settings = settings;
    this.router = router;
    this.internal = internal;
    this.onColorsChanged = onColorsChanged;
    this.solve = solve;
    this.css = this.currentCss();
    nativeTheme.themeSource = settings.get(ColorModeSetting);
    this.subscriptions.add(
      settings.onDidChange(({ keys }) => {
        if (!keys.some((key) => appearanceKeys.has(key))) {
          return;
        }
        nativeTheme.themeSource = settings.get(ColorModeSetting);
        void this.update();
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

  /**
   * Makes the controller for the settings at the start; a custom accent loads its color math
   * first, so the first window paints with it.
   * @param settings - Loaded settings.
   * @param router - Publishes token changes.
   * @param internal - Session of the browser's own views.
   * @param onColorsChanged - Called after the light or dark colors changed.
   */
  static async create(
    settings: SettingsService,
    router: IpcRouter,
    internal: Session,
    onColorsChanged: () => void,
  ): Promise<AppearanceController> {
    const custom = !isAccentPreset(settings.get(AccentSetting));
    const solve = custom
      ? (await import('../domain/appearance/accent.ts')).accentColors
      : undefined;
    return new AppearanceController(settings, router, internal, onColorsChanged, solve);
  }

  private async update(): Promise<void> {
    const accent = this.settings.get(AccentSetting);
    if (!isAccentPreset(accent) && this.solve === undefined) {
      this.solve = (await import('../domain/appearance/accent.ts')).accentColors;
    }
    const before = this.windowColors;
    const css = this.currentCss();
    if (css !== this.css) {
      this.css = css;
      this.publish();
    }
    // A theme changes the color of the windows without a change of the color mode, which
    // repaints them otherwise.
    if (this.windowColors !== before) this.onColorsChanged();
  }

  private currentCss(): string {
    const accent = this.settings.get(AccentSetting);
    const theme = this.settings.get(ThemeSetting);
    const custom = this.settings.get(CustomThemeSetting);
    // New windows paint the theme's color until their shell has painted.
    const colors = windowColors(theme, custom);
    setWindowColors(colors);
    this.windowColors = JSON.stringify(colors);
    return appearanceCss({
      theme: themeColors(theme, custom),
      accent: isAccentPreset(accent)
        ? presetAccentColors[accent]
        : (this.solve?.(accent) ?? presetAccentColors.blue),
      density: this.settings.get(DensitySetting),
      textSize: this.settings.get(TextSizeSetting),
      font: this.settings.get(UiFontSetting),
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
