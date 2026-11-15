import { easingOf, motionOf } from '../ui-kit/motion.ts';

/**
 * Lets a popover enter: it fades in and moves the last 4 px away from its button, over
 * `--motion-enter` with `--ease-out`. A question in the middle of the window only fades in.
 * Nothing moves, and no animation starts, when the system asks for reduced motion, which sets
 * the duration to 0.
 * @param element - The surface of the popover.
 * @param above - Whether the popover lies above its button, so that it comes from below.
 * @param move - Whether it moves as well as fading, as popovers at a button do.
 * @returns The animation, or `undefined` when nothing moves.
 */
export function enter(element: HTMLElement, above = false, move = true): Animation | undefined {
  const duration = motionOf(element, '--motion-enter');
  if (duration === 0) return undefined;
  const from = move ? { opacity: 0, transform: `translateY(${above ? 4 : -4}px)` } : { opacity: 0 };
  const to = move ? { opacity: 1, transform: 'none' } : { opacity: 1 };
  return element.animate([from, to], { duration, easing: easingOf(element, '--ease-out') });
}

/**
 * Lets a popover leave: it fades out and moves 2 px towards its button, over `--motion-exit`
 * with `--ease-in`, and keeps its last frame until it is gone. A question only fades out. With
 * reduced motion, it is done at once.
 * @param element - The surface of the popover.
 * @param above - Whether the popover lies above its button.
 * @param move - Whether it moves as well as fading.
 * @returns When the popover has left.
 */
export async function leave(element: HTMLElement, above = false, move = true): Promise<void> {
  const duration = motionOf(element, '--motion-exit');
  if (duration === 0) return;
  const from = move ? { opacity: 1, transform: 'none' } : { opacity: 1 };
  const to = move ? { opacity: 0, transform: `translateY(${above ? 2 : -2}px)` } : { opacity: 0 };
  const animation = element.animate([from, to], {
    duration,
    easing: easingOf(element, '--ease-in'),
    fill: 'forwards',
  });
  // An animation that is cancelled, as when its element goes, has left as well.
  await animation.finished.catch(() => undefined);
}
