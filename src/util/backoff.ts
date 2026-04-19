/**
 * Exponential backoff helper with optional circuit breaker.
 *
 * Used by the API client to throttle re-login attempts after auth failures.
 * Without this, a wrong password causes a re-login storm — every poll cycle
 * fails with 1009, triggers a fresh login, the fresh login fails, repeat
 * forever, hammering PETLIBRO and possibly tripping account lockout.
 */

export interface BackoffOptions {
  /** Initial wait in ms after the first failure. */
  initialDelayMs?: number;
  /** Hard cap on wait time. */
  maxDelayMs?: number;
  /** Multiplier per consecutive failure. */
  factor?: number;
  /** Random jitter ratio applied to each delay (0..1). 0.2 = ±20%. */
  jitter?: number;
  /**
   * Number of consecutive failures before the breaker trips. After the
   * breaker trips, `shouldAttempt()` returns false until `reset()` is
   * called (typically on a successful operation, or by the operator
   * restarting Homebridge).
   */
  breakerThreshold?: number;
}

export class Backoff {
  private failures = 0;
  private nextAttemptAt = 0;
  private tripped = false;

  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly factor: number;
  private readonly jitter: number;
  private readonly breakerThreshold: number;

  constructor(opts: BackoffOptions = {}) {
    this.initialDelayMs = opts.initialDelayMs ?? 5_000;
    this.maxDelayMs = opts.maxDelayMs ?? 5 * 60_000;
    this.factor = opts.factor ?? 2;
    this.jitter = opts.jitter ?? 0.2;
    this.breakerThreshold = opts.breakerThreshold ?? 6;
  }

  /** True when enough time has elapsed since the last failure to retry. */
  shouldAttempt(now: number = Date.now()): boolean {
    if (this.tripped) return false;
    return now >= this.nextAttemptAt;
  }

  /** ms to wait before the next attempt is allowed; 0 if ready now. */
  msUntilNextAttempt(now: number = Date.now()): number {
    return Math.max(0, this.nextAttemptAt - now);
  }

  /** True when the breaker has tripped open. */
  isTripped(): boolean {
    return this.tripped;
  }

  /** Number of consecutive failures since the last reset. */
  failureCount(): number {
    return this.failures;
  }

  /**
   * Record a failed attempt. Returns the delay (ms) until the next attempt
   * is allowed. Trips the breaker if threshold is reached.
   */
  recordFailure(now: number = Date.now()): number {
    this.failures += 1;
    if (this.failures >= this.breakerThreshold) {
      this.tripped = true;
    }
    const base = Math.min(
      this.maxDelayMs,
      this.initialDelayMs * Math.pow(this.factor, this.failures - 1),
    );
    const jitterAmount = base * this.jitter * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(base + jitterAmount));
    this.nextAttemptAt = now + delay;
    return delay;
  }

  /** Clear failure state on a successful attempt. */
  reset(): void {
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.tripped = false;
  }
}
