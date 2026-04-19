import {
  CharacteristicValue,
  PlatformAccessory,
  Service,
  WithUUID,
} from 'homebridge';

import { GranarySmartFeeder } from '../devices';
import { PetLibroPlatform } from '../platform';
import {
  DESICCANT_DEFAULT_DAYS,
  LOW_BATTERY_PCT,
  MOMENTARY_SWITCH_RESET_MS,
  PetLibroUiConfig,
  RECENT_FEED_PULSE_MS,
  resolveUiConfig,
} from '../settings';

/**
 * HomeKit accessory for the Granary Smart Feeder.
 *
 * Service mapping:
 *
 *   Battery                — battery %, low-battery flag, charging state
 *   OccupancySensor        — Food Low (occupied = food is low)
 *   OccupancySensor        — Dispenser Jam (occupied = grain outlet blocked)
 *   FilterMaintenance      — Desiccant life remaining
 *   ContactSensor          — Recent Feed pulse (open = a feed just happened)
 *   Switch                 — Feed Now (momentary, auto-reverts)
 *   Switch (Primary)       — Feeding Schedule (stateful enable/disable)
 *   Lightbulb              — Indicator Light (renders as a light, not a generic toggle)
 *   LockMechanism          — Child Lock (renders as a lock, supports Siri lock verbs)
 *   Switch                 — Reset Desiccant (momentary, hidden by default)
 *
 * Each non-info service uses a stable subtype so Home.app keeps them
 * distinct across renames. Service exposure is configurable via
 * `ui.expose*` flags; orphaned services from previous versions or
 * disabled-by-config services are pruned on startup.
 */

/** Keys identifying every optional service we manage. */
type ManagedServiceKey =
  | 'battery'
  | 'food-low'
  | 'dispenser-problem'
  | 'desiccant'
  | 'recent-feed'
  | 'feed-now'
  | 'feeding-plan'
  | 'indicator-light'
  | 'child-lock-mechanism'
  | 'desiccant-reset'
  // Legacy subtypes from <0.5.0 that we now migrate away from.
  | 'indicator'
  | 'child-lock';

export class GranarySmartFeederAccessory {
  private batteryService?: Service;
  private foodLowService?: Service;
  private dispenserService?: Service;
  private desiccantMaintenanceService?: Service;
  private recentFeedService?: Service;
  private feedNowService?: Service;
  private feedingPlanService?: Service;
  private indicatorService?: Service;
  private childLockService?: Service;
  private desiccantResetService?: Service;

  private feedResetTimer: NodeJS.Timeout | null = null;
  private desiccantResetTimer: NodeJS.Timeout | null = null;
  private recentFeedClearTimer: NodeJS.Timeout | null = null;

  private lastObservedFeedMs: number | null = null;

  private readonly ui: Required<PetLibroUiConfig>;

  constructor(
    private readonly platform: PetLibroPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: GranarySmartFeeder,
  ) {
    const Service = this.platform.api.hap.Service;
    const Characteristic = this.platform.api.hap.Characteristic;

    this.ui = resolveUiConfig(this.platform.config.ui as PetLibroUiConfig | undefined);

    // ---- AccessoryInformation (always present) ----
    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'PETLIBRO')
      .setCharacteristic(Characteristic.Model, device.model)
      .setCharacteristic(Characteristic.SerialNumber, device.serial)
      .setCharacteristic(Characteristic.FirmwareRevision, device.softwareVersion);

    // ---- Migrate legacy services from <0.5.0 ----
    // Indicator was a Switch; it's now a Lightbulb with a different subtype.
    // Child Lock was a Switch; it's now a LockMechanism with a different subtype.
    // Removing the legacy services here means upgrades don't leave dead tiles.
    this.removeServiceIfPresent(Service.Switch, 'indicator');
    this.removeServiceIfPresent(Service.Switch, 'child-lock');

