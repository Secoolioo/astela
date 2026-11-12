import { app } from 'electron';

let restarting = false;

/**
 * Starts the browser again once it has quit, with the given arguments. An AppImage starts
 * through its own file, as the mount of its image ends with this process.
 * @param args - The arguments of the new start.
 * @param appImage - The path of the AppImage, which its runtime sets as `APPIMAGE`.
 */
export function relaunch(args: readonly string[], appImage = process.env['APPIMAGE']): void {
  restarting = true;
  app.relaunch(
    appImage === undefined || appImage === ''
      ? { args: [...args] }
      : { args: [...args], execPath: appImage },
  );
}

/** Whether the browser starts again after this quit, so an update waits for the next one. */
export function relaunching(): boolean {
  return restarting;
}
