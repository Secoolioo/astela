import type { OnBeforeRequestListenerDetails, Session } from 'electron';

/** What an interceptor decides about a request. */
export interface RequestDecision {
  /** Cancels the request. */
  readonly cancel?: boolean;
}

/** One step of the request pipeline, such as the content blocker. */
export interface RequestInterceptor {
  /**
   * Decides about a request before it starts.
   * @returns A decision, or `undefined` to let the next interceptor decide.
   */
  beforeRequest(
    details: OnBeforeRequestListenerDetails,
  ): RequestDecision | undefined | Promise<RequestDecision | undefined>;
}

/**
 * Owns the one `onBeforeRequest` listener that Electron allows per session and asks its
 * interceptors in order; the first decision wins. Requests of the browser's own pages never
 * pass here, because the pipeline only serves web sessions.
 */
export class RequestPipeline {
  private readonly interceptors: RequestInterceptor[] = [];

  /**
   * Adds an interceptor after the existing ones.
   * @param interceptor - The interceptor.
   */
  add(interceptor: RequestInterceptor): void {
    this.interceptors.push(interceptor);
  }

  /**
   * Routes the requests of a web session through the pipeline.
   * @param session - A session of web content.
   */
  attach(session: Session): void {
    session.webRequest.onBeforeRequest((details, callback) => {
      void this.decide(details).then(
        (decision) => callback(decision ?? {}),
        () => callback({}),
      );
    });
  }

  private async decide(
    details: OnBeforeRequestListenerDetails,
  ): Promise<RequestDecision | undefined> {
    for (const interceptor of this.interceptors) {
      const decision = await interceptor.beforeRequest(details);
      if (decision !== undefined) {
        return decision;
      }
    }
    return undefined;
  }
}
