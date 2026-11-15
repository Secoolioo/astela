import * as v from 'valibot';

const coordinate = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20000));

/** The rectangle in the window, in CSS pixels, that a popover points at. */
export const OverlayAnchor = v.strictObject({
  x: coordinate,
  y: coordinate,
  width: coordinate,
  height: coordinate,
});

/** A rectangle that a popover points at. */
export type OverlayAnchor = v.InferOutput<typeof OverlayAnchor>;

/**
 * The button that a popover opens at, and whether the keyboard opened it, as Enter or Space
 * on the button does: then the focus goes back to the button when the popover closes.
 */
export const PopoverAnchor = v.strictObject({ ...OverlayAnchor.entries, keyboard: v.boolean() });

/** The button that a popover opens at, and whether the keyboard opened it. */
export type PopoverAnchor = v.InferOutput<typeof PopoverAnchor>;
