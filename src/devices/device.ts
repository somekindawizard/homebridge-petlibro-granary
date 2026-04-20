import { Logger } from 'homebridge';

import { PetLibroAPI, RawDevice } from '../api';
import { DeviceRawData } from '../types/petlibroApi';

/**
 * Base class for all PETLIBRO devices.
 *
 * Faithful port of custom_components/petlibro/devices/device.py. Each
 * concrete device subclass adds its own property getters and control
 * methods, and overrides `refresh()` to pull in device-specific endpoints.
 *
 * Data is held in `raw` as a merged dictionary that matches the Python
 * integration's `_data` dict -- this lets us keep the property accessors
 * structurally identical and reduces porting risk as we add more devices.
 */
export abstract class Device {
  /** Merged raw data from /device/device/list plus later refresh calls. */
  protected raw: DeviceRawData;

  constructor(
    data: RawDevice,
    protected readonly api: PetLibroAPI,
    protected readonly log: Logger,
  ) {
    this.raw = { ...data } as DeviceRawData;
  }

  /** Merge new data into the device's internal state. */
  updateData(patch: Record<string, unknown>): void {
    this.raw = { ...this.raw, ...patch } as DeviceRawData;
  }

  /**
   * Apply an *optimistic* local-only update for a nested settings field.
   * Used by mutators (set child lock, set indicator light, ...) to flip
   * the local state immediately without waiting for the next poll. The
   * subsequent server poll will overwrite this if it disagrees.
   */
  patchNested(outer: keyof DeviceRawData, patch: Record<string, unknown>): void {
    const current = this.nested(String(outer));
    this.updateData({ [outer]: { ...current, ...patch } });
  }

  /**
   * Like `refresh()`, but returns a boolean indicating whether *any* of the
   * core fields were successfully populated. Used by the platform to decide
   * whether the accessory has real state on first registration.
   */
  async refreshSafely(): Promise<boolean> {
    await this.refresh();
    const real = this.nested('realInfo');
    return Object.keys(real).length > 0;
  }

  /**
   * Refresh base/real/attribute data. Subclasses should override and call
   * `super.refresh()` first to populate the common fields.
   *
   * Uses Promise.allSettled so a single failing endpoint doesn't lose all
   * other state. The cached() layer in the API will keep stale data alive
   * for 10s, but anything older falls through to the network.
   */
  async refresh(): Promise<void> {
    const results = await Promise.allSettled([
      this.api.deviceBaseInfo(this.serial),
      this.api.deviceRealInfo(this.serial),
      this.api.deviceAttributeSettings(this.serial),
      this.api.deviceGetBoundPets(this.serial),
    ]);
    const labels = ['baseInfo', 'realInfo', 'attributeSettings', 'boundPets'];

    const patch: Record<string, unknown> = {};
    let anyFailed = false;
    let anyError: unknown = null;

    if (results[0].status === 'fulfilled') {
      Object.assign(patch, results[0].value);
    } else {
      anyFailed = true;
      anyError = results[0].reason;
      this.log.debug(`Refresh: ${labels[0]} failed for ${this.name}:`, results[0].reason);
    }
    if (results[1].status === 'fulfilled') {
      patch.realInfo = results[1].value ?? {};
    } else {
      anyFailed = true;
      anyError ??= results[1].reason;
      this.log.debug(`Refresh: ${labels[1]} failed for ${this.name}:`, results[1].reason);
    }
    if (results[2].status === 'fulfilled') {
      patch.getAttributeSetting = results[2].value ?? {};
    } else {
      anyFailed = true;
      anyError ??= results[2].reason;
      this.log.debug(`Refresh: ${labels[2]} failed for ${this.name}:`, results[2].reason);
    }
    if (results[3].status === 'fulfilled') {
      patch.boundPets = results[3].value;
    } else {
      anyFailed = true;
      anyError ??= results[3].reason;
      this.log.debug(`Refresh: ${labels[3]} failed for ${this.name}:`, results[3].reason);
    }

    this.updateData(patch);

    if (anyFailed) {
      this.logRefreshError(anyError);
    }
  }

  /**
   * Log a refresh error with appropriate severity. Transient network
   * issues (timeouts, connection drops) get a one-line warning; genuinely
   * unexpected errors get the full stack trace at error level.
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

  /** Whether this account owns (vs is shared) the device. */
  get owned(): boolean {
    const state = this.raw.deviceShareState;
    // 1 = Shared with me; 2 = Owned, shared; 3 = Owned, not shared.
    return state === 2 || state === 3 || state === undefined;
  }

  /**
   * Name of the first bound pet, or null if no pets are bound.
   *
   * Used by the accessory layer to build friendlier HomeKit service
   * labels (e.g. "Feed Mochi" instead of "Test Feeder Feed Now").
   * Only the first pet is used because most single-feeder setups have
   * one pet; multi-pet names would make labels too long.
   */
  get primaryPetName(): string | null {
    const pets = this.raw.boundPets;
    if (!Array.isArray(pets) || pets.length === 0) return null;
    const first = pets[0] as Record<string, unknown> | undefined;
    const name = first?.name ?? first?.petName;
    return typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : null;
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
