import { describe, it, expect, vi } from 'vitest';
import { jitter, debounce, sleep } from '../util/jitter';
import { encryptToken, decryptToken } from '../util/tokenCrypto';

describe('jitter', () => {
  it('returns base when ratio is 0', () => {
    expect(jitter(1000, 0)).toBe(1000);
    expect(jitter(1000, -1)).toBe(1000);
  });

  it('stays within ±ratio of base', () => {
    for (let i = 0; i < 100; i++) {
      const v = jitter(1000, 0.1);
      expect(v).toBeGreaterThanOrEqual(900);
      expect(v).toBeLessThanOrEqual(1100);
    }
  });

  it('produces variation', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(jitter(1000, 0.5));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('debounce', () => {
  it('only fires once after rapid calls', async () => {
    const fn = vi.fn();
    const d = debounce(fn, 20);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    await sleep(40);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes the latest args', async () => {
    const fn = vi.fn();
    const d = debounce(fn, 10);
    d('a'); d('b'); d('c');
    await sleep(30);
    expect(fn).toHaveBeenCalledWith('c');
  });
});

describe('tokenCrypto', () => {
  it('round-trips a token', () => {
    const ct = encryptToken('hello-world', 'a@b.com');
    expect(ct).not.toContain('hello-world');
    expect(decryptToken(ct, 'a@b.com')).toBe('hello-world');
  });

  it('returns null on email mismatch', () => {
    const ct = encryptToken('tok', 'a@b.com');
    expect(decryptToken(ct, 'other@example.com')).toBeNull();
  });

  it('returns null on legacy plaintext file', () => {
    const legacy = JSON.stringify({ email: 'a@b.com', token: 'plain-tok' });
    expect(decryptToken(legacy, 'a@b.com')).toBeNull();
  });

  it('returns null on garbage input', () => {
    expect(decryptToken('not json', 'a@b.com')).toBeNull();
    expect(decryptToken('{}', 'a@b.com')).toBeNull();
  });

  it('returns null on tampered ciphertext', () => {
    const ct = encryptToken('tok', 'a@b.com');
    const obj = JSON.parse(ct);
    obj.ct = 'deadbeef'; // valid hex but wrong bytes
    expect(decryptToken(JSON.stringify(obj), 'a@b.com')).toBeNull();
  });
});
