import {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { GranarySmartFeeder } from '../devices';
import { PetLibroPlatform } from '../platform';
import {
  ALL_GRANARY_SERVICES,
  DESICCANT_DEFAULT_DAYS,
  GranaryServiceKey,
  LOW_BATTERY_PCT,
  MOMENTARY_SWITCH_RESET_MS,
  POST_MUTATION_REFRESH_DEBOUNCE_MS,
  RECENT_FEED_PULSE_MS,
} from '../settings';
import { debounce } from '../util/jitter';

/**
 * HomeKit accessory for the Granary Smart Feeder.
 *
 * Composes standard HomeKit services (no native feeder service exists).
 * Battery is always present. All other services are opt-in via the
 * enabledServices config array. When omitted, all services are enabled
 * for backward compatibility.
 *
 * Service labels use the bound pet name when available (e.g. "Feed Mochi"
 * instead of "Kitchen Feeder Feed Now"). Falls back to the device name
 * when no pet is bound or the fetch fails.
 */
export class GranarySmartFeederAccessory {
  private readonly batteryService: Service;
  private readonly foodLowService: Service | null = null;
  private readonly dispenserService: Service | null = null;
  private readonly desiccantMaintenanceService: Service | null = null;
  private readonly recentFeedService: Service | null = null;
  private readonly feedNowService: Service | null = null;
  private readonly feedingPlanService: Service | null = null;
  private readonly indicatorService: Service | null = null;
  private readonly childLockService: Service | null = null;
  private readonly desiccantResetService: Service | null = null;

  private feedResetTimer: NodeJS.Timeout | null = null;
  private desiccantResetTimer: NodeJS.Timeout | null = null;
  private recentFeedClearTimer: NodeJS.Timeout | null = null;
  private lastObservedFeedMs: number | null = null;
  private readonly enabledServices: ReadonlySet<GranaryServiceKey>;

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
    const Svc = this.platform.api.hap.Service;
    const Chr = this.platform.api.hap.Characteristic;

    const configured = this.platform.config.enabledServices;
    this.enabledServices = new Set<GranaryServiceKey>(
      Array.isArray(configured) && configured.length > 0
        ? configured as GranaryServiceKey[]
        : ALL_GRANARY_SERVICES,
    );

    const petName = this.device.primaryPetName;
    const prefix = petName ?? device.name;

    // ---- AccessoryInformation ----
    this.accessory
      .getService(Svc.AccessoryInformation)!
      .setCharacteristic(Chr.Manufacturer, 'PETLIBRO')
      .setCharacteristic(Chr.Model, device.model)
      .setCharacteristic(Chr.SerialNumber, device.serial)
      .setCharacteristic(Chr.FirmwareRevision, device.softwareVersion);

    // ---- Battery (always present) ----
    const batteryLabel = `${prefix} Battery`;
    this.batteryService =
      this.accessory.getServiceById(Svc.Battery, 'battery')
      ?? this.accessory.getService(Svc.Battery)
      ?? this.accessory.addService(Svc.Battery, batteryLabel, 'battery');
    this.ensureDisplayName(this.batteryService, batteryLabel);
    this.batteryService.getCharacteristic(Chr.BatteryLevel)
      .onGet(() => this.device.batteryPercent);
    this.batteryService.getCharacteristic(Chr.StatusLowBattery)
      .onGet(() => this.computeLowBattery());
    this.batteryService.getCharacteristic(Chr.ChargingState)
      .onGet(() => this.computeChargingState());

    // ---- Food Low ----
    if (this.isEnabled('foodLow')) {
      const label = `${prefix} Food Low`;
      this.foodLowService =
        this.accessory.getServiceById(Svc.OccupancySensor, 'food-low')
        ?? this.accessory.addService(Svc.OccupancySensor, label, 'food-low');
      this.ensureDisplayName(this.foodLowService, label);
      this.foodLowService.getCharacteristic(Chr.OccupancyDetected)
        .onGet(() => this.device.foodLow
          ? Chr.OccupancyDetected.OCCUPANCY_DETECTED
          : Chr.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      this.foodLowService.getCharacteristic(Chr.StatusActive)
        .onGet(() => this.device.online);
    } else {
      this.removeStaleService(Svc.OccupancySensor, 'food-low');
    }

    // ---- Dispenser blockage ----
    if (this.isEnabled('dispenser')) {
      const label = `${prefix} Feeder Jam`;
      this.dispenserService =
        this.accessory.getServiceById(Svc.OccupancySensor, 'dispenser-problem')
        ?? this.accessory.addService(Svc.OccupancySensor, label, 'dispenser-problem');
      this.ensureDisplayName(this.dispenserService, label);
      this.dispenserService.getCharacteristic(Chr.OccupancyDetected)
        .onGet(() => this.device.foodDispenserProblem
          ? Chr.OccupancyDetected.OCCUPANCY_DETECTED
          : Chr.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      this.dispenserService.getCharacteristic(Chr.StatusActive)
        .onGet(() => this.device.online);
    } else {
      this.removeStaleService(Svc.OccupancySensor, 'dispenser-problem');
    }

    // ---- Desiccant filter ----
    if (this.isEnabled('desiccantMaintenance')) {
      const label = `${prefix} Desiccant`;
      this.desiccantMaintenanceService =
        this.accessory.getServiceById(Svc.FilterMaintenance, 'desiccant')
        ?? this.accessory.addService(Svc.FilterMaintenance, label, 'desiccant');
      this.ensureDisplayName(this.desiccantMaintenanceService, label);
      this.desiccantMaintenanceService.getCharacteristic(Chr.FilterChangeIndication)
        .onGet(() => this.computeDesiccantChangeIndication());
      this.desiccantMaintenanceService.getCharacteristic(Chr.FilterLifeLevel)
        .onGet(() => this.computeDesiccantLifeLevel());
    } else {
      this.removeStaleService(Svc.FilterMaintenance, 'desiccant');
    }

    // ---- Last Fed pulse ----
    if (this.isEnabled('recentFeed')) {
      const label = `${prefix} Last Fed`;
      this.recentFeedService =
        this.accessory.getServiceById(Svc.ContactSensor, 'recent-feed')
        ?? this.accessory.addService(Svc.ContactSensor, label, 'recent-feed');
      this.ensureDisplayName(this.recentFeedService, label);
      this.recentFeedService.getCharacteristic(Chr.ContactSensorState)
        .onGet(() => Chr.ContactSensorState.CONTACT_DETECTED);
      this.lastObservedFeedMs = this.device.lastFeedTimeMs;
    } else {
      this.removeStaleService(Svc.ContactSensor, 'recent-feed');
    }

    // ---- Feed Now (momentary) ----
    if (this.isEnabled('feedNow')) {
      const label = petName ? `Feed ${petName}` : `${prefix} Feed Now`;
      this.feedNowService =
        this.accessory.getServiceById(Svc.Switch, 'feed-now')
        ?? this.accessory.addService(Svc.Switch, label, 'feed-now');
      this.ensureDisplayName(this.feedNowService, label);
      this.feedNowService.getCharacteristic(Chr.On)
        .onGet(() => false)
        .onSet(async (v: CharacteristicValue) => this.handleFeedNow(Boolean(v)));
    } else {
      this.removeStaleService(Svc.Switch, 'feed-now');
    }

    // ---- Feeding Schedule ----
    if (this.isEnabled('feedingSchedule')) {
      const label = `${prefix} Schedule`;
      this.feedingPlanService =
        this.accessory.getServiceById(Svc.Switch, 'feeding-plan')
        ?? this.accessory.addService(Svc.Switch, label, 'feeding-plan');
      this.ensureDisplayName(this.feedingPlanService, label);
      this.feedingPlanService.getCharacteristic(Chr.On)
        .onGet(() => this.device.feedingPlanEnabled)
        .onSet((v: CharacteristicValue) =>
          this.runMutation('Feeding Schedule', () => this.device.setFeedingPlan(Boolean(v))));
    } else {
      this.removeStaleService(Svc.Switch, 'feeding-plan');
    }

    // ---- Indicator ----
    if (this.isEnabled('indicator')) {
      const label = `${prefix} Indicator`;
      this.indicatorService =
        this.accessory.getServiceById(Svc.Switch, 'indicator')
        ?? this.accessory.addService(Svc.Switch, label, 'indicator');
      this.ensureDisplayName(this.indicatorService, label);
      this.indicatorService.getCharacteristic(Chr.On)
        .onGet(() => this.device.indicatorLightOn)
        .onSet((v: CharacteristicValue) =>
          this.runMutation('Indicator', () => this.device.setIndicatorLight(Boolean(v))));
    } else {
      this.removeStaleService(Svc.Switch, 'indicator');
    }

    // ---- Child Lock ----
    if (this.isEnabled('childLock')) {
      const label = `${prefix} Child Lock`;
      this.childLockService =
        this.accessory.getServiceById(Svc.Switch, 'child-lock')
        ?? this.accessory.addService(Svc.Switch, label, 'child-lock');
      this.ensureDisplayName(this.childLockService, label);
      this.childLockService.getCharacteristic(Chr.On)
        .onGet(() => this.device.childLockOn)
        .onSet((v: CharacteristicValue) =>
          this.runMutation('Child Lock', () => this.device.setChildLock(Boolean(v))));
    } else {
      this.removeStaleService(Svc.Switch, 'child-lock');
    }

    // ---- Replace Desiccant (momentary) ----
    if (this.isEnabled('resetDesiccant')) {
      const label = `${prefix} Replace Desiccant`;
      this.desiccantResetService =
        this.accessory.getServiceById(Svc.Switch, 'desiccant-reset')
        ?? this.accessory.addService(Svc.Switch, label, 'desiccant-reset');
      this.ensureDisplayName(this.desiccantResetService, label);
      this.desiccantResetService.getCharacteristic(Chr.On)
        .onGet(() => false)
        .onSet(async (v: CharacteristicValue) => this.handleDesiccantReset(Boolean(v)));
    } else {
      this.removeStaleService(Svc.Switch, 'desiccant-reset');
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  destroy(): void {
    if (this.feedResetTimer) { clearTimeout(this.feedResetTimer); this.feedResetTimer = null; }
    if (this.desiccantResetTimer) { clearTimeout(this.desiccantResetTimer); this.desiccantResetTimer = null; }
    if (this.recentFeedClearTimer) { clearTimeout(this.recentFeedClearTimer); this.recentFeedClearTimer = null; }
  }

  refreshCharacteristics(): void {
    const Chr = this.platform.api.hap.Characteristic;

    this.batteryService.updateCharacteristic(Chr.BatteryLevel, this.device.batteryPercent);
    this.batteryService.updateCharacteristic(Chr.StatusLowBattery, this.computeLowBattery());
    this.batteryService.updateCharacteristic(Chr.ChargingState, this.computeChargingState());

    if (this.foodLowService) {
      this.foodLowService.updateCharacteristic(Chr.OccupancyDetected,
        this.device.foodLow
          ? Chr.OccupancyDetected.OCCUPANCY_DETECTED
          : Chr.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      this.foodLowService.updateCharacteristic(Chr.StatusActive, this.device.online);
    }
    if (this.dispenserService) {
      this.dispenserService.updateCharacteristic(Chr.OccupancyDetected,
        this.device.foodDispenserProblem
          ? Chr.OccupancyDetected.OCCUPANCY_DETECTED
          : Chr.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
      this.dispenserService.updateCharacteristic(Chr.StatusActive, this.device.online);
    }
    if (this.desiccantMaintenanceService) {
      this.desiccantMaintenanceService.updateCharacteristic(
        Chr.FilterChangeIndication, this.computeDesiccantChangeIndication());
      this.desiccantMaintenanceService.updateCharacteristic(
        Chr.FilterLifeLevel, this.computeDesiccantLifeLevel());
    }
    if (this.feedingPlanService) {
      this.feedingPlanService.updateCharacteristic(Chr.On, this.device.feedingPlanEnabled);
    }
    if (this.indicatorService) {
      this.indicatorService.updateCharacteristic(Chr.On, this.device.indicatorLightOn);
    }
    if (this.childLockService) {
      this.childLockService.updateCharacteristic(Chr.On, this.device.childLockOn);
    }
    this.detectRecentFeed();
  }

  // ------------------------------------------------------------------
  // Service helpers
  // ------------------------------------------------------------------

  private isEnabled(key: GranaryServiceKey): boolean {
    return this.enabledServices.has(key);
  }

  /**
   * Update a service's display name and Name characteristic.
   *
   * Called on every startup for both cached and freshly-created services
   * so that users upgrading from an older version (or changing their pet
   * name in the PETLIBRO app) see the new labels without needing to
   * remove and re-add the accessory.
   */
  private ensureDisplayName(service: Service, name: string): void {
    service.displayName = name;
    try {
      service.updateCharacteristic(
        this.platform.api.hap.Characteristic.Name, name,
      );
    } catch {
      // Some service types may not support the Name characteristic.
      // Not critical -- displayName alone is sufficient for most UIs.
    }
  }

  private removeStaleService(
    serviceType: WithUUID<typeof Service>,
    subtype: string,
  ): void {
    const existing = this.accessory.getServiceById(serviceType, subtype);
    if (existing) {
      this.platform.log.info(
        `Removing disabled service "${subtype}" from ${this.device.name}`,
      );
      this.accessory.removeService(existing);
    }
  }

  // ------------------------------------------------------------------
  // Compute helpers
  // ------------------------------------------------------------------

  computeLowBattery(): number {
    const Chr = this.platform.api.hap.Characteristic;
    if (this.device.chargingState === 'NOT_CHARGEABLE') {
      return Chr.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    const pct = this.device.batteryPercent;
    const state = this.device.batteryState;
    const lowByState = state === 'LOW' || state === 'CRITICAL';
    const lowByPct = pct > 0 && pct < LOW_BATTERY_PCT;
    return (lowByState || lowByPct)
      ? Chr.StatusLowBattery.BATTERY_LEVEL_LOW
      : Chr.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  computeChargingState(): number {
    const Chr = this.platform.api.hap.Characteristic;
    switch (this.device.chargingState) {
      case 'CHARGING': return Chr.ChargingState.CHARGING;
      case 'NOT_CHARGING': return Chr.ChargingState.NOT_CHARGING;
      default: return Chr.ChargingState.NOT_CHARGEABLE;
    }
  }

  computeDesiccantChangeIndication(): number {
    const Chr = this.platform.api.hap.Characteristic;
    const days = this.device.remainingDesiccantDays;
    if (days === null) return Chr.FilterChangeIndication.FILTER_OK;
    return days <= 0
      ? Chr.FilterChangeIndication.CHANGE_FILTER
      : Chr.FilterChangeIndication.FILTER_OK;
  }

  computeDesiccantLifeLevel(): number {
    const cycle = Number(this.platform.config.desiccantCycleDays ?? DESICCANT_DEFAULT_DAYS);
    const safeCycle = Number.isFinite(cycle) && cycle > 0 ? cycle : DESICCANT_DEFAULT_DAYS;
    const days = this.device.remainingDesiccantDays ?? 0;
    const pct = Math.round((days / safeCycle) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  // ------------------------------------------------------------------
  // Feed detection
  // ------------------------------------------------------------------

  private detectRecentFeed(): void {
    if (!this.recentFeedService) return;
    const latest = this.device.lastFeedTimeMs;
    if (latest === null) return;
    if (this.lastObservedFeedMs !== null && latest <= this.lastObservedFeedMs) return;
    this.lastObservedFeedMs = latest;
    this.firePulseRecentFeed(`workRecord (${this.device.lastFeedQuantity} portion(s))`);
  }

  private firePulseRecentFeed(reason: string): void {
    if (!this.recentFeedService) return;
    const Chr = this.platform.api.hap.Characteristic;
    this.recentFeedService.updateCharacteristic(
      Chr.ContactSensorState, Chr.ContactSensorState.CONTACT_NOT_DETECTED);
    this.platform.log.debug(`${this.device.name}: recent feed pulse -- ${reason}`);
    if (this.recentFeedClearTimer) clearTimeout(this.recentFeedClearTimer);
    this.recentFeedClearTimer = setTimeout(() => {
      if (this.recentFeedService) {
        this.recentFeedService.updateCharacteristic(
          Chr.ContactSensorState, Chr.ContactSensorState.CONTACT_DETECTED);
      }
    }, RECENT_FEED_PULSE_MS);
  }

  // ------------------------------------------------------------------
  // Mutation handlers
  // ------------------------------------------------------------------

  private async runMutation(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.platform.boostPolling();
      this.debouncedRefresh();
    } catch (err) {
      this.platform.log.error(`${label} failed on ${this.device.name}:`, err);
      this.debouncedRefresh();
    }
  }

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
    this.platform.log.info(`Manual feed triggered on ${this.device.name}: ${portions} portion(s)`);
    try {
      const dispensed = await this.device.manualFeed(portions);
      this.firePulseRecentFeed(`manual feed (${dispensed} portion(s))`);
      this.platform.boostPolling();
    } catch (err) {
      this.platform.log.error(`Manual feed failed on ${this.device.name}:`, err);
    }
    this.scheduleFeedSwitchReset();
  }

  private scheduleFeedSwitchReset(): void {
    if (!this.feedNowService) return;
    if (this.feedResetTimer) clearTimeout(this.feedResetTimer);
    this.feedResetTimer = setTimeout(() => {
      if (this.feedNowService) {
        this.feedNowService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }
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
    if (!this.desiccantResetService) return;
    if (this.desiccantResetTimer) clearTimeout(this.desiccantResetTimer);
    this.desiccantResetTimer = setTimeout(() => {
      if (this.desiccantResetService) {
        this.desiccantResetService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }
    }, MOMENTARY_SWITCH_RESET_MS);
  }
}

type WithUUID<T> = T & { UUID: string };
