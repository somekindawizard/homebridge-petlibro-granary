import { Device } from '../device';
import { KeyedMutex } from '../../util/mutex';

/**
 * Granary Smart Feeder.
 *
 * Covers both PLAF103 (non-camera) and PLAF203 (Granary Smart Camera Feeder),
 * since their non-camera control surface is identical — manual feed, food
 * level, child lock, indicator light, schedule, desiccant. Camera-side
 * features are explicitly excluded.
 */
export class GranarySmartFeeder extends Device {
  /** Max portions the device will accept for a single manual feed. */
  readonly maxFeedPortions = 48;

  /** Serializes mutations per device so rapid Switch taps don't race. */
  private readonly mutex = new KeyedMutex();

  /**
   * Refresh device state.
   *
   * @param mode 'full' (default) fetches all endpoints. 'light' fetches only
   *   the fast-changing ones (realInfo, grainStatus, workRecord) to reduce
   *   API load on the standard polling cadence.
   */
  override async refresh(mode: 'full' | 'light' = 'full'): Promise<void> {
    if (mode === 'full') {
      await super.refresh();
    }

    // Always refetch realInfo + grainStatus on every cycle. The 10s
    // response cache makes the duplicate realInfo call free in 'full' mode.
    const fastTasks = [
      this.api.deviceRealInfo(this.serial),
      this.api.deviceGrainStatus(this.serial),
      this.api.deviceWorkRecord(this.serial),
    ] as const;

    const slowTasks = mode === 'full'
      ? [
        this.api.deviceAttributeSettings(this.serial),
        this.api.deviceUpgrade(this.serial),
        this.api.deviceFeedingPlanTodayNew(this.serial),
        this.raw.enableFeedingPlan
          ? this.api.deviceFeedingPlanList(this.serial)
          : Promise.resolve([]),
      ] as const
      : [];

    const [
      realInfoR,
      grainStatusR,
      workRecordR,
      attrSettingsR,
      upgradeR,
      feedingTodayR,
      feedingListR,
    ] = await Promise.allSettled([...fastTasks, ...slowTasks]);

    const patch: Record<string, unknown> = {};
    let firstError: unknown = null;
    const note = (label: string, r: PromiseSettledResult<unknown> | undefined) => {
      if (!r) return undefined;
      if (r.status === 'fulfilled') return r.value;
      firstError ??= r.reason;
      this.log.debug(`Granary refresh: ${label} failed for ${this.name}:`, r.reason);
      return undefined;
    };

    const realInfo = note('realInfo', realInfoR);
    if (realInfo !== undefined) patch.realInfo = realInfo ?? {};
    const grainStatus = note('grainStatus', grainStatusR);
    if (grainStatus !== undefined) patch.grainStatus = grainStatus ?? {};
    const workRecord = note('workRecord', workRecordR);
    if (workRecord !== undefined) patch.workRecord = workRecord ?? [];

    if (mode === 'full') {
      const attrSettings = note('attrSettings', attrSettingsR);
      if (attrSettings !== undefined) patch.getAttributeSetting = attrSettings ?? {};
      const upgrade = note('upgrade', upgradeR);
      if (upgrade !== undefined) patch.getUpgrade = upgrade ?? {};
      const feedingToday = note('feedingPlanToday', feedingTodayR);
      if (feedingToday !== undefined) patch.getfeedingplantoday = feedingToday ?? {};
      const feedingList = note('feedingPlanList', feedingListR);
      if (feedingList !== undefined) patch.feedingPlan = feedingList ?? [];
    }

    this.updateData(patch);

    if (firstError) {
      this.logRefreshError(firstError);
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

  /** True when the feeder is LOW on food. API reports surplusGrain inverted. */
  get foodLow(): boolean {
    return !this.nestedGet('realInfo', 'surplusGrain', true);
  }

  /** True when the grain dispenser has a problem / is blocked. */
  get foodDispenserProblem(): boolean {
    return !this.nestedGet('realInfo', 'grainOutletState', true);
  }

  get childLockOn(): boolean {
    return Boolean(this.nestedGet('realInfo', 'childLockSwitch', false));
  }

  get indicatorLightOn(): boolean {
    return Boolean(this.nestedGet('realInfo', 'lightSwitch', false));
  }

  /** True when the device is in its configured sleep window. */
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

  /** Raw battery state string from the API. */
  get batteryState(): string {
    const v = this.nestedGet<string | undefined>('realInfo', 'batteryState', 'unknown');
    return typeof v === 'string' ? v.toUpperCase() : 'UNKNOWN';
  }

  /** Charging / power state, mapped to a stable enum. */
  get chargingState(): 'CHARGING' | 'NOT_CHARGING' | 'NOT_CHARGEABLE' {
    const raw = String(this.nestedGet<string>('realInfo', 'powerState', '') ?? '').toUpperCase();
    if (raw === 'CHARGING') return 'CHARGING';
    if (raw === 'USING') return 'NOT_CHARGING';
    if (raw === 'CHARGED') return 'NOT_CHARGING';
    return this.batteryPercent > 0 ? 'NOT_CHARGING' : 'NOT_CHARGEABLE';
  }

  /** Wi-Fi RSSI in dBm. */
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

  /** ms-epoch of the last successful grain output, or null if none. */
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
  // Control methods
  //
  // All mutations:
  //   1. Run inside the per-device mutex so rapid taps don't race.
  //   2. Apply an optimistic local state update immediately so the next
  //      HomeKit characteristic read returns the new value without
  //      waiting for a server poll.
  //   3. Invalidate the response cache so the *next* poll (driven by the
  //      platform's adaptive scheduler) actually hits the network rather
  //      than serving stale 10s-cached data.
  //
  // We deliberately do NOT trigger a full refresh inline — that turned
  // every Switch toggle into ~8 API calls. The platform's fast-poll
  // window (kicked off by the accessory layer) handles reconciliation.
  // ------------------------------------------------------------------

  async setFeedingPlan(enabled: boolean): Promise<void> {
    await this.mutex.run(this.serial, async () => {
      await this.api.setFeedingPlan(this.serial, enabled);
      this.updateData({ enableFeedingPlan: enabled });
      this.api.invalidateCache(this.serial);
    });
  }

  async setChildLock(enabled: boolean): Promise<void> {
    await this.mutex.run(this.serial, async () => {
      await this.api.setChildLock(this.serial, enabled);
      this.patchNested('realInfo', { childLockSwitch: enabled });
      this.api.invalidateCache(this.serial);
    });
  }

  async setIndicatorLight(on: boolean): Promise<void> {
    await this.mutex.run(this.serial, async () => {
      if (on) {
        await this.api.setLightOn(this.serial);
      } else {
        await this.api.setLightOff(this.serial);
      }
      this.patchNested('realInfo', { lightSwitch: on });
      this.api.invalidateCache(this.serial);
    });
  }

  /** Dispense `portions` portions immediately. Returns the clamped count. */
  async manualFeed(portions: number): Promise<number> {
    const clamped = Math.max(1, Math.min(portions, this.maxFeedPortions));
    await this.mutex.run(this.serial, async () => {
      await this.api.setManualFeed(this.serial, clamped);
      this.api.invalidateCache(this.serial);
    });
    return clamped;
  }

  async resetDesiccant(): Promise<void> {
    await this.mutex.run(this.serial, async () => {
      await this.api.setDesiccantReset(this.serial);
      this.api.invalidateCache(this.serial);
    });
  }
}
