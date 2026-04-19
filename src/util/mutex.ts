/**
 * Minimal per-key serial mutex.
 *
 * Used by the Granary feeder to serialize mutating API calls (Feed Now,
 * Child Lock, Indicator, etc.) per device. Without this, rapid double-taps
 * in Home.app can race: two writes to the same field hit the API
 * concurrently and the subsequent state refresh may resolve out of order,
 * briefly flipping the UI to the "wrong" state.
 *
 * The lock is intentionally simple — a per-key promise chain. Each call
 * appends to the chain and resolves when its turn comes up. No queue size
 * limits, no timeouts; if a caller hangs, every later call for the same
 * key hangs too. That matches the reality of the underlying API: if a
 * mutation is stuck, queueing more mutations behind it isn't going to help.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` exclusively for `key`. Other callers using the same key will
   * wait for prior calls to settle. Different keys run independently.
   *
   * Errors propagate to the caller; the chain is not poisoned by failures.
   */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    // Swallow errors from prior callers when *we* wait — those errors
    // already propagated to the original caller. We just need ordering.
    const next = previous.catch(() => undefined).then(fn);
    this.chains.set(key, next);

    try {
      return await next;
    } finally {
      // If we're still the tail of the chain, clear it so the map doesn't
      // grow unbounded over the lifetime of the process.
      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
    }
  }
}
