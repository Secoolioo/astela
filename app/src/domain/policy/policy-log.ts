import type { Logger } from '../../kernel/logging/logger.ts';
import type { PolicyReadError } from './policy.ts';
import type { PolicyReporter, PolicyStatus } from './policy-service.ts';

/**
 * Writes what the reads of the policies could not apply to the log: the sources that could not
 * be read and every value that does not apply, with the reason, once for each change of them,
 * as the browser reads the policies again on every focus of a window. Each changed set starts
 * with a `Policies read` record with the numbers of both, also when none are left, so the
 * records after the last one are the problems that hold now. It loads apart from the policy
 * service, as the first window does not wait for the log.
 */
export class PolicyLog implements PolicyReporter {
  private readonly logger: Logger;
  /** The problems that the log holds already, so a read that finds them again logs nothing. */
  private reported: string | undefined;

  /** @param logger - The log of the browser; the records get the scope `policy`. */
  constructor(logger: Logger) {
    this.logger = logger.child('policy');
  }

  /**
   * Logs the problems of a read, unless the log holds them already.
   * @param statuses - Every value of the read with its state.
   * @param errors - The sources that could not be read.
   */
  report(statuses: readonly PolicyStatus[], errors: readonly PolicyReadError[]): void {
    const ignored = statuses.filter(({ state }) => state !== 'applied' && state !== 'overridden');
    const problems = JSON.stringify([errors, ignored]);
    if (problems === this.reported) return;
    this.reported = problems;
    this.logger.info('Policies read', { ignored: ignored.length, unreadable: errors.length });
    for (const error of errors) {
      this.logger.warn('Policy source could not be read', { ...error });
    }
    // The value itself stays out of the log, as it can be long; the reason quotes what it needs.
    for (const status of ignored) {
      this.logger.warn('Policy value ignored', { ...status, value: undefined });
    }
  }
}
