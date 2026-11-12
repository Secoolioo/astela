import { systemPreferences } from 'electron';

/**
 * Leaves the windows of the last start to the browser's own session on macOS. AppKit keeps
 * the windows of an app for its next start, per bundle ID and outside every profile, although
 * it cannot reopen the browser's windows. After the app ended abnormally during a start,
 * AppKit asks in a modal alert, before any window, whether to reopen them, and holds back
 * `ready` until someone answers. The user default `ApplePersistenceIgnoreState` makes AppKit
 * ignore that state and keep new state in a temporary folder, whose path it logs at each
 * start. The default is registered, not written: it holds for this process only, and a value
 * set with `defaults` wins. AppKit reads it when it handles the launch in its run loop, which
 * Electron starts only after the main script has loaded, so the main script calls this first.
 */
export function skipMacWindowRestoration(): void {
  if (process.platform === 'darwin') {
    systemPreferences.registerDefaults({ ApplePersistenceIgnoreState: true });
  }
}
