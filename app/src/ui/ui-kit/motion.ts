/**
 * The length of a motion token in milliseconds where an element is: 0 when the system asks
 * for reduced motion, so that animations started from code stop with those of the styles.
 * @param element - An element that the tokens reach.
 * @param token - A motion token, such as `--motion-base`.
 */
export function motionOf(element: Element, token: `--motion-${string}`): number {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  const match = /^(\d*\.?\d+)(m?s)$/.exec(value);
  return match === null ? 0 : Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}

/**
 * The value of an easing token where an element is.
 * @param element - An element that the tokens reach.
 * @param token - An easing token, such as `--ease-standard`.
 */
export function easingOf(element: Element, token: `--ease-${string}`): string {
  return getComputedStyle(element).getPropertyValue(token).trim() || 'ease';
}
