import type { Session } from 'electron';
import type { RequestPipeline } from './request-pipeline.ts';

/**
 * Routes the requests of a web session through a request pipeline whose code loads with the
 * first of them, so that a start which shows only the browser's own pages does not load it.
 * The listeners are there from the start, and every request waits for the pipeline, so none
 * passes without its steps. While the pipeline cannot load, requests go on as they were, as
 * after a step that fails.
 * @param session - A session of web content.
 * @param pipeline - Loads the pipeline, or gives the one that has loaded.
 */
export function attachLater(session: Session, pipeline: () => Promise<RequestPipeline>): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    pipeline().then(
      (loaded) => loaded.beforeRequest(details, callback),
      () => callback({}),
    );
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    pipeline().then(
      (loaded) => loaded.beforeSendHeaders(details, callback),
      () => callback({}),
    );
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    pipeline().then(
      (loaded) => loaded.headersReceived(details, callback),
      () => callback({}),
    );
  });
}
