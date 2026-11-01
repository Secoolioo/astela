import { homedir, tmpdir } from 'node:os';
import { ProfileDatabase } from '../platform/data/profile-db.ts';
import { answer, type DataRequest } from '../platform/data/data-protocol.ts';
import { BrowserImporter } from '../platform/import/browser-import.ts';

/**
 * Entry of the data service, a utility process that owns `profile.db`. The browser process
 * starts it with the first data access and talks to it through messages.
 */
const path = process.argv.at(-1) ?? ':memory:';
const db = new ProfileDatabase(path);
const importer = new BrowserImporter(db, {
  platform: process.platform,
  home: homedir(),
  appData: process.env['APPDATA'],
  localAppData: process.env['LOCALAPPDATA'],
  configHome: process.env['XDG_CONFIG_HOME'],
  temp: tmpdir(),
});
const port = process.parentPort;
port.on('message', ({ data }: { data: DataRequest }) => {
  port.postMessage(answer(db, importer, data));
});
process.on('exit', () => db.close());
