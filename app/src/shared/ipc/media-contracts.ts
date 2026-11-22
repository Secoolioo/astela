import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';
import { PopoverAnchor } from './overlay-anchor.ts';
import { Done, TabId } from './shell-contracts.ts';

// What the shell hears of protected video and music, which Astela cannot play yet. Their
// handler comes with the code for web pages, before the first page that could ask for it, so
// the browser does not read these at its start.

/**
 * The tabs of a window whose page asked for protected video or music and could not get it, as
 * from Widevine, since it loaded and until it plays media.
 */
export const ProtectedMediaChanged = defineEvent({
  channel: 'shell.protectedMedia',
  payload: v.strictObject({ tabs: v.pipe(v.array(TabId), v.maxLength(1000)) }),
  capability: 'shell',
});

/** Opens the popover that says why the page of the active tab cannot play what it protects. */
export const OpenProtectedMedia = defineRequest({
  channel: 'shell.openProtectedMedia',
  request: PopoverAnchor,
  response: Done,
  capability: 'shell',
});

/** The requests of the shell whose handler comes with the code for web pages. */
export const shellWebRequests = [OpenProtectedMedia] as const;
