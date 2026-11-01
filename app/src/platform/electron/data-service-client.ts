import { utilityProcess, type UtilityProcess } from 'electron';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { DataApi, DataMethod, DataResponse } from '../data/data-protocol.ts';

/**
 * Talks to the data service. The service starts with the first call, outside the start-up
 * path, and starts again with the next call if it ever stops.
 */
export class DataServiceClient {
  private child: UtilityProcess | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, (response: DataResponse) => void>();
  private readonly entry: string;
  private readonly databasePath: string;
  private readonly logger: Logger;

  /**
   * @param entry - Path of the service's bundled entry.
   * @param databasePath - Path of `profile.db`.
   * @param logger - Receives failures.
   */
  constructor(entry: string, databasePath: string, logger: Logger) {
    this.entry = entry;
    this.databasePath = databasePath;
    this.logger = logger;
  }

  /**
   * Calls a method of the profile database.
   * @param method - The method.
   * @param params - Its arguments.
   */
  call<M extends DataMethod>(
    method: M,
    ...params: Parameters<DataApi[M]>
  ): Promise<ReturnType<DataApi[M]>> {
    const child = (this.child ??= this.start());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (response) => {
        if (response.error === undefined) {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the service answers with the method's own result
          resolve(response.result as ReturnType<DataApi[M]>);
        } else {
          reject(new Error(response.error));
        }
      });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a utility process has no origin
      child.postMessage({ id, method, params });
    });
  }

  /** Stops the service. */
  dispose(): void {
    this.child?.kill();
  }

  private start(): UtilityProcess {
    const child = utilityProcess.fork(this.entry, [this.databasePath], {
      serviceName: 'data-service',
    });
    child.on('message', (response: DataResponse) => {
      this.pending.get(response.id)?.(response);
      this.pending.delete(response.id);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = undefined;
      for (const [id, settle] of this.pending)
        settle({ id, error: `The data service stopped (${code})` });
      this.pending.clear();
      if (code !== 0) this.logger.warn('The data service stopped', { code });
    });
    return child;
  }
}
