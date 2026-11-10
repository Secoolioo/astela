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

/**
 * A site that asks for permissions: the question's number, the site's host with the port if it
 * has one, and what it wants.
 */
const PermissionPrompt = v.strictObject({
  kind: v.literal('permission'),
  id: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  site: v.pipe(v.string(), v.maxLength(300)),
  permissions: v.pipe(
    v.array(v.picklist(['camera', 'microphone', 'location', 'notifications', 'clipboard'])),
    v.minLength(1),
    v.maxLength(5),
  ),
});

/**
 * A site that wants to see a screen or a window, and the screens and windows to choose from:
 * their names, and small pictures of them as JPEG data URLs, empty when the system has none.
 */
const ScreenPicker = v.strictObject({
  kind: v.literal('screen'),
  site: v.pipe(v.string(), v.maxLength(300)),
  sources: v.pipe(
    v.array(
      v.strictObject({
        id: v.pipe(v.string(), v.maxLength(200)),
        name: v.pipe(v.string(), v.maxLength(500)),
        screen: v.boolean(),
        thumbnail: v.pipe(
          v.string(),
          v.maxLength(400_000),
          v.regex(/^(?:data:image\/jpeg;base64,[A-Za-z0-9+/=]*)?$/),
        ),
      }),
    ),
    v.minLength(1),
    v.maxLength(100),
  ),
});

/**
 * The list of downloads at its button, newest first: each one's name, where it stands, its
 * bytes, whether it is paused and whether its file is still there.
 */
const DownloadsPanel = v.strictObject({
  kind: v.literal('downloads'),
  anchor: OverlayAnchor,
  items: v.pipe(
    v.array(
      v.strictObject({
        id: v.pipe(v.number(), v.integer(), v.minValue(1)),
        name: v.pipe(v.string(), v.maxLength(1000)),
        state: v.picklist(['progressing', 'completed', 'cancelled', 'interrupted']),
        received: v.pipe(v.number(), v.minValue(0)),
        total: v.pipe(v.number(), v.minValue(0)),
        paused: v.boolean(),
        exists: v.boolean(),
      }),
    ),
    v.maxLength(100),
  ),
});

/** What the overlay shows, or `null` when it is closed. */
// A union rather than a variant: the union is in the bundle of the browser process anyway.
export const OverlayContent = v.nullable(
  v.union([ShieldPopover, LoginPrompt, PermissionPrompt, ScreenPicker, DownloadsPanel]),
);

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

/** Answers the question of a site for permissions; the answer is kept for the site. */
export const AnswerPermission = defineRequest({
  channel: 'overlay.answerPermission',
  request: v.strictObject({
    id: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    allow: v.boolean(),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Lets the site that asked see the chosen screen or window. */
export const ShareScreen = defineRequest({
  channel: 'overlay.shareScreen',
  request: v.strictObject({ id: v.pipe(v.string(), v.maxLength(200)) }),
  response: v.null(),
  capability: 'overlay',
});

/** Pauses, resumes, cancels, opens, shows, retries or removes a download of the list. */
export const DownloadAction = defineRequest({
  channel: 'overlay.download',
  request: v.strictObject({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    action: v.picklist(['pause', 'resume', 'cancel', 'open', 'folder', 'retry', 'remove']),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Opens the folder that downloads go to. */
export const OpenDownloadsFolder = defineRequest({
  channel: 'overlay.openDownloadsFolder',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});
