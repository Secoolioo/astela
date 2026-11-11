/** The zoom factors that zooming in and out steps through, as in other browsers. */
export const zoomFactors: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];

/**
 * Whether two zoom factors are the same, apart from the rounding of Chromium's zoom levels.
 * @param a - A zoom factor.
 * @param b - Another zoom factor.
 */
export function sameZoom(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}
