/** The density of the interface, which sets the heights of its rows. */
export type Density = 'compact' | 'normal' | 'comfortable';

/** Where the tab strip is. */
export type TabStripSide = 'top' | 'bottom' | 'left' | 'right';

/** The heights of the rows of the shell at each density, as the design tokens set them. */
const rows: Readonly<Record<Density, { tab: number; toolbar: number; gap: number }>> = {
  compact: { tab: 28, toolbar: 32, gap: 2 },
  normal: { tab: 32, toolbar: 40, gap: 4 },
  comfortable: { tab: 40, toolbar: 48, gap: 4 },
};

/** The width of a vertical tab strip. */
const sidebarWidth = 240;

/**
 * Where the window controls lie in an integrated title bar, in CSS pixels: at the start of
 * the top row on macOS, where the three buttons of the window sit, and at its end elsewhere.
 * On Windows and Linux, the shell takes their place and width from the window as soon as the
 * window reports them, as a Linux desktop may put its buttons at the start.
 */
export interface TitleBarArea {
  readonly side: 'start' | 'end';
  /** The room that the controls take in the top row. */
  readonly size: number;
  /** The height of the top row, which the controls share. */
  readonly height: number;
}

/**
 * The area of the window controls in an integrated title bar: the top row is the tab strip
 * when it is at the top, and the toolbar otherwise.
 * @param platform - The operating system, as `process.platform` names it.
 * @param density - The density of the interface.
 * @param side - Where the tab strip is.
 */
export function titleBarArea(platform: string, density: Density, side: TabStripSide): TitleBarArea {
  const row = rows[density];
  const height = side === 'top' ? row.tab + row.gap : row.toolbar;
  return platform === 'darwin'
    ? { side: 'start', size: 76, height }
    : { side: 'end', size: 138, height };
}

/** The window controls that Chromium draws on Windows and Linux. */
export interface ControlsOverlay {
  /** Their background, as `#rrggbb`. */
  readonly color: string;
  /** The color of their symbols. */
  readonly symbolColor: string;
  /** Their height, that of the top row. */
  readonly height: number;
}

/**
 * The window controls of Windows and Linux: in the color of the row that they sit on, the
 * background of the window behind a tab strip at the top and the toolbar's color otherwise,
 * with symbols that can be read on it, and as high as the row.
 * @param area - Where the controls are.
 * @param colors - The background of the window and the color of the toolbar, as `#rrggbb`.
 * @param side - Where the tab strip is.
 */
export function controlsOverlay(
  area: TitleBarArea,
  colors: { readonly window: string; readonly toolbar: string },
  side: TabStripSide,
): ControlsOverlay {
  const color = side === 'top' ? colors.window : colors.toolbar;
  return { color, symbolColor: isDark(color) ? '#e8eaed' : '#1f2329', height: area.height };
}

/** Whether a color such as `#14161A` is dark. */
function isDark(color: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (match === null) return false;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '0', 16));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) < 128;
}

/**
 * Where the content area of a new window starts, until the shell reports where it is.
 * @param density - The density of the interface.
 * @param side - Where the tab strip is.
 */
export function startInsets(
  density: Density,
  side: TabStripSide,
): { top: number; right: number; bottom: number; left: number } {
  const row = rows[density];
  const strip = row.tab + row.gap;
  return {
    top: row.toolbar + (side === 'top' ? strip : 0),
    right: side === 'right' ? sidebarWidth : 0,
    bottom: side === 'bottom' ? strip : 0,
    left: side === 'left' ? sidebarWidth : 0,
  };
}
