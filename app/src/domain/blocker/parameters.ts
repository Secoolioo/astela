/**
 * The address without the query parameters that the filter engine took out of it. Every
 * other parameter stays exactly as the address had it: the engine encodes the values that it
 * keeps once more, which would change what a page gets, such as a search term or the address
 * to return to after signing in.
 * @param original - The address as a page asked for it.
 * @param rewritten - The address that the engine made without the tracking parameters.
 * @returns The original address without the parameters that the engine took out.
 */
export function withoutRemovedParameters(original: string, rewritten: string): string {
  const kept = new Map<string, number>();
  for (const pair of pairsOf(queryOf(rewritten))) {
    const name = nameOf(pair);
    kept.set(name, (kept.get(name) ?? 0) + 1);
  }
  const hashAt = original.indexOf('#');
  const hash = hashAt === -1 ? '' : original.slice(hashAt);
  const address = hashAt === -1 ? original : original.slice(0, hashAt);
  const queryAt = address.indexOf('?');
  if (queryAt === -1) return original;
  const pairs = pairsOf(address.slice(queryAt + 1)).filter((pair) => {
    const name = nameOf(pair);
    const left = kept.get(name) ?? 0;
    kept.set(name, left - 1);
    return left > 0;
  });
  return `${address.slice(0, queryAt)}${pairs.length === 0 ? '' : `?${pairs.join('&')}`}${hash}`;
}

/** The query of an address, without its fragment. */
function queryOf(address: string): string {
  const hashAt = address.indexOf('#');
  const withoutHash = hashAt === -1 ? address : address.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  return queryAt === -1 ? '' : withoutHash.slice(queryAt + 1);
}

/** The `name=value` pairs of a query, without empty ones. */
function pairsOf(query: string): string[] {
  return query.split('&').filter((pair) => pair !== '');
}

/** The decoded name of a pair, so that names compare however they were encoded. */
function nameOf(pair: string): string {
  const equals = pair.indexOf('=');
  const name = (equals === -1 ? pair : pair.slice(0, equals)).replaceAll('+', ' ');
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
