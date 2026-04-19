import { Device } from '../device';

/**
 * Granary Smart Feeder.
 *
 * Covers both PLAF103 (non-camera) and PLAF203 (Granary Smart Camera Feeder),
 * since their non-camera control surface is identical — manual feed, food
 * level, child lock, indicator light, schedule, desiccant. Camera-side
 * features (resolution, nightVision, video record) are explicitly excluded
 * from this plugin; integrate the camera separately if needed.
 *
 * Faithful port of devices/feeders/granary_smart_feeder.py. The Python
 * class reads nested API responses (`grainStatus`, `realInfo`, etc.) via
 * `self._data.get(...)` — here we use the `nested()` helpers on the base
 * class to keep the property accessors structurally identical.
 */
export class GranarySmartFeeder extends Device {
  /** Max portions the device will accept for a single manual feed. */
  readonly maxFeedPortions = 48;

  async refresh(): Promise<void> {
    await super.refresh();

    try {
      // realInfo and getAttributeSetting are already fetched by Device.refresh().
      // Thanks to the 10s response cache in the API client, we *could* safely
      // re-fetch them here, but it's cleaner to only grab the extras.
      const [grainStatus, upgrade, workRecord, feedingToday] = await Promise.all([
        this.api.deviceGrainStatus(this.serial),
        this.api.deviceUpgrade(this.serial),
        this.api.deviceWorkRecord(this.serial),
        this.api.deviceFeedingPlanTodayNew(this.serial),
      ]);

      const feedingList = this.raw.enableFeedingPlan
        ? await this.api.deviceFeedingPlanList(this.serial)
        : [];

      this.updateData({
        grainStatus: grainStatus ?? {},
        getUpgrade: upgrade ?? {},
        // Upstream key is lowercase "getfeedingplantoday" — matching that
        // lets us reuse the exact accessor shape if we ever port more feeder
        // properties from Python.
        getfeedingplantoday: feedingToday ?? {},
        feedingPlan: feedingList ?? [],
        workRecord: workRecord ?? [],
      });
    } catch (err) {
      this.logRefreshError(err);
    }
  }

  // ------------------------------------------------------------------
  // State — booleans that map to HomeKit switches/sensors
  // ------------------------------------------------------------------

  /** Device is connected to Wi-Fi / PETLIBRO cloud. */
  get online(): boolean {
    return Boolean(this.nestedGet('realInfo', 'online', false));
  }

  /** Whether the recurring feeding plan is enabled. */
  get feedingPlanEnabled(): boolean {
    return Boolean(this.raw.enableFeedingPlan);
  }

  /**
   * True when the feeder is LOW on food. The API reports `surplusGrain: true`
   * when food is present, so we invert it to match the HA integration's
   * `food_low` semantics (and HomeKit's "problem" convention).
   */
  get foodLow(): boolean {
    return !this.nestedGet('realInfo', 'surplusGrain', true);
  }

  /**
   * True when the grain dispenser has a problem / is blocked. Inverted from
   * the API's `grainOutletState: true == OK` for the same reason as foodLow.
   */
  get foodDispenserProblem(): boolean {
    return !this.nestedGet('realInfo', 'grainOutletState', true);
  }

  get childLockOn(): boolean {
    return Boolean(this.nestedGet('realInfo', 'childLockSwitch', false));
  }

  get indicatorLightOn(): boolean {
    return Boolean(this.nestedGet('realInfo', 'lightSwitch', false));
  }

  /**
   * True when the device is in its configured sleep window. While asleep
   * the device is less responsive to commands; we report this to HomeKit
   * via StatusActive on the Feed Now switch so users see *why* a feed
   * didn't trigger immediately.
   */
  get inSleepMode(): boolean {
    return Boolean(this.nestedGet('getAttributeSetting', 'enableSleepMode', false));
  }

  // ------------------------------------------------------------------
  // State — numeric / string values
  // ------------------------------------------------------------------

