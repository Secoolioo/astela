import { restoreSessionSwitch } from './links.ts';

/**
 * The arguments of a restart: the switches of this start with the switch that restores the
 * session, so the open tabs come back, and without the links of this start, which are open
 * already.
 * @param args - The arguments after the program itself.
 * @param appPath - Whether the first argument is the path of the app, as in a development
 *   start, which the restart needs as well.
 */
export function restartArguments(args: readonly string[], appPath: boolean): string[] {
  const own = appPath ? args.slice(1) : args;
  const end = own.indexOf('--');
  const switches = (end === -1 ? own : own.slice(0, end)).filter(
    (arg) => arg.startsWith('-') && arg !== `--${restoreSessionSwitch}`,
  );
  return [...(appPath ? args.slice(0, 1) : []), ...switches, `--${restoreSessionSwitch}`];
}
