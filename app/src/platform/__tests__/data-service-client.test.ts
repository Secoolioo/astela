import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

/** A data service that answers only when the test lets it. */
class FakeService extends EventEmitter {
  static last: FakeService | undefined;
  readonly sent: { id: number }[] = [];
  constructor() {
    super();
    FakeService.last = this;
  }
  postMessage(message: { id: number }): void {
    this.sent.push(message);
  }
  kill(): void {
    this.emit('exit', 0);
  }
}

vi.mock('electron', () => ({ utilityProcess: { fork: () => new FakeService() } }));

const { DataServiceClient } = await import('../electron/data-service-client.ts');

const logger = { warn: () => undefined } as never;

describe('DataServiceClient.settled', () => {
  it('waits for the answers to the calls sent so far, as the browser does before it quits', async () => {
    const client = new DataServiceClient('/service.js', '/profile.db', logger);
    const call = client.call('interruptDownloads');
    let settled = false;
    void client.settled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    const service = FakeService.last;
    service?.emit('message', { id: service.sent[0]?.id, result: undefined });
    await call;
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('is settled at once without calls, and when the service stops', async () => {
    const client = new DataServiceClient('/service.js', '/profile.db', logger);
    await expect(client.settled()).resolves.toBeUndefined();
    const call = client.call('interruptDownloads').catch(() => 'failed');
    const settled = client.settled();
    client.dispose();
    await expect(settled).resolves.toBeUndefined();
    await expect(call).resolves.toBe('failed');
  });
});