  /** Battery percentage. Returns 0 when on AC power and battery is absent. */
  get batteryPercent(): number {
    const v = this.nestedGet<number | string | undefined>('realInfo', 'electricQuantity', 0);
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Raw battery state string from the API. Common values observed upstream:
   * "NORMAL", "LOW", "UNKNOWN". Used to drive the StatusLowBattery flag
   * more reliably than a naive percentage threshold.
   */
  get batteryState(): string {
    const v = this.nestedGet<string | undefined>('realInfo', 'batteryState', 'unknown');
    return typeof v === 'string' ? v.toUpperCase() : 'UNKNOWN';
  }

  /**
   * Charging / power state. The API uses `powerState` on the realInfo blob
   * with values CHARGED / CHARGING / USING. Maps to HomeKit's
   * ChargingState enum: CHARGING (1) when actively charging, NOT_CHARGING
   * (0) when running on battery, NOT_CHARGEABLE (2) otherwise.
   *
   * Granary is mains-powered with optional D-cell battery backup — so when
   * plugged in and batteries present, we expect "CHARGED"; on batteries
   * only we expect "USING".
   */
  get chargingState(): 'CHARGING' | 'NOT_CHARGING' | 'NOT_CHARGEABLE' {
    const raw = String(this.nestedGet<string>('realInfo', 'powerState', '') ?? '').toUpperCase();
    if (raw === 'CHARGING') return 'CHARGING';
    if (raw === 'USING') return 'NOT_CHARGING';
    if (raw === 'CHARGED') return 'NOT_CHARGING';
    // Fall back: if we have no battery at all, report NOT_CHARGEABLE so
    // HomeKit doesn't show a misleading "running on battery" state.
    return this.batteryPercent > 0 ? 'NOT_CHARGING' : 'NOT_CHARGEABLE';
  }

  /** Wi-Fi RSSI in dBm. Typically -30 (excellent) to -90 (very poor). */
  get wifiRssi(): number {
    const v = this.nestedGet<number | undefined>('realInfo', 'wifiRssi', -100);
    return typeof v === 'number' ? v : -100;
  }

  /** Days of desiccant life remaining. */
  get remainingDesiccantDays(): number | null {
    const v = this.raw.remainingDesiccantDays;
    if (v === undefined || v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Total portions dispensed today. */
  get todayFeedingQuantity(): number {
    const v = this.nestedGet<number | undefined>('grainStatus', 'todayFeedingQuantity', 0);
    return typeof v === 'number' ? v : 0;
  }

  /** Count of feed events today. */
  get todayFeedingTimes(): number {
    const v = this.nestedGet<number | undefined>('grainStatus', 'todayFeedingTimes', 0);
    return typeof v === 'number' ? v : 0;
  }

  /**
   * Timestamp (ms epoch) of the last successful grain output, or null if
   * no record exists. Walks the workRecord list looking for the most
   * recent GRAIN_OUTPUT_SUCCESS entry. Structure ported from upstream:
   *   workRecord: [ { workRecords: [ { type, recordTime, actualGrainNum }, … ] }, … ]
   */
  get lastFeedTimeMs(): number | null {
    const days = this.raw.workRecord;
    if (!Array.isArray(days)) return null;
    for (const day of days) {
      const records = (day as { workRecords?: unknown })?.workRecords;
      if (!Array.isArray(records)) continue;
      for (const rec of records) {
        const r = rec as { type?: string; recordTime?: number };
        if (r?.type === 'GRAIN_OUTPUT_SUCCESS' && typeof r.recordTime === 'number') {
          return r.recordTime;
        }
      }
    }
    return null;
  }

  /** Portion count of the most recent successful dispense, or 0 if none. */
  get lastFeedQuantity(): number {
    const days = this.raw.workRecord;
    if (!Array.isArray(days)) return 0;
    for (const day of days) {
      const records = (day as { workRecords?: unknown })?.workRecords;
      if (!Array.isArray(records)) continue;
      for (const rec of records) {
        const r = rec as { type?: string; actualGrainNum?: number };
        if (r?.type === 'GRAIN_OUTPUT_SUCCESS' && typeof r.actualGrainNum === 'number') {
          return r.actualGrainNum;
        }
      }
    }
    return 0;
  }

  // ------------------------------------------------------------------
  // Control methods — mutations trigger API, caller refreshes after
  // ------------------------------------------------------------------

  async setFeedingPlan(enabled: boolean): Promise<void> {
    await this.api.setFeedingPlan(this.serial, enabled);
    this.api.invalidateCache(this.serial);
    await this.refresh();
  }

  async setChildLock(enabled: boolean): Promise<void> {
    await this.api.setChildLock(this.serial, enabled);
    this.api.invalidateCache(this.serial);
    await this.refresh();
  }

  async setIndicatorLight(on: boolean): Promise<void> {
    if (on) {
      await this.api.setLightOn(this.serial);
    } else {
      await this.api.setLightOff(this.serial);
    }
    this.api.invalidateCache(this.serial);
    await this.refresh();
  }

  /** Dispense `portions` portions immediately. */
  async manualFeed(portions: number): Promise<void> {
    const clamped = Math.max(1, Math.min(portions, this.maxFeedPortions));
    await this.api.setManualFeed(this.serial, clamped);
    this.api.invalidateCache(this.serial);
    await this.refresh();
  }

  async resetDesiccant(): Promise<void> {
    await this.api.setDesiccantReset(this.serial);
    this.api.invalidateCache(this.serial);
    await this.refresh();
  }
}
