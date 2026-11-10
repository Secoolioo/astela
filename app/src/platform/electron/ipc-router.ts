import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as v from 'valibot';
import { toDisposable, type Disposable } from '../../shared/disposable.ts';
import type { EventContract, RequestContract } from '../../shared/ipc/contract.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { IpcGate } from './ipc-gate.ts';

/** Context passed to a request handler. */
export interface IpcContext {
  /** The `WebContents` that sent the request. */
  readonly sender: WebContents;
}

/** Answers a request of one channel, after its checks. */
type Dispatch = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;

/**
 * Connects request contracts to handlers in the browser process. Every request passes the
 * {@link IpcGate} first; refused requests are dropped and logged, and the renderer only
 * learns that the request failed.
 */
export class IpcRouter {
  private readonly gate: IpcGate;
  private readonly logger: Logger;
  /** The handlers of the channels that {@link IpcRouter.handleLater} registered. */
  private readonly later = new Map<string, Dispatch | undefined>();

  /**
   * @param gate - Sender, capability, schema and rate checks.
   * @param logger - Receives refused requests and handler errors.
   */
  constructor(gate: IpcGate, logger: Logger) {
    this.gate = gate;
    this.logger = logger.child('ipc');
  }

  /**
   * Handles a request channel.
   * @param contract - The channel's contract.
   * @param handler - Produces the response; its result is checked against the contract.
   * @returns A disposable that removes the handler.
   */
  handle<Req, Res>(
    contract: RequestContract<Req, Res>,
    handler: (request: Req, context: IpcContext) => Res | Promise<Res>,
  ): Disposable {
    const dispatch: Dispatch = async (event, payload) => {
      const frame = event.senderFrame;
      const checked = this.gate.check(
        contract,
        {
          viewId: event.sender.id,
          frameUrl: frame?.url ?? '',
          isMainFrame: frame !== null && frame === event.sender.mainFrame,
        },
        payload,
      );
      if (!checked.ok) {
        this.logger.warn('Refused IPC request', {
          channel: contract.channel,
          reason: checked.error,
        });
        throw new Error('Request refused');
      }
      try {
        const response = await handler(checked.value, { sender: event.sender });
        return v.parse(contract.response, response);
      } catch (error) {
        this.logger.error(`IPC handler failed: ${contract.channel}`, error);
        throw new Error('Request failed', { cause: error });
      }
    };
    if (this.later.has(contract.channel)) {
      this.later.set(contract.channel, dispatch);
      return toDisposable(() => this.later.set(contract.channel, undefined));
    }
    ipcMain.handle(contract.channel, dispatch);
    return toDisposable(() => ipcMain.removeHandler(contract.channel));
  }

  /**
   * Handles request channels whose contracts and handlers load with the first request on any
   * of them, so that the browser does not load them at its start. The first request waits
   * for them; every request passes the same checks as with {@link IpcRouter.handle}.
   * @param channels - The channels; `register` must handle each of them.
   * @param register - Loads the contracts and handlers, and handles the channels.
   */
  handleLater(channels: readonly string[], register: () => Promise<void>): void {
    let loading: Promise<void> | undefined;
    for (const channel of channels) {
      this.later.set(channel, undefined);
      ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
        loading ??= register();
        await loading;
        const dispatch = this.later.get(channel);
        if (dispatch === undefined) {
          this.logger.error('No handler for a channel that loads later', { channel });
          throw new Error('Request refused');
        }
        return dispatch(event, payload);
      });
    }
  }

  /**
   * Sends an event to a view if it has the contract's capability.
   * @param contract - The event's contract.
   * @param target - Receiving view.
   * @param payload - The event payload.
   */
  publish<T>(contract: EventContract<T>, target: WebContents, payload: T): void {
    if (!target.isDestroyed() && this.gate.mayReceive(target.id, contract.capability)) {
      target.send(contract.channel, payload);
    }
  }
}
