import {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { GranarySmartFeeder } from '../devices';
import { PetLibroPlatform } from '../platform';
import {
  DESICCANT_DEFAULT_DAYS,
  LOW_BATTERY_PCT,
  MOMENTARY_SWITCH_RESET_MS,
  POST_MUTATION_REFRESH_DEBOUNCE_MS,
  RECENT_FEED_PULSE_MS,
} from '../settings';
import { debounce } from '../util/jitter';

/**
 * HomeKit accessory for the Granary Smart Feeder.
 *
 * Composes standard HomeKit services (no native feeder service exists):
 *
 *   Battery                         — battery %, low-battery, charging
 *   OccupancySensor "Food Low"      — occupied = food is low
 *   OccupancySensor "Dispenser"     — occupied = grain outlet jammed
 *   FilterMaintenance "Desiccant"   — desiccant life remaining
 *   ContactSensor "Recent Feed"     — pulses on each successful feed
 *   Switch "Feed Now"               — momentary; dispenses portions
 *   Switch "Feeding Schedule"       — toggle recurring plan
 *   Switch "Indicator"              — LED on/off
 *   Switch "Child Lock"             — hardware button lock
 *   Switch "Reset Desiccant"        — momentary; resets the day counter
 */
export class GranarySmartFeederAccessory {
  private readonly batteryService: Service;
  private readonly foodLowService: Service;
  private readonly dispenserService: Service;
  private readonly desiccantMaintenanceService: Service;
  private readonly recentFeedService: Service;
  private readonly feedNowService: Service;
  private readonly feedingPlanService: Service;
  private readonly indicatorService: Service;
  private readonly childLockService: Service;
  private readonly desiccantResetService: Service;

  private feedResetTimer: NodeJS.Timeout | null = null;
  private desiccantResetTimer: NodeJS.Timeout | null = null;
  private recentFeedClearTimer: NodeJS.Timeout | null = null;

  /** Last lastFeedTimeMs we surfaced to HomeKit, so we only pulse on change. */
  private lastObservedFeedMs: number | null = null;

  /** Debounced post-mutation refresh — coalesces rapid Switch taps. */
  private readonly debouncedRefresh = debounce(() => {
    try {
      this.refreshCharacteristics();
    } catch (err) {
      this.platform.log.debug('debounced refresh failed:', err);
    }
  }, POST_MUTATION_REFRESH_DEBOUNCE_MS);

  constructor(
    private readonly platform: PetLibroPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: GranarySmartFeeder,
  ) {
    const Service = this.platform.api.hap.Service;
    const Characteristic = this.platform.api.hap.Characteristic;

    // ---- AccessoryInformation ----
    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'PETLIBRO')
      .setCharacteristic(Characteristic.Model, device.model)
      .setCharacteristic(Characteristic.SerialNumber, device.serial)
      .setCharacteristic(Characteristic.FirmwareRevision, device.softwareVersion);

    // ---- Battery ----
    this.batteryService =
      this.accessory.getServiceById(Service.Battery, 'battery')
      ?? this.accessory.getService(Service.Battery)
      ?? this.accessory.addService(Service.Battery, `${device.name} Battery`, 'battery');
    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(() => this.device.batteryPercent);
    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(() => this.computeLowBattery());
    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(() => this.computeChargingState());

    // ---- Food Low ----
    this.foodLowService =
      this.accessory.getServiceById(Service.OccupancySensor, 'food-low')
      ?? this.accessory.addService(Service.OccupancySensor, `${device.name} Food Low`, 'food-low');
    this.foodLowService
      .getCharacteristic(Characteristic.OccupancyDetected)
      .onGet(() =>
        this.device.foodLow
          ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    this.foodLowService
      .getCharacteristic(Characteristic.StatusActive)
      .onGet(() => this.device.online);

    // ---- Dispenser blockage ----
    this.dispenserService =
      this.accessory.getServiceById(Service.OccupancySensor, 'dispenser-problem')
      ?? this.accessory.addService(Service.OccupancySensor, `${device.name} Dispenser`, 'dispenser-problem');
    this.dispenserService
      .getCharacteristic(Characteristic.OccupancyDetected)
      .onGet(() =>
        this.device.foodDispenserProblem
          ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
    this.dispenserService
      .getCharacteristic(Characteristic.StatusActive)
      .onGet(() => this.device.online);

    // ---- Desiccant filter ----
    this.desiccantMaintenanceService =
      this.accessory.getServiceById(Service.FilterMaintenance, 'desiccant')
      ?? this.accessory.addService(Service.FilterMaintenance, `${device.name} Desiccant`, 'desiccant');
    this.desiccantMaintenanceService
      .getCharacteristic(Characteristic.FilterChangeIndication)
      .onGet(() => this.computeDesiccantChangeIndication());
    this.desiccantMaintenanceService
      .getCharacteristic(Characteristic.FilterLifeLevel)
      .onGet(() => this.computeDesiccantLifeLevel());

    // ---- Recent Feed pulse ----
    this.recentFeedService =
      this.accessory.getServiceById(Service.ContactSensor, 'recent-feed')
      ?? this.accessory.addService(Service.ContactSensor, `${device.name} Recent Feed`, 'recent-feed');
    this.recentFeedService
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() => Characteristic.ContactSensorState.CONTACT_DETECTED);
    this.lastObservedFeedMs = this.device.lastFeedTimeMs;

    // ---- Feed Now (momentary) ----
    this.feedNowService =
      this.accessory.getServiceById(Service.Switch, 'feed-now')
      ?? this.accessory.addService(Service.Switch, `${device.name} Feed Now`, 'feed-now');
    this.feedNowService
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value: CharacteristicValue) => this.handleFeedNow(Boolean(value)));

    // ---- Feeding Schedule ----
    this.feedingPlanService =
      this.accessory.getServiceById(Service.Switch, 'feeding-plan')
      ?? this.accessory.addService(Service.Switch, `${device.name} Feeding Schedule`, 'feeding-plan');
    this.feedingPlanService
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.device.feedingPlanEnabled)
      .onSet((value: CharacteristicValue) =>
        this.runMutation('Feeding Schedule', () => this.device.setFeedingPlan(Boolean(value))));

    // ---- Indicator ----
    this.indicatorService =
      this.accessory.getServiceById(Service.Switch, 'indicator')
      ?? this.accessory.addService(Service.Switch, `${device.name} Indicator`, 'indicator');
    this.indicatorService
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.device.indicatorLightOn)
      .onSet((value: CharacteristicValue) =>
        this.runMutation('Indicator', () => this.device.setIndicatorLight(Boolean(value))));

    // ---- Child Lock ----
    this.childLockService =
      this.accessory.getServiceById(Service.Switch, 'child-lock')
      ?? this.accessory.addService(Service.Switch, `${device.name} Child Lock`, 'child-lock');
    this.childLockService
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.device.childLockOn)
      .onSet((value: CharacteristicValue) =>
        this.runMutation('Child Lock', () => this.device.setChildLock(Boolean(value))));

    // ---- Reset Desiccant (momentary) ----
    this.desiccantResetService =
      this.accessory.getServiceById(Service.Switch, 'desiccant-reset')
      ?? this.accessory.addService(Service.Switch, `${device.name} Reset Desiccant`, 'desiccant-reset');
    this.desiccantResetService
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value: CharacteristicValue) => this.handleDesiccantReset(Boolean(value)));
  }

  /** Called by the platform after each polling cycle to push fresh state. */
  refreshCharacteristics(): void {
    const Characteristic = this.platform.api.hap.Characteristic;

    this.batteryService.updateCharacteristic(
      Characteristic.BatteryLevel, this.device.batteryPercent);
    this.batteryService.updateCharacteristic(
      Characteristic.StatusLowBattery, this.computeLowBattery());
    this.batteryService.updateCharacteristic(
      Characteristic.ChargingState, this.computeChargingState());

    this.foodLowService.updateCharacteristic(
      Characteristic.OccupancyDetected,
      this.device.foodLow
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    this.foodLowService.updateCharacteristic(
      Characteristic.StatusActive, this.device.online);

    this.dispenserService.updateCharacteristic(
      Characteristic.OccupancyDetected,
      this.device.foodDispenserProblem
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
    this.dispenserService.updateCharacteristic(
      Characteristic.StatusActive, this.device.online);

    this.desiccantMaintenanceService.updateCharacteristic(
      Characteristic.FilterChangeIndication, this.computeDesiccantChangeIndication());
    this.desiccantMaintenanceService.updateCharacteristic(
      Characteristic.FilterLifeLevel, this.computeDesiccantLifeLevel());

    this.feedingPlanService.updateCharacteristic(
      Characteristic.On, this.device.feedingPlanEnabled);
    this.indicatorService.updateCharacteristic(
      Characteristic.On, this.device.indicatorLightOn);
    this.childLockService.updateCharacteristic(
      Characteristic.On, this.device.childLockOn);

    this.detectRecentFeed();
  }

  // ------------------------------------------------------------------
  // Compute helpers
  // ------------------------------------------------------------------

  /**
   * StatusLowBattery. Belt-and-suspenders: low if either the device says
   * so OR battery percent < threshold. Always NORMAL when no battery is
   * installed (NOT_CHARGEABLE) so AC-only setups don't show the warning.
   */
  computeLowBattery(): number {
    const Characteristic = this.platform.api.hap.Characteristic;

    if (this.device.chargingState === 'NOT_CHARGEABLE') {
      return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }

    const pct = this.device.batteryPercent;
    const state = this.device.batteryState;
    const lowByState = state === 'LOW' || state === 'CRITICAL';
    const lowByPct = pct > 0 && pct < LOW_BATTERY_PCT;
    return (lowByState || lowByPct)
      ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  computeChargingState(): number {
    const Characteristic = this.platform.api.hap.Characteristic;
    switch (this.device.chargingState) {
      case 'CHARGING': return Characteristic.ChargingState.CHARGING;
      case 'NOT_CHARGING': return Characteristic.ChargingState.NOT_CHARGING;
      default: return Characteristic.ChargingState.NOT_CHARGEABLE;
    }
  }

  computeDesiccantChangeIndication(): number {
    const Characteristic = this.platform.api.hap.Characteristic;
    const days = this.device.remainingDesiccantDays;
    if (days === null) return Characteristic.FilterChangeIndication.FILTER_OK;
    return days <= 0
      ? Characteristic.FilterChangeIndication.CHANGE_FILTER
      : Characteristic.FilterChangeIndication.FILTER_OK;
  }

  /**
   * 0-100 desiccant life percentage normalized against the configured
   * cycle length (default 30 days).
   */
  computeDesiccantLifeLevel(): number {
    const cycle = Number(this.platform.config.desiccantCycleDays ?? DESICCANT_DEFAULT_DAYS);
    const safeCycle = Number.isFinite(cycle) && cycle > 0 ? cycle : DESICCANT_DEFAULT_DAYS;
    const days = this.device.remainingDesiccantDays ?? 0;
    const pct = Math.round((days / safeCycle) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  /**
   * If a fresher GRAIN_OUTPUT_SUCCESS timestamp appeared since last poll,
   * pulse the ContactSensor open for RECENT_FEED_PULSE_MS.
   */
  private detectRecentFeed(): void {
    const latest = this.device.lastFeedTimeMs;
    if (latest === null) return;
    if (this.lastObservedFeedMs !== null && latest <= this.lastObservedFeedMs) {
      return;
    }
    this.lastObservedFeedMs = latest;
    this.firePulseRecentFeed(`workRecord (${this.device.lastFeedQuantity} portion(s))`);
  }

  /**
   * Open the Recent Feed contact sensor for RECENT_FEED_PULSE_MS, then
   * close it. Safe to call multiple times — the existing pulse extends.
   */
  private firePulseRecentFeed(reason: string): void {
    const Characteristic = this.platform.api.hap.Characteristic;
    this.recentFeedService.updateCharacteristic(
      Characteristic.ContactSensorState,
      Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
    );
    this.platform.log.debug(`${this.device.name}: recent feed pulse — ${reason}`);

    if (this.recentFeedClearTimer) clearTimeout(this.recentFeedClearTimer);
    this.recentFeedClearTimer = setTimeout(() => {
      this.recentFeedService.updateCharacteristic(
        Characteristic.ContactSensorState,
        Characteristic.ContactSensorState.CONTACT_DETECTED,
      );
    }, RECENT_FEED_PULSE_MS);
  }

  // ------------------------------------------------------------------
  // Mutation handlers
  // ------------------------------------------------------------------

  /**
   * Generic onSet wrapper: runs the mutation, swallows errors so HomeKit
   * doesn't log the noisy "threw from characteristic" warning, kicks off
   * the platform's adaptive fast-poll boost, and queues a debounced
   * characteristic refresh.
   */
  private async runMutation(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.platform.boostPolling();
      this.debouncedRefresh();
    } catch (err) {
      this.platform.log.error(
        `${label} failed on ${this.device.name}:`, err,
      );
      // Schedule a refresh anyway so the UI self-corrects.
      this.debouncedRefresh();
    }
  }

  /**
   * Momentary-switch handler for Feed Now. Skips the call when the device
   * is offline or asleep (the API would just no-op or error). On success,
   * we also fire the Recent Feed pulse immediately rather than waiting
   * for workRecord to surface the new entry on the next slow-tier poll.
   */
  private async handleFeedNow(requested: boolean): Promise<void> {
    if (!requested) return;

    if (!this.device.online) {
      this.platform.log.warn(`Manual feed skipped: ${this.device.name} is offline.`);
      this.scheduleFeedSwitchReset();
      return;
    }
    if (this.device.inSleepMode) {
      this.platform.log.warn(`Manual feed skipped: ${this.device.name} is in sleep mode.`);
      this.scheduleFeedSwitchReset();
      return;
    }

    const portions = this.platform.config.manualFeedPortions ?? 2;
    this.platform.log.info(
      `Manual feed triggered on ${this.device.name}: ${portions} portion(s)`,
    );

    try {
      const dispensed = await this.device.manualFeed(portions);
      // We initiated the feed locally — fire the pulse immediately so
      // automations don't need to wait for the workRecord poll.
      this.firePulseRecentFeed(`manual feed (${dispensed} portion(s))`);
      this.platform.boostPolling();
    } catch (err) {
      this.platform.log.error(`Manual feed failed on ${this.device.name}:`, err);
    }

    this.scheduleFeedSwitchReset();
  }

  private scheduleFeedSwitchReset(): void {
    if (this.feedResetTimer) clearTimeout(this.feedResetTimer);
    this.feedResetTimer = setTimeout(() => {
      this.feedNowService.updateCharacteristic(
        this.platform.api.hap.Characteristic.On,
        false,
      );
    }, MOMENTARY_SWITCH_RESET_MS);
  }

  private async handleDesiccantReset(requested: boolean): Promise<void> {
    if (!requested) return;

    this.platform.log.info(`Desiccant reset triggered on ${this.device.name}`);

    try {
      await this.device.resetDesiccant();
      this.platform.boostPolling();
    } catch (err) {
      this.platform.log.error(`Desiccant reset failed on ${this.device.name}:`, err);
    }

    if (this.desiccantResetTimer) clearTimeout(this.desiccantResetTimer);
    this.desiccantResetTimer = setTimeout(() => {
      this.desiccantResetService.updateCharacteristic(
        this.platform.api.hap.Characteristic.On,
        false,
      );
    }, MOMENTARY_SWITCH_RESET_MS);
  }
}
