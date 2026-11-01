/**
 * Resolves the preprocessor directives of filter lists before the engine parses them, as
 * uBlock Origin does: `!#if` blocks for one environment, and `!#include` of further files
 * next to the list.
 */

/** Environment tokens that are true for Astela: a Chromium browser that uses uBO's lists. */
export const astelaEnvironment: ReadonlySet<string> = new Set([
  'env_chromium',
  'cap_user_stylesheet',
  'ext_ublock',
]);

/**
 * Evaluates the condition of an `!#if` directive. It supports tokens, `!`, `&&`, `||`
 * and parentheses; unknown tokens are false.
 * @param expression - The condition, such as `env_chromium && !env_mobile`.
 * @param environment - Tokens that are true.
 */
export function evaluateCondition(expression: string, environment: ReadonlySet<string>): boolean {
  const tokens = expression.match(/[A-Za-z0-9_]+|&&|\|\||[!()]/g) ?? [];
  let position = 0;
  const peek = (): string | undefined => tokens[position];
  const or = (): boolean => {
    let value = and();
    while (peek() === '||') {
      position += 1;
      value = and() || value;
    }
    return value;
  };
  const and = (): boolean => {
    let value = unary();
    while (peek() === '&&') {
      position += 1;
      value = unary() && value;
    }
    return value;
  };
  const unary = (): boolean => {
    const token = tokens[position];
    position += 1;
    if (token === '!') return !unary();
    if (token === '(') {
      const value = or();
      position += 1;
      return value;
    }
    return token !== undefined && environment.has(token);
  };
  return or();
}

/**
 * Keeps the lines of a list whose `!#if` conditions hold and drops the directives.
 * @param text - The list.
 * @param environment - Tokens that are true.
 * @returns The kept lines, and the files that `!#include` names among them.
 */
export function applyConditions(
  text: string,
  environment: ReadonlySet<string>,
): { readonly lines: string[]; readonly includes: string[] } {
  const lines: string[] = [];
  const includes: string[] = [];
  // One entry per open block: whether its lines are kept.
  const open: boolean[] = [];
  for (const line of text.split(/\r?\n/)) {
    const directive = /^!#(if|else|endif|include)\b\s*(.*)$/.exec(line.trim());
    const keeping = open.every(Boolean);
    if (directive === null) {
      if (keeping) lines.push(line);
      continue;
    }
    const [, name, argument = ''] = directive;
    if (name === 'if') open.push(evaluateCondition(argument, environment));
    else if (name === 'else') open.push(!(open.pop() ?? true));
    else if (name === 'endif') open.pop();
    else if (keeping) includes.push(argument.trim());
  }
  return { lines, includes };
}

/**
 * Loads a list with the lists it includes, depth first, as one text. An include must be a
 * plain file name next to the list; anything else is refused.
 * @param url - Address of the list.
 * @param fetchText - Downloads a text.
 * @param environment - Tokens that are true.
 */
export async function loadList(
  url: string,
  fetchText: (url: string) => Promise<string>,
  environment: ReadonlySet<string> = astelaEnvironment,
): Promise<string> {
  const { lines, includes } = applyConditions(await fetchText(url), environment);
  const parts = [lines.join('\n')];
  for (const name of includes) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(name)) {
      throw new Error(`Refusing to include "${name}" from ${url}`);
    }
    parts.push(await loadList(new URL(name, url).href, fetchText, environment));
  }
  return parts.join('\n');
}