    // ---- Battery ----
    if (this.ui.exposeBattery) {
      this.batteryService = this.accessory.getService(Service.Battery)
        ?? this.accessory.addService(Service.Battery, this.label('Battery', '🪫'));
      this.batteryService
        .getCharacteristic(Characteristic.BatteryLevel)
        .onGet(() => this.device.batteryPercent);
      this.batteryService
        .getCharacteristic(Characteristic.StatusLowBattery)
        .onGet(() => this.computeLowBattery());
      this.batteryService
        .getCharacteristic(Characteristic.ChargingState)
        .onGet(() => this.computeChargingState());
    } else {
      this.removeServiceIfPresent(Service.Battery);
    }

    // ---- Food Low (Occupancy Sensor) ----
    if (this.ui.exposeFoodLow) {
      this.foodLowService = this.accessory.getServiceById(Service.OccupancySensor, 'food-low')
        ?? this.accessory.addService(Service.OccupancySensor, this.label('Food Low', '🥣'), 'food-low');
      this.foodLowService
        .getCharacteristic(Characteristic.OccupancyDetected)
        .onGet(() => this.boolToOccupancy(this.device.foodLow));
      this.foodLowService
        .getCharacteristic(Characteristic.StatusActive)
        .onGet(() => this.device.online);
    } else {
      this.removeServiceIfPresent(Service.OccupancySensor, 'food-low');
    }

    // ---- Dispenser Jam (Occupancy Sensor) ----
    if (this.ui.exposeDispenser) {
      this.dispenserService = this.accessory.getServiceById(Service.OccupancySensor, 'dispenser-problem')
        ?? this.accessory.addService(Service.OccupancySensor, this.label('Dispenser Jam', '⚠️'), 'dispenser-problem');
      this.dispenserService
        .getCharacteristic(Characteristic.OccupancyDetected)
        .onGet(() => this.boolToOccupancy(this.device.foodDispenserProblem));
      this.dispenserService
        .getCharacteristic(Characteristic.StatusActive)
        .onGet(() => this.device.online);
    } else {
      this.removeServiceIfPresent(Service.OccupancySensor, 'dispenser-problem');
    }

    // ---- Desiccant (Filter Maintenance) ----
    if (this.ui.exposeDesiccant) {
      this.desiccantMaintenanceService = this.accessory.getServiceById(Service.FilterMaintenance, 'desiccant')
        ?? this.accessory.addService(Service.FilterMaintenance, this.label('Desiccant', '🧂'), 'desiccant');
      this.desiccantMaintenanceService
        .getCharacteristic(Characteristic.FilterChangeIndication)
        .onGet(() => this.computeDesiccantChangeIndication());
      this.desiccantMaintenanceService
        .getCharacteristic(Characteristic.FilterLifeLevel)
        .onGet(() => this.computeDesiccantLifeLevel());
    } else {
      this.removeServiceIfPresent(Service.FilterMaintenance, 'desiccant');
    }

    // ---- Recent Feed (Contact Sensor) ----
    if (this.ui.exposeRecentFeed) {
      this.recentFeedService = this.accessory.getServiceById(Service.ContactSensor, 'recent-feed')
        ?? this.accessory.addService(Service.ContactSensor, this.label('Recent Feed', '🐾'), 'recent-feed');
      this.recentFeedService
        .getCharacteristic(Characteristic.ContactSensorState)
        .onGet(() => Characteristic.ContactSensorState.CONTACT_DETECTED);
      this.lastObservedFeedMs = this.device.lastFeedTimeMs;
    } else {
      this.removeServiceIfPresent(Service.ContactSensor, 'recent-feed');
    }

    // ---- Feed Now (momentary Switch) ----
    if (this.ui.exposeFeedNow) {
      this.feedNowService = this.accessory.getServiceById(Service.Switch, 'feed-now')
        ?? this.accessory.addService(Service.Switch, this.label('Feed Now', '🍽️'), 'feed-now');
      this.feedNowService
        .getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet((value: CharacteristicValue) => {
          void this.handleFeedNow(Boolean(value));
        });
    } else {
      this.removeServiceIfPresent(Service.Switch, 'feed-now');
    }

