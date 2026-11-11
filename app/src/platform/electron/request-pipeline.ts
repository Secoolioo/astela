import type {
  OnBeforeRequestListenerDetails,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
} from 'electron';

/** What an interceptor decides about a request. */
export interface RequestDecision {
  /** Cancels the request. */
  readonly cancel?: boolean;
  /** Sends the request to another address instead. */
  readonly redirectURL?: string;
}

/** Headers that an interceptor adds to a response. */
export type HeaderAdditions = Readonly<Record<string, readonly string[]>>;

/** One step of the request pipeline, such as the content blocker. */
export interface RequestInterceptor {
  /**
   * Decides about a request before it starts.
   * @returns A decision, or `undefined` to let the next interceptor decide.
   */
  beforeRequest(
    details: OnBeforeRequestListenerDetails,
  ): RequestDecision | undefined | Promise<RequestDecision | undefined>;
  /**
   * Adds headers to a response, such as a content security policy.
   * @returns The headers to add, or `undefined` for none.
   */
  headersReceived?(details: OnHeadersReceivedListenerDetails): HeaderAdditions | undefined;
  /**
   * Names of request headers to remove before the request is sent, such as `cookie`.
   * @returns The names, or `undefined` for none.
   */
  removedRequestHeaders?(
    details: OnBeforeSendHeadersListenerDetails,
  ): readonly string[] | undefined | Promise<readonly string[] | undefined>;
  /**
   * Names of response headers to remove before the page sees the response, such as
   * `set-cookie`.
   * @returns The names, or `undefined` for none.
   */
  removedResponseHeaders?(
    details: OnHeadersReceivedListenerDetails,
  ): readonly string[] | undefined | Promise<readonly string[] | undefined>;
}

/**
 * The response headers with more values added. A header that exists under another spelling
 * gets the values under its own name, so no value of the server is lost.
 * @param headers - The headers of the response.
 * @param additions - Values to add, by header name.
 */
export function addHeaders(
  headers: Readonly<Record<string, readonly string[]>>,
  additions: HeaderAdditions,
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(
    Object.entries(headers).map(([name, values]) => [name, [...values]]),
  );
  for (const [name, values] of Object.entries(additions)) {
    const existing = Object.keys(result).find((key) => key.toLowerCase() === name.toLowerCase());
    const key = existing ?? name;
    result[key] = [...(result[key] ?? []), ...values];
  }
  return result;
}

/**
 * The headers without some of them, whatever their spelling.
 * @param headers - The headers.
 * @param names - The names of the headers to remove.
 */
export function withoutHeaders<T>(
  headers: Readonly<Record<string, T>>,
  names: readonly string[],
): Record<string, T> {
  const removed = new Set(names.map((name) => name.toLowerCase()));
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !removed.has(name.toLowerCase())),
  );
}

/**
 * Owns the one `onBeforeRequest`, `onBeforeSendHeaders` and `onHeadersReceived` listener
 * that Electron allows per session and asks its interceptors in order: the first decision
 * about a request wins, every interceptor may add response headers, and the headers that any
 * of them names are removed. Requests of the browser's own pages never pass here, because the
 * pipeline only serves web sessions.
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
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      void this.removals((interceptor) => interceptor.removedRequestHeaders?.(details)).then(
        (names) =>
          callback(
            names.length === 0
              ? {}
              : { requestHeaders: withoutHeaders(details.requestHeaders, names) },
          ),
        () => callback({}),
      );
    });
    session.webRequest.onHeadersReceived((details, callback) => {
      let headers: Record<string, string[]> | undefined;
      for (const interceptor of this.interceptors) {
        const additions = interceptor.headersReceived?.(details);
        if (additions !== undefined) {
          headers = addHeaders(headers ?? details.responseHeaders ?? {}, additions);
        }
      }
      void this.removals((interceptor) => interceptor.removedResponseHeaders?.(details)).then(
        (names) => {
          if (names.length > 0) {
            headers = withoutHeaders(headers ?? details.responseHeaders ?? {}, names);
          }
          callback(headers === undefined ? {} : { responseHeaders: headers });
        },
        () => callback(headers === undefined ? {} : { responseHeaders: headers }),
      );
    });
  }

  /**
   * The names of the headers that the interceptors remove, from all of them. An interceptor
   * that fails, also at once, rejects the result, so that the request goes on unchanged
   * instead of waiting forever.
   */
  private async removals(
    ask: (
      interceptor: RequestInterceptor,
    ) => readonly string[] | undefined | Promise<readonly string[] | undefined>,
  ): Promise<string[]> {
    const names: string[] = [];
    for (const interceptor of this.interceptors) {
      const removed = await ask(interceptor);
      if (removed !== undefined) names.push(...removed);
    }
    return names;
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
