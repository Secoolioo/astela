/** A setting as the browser process reports it. */
export interface SettingView {
  readonly key: string;
  readonly value: unknown;
  /** Whether a mandatory policy sets the value. */
  readonly locked: boolean;
}

/** An accent preset with its color in each mode. */
export interface AccentSwatch {
  readonly id: string;
  readonly light: string;
  readonly dark: string;
}

/** The part of the page bridge that settings need. */
export interface PageBridge {
  /** Calls a request channel of the page's scopes. */
  invoke(channel: string, payload: unknown): Promise<unknown>;
  /** Listens to an event channel of the page's scopes; returns a function that stops. */
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSettingView(value: unknown): value is SettingView {
  return (
    isRecord(value) && typeof value['key'] === 'string' && typeof value['locked'] === 'boolean'
  );
}

function isSwatch(value: unknown): value is AccentSwatch {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['light'] === 'string' &&
    typeof value['dark'] === 'string'
  );
}

function listOf<T>(payload: unknown, key: string, check: (value: unknown) => value is T): T[] {
  const list = isRecord(payload) ? payload[key] : undefined;
  return Array.isArray(list) ? list.filter(check) : [];
}

/**
 * The settings of an internal page: loads them, follows every change, wherever it comes
 * from, and writes new values, which the browser process validates.
 */
export class SettingsClient {
  private values: ReadonlyMap<string, SettingView> = new Map();
  private swatches: readonly AccentSwatch[] = [];
  private readonly bridge: PageBridge;
  private readonly onChange: () => void;
  private readonly unsubscribe: () => void;

  /**
   * @param bridge - The page bridge; the page needs the channels of the settings page.
   * @param onChange - Called after values were loaded or changed.
   */
  constructor(bridge: PageBridge, onChange: () => void) {
    this.bridge = bridge;
    this.onChange = onChange;
    this.unsubscribe = bridge.on('settings.changed', (payload) =>
      this.merge(listOf(payload, 'settings', isSettingView)),
    );
  }

  /** The accent presets with their colors. */
  get accents(): readonly AccentSwatch[] {
    return this.swatches;
  }

  /** Loads every setting that the settings page shows. */
  async load(): Promise<void> {
    const payload = await this.bridge.invoke('settings.getAll', {});
    this.swatches = listOf(payload, 'accents', isSwatch);
    this.merge(listOf(payload, 'settings', isSettingView));
  }

  /**
   * A setting, once loaded.
   * @param key - Its key, such as `appearance.accent`.
   */
  get(key: string): SettingView | undefined {
    return this.values.get(key);
  }

  /**
   * Writes a setting.
   * @param key - Its key.
   * @param value - The new value.
   * @returns Whether the browser accepted the value.
   */
  async set(key: string, value: unknown): Promise<boolean> {
    const result = await this.bridge.invoke('settings.set', { key, value });
    return isRecord(result) && result['ok'] === true;
  }

  /** Stops following changes. */
  dispose(): void {
    this.unsubscribe();
  }

  private merge(views: readonly SettingView[]): void {
    const next = new Map(this.values);
    for (const view of views) next.set(view.key, view);
    this.values = next;
    this.onChange();
  }
}

/**
 * Paints the accent swatches of a page. Colors go through the CSS object model, because the
 * pages' content security policy forbids style attributes.
 * @param root - The page's render root.
 * @param accents - The swatches.
 */
export function paintSwatches(root: ParentNode, accents: readonly AccentSwatch[]): void {
  for (const accent of accents) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-accent="${accent.id}"]`)) {
      element.style.setProperty('--swatch-light', accent.light);
      element.style.setProperty('--swatch-dark', accent.dark);
    }
  }
}