    // ---- Feeding Schedule (Switch, marked Primary) ----
    if (this.ui.exposeFeedingSchedule) {
      this.feedingPlanService = this.accessory.getServiceById(Service.Switch, 'feeding-plan')
        ?? this.accessory.addService(Service.Switch, this.label('Feeding Schedule', '📅'), 'feeding-plan');
      this.feedingPlanService.setPrimaryService(true);
      this.feedingPlanService
        .getCharacteristic(Characteristic.On)
        .onGet(() => this.device.feedingPlanEnabled)
        .onSet((value: CharacteristicValue) => {
          void this.runMutation(
            'Feeding Schedule',
            () => this.device.setFeedingPlan(Boolean(value)),
          );
        });
    } else {
      this.removeServiceIfPresent(Service.Switch, 'feeding-plan');
    }

    // ---- Indicator Light (Lightbulb — semantic upgrade from Switch) ----
    if (this.ui.exposeIndicator) {
      this.indicatorService = this.accessory.getServiceById(Service.Lightbulb, 'indicator-light')
        ?? this.accessory.addService(Service.Lightbulb, this.label('Indicator', '💡'), 'indicator-light');
      this.indicatorService
        .getCharacteristic(Characteristic.On)
        .onGet(() => this.device.indicatorLightOn)
        .onSet((value: CharacteristicValue) => {
          void this.runMutation(
            'Indicator',
            () => this.device.setIndicatorLight(Boolean(value)),
          );
        });
    } else {
      this.removeServiceIfPresent(Service.Lightbulb, 'indicator-light');
    }

    // ---- Child Lock (LockMechanism — semantic upgrade from Switch) ----
    if (this.ui.exposeChildLock) {
      this.childLockService = this.accessory.getServiceById(Service.LockMechanism, 'child-lock-mechanism')
        ?? this.accessory.addService(Service.LockMechanism, this.label('Child Lock', '🔒'), 'child-lock-mechanism');
      this.childLockService
        .getCharacteristic(Characteristic.LockCurrentState)
        .onGet(() => this.computeLockCurrentState());
      this.childLockService
        .getCharacteristic(Characteristic.LockTargetState)
        .onGet(() => this.computeLockTargetState())
        .onSet((value: CharacteristicValue) => {
          const lock = Number(value) === Characteristic.LockTargetState.SECURED;
          void this.runMutation(
            'Child Lock',
            async () => {
              await this.device.setChildLock(lock);
              // Optimistic LockCurrentState update so Home.app shows the
              // mechanical state matching the target without a poll wait.
              this.childLockService?.updateCharacteristic(
                Characteristic.LockCurrentState,
                lock
                  ? Characteristic.LockCurrentState.SECURED
                  : Characteristic.LockCurrentState.UNSECURED,
              );
            },
          );
        });
    } else {
      this.removeServiceIfPresent(Service.LockMechanism, 'child-lock-mechanism');
    }

