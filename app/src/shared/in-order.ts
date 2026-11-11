/**
 * Runs the tasks of each key one after another, so that their results come in the order the
 * tasks were asked for, also when an earlier task takes longer than a later one. Keys are
 * held weakly, so a key that is gone takes its queue with it.
 * @returns A function that queues a task for a key and gives its result.
 */
export function inOrder(): <T>(key: object, task: () => Promise<T>) => Promise<T> {
  const queues = new WeakMap<object, Promise<unknown>>();
  return <T>(key: object, task: () => Promise<T>): Promise<T> => {
    const result = (queues.get(key) ?? Promise.resolve()).then(task);
    queues.set(
      key,
      result.catch(() => undefined),
    );
    return result;
  };
}
