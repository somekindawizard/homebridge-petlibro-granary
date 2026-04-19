import { describe, it, expect } from 'vitest';
import { KeyedMutex } from '../util/mutex';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('KeyedMutex', () => {
  it('serializes calls with the same key', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];

    const a = m.run('k', async () => {
      order.push('a-start');
      await sleep(20);
      order.push('a-end');
    });
    const b = m.run('k', async () => {
      order.push('b-start');
      await sleep(5);
      order.push('b-end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs different keys concurrently', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];

    const a = m.run('a', async () => {
      order.push('a-start');
      await sleep(20);
      order.push('a-end');
    });
    const b = m.run('b', async () => {
      order.push('b-start');
      await sleep(5);
      order.push('b-end');
    });

    await Promise.all([a, b]);
    // b is shorter and ran in parallel, so it must finish before a.
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
    expect(order.indexOf('a-start')).toBeLessThan(order.indexOf('b-end'));
  });

  it('does not poison the chain on failure', async () => {
    const m = new KeyedMutex();
    let ran = false;

    await expect(m.run('k', async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');

    await m.run('k', async () => { ran = true; });
    expect(ran).toBe(true);
  });

  it('returns the function result', async () => {
    const m = new KeyedMutex();
    const result = await m.run('k', async () => 42);
    expect(result).toBe(42);
  });
});
