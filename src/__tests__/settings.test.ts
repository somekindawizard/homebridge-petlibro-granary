import { describe, it, expect } from 'vitest';
import { DEFAULT_UI_CONFIG, resolveUiConfig } from '../settings';

describe('resolveUiConfig', () => {
  it('returns full defaults when nothing supplied', () => {
    expect(resolveUiConfig()).toEqual(DEFAULT_UI_CONFIG);
    expect(resolveUiConfig(undefined)).toEqual(DEFAULT_UI_CONFIG);
    expect(resolveUiConfig({})).toEqual(DEFAULT_UI_CONFIG);
  });

  it('reset desiccant defaults to false (power-user feature)', () => {
    expect(DEFAULT_UI_CONFIG.exposeResetDesiccant).toBe(false);
  });

  it('all other expose* default to true', () => {
    expect(DEFAULT_UI_CONFIG.exposeFeedNow).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeFeedingSchedule).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeIndicator).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeChildLock).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeRecentFeed).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeDispenser).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeDesiccant).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeFoodLow).toBe(true);
    expect(DEFAULT_UI_CONFIG.exposeBattery).toBe(true);
    expect(DEFAULT_UI_CONFIG.useEmojiNames).toBe(true);
  });

  it('overrides only the supplied keys', () => {
    const r = resolveUiConfig({ exposeIndicator: false, useEmojiNames: false });
    expect(r.exposeIndicator).toBe(false);
    expect(r.useEmojiNames).toBe(false);
    // Untouched keys keep their defaults.
    expect(r.exposeBattery).toBe(true);
    expect(r.exposeChildLock).toBe(true);
    expect(r.exposeResetDesiccant).toBe(false);
  });

  it('can opt INTO Reset Desiccant', () => {
    const r = resolveUiConfig({ exposeResetDesiccant: true });
    expect(r.exposeResetDesiccant).toBe(true);
  });
});
