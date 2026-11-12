/** The room that the window controls take at the ends of the top row, in CSS pixels. */
export interface ControlsRoom {
  /** Where the controls are: at the start of the row, at its end or at both ends. */
  readonly side: 'start' | 'end' | 'both';
  readonly start: number;
  readonly end: number;
}

/**
 * The room that the window controls take in the top row of the shell. On Windows and Linux,
 * Electron tells the shell which part of the row the controls leave free, as the title bar
 * area of the Window Controls Overlay API; a Linux desktop puts its buttons at the start of
 * the row, at its end or at both ends. Until then, and on macOS, the browser process names the
 * side and the room. The shell is laid out from left to right, so the start of the row is its
 * left end.
 * @param area - The side and the room that the browser process names.
 * @param overlay - The free part of the row and the width of the shell, once Electron told it.
 */
export function controlsRoom(
  area: { readonly side: 'start' | 'end'; readonly size: number },
  overlay?: {
    readonly x: number;
    readonly width: number;
    readonly height: number;
    readonly viewport: number;
  },
): ControlsRoom {
  if (overlay === undefined || overlay.width <= 0 || overlay.height <= 0) {
    return area.side === 'start'
      ? { side: 'start', start: area.size, end: 0 }
      : { side: 'end', start: 0, end: area.size };
  }
  const start = Math.max(0, Math.round(overlay.x));
  const end = Math.max(0, Math.round(overlay.viewport - overlay.x - overlay.width));
  return { side: start > 0 && end > 0 ? 'both' : start > 0 ? 'start' : 'end', start, end };
}
