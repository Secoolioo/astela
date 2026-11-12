/**
 * Texts of a menu without exactly one access key, and access keys that two texts of the menu
 * share. Windows and Linux only move the highlight between the items that share a key, so
 * the key runs neither of them.
 * @param labels - The texts of the items of one menu, with `&` before each access key.
 */
export function accessKeyProblems(labels: readonly string[]): string[] {
  const owners = new Map<string, string>();
  const problems: string[] = [];
  for (const label of labels) {
    const keys = [...label.replaceAll('&&', '').matchAll(/&(.)/gu)].map(([, key = '']) =>
      key.toLowerCase(),
    );
    if (keys.length !== 1) {
      problems.push(`${label} has ${keys.length} access keys`);
    }
    for (const key of keys) {
      const owner = owners.get(key);
      if (owner !== undefined) {
        problems.push(`${label} shares ${key} with ${owner}`);
      }
      owners.set(key, label);
    }
  }
  return problems;
}
