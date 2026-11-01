import * as v from 'valibot';
import { defineEvent } from './contract.ts';

/**
 * Sent to every view of the browser's own UI when the accent or the density changed. The
 * payload is the style sheet of design tokens; the preload applies it, not the page.
 */
export const AppearanceChanged = defineEvent({
  channel: 'appearance.changed',
  payload: v.pipe(v.string(), v.maxLength(4096)),
  capability: 'appearance',
});
