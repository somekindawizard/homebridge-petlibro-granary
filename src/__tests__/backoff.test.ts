import { describe, it, expect } from 'vitest';
import { Backoff } from '../util/backoff';

describe('Backoff', () => {
  it('allows the first attempt immediately', () => {
    const b = new Backoff();
    expect(b.shouldAttempt()).toBe(true);
    expect(b.msUntilNextAttempt()).toBe(0);
  });

  it('grows the wait exponentially after each failure', () => {
    const b = new Backoff({ initialDelayMs: 100, factor: 2, jitter: 0, breakerThreshold: 100 });
    const d1 = b.recordFailure(0);
    const d2 = b.recordFailure(0);
    const d3 = b.recordFailure(0);
    expect(d1).toBe(100);
    expect(d2).toBe(200);
    expect(d3).toBe(400);
  });

  it('caps wait at maxDelayMs', () => {
    const b = new Backoff({ initialDelayMs: 100, factor: 10, maxDelayMs: 500, jitter: 0, breakerThreshold: 100 });
    b.recordFailure(0);
    b.recordFailure(0);
    const d3 = b.recordFailure(0);
    expect(d3).toBe(500);
  });

  it('trips the breaker after threshold consecutive failures', () => {
    const b = new Backoff({ breakerThreshold: 3, initialDelayMs: 1, jitter: 0 });
    b.recordFailure();
    b.recordFailure();
    expect(b.isTripped()).toBe(false);
    b.recordFailure();
    expect(b.isTripped()).toBe(true);
    expect(b.shouldAttempt()).toBe(false);
  });

  it('reset() clears failure state and breaker', () => {
    const b = new Backoff({ breakerThreshold: 2, initialDelayMs: 1, jitter: 0 });
    b.recordFailure();
    b.recordFailure();
    expect(b.isTripped()).toBe(true);
    b.reset();
    expect(b.isTripped()).toBe(false);
    expect(b.failureCount()).toBe(0);
    expect(b.shouldAttempt()).toBe(true);
  });

  it('respects shouldAttempt before the next-attempt window', () => {
    const b = new Backoff({ initialDelayMs: 1000, jitter: 0, breakerThreshold: 100 });
    b.recordFailure(0);
    expect(b.shouldAttempt(500)).toBe(false);
    expect(b.shouldAttempt(1500)).toBe(true);
  });

  it('jitter ratio randomizes within bounds', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const b = new Backoff({ initialDelayMs: 100, factor: 1, jitter: 0.5, breakerThreshold: 100 });
      seen.add(b.recordFailure(0));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThanOrEqual(150);
    }
  });
});
