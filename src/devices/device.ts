import { Logger } from 'homebridge';

import { PetLibroAPI, RawDevice } from '../api';

/**
 * Base class for all PETLIBRO devices.
 *
 * Faithful port of custom_components/petlibro/devices/device.py. Each
 * concrete device subclass adds its own property getters and control
 * methods, and overrides `refresh()` to pull in device-specific endpoints.
 *
 * Data is held in `raw` as a merged dictionary that matches the Python
 * integration's `_data` dict — this lets us keep the property accessors
 * structurally identical and reduces porting risk as we add more devices.
 */
export abstract class Device {
  /** Merged raw data from /device/device/list plus later refresh calls. */
  protected raw: Record<string, unknown>;

  constructor(
    data: RawDevice,
    protected readonly api: PetLibroAPI,
    protected readonly log: Logger,
  ) {
    this.raw = { ...data } as Record<string, unknown>;
  }

  /** Merge new data into the device's internal state. */
  updateData(patch: Record<string, unknown>): void {
    this.raw = { ...this.raw, ...patch };
  }

  /**
   * Like `refresh()`, but returns a boolean indicating whether *any* of the
   * core fields were successfully populated. Used by the platform to decide
   * whether the accessory has real state on first registration.
   *
   * Subclasses can override this if they want different "ready" criteria;
   * the default is "we saw a non-empty realInfo blob."
   */
  async refreshSafely(): Promise<boolean> {
    await this.refresh();
    const real = this.nested('realInfo');
    return Object.keys(real).length > 0;
  }

  /**
   * Refresh base/real/attribute data. Subclasses should override and call
   * `super.refresh()` first to populate the common fields.
   */
  async refresh(): Promise<void> {
    try {
      const [base, real, attrs, pets] = await Promise.all([
        this.api.deviceBaseInfo(this.serial),
        this.api.deviceRealInfo(this.serial),
        this.api.deviceAttributeSettings(this.serial),
        this.api.deviceGetBoundPets(this.serial),
      ]);
      // `base` fields are top-level on `this.raw` (they extend the original
      // device-list entry). `realInfo` and `getAttributeSetting` are kept as
      // nested sub-objects so the `nestedGet('realInfo', …)` accessors below
      // can find them structurally, matching the upstream Python shape.
      this.updateData({
        ...base,
        realInfo: real ?? {},
        getAttributeSetting: attrs ?? {},
        boundPets: pets,
      });
    } catch (err) {
      this.logRefreshError(err);
    }
  }

  /**
   * Log a refresh error with appropriate severity. Transient network
   * issues (timeouts, connection drops) get a one-line warning; genuinely
   * unexpected errors get the full stack trace at error level.
   *
   * This avoids the situation where a single axios timeout dumps a ~100-line
   * stack trace into the user's Homebridge log every poll interval.
   */
  protected logRefreshError(err: unknown): void {
    const transientCodes = new Set([
      'ECONNABORTED', // axios timeout
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',   // DNS lookup temporary failure
      'ENETUNREACH',
    ]);
    const code = (err as { code?: string })?.code;
    const label = this.name || this.serial || 'unknown device';

    if (code && transientCodes.has(code)) {
      this.log.warn(
        `Transient network error refreshing ${label} (${code}); will retry next poll.`,
      );
      return;
    }

    this.log.error(`Failed to refresh ${label}:`, err);
  }

  // ---- Identity ----

  get serial(): string {
    return String(this.raw.deviceSn ?? '');
  }

  get model(): string {
    return String(this.raw.productIdentifier ?? 'unknown');
  }

  get modelName(): string {
    return String(this.raw.productName ?? 'unknown');
  }

  get name(): string {
    return String(this.raw.name ?? this.modelName);
  }

  get mac(): string {
    return String(this.raw.mac ?? '');
  }

  get softwareVersion(): string {
    return String(this.raw.softwareVersion ?? '0.0.0');
  }

  get hardwareVersion(): string {
    return String(this.raw.hardwareVersion ?? '0.0.0');
  }

  /** Whether this account owns (vs is shared) the device. Matches HA logic. */
  get owned(): boolean {
    const state = this.raw.deviceShareState;
    // 1 = Shared with me; 2 = Owned, shared; 3 = Owned, not shared.
    return state === 2 || state === 3 || state === undefined;
  }

  // ---- Helpers for subclasses ----

  protected nested(key: string): Record<string, unknown> {
    const v = this.raw[key];
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  }

  protected nestedGet<T>(outer: string, inner: string, fallback: T): T {
    const obj = this.nested(outer);
    const v = obj[inner];
    return (v === undefined || v === null) ? fallback : (v as T);
  }
}
