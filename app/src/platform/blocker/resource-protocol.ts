import type { Session } from 'electron';
import { resourceScheme, type ReplacementResource } from './resource-scheme.ts';

export { resourceScheme, type ReplacementResource } from './resource-scheme.ts';

/**
 * Serves the replacement resources on a web session. Every page may load them, because a
 * redirected request keeps the origin of the page that made it. The answers come from the
 * code that makes their addresses (`resource-answers.ts`), which the content blocker's engine
 * loads before any page can learn one.
 * @param session - A session of web content.
 * @param lookup - Finds a resource by its file name; `undefined` if there is none.
 */
export function serveResources(
  session: Session,
  lookup: (name: string) => ReplacementResource | undefined,
): void {
  session.protocol.handle(resourceScheme, (request) =>
    import('./resource-answers.ts').then(({ answer }) => answer(request, lookup)),
  );
}
