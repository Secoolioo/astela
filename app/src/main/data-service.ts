import { ProfileDatabase } from '../platform/data/profile-db.ts';
import { answer, type DataRequest } from '../platform/data/data-protocol.ts';

/**
 * Entry of the data service, a utility process that owns `profile.db`. The browser process
 * starts it with the first data access and talks to it through messages.
 */
const path = process.argv.at(-1) ?? ':memory:';
const db = new ProfileDatabase(path);
const port = process.parentPort;
port.on('message', ({ data }: { data: DataRequest }) => {
  port.postMessage(answer(db, data));
});
process.on('exit', () => db.close());
