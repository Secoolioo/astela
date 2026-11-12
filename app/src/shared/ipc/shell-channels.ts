/** Requests of the shell whose handlers load with the first of them. */
export const shellLaterChannels = [
  'tabs.reopenClosed',
  'shell.openMenu',
  'shell.openBlockerPopover',
  'shell.openDownloads',
  'tabs.proceedUnsafely',
  'tabs.proceedInsecurely',
  'tabs.find',
  'tabs.stopFind',
  'tabs.resetZoom',
  'shell.toggleBookmark',
  'shell.openBookmarkFolder',
  'tabs.favicon',
  'tabs.setMuted',
  'tabs.move',
  'tabs.openMenu',
] as const;

/**
 * Channel names of the shell, without schemas, so the preload script stays tiny. A test
 * checks that this list matches the contracts in `shell-contracts.ts` and
 * `shell-later-contracts.ts`.
 */
export const shellChannels = [
  'shell.getState',
  'tabs.open',
  'tabs.activate',
  'tabs.close',
  'tabs.navigate',
  'tabs.action',
  'shell.setInsets',
  ...shellLaterChannels,
] as const;

/** Event channels the shell listens to. */
export const shellEventChannels = ['shell.stateChanged', 'shell.command'] as const;

/** A request channel of the shell. */
export type ShellChannel = (typeof shellChannels)[number];
