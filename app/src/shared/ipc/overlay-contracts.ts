import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';
import { OverlayAnchor } from './overlay-anchor.ts';

/**
 * The content blocker's popover for the active tab: the domain that an exception covers,
 * such as `example.com`, the requests blocked on the page, whether the blocker blocks on
 * the site, whether it is on at all, so that the switch for the site can be used, and
 * whether it has no usable filter data.
 */
const ShieldPopover = v.strictObject({
  kind: v.literal('shield'),
  anchor: OverlayAnchor,
  site: v.pipe(v.string(), v.maxLength(253)),
  blocked: v.pipe(v.number(), v.integer(), v.minValue(0)),
  on: v.boolean(),
  available: v.boolean(),
  failed: v.boolean(),
});

/**
 * A site, or a proxy, that asks for a user name and password: its host, the realm that it
 * names, and whether the connection is encrypted.
 */
const LoginPrompt = v.strictObject({
  kind: v.literal('login'),
  host: v.pipe(v.string(), v.maxLength(300)),
  realm: v.pipe(v.string(), v.maxLength(300)),
  proxy: v.boolean(),
  secure: v.boolean(),
});

/** What the overlay shows, or `null` when it is closed. */
// A union rather than a variant: the union is in the bundle of the browser process anyway.
export const OverlayContent = v.nullable(v.union([ShieldPopover, LoginPrompt]));

/** The content of an open overlay. */
export type OverlayContent = NonNullable<v.InferOutput<typeof OverlayContent>>;

/** Asks for what the overlay shows; the page asks once it has loaded. */
export const GetOverlay = defineRequest({
  channel: 'overlay.get',
  request: v.strictObject({}),
  response: OverlayContent,
  capability: 'overlay',
});

/** Tells the overlay page what to show from now on. */
export const OverlayChanged = defineEvent({
  channel: 'overlay.changed',
  payload: OverlayContent,
  capability: 'overlay',
});

/** Closes the overlay, for example after a click next to the popover. */
export const CloseOverlay = defineRequest({
  channel: 'overlay.close',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** Turns the content blocker off or on for the site of the active tab, and reloads it. */
export const ToggleSiteBlocking = defineRequest({
  channel: 'overlay.toggleSiteBlocking',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** Opens the settings of the content blocker and closes the overlay. */
export const OpenBlockerSettings = defineRequest({
  channel: 'overlay.openBlockerSettings',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** Signs in with the user name and password of the sign-in prompt. */
export const SignIn = defineRequest({
  channel: 'overlay.signIn',
  request: v.strictObject({
    username: v.pipe(v.string(), v.maxLength(1024)),
    password: v.pipe(v.string(), v.maxLength(1024)),
  }),
  response: v.null(),
  capability: 'overlay',
});
