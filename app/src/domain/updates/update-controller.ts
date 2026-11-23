import type { Disposable } from '../../shared/disposable.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import type { PolicyService } from '../policy/policy-service.ts';
import { updatePolicies } from './update-policies.ts';
import type { UpdateService, UpdateState } from './update-service.ts';

const updatePolicyNames: ReadonlySet<string> = new Set(updatePolicies.map(({ name }) => name));

/**
 * Keeps the update service in step with the update policies. A service reads them once, when
 * it is made, so a change of any of them at a refresh of the policies replaces it. Disposing
 * the old one cancels a download that runs; off stops the checks and drops an update that is
 * ready, so that nothing installs when the browser quits, and a new mirror, channel, version
 * prefix or period applies from the next check.
 */
export class UpdateController implements Disposable {
  private readonly create: () => UpdateService;
  private readonly changed = new Emitter<UpdateState>();
  private readonly policyListener: Disposable;
  private current: UpdateService;

  /** Fires whenever {@link UpdateController.state} changes, also when a service replaces another. */
  readonly onDidChange: Event<UpdateState> = this.changed.event;

  /**
   * Makes the first service and starts it.
   * @param policies - The policies, whose changes replace the service.
   * @param create - Makes a service from the policies as they are now.
   */
  constructor(policies: Pick<PolicyService, 'onDidChange'>, create: () => UpdateService) {
    this.create = create;
    this.current = this.started();
    this.policyListener = policies.onDidChange((names) => {
      if (!names.some((name) => updatePolicyNames.has(name))) return;
      this.current.dispose();
      this.current = this.started();
      this.changed.fire(this.current.state);
    });
  }

  /** The state of the current service. */
  get state(): UpdateState {
    return this.current.state;
  }

  /**
   * Checks now with the current service, as people ask for it.
   * @returns The state after the check.
   */
  check(): Promise<UpdateState> {
    return this.current.check();
  }

  /**
   * Installs an update that the current service downloaded, while the browser exits.
   * @returns Whether an installation started.
   */
  installOnExit(): boolean {
    return this.current.installOnExit();
  }

  /** Stops following the policies and cancels the schedule. */
  dispose(): void {
    this.policyListener.dispose();
    this.current.dispose();
    this.changed.dispose();
  }

  private started(): UpdateService {
    const service = this.create();
    service.onDidChange((state) => this.changed.fire(state));
    service.start();
    return service;
  }
}
