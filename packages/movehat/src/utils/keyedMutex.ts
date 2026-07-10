const tails = new Map<string, Promise<void>>();

/**
 * Runs `fn` under an in-process FIFO lock scoped to `key`. Calls with the
 * same key execute one at a time in arrival order; calls with different
 * keys run concurrently. A rejected `fn` rejects only its own caller — the
 * next waiter on the key still runs.
 *
 * Non-reentrant: calling `withKeyedLock` with the same key from inside `fn`
 * deadlocks. In-process only: it cannot serialize against other processes
 * touching the same on-disk state.
 *
 * @internal
 */
export function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const result = prev.then(() => fn());
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.finally(() => {
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  });
  return result;
}