    // ---- Reset Desiccant (momentary Switch, hidden by default) ----
    if (this.ui.exposeResetDesiccant) {
      this.desiccantResetService = this.accessory.getServiceById(Service.Switch, 'desiccant-reset')
        ?? this.accessory.addService(Service.Switch, this.label('Reset Desiccant', '🧂'), 'desiccant-reset');
      this.desiccantResetService
        .getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet((value: CharacteristicValue) => {
          void this.handleDesiccantReset(Boolean(value));
        });
    } else {
      this.removeServiceIfPresent(Service.Switch, 'desiccant-reset');
    }
  }

  /** Called by the platform after each polling cycle to push fresh state. */
  refreshCharacteristics(): void {
    const Characteristic = this.platform.api.hap.Characteristic;

    if (this.batteryService) {
      this.batteryService.updateCharacteristic(
        Characteristic.BatteryLevel,
        this.device.batteryPercent,
      );
      this.batteryService.updateCharacteristic(
        Characteristic.StatusLowBattery,
        this.computeLowBattery(),
      );
      this.batteryService.updateCharacteristic(
        Characteristic.ChargingState,
        this.computeChargingState(),
      );
    }

    if (this.foodLowService) {
      this.foodLowService.updateCharacteristic(
        Characteristic.OccupancyDetected,
        this.boolToOccupancy(this.device.foodLow),
      );
      this.foodLowService.updateCharacteristic(
        Characteristic.StatusActive,
        this.device.online,
      );
    }

    if (this.dispenserService) {
      this.dispenserService.updateCharacteristic(
        Characteristic.OccupancyDetected,
        this.boolToOccupancy(this.device.foodDispenserProblem),
      );
      this.dispenserService.updateCharacteristic(
        Characteristic.StatusActive,
        this.device.online,
      );
    }

    if (this.desiccantMaintenanceService) {
      this.desiccantMaintenanceService.updateCharacteristic(
        Characteristic.FilterChangeIndication,
        this.computeDesiccantChangeIndication(),
      );
      this.desiccantMaintenanceService.updateCharacteristic(
        Characteristic.FilterLifeLevel,
        this.computeDesiccantLifeLevel(),
      );
    }

    this.feedingPlanService?.updateCharacteristic(
      Characteristic.On,
      this.device.feedingPlanEnabled,
    );
    this.indicatorService?.updateCharacteristic(
      Characteristic.On,
      this.device.indicatorLightOn,
    );

    if (this.childLockService) {
      this.childLockService.updateCharacteristic(
        Characteristic.LockCurrentState,
        this.computeLockCurrentState(),
      );
      this.childLockService.updateCharacteristic(
        Characteristic.LockTargetState,
        this.computeLockTargetState(),
      );
    }

    this.detectRecentFeed();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Build a default service name. If emoji are enabled (default), prefix
   * with the supplied emoji for at-a-glance scanning in Home.app.
   * The user can always rename and the rename will stick — Homebridge
   * preserves the user's chosen name.
   */
  private label(base: string, emoji: string): string {
    const prefix = this.ui.useEmojiNames ? `${emoji} ` : '';
    return `${this.device.name} ${prefix}${base}`.trim();
  }

  private boolToOccupancy(b: boolean): number {
    const C = this.platform.api.hap.Characteristic;
    return b
      ? C.OccupancyDetected.OCCUPANCY_DETECTED
      : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
  }

  /**
   * Remove a service if currently present on the accessory. Used both
   * for user-disabled services and for migrating away from legacy
   * service types (where the service UUID itself changed between versions).
   */
  private removeServiceIfPresent(
    serviceCtor: WithUUID<typeof Service>,
    subtype?: string,
  ): void {
    const existing = subtype
      ? this.accessory.getServiceById(serviceCtor, subtype)
      : this.accessory.getService(serviceCtor);
    if (existing) {
      this.accessory.removeService(existing);
      this.platform.log.debug(
        `Removed ${subtype ? `${subtype} ` : ''}service from ${this.device.name}.`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Compute helpers — pure functions of device state
  // ------------------------------------------------------------------

  private computeLowBattery(): number {
    const C = this.platform.api.hap.Characteristic;
    if (this.device.chargingState === 'NOT_CHARGEABLE') {
      return C.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
    const pct = this.device.batteryPercent;
    const state = this.device.batteryState;
    const lowByState = state === 'LOW' || state === 'CRITICAL';
    const lowByPct = pct > 0 && pct < LOW_BATTERY_PCT;
    return (lowByState || lowByPct)
      ? C.StatusLowBattery.BATTERY_LEVEL_LOW
      : C.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  private computeChargingState(): number {
    const C = this.platform.api.hap.Characteristic;
    switch (this.device.chargingState) {
      case 'CHARGING': return C.ChargingState.CHARGING;
      case 'NOT_CHARGING': return C.ChargingState.NOT_CHARGING;
      default: return C.ChargingState.NOT_CHARGEABLE;
    }
  }

  private computeDesiccantChangeIndication(): number {
    const C = this.platform.api.hap.Characteristic;
    const days = this.device.remainingDesiccantDays;
    if (days === null) return C.FilterChangeIndication.FILTER_OK;
    return days <= 0
      ? C.FilterChangeIndication.CHANGE_FILTER
      : C.FilterChangeIndication.FILTER_OK;
  }

  private computeDesiccantLifeLevel(): number {
    const days = this.device.remainingDesiccantDays ?? 0;
    const cycle = this.platform.config.desiccantCycleDays ?? DESICCANT_DEFAULT_DAYS;
    const pct = Math.round((days / cycle) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  private computeLockCurrentState(): number {
    const C = this.platform.api.hap.Characteristic;
    return this.device.childLockOn
      ? C.LockCurrentState.SECURED
      : C.LockCurrentState.UNSECURED;
  }

  private computeLockTargetState(): number {
    const C = this.platform.api.hap.Characteristic;
    return this.device.childLockOn
      ? C.LockTargetState.SECURED
      : C.LockTargetState.UNSECURED;
  }

  // ------------------------------------------------------------------
  // Recent-feed pulse
  // ------------------------------------------------------------------

  private detectRecentFeed(): void {
    if (!this.recentFeedService) return;
    const C = this.platform.api.hap.Characteristic;
    const latest = this.device.lastFeedTimeMs;
    if (latest === null) return;
    if (this.lastObservedFeedMs !== null && latest <= this.lastObservedFeedMs) {
      return;
    }
    this.pulseRecentFeed(latest, this.device.lastFeedQuantity);
  }

  /**
   * Briefly open the Recent Feed contact sensor. Public so the manual-feed
   * handler can fire it immediately on a successful local feed instead of
   * waiting up to 60s for workRecord polling to surface the event.
   */
  pulseRecentFeed(timestampMs: number, portions: number): void {
    if (!this.recentFeedService) return;
    const C = this.platform.api.hap.Characteristic;
    this.lastObservedFeedMs = timestampMs;

    this.recentFeedService.updateCharacteristic(
      C.ContactSensorState,
      C.ContactSensorState.CONTACT_NOT_DETECTED,
    );
    this.platform.log.debug(
      `${this.device.name}: recent feed pulse (${portions} portion(s))`,
    );

    if (this.recentFeedClearTimer) clearTimeout(this.recentFeedClearTimer);
    this.recentFeedClearTimer = setTimeout(() => {
      this.recentFeedService?.updateCharacteristic(
        C.ContactSensorState,
        C.ContactSensorState.CONTACT_DETECTED,
      );
    }, RECENT_FEED_PULSE_MS);
  }

  // ------------------------------------------------------------------
  // Mutation handlers
  // ------------------------------------------------------------------

  /**
   * Wrap any mutation: log it, run it, ask the platform to boost polling
   * so the UI catches up quickly, and refresh characteristics from the
   * (optimistic) device state. Errors are swallowed-but-logged so HomeKit
   * doesn't show "threw from characteristic" warnings; state self-corrects
   * on the next poll.
   */
  private async runMutation(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.platform.boostPolling();
      this.refreshCharacteristics();
    } catch (err) {
      this.platform.log.error(`${label} change failed on ${this.device.name}:`, err);
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
    this.platform.log.info(
      `Manual feed triggered on ${this.device.name}: ${portions} portion(s)`,
    );

    try {
      const dispensed = await this.device.manualFeed(portions);
      // Pulse the Recent Feed sensor immediately — we know a feed just
      // happened, no need to wait for the next workRecord poll.
      this.pulseRecentFeed(Date.now(), dispensed);
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
      this.feedNowService?.updateCharacteristic(
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
      this.desiccantResetService?.updateCharacteristic(
        this.platform.api.hap.Characteristic.On,
        false,
      );
    }, MOMENTARY_SWITCH_RESET_MS);
  }
}
