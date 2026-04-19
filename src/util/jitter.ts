/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Apply ±ratio jitter around `base`. Used to desynchronize multiple
 * Homebridge instances polling PETLIBRO so they don't all hit the API
 * at the same wall-clock second.
 */
export function jitter(base: number, ratio = 0.1): number {
  if (ratio <= 0) return base;
  const delta = base * ratio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + delta));
}

/**
 * Coalesce rapid-fire calls into a single trailing-edge invocation.
 * If `fn` is called multiple times within `waitMs`, only the *last*
 * invocation actually runs, after the quiet period elapses.
 *
 * Used in the accessory layer to avoid storming PETLIBRO with refresh
 * calls when a user mashes a Switch in Home.app.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let timer: NodeJS.Timeout | null = null;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}
