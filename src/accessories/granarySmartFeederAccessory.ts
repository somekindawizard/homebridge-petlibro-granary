import {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { GranarySmartFeeder } from '../devices';
import { PetLibroPlatform } from '../platform';

/**
 * HomeKit accessory for the Granary Smart Feeder.
 *
 * HomeKit has no native "pet feeder" service, so we compose several
 * standard services that map cleanly to Home app and also surface well
 * in the Eve app:
 *
 *   Battery                   — battery %, low-battery flag, charging state
 *   OccupancySensor "Food Low"      — occupied = food is low
 *   OccupancySensor "Dispenser"     — occupied = grain outlet is blocked
 *   FilterMaintenance               — desiccant life remaining
 *   ContactSensor "Recent Feed"     — contact-detected pulse when a new
 *                                     GRAIN_OUTPUT_SUCCESS event is observed
 *   Switch "Feed Now"               — momentary; dispenses configured portions
 *   Switch "Feeding Schedule"       — toggles the recurring feeding plan
 *   Switch "Indicator"              — turns the on-device LED on/off
 *   Switch "Child Lock"             — toggles hardware button lock
 *   Switch "Reset Desiccant"        — momentary; resets the desiccant counter
 *
 * Each Switch uses a stable subtype so Home.app keeps them distinct even
 * if the user renames them. The accessory polls via the platform; this
 * class only reads from / writes to the wrapped `GranarySmartFeeder`
 * device object.
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

  /** Timeout handle for auto-resetting the Feed Now switch back to off. */
  private feedResetTimer: NodeJS.Timeout | null = null;

  /** Timeout handle for auto-resetting the Desiccant Reset switch back to off. */
  private desiccantResetTimer: NodeJS.Timeout | null = null;

  /** Timeout handle for clearing the "recent feed" contact pulse. */
  private recentFeedClearTimer: NodeJS.Timeout | null = null;

  /** Last lastFeedTimeMs we surfaced to HomeKit, so we only pulse on change. */
  private lastObservedFeedMs: number | null = null;

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
    // The Granary is mains-powered with optional D-cell battery backup. We
    // report the electricQuantity percentage plus a proper ChargingState
    // derived from the API's powerState field (CHARGED/CHARGING/USING).
    // Low-battery uses BOTH the device-reported batteryState string AND a
    // <20% percentage threshold as a belt-and-suspenders fallback.
    this.batteryService =
      this.accessory.getService(Service.Battery)
      ?? this.accessory.addService(Service.Battery, `${device.name} Battery`);
    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .onGet(() => this.device.batteryPercent);
    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(() => this.computeLowBattery());
    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(() => this.computeChargingState());

    // ---- Food Low indicator (as Occupancy Sensor) ----
    // We use OccupancySensor because Home.app displays it prominently and
    // supports triggering automations. "Occupied" = food is low.
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

    // ---- Dispenser blockage warning (as Occupancy Sensor) ----
    // "Occupied" = the grain outlet is in its problem state (blocked/jammed).
    // Useful for automations like "notify me when the feeder is jammed."
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

    // ---- Desiccant life (as FilterMaintenance) ----
    // HomeKit's FilterMaintenance service shows a maintenance icon when
    // `FilterChangeIndication = CHANGE_FILTER`. We trigger that when days
    // remaining drops to 0 or below, matching the on-device warning.
    // `FilterLifeLevel` is a 0-100 percentage — we derive it from days
    // remaining against the desiccant_frequency default of 30 days.
    this.desiccantMaintenanceService =
      this.accessory.getServiceById(Service.FilterMaintenance, 'desiccant')
      ?? this.accessory.addService(Service.FilterMaintenance, `${device.name} Desiccant`, 'desiccant');
    this.desiccantMaintenanceService
      .getCharacteristic(Characteristic.FilterChangeIndication)
      .onGet(() => this.computeDesiccantChangeIndication());
    this.desiccantMaintenanceService
      .getCharacteristic(Characteristic.FilterLifeLevel)
      .onGet(() => this.computeDesiccantLifeLevel());

    // ---- Recent Feed pulse (as Contact Sensor) ----
    // Flips to CONTACT_NOT_DETECTED ("open") for 30 seconds whenever a new
    // GRAIN_OUTPUT_SUCCESS event is observed via polling. Lets you build
    // automations like "when a feed happens, send a notification" or
    // "log pet eating activity."
    this.recentFeedService =
      this.accessory.getServiceById(Service.ContactSensor, 'recent-feed')
      ?? this.accessory.addService(Service.ContactSensor, `${device.name} Recent Feed`, 'recent-feed');
    this.recentFeedService
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() => Characteristic.ContactSensorState.CONTACT_DETECTED);
    // Seed the "last seen" marker so the first poll after startup doesn't
    // spuriously pulse for an old recorded feed.
    this.lastObservedFeedMs = this.device.lastFeedTimeMs;

    // ---- Manual Feed (momentary Switch) ----
    // Dispenses the configured portion count when toggled on. If the
    // device is offline or in its configured sleep window, the feed
    // command is skipped entirely with a warning log — since HomeKit's
    // Switch service doesn't support StatusActive, we gate the action
    // in the handler rather than showing visual inactive state.
    this.feedNowService =
      this.accessory.getServiceById(Service.Switch, 'feed-now')
      ?? this.accessory.addService(Service.Switch, `${device.name} Feed Now`, 'feed-now');
    this.feedNowService
      .getCharacteristic(Characteristic.On)
      .onGet(() => false) // momentary — always reads off
      .onSet(async (value: CharacteristicValue) => this.handleFeedNow(Boolean(value)));

    // ---- Feeding Schedule toggle ----
    this.feedingPlanService =
      this.accessory.getServiceById(Service.Switch, 'feeding-plan')
      ?? this.accessory.addService(Service.Switch, `${device.name} Feeding Schedule`, 'feeding-plan');
    this.feedingPlanService
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.device.feedingPlanEnabled)
      .onSet(async (value: CharacteristicValue) => {
        try {
          await this.device.setFeedingPlan(Boolean(value));
          this.refreshCharacteristics();
        } catch (err) {
          this.platform.log.error(
            `Feeding Schedule toggle failed on ${this.device.name}:`, err,
          );
          // Swallow the error so HomeKit doesn't log a second, noisier
          // "threw an error from the characteristic" warning. The switch
          // state will self-correct on the next poll.
        }
      });

    // ---- Indicator light toggle ----
    this.indicatorService =
      this.accessory.getServiceById(Service.Switch, 'indicator')
      ?? this.accessory.addService(Service.Switch, `${device.name} Indicator`, 'indicator');
    this.indicatorService
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.device.indicatorLightOn)
      .onSet(async (value: CharacteristicValue) => {
        try {
          await this.device.setIndicatorLight(Boolean(value));
          this.refreshCharacteristics();
        } catch (err) {
          this.platform.log.error(
            `Indicator toggle failed on ${this.device.name}:`, err,
          );
        }
      });

    // ---- Child Lock toggle ----
    this.childLockService =
      this.accessory.getServiceById(Service.Switch, 'child-lock')
      ?? this.accessory.addService(Service.Switch, `${device.name} Child Lock`, 'child-lock');
    this.childLockService
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.device.childLockOn)
      .onSet(async (value: CharacteristicValue) => {
        try {
          await this.device.setChildLock(Boolean(value));
          this.refreshCharacteristics();
        } catch (err) {
          this.platform.log.error(
            `Child Lock toggle failed on ${this.device.name}:`, err,
          );
        }
      });

    // ---- Desiccant Reset (momentary Switch) ----
    // Mirrors the HA integration's "Reset Desiccant" button. Tells the
    // feeder you've replaced the desiccant pack so its remainingDesiccantDays
    // counter resets. Like Feed Now, this is a momentary switch — fires the
    // API call on `on`, then auto-reverts after 1s.
    this.desiccantResetService =
      this.accessory.getServiceById(Service.Switch, 'desiccant-reset')
      ?? this.accessory.addService(Service.Switch, `${device.name} Reset Desiccant`, 'desiccant-reset');
    this.desiccantResetService
      .getCharacteristic(Characteristic.On)
      .onGet(() => false) // momentary — always reads off
      .onSet(async (value: CharacteristicValue) => this.handleDesiccantReset(Boolean(value)));
  }

  /** Called by the platform after each polling cycle to push fresh state. */
  refreshCharacteristics(): void {
    const Characteristic = this.platform.api.hap.Characteristic;

    // Battery
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

    // Food Low
    this.foodLowService.updateCharacteristic(
      Characteristic.OccupancyDetected,
      this.device.foodLow
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    this.foodLowService.updateCharacteristic(
      Characteristic.StatusActive,
      this.device.online,
    );

    // Dispenser blockage
    this.dispenserService.updateCharacteristic(
      Characteristic.OccupancyDetected,
      this.device.foodDispenserProblem
        ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
    this.dispenserService.updateCharacteristic(
      Characteristic.StatusActive,
      this.device.online,
    );

    // Desiccant maintenance
    this.desiccantMaintenanceService.updateCharacteristic(
      Characteristic.FilterChangeIndication,
      this.computeDesiccantChangeIndication(),
    );
    this.desiccantMaintenanceService.updateCharacteristic(
      Characteristic.FilterLifeLevel,
      this.computeDesiccantLifeLevel(),
    );

    // Switches
    this.feedingPlanService.updateCharacteristic(
      Characteristic.On,
      this.device.feedingPlanEnabled,
    );
    this.indicatorService.updateCharacteristic(
      Characteristic.On,
      this.device.indicatorLightOn,
    );
    this.childLockService.updateCharacteristic(
      Characteristic.On,
      this.device.childLockOn,
    );

    // Recent feed pulse — detect a new GRAIN_OUTPUT_SUCCESS since last poll.
    this.detectRecentFeed();
  }

  // ------------------------------------------------------------------
  // Compute helpers — keep construction clean and behavior testable.
  // ------------------------------------------------------------------

  /**
   * StatusLowBattery value. Uses both the device-reported batteryState
   * string ("LOW" / "NORMAL") AND a <20% percentage fallback.
   *
   * Important: the Granary is AC-powered with *optional* D-cell battery
   * backup. When no batteries are inserted the API returns battery percent
   * as 0 and batteryState as "NONE" / empty — we must NOT flag that as
   * "low battery" because there's no battery to be low. We detect the
   * no-battery case via the chargingState resolving to NOT_CHARGEABLE.
   */
  private computeLowBattery(): number {
    const Characteristic = this.platform.api.hap.Characteristic;

    // If the feeder has no batteries installed, the concept of "low"
    // doesn't apply — always report NORMAL so HomeKit doesn't show the
    // orange "low battery" warning for a device running happily on AC.
    if (this.device.chargingState === 'NOT_CHARGEABLE') {
      return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }

    const pct = this.device.batteryPercent;
    const state = this.device.batteryState;
    const lowByState = state === 'LOW' || state === 'CRITICAL';
    const lowByPct = pct > 0 && pct < 20;
    return (lowByState || lowByPct)
      ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  /**
   * Map the device's chargingState enum to HomeKit's ChargingState value.
   */
  private computeChargingState(): number {
    const Characteristic = this.platform.api.hap.Characteristic;
    switch (this.device.chargingState) {
      case 'CHARGING': return Characteristic.ChargingState.CHARGING;
      case 'NOT_CHARGING': return Characteristic.ChargingState.NOT_CHARGING;
      default: return Characteristic.ChargingState.NOT_CHARGEABLE;
    }
  }

  /**
   * Trigger HomeKit's filter-change indicator when the desiccant counter
   * hits zero or the value is unknown-but-reported-as-zero. A `null`
   * (unknown) value is treated as FILTER_OK to avoid false alarms when
   * the device hasn't reported a value yet.
   */
  private computeDesiccantChangeIndication(): number {
    const Characteristic = this.platform.api.hap.Characteristic;
    const days = this.device.remainingDesiccantDays;
    if (days === null) return Characteristic.FilterChangeIndication.FILTER_OK;
    return days <= 0
      ? Characteristic.FilterChangeIndication.CHANGE_FILTER
      : Characteristic.FilterChangeIndication.FILTER_OK;
  }

  /**
   * 0-100 desiccant "life" percentage. Upstream uses a default desiccant
   * frequency of 30 days for the Granary — we normalize against that.
   * Clamped to [0, 100] since the device can report weird transient values
   * after a reset.
   */
  private computeDesiccantLifeLevel(): number {
    const days = this.device.remainingDesiccantDays ?? 0;
    const pct = Math.round((days / 30) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  /**
   * If a fresher GRAIN_OUTPUT_SUCCESS timestamp appeared since last poll,
   * briefly flip the ContactSensor to CONTACT_NOT_DETECTED (open). This
   * gives HomeKit a rising-edge event that automations can trigger on.
   */
  private detectRecentFeed(): void {
    const Characteristic = this.platform.api.hap.Characteristic;
    const latest = this.device.lastFeedTimeMs;
    if (latest === null) return;
    if (this.lastObservedFeedMs !== null && latest <= this.lastObservedFeedMs) {
      return;
    }
    this.lastObservedFeedMs = latest;

    this.recentFeedService.updateCharacteristic(
      Characteristic.ContactSensorState,
      Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
    );
    this.platform.log.debug(
      `${this.device.name}: recent feed pulse (${this.device.lastFeedQuantity} portion(s))`,
    );

    if (this.recentFeedClearTimer) clearTimeout(this.recentFeedClearTimer);
    this.recentFeedClearTimer = setTimeout(() => {
      this.recentFeedService.updateCharacteristic(
        Characteristic.ContactSensorState,
        Characteristic.ContactSensorState.CONTACT_DETECTED,
      );
    }, 30_000);
  }

  /**
   * Momentary-switch handler for the Feed Now control. HomeKit switches
   * are stateful by default, so we fire the API call on `on`, then
   * auto-revert the switch to off after 1s to give the visual pulse.
   *
   * Before firing, we check the device is online and not in sleep mode.
   * If either fails, we log a warning and silently revert the switch —
   * swallowing the HomeKit 'threw from characteristic' warning that
   * would otherwise appear. The switch can't physically dispense food
   * when offline/asleep, so failing fast is better than a cryptic error.
   */
  private async handleFeedNow(requested: boolean): Promise<void> {
    if (!requested) {
      return; // ignore explicit off
    }

    // Short-circuit if the device can't act on the command right now.
    if (!this.device.online) {
      this.platform.log.warn(
        `Manual feed skipped: ${this.device.name} is offline.`,
      );
      this.scheduleFeedSwitchReset();
      return;
    }
    if (this.device.inSleepMode) {
      this.platform.log.warn(
        `Manual feed skipped: ${this.device.name} is in sleep mode.`,
      );
      this.scheduleFeedSwitchReset();
      return;
    }

    const portions = this.platform.config.manualFeedPortions ?? 2;
    this.platform.log.info(`Manual feed triggered on ${this.device.name}: ${portions} portion(s)`);

    try {
      await this.device.manualFeed(portions);
    } catch (err) {
      this.platform.log.error(`Manual feed failed on ${this.device.name}:`, err);
    }

    this.scheduleFeedSwitchReset();
  }

  /** Bounce the Feed Now switch back to off after 1s. */
  private scheduleFeedSwitchReset(): void {
    if (this.feedResetTimer) clearTimeout(this.feedResetTimer);
    this.feedResetTimer = setTimeout(() => {
      this.feedNowService.updateCharacteristic(
        this.platform.api.hap.Characteristic.On,
        false,
      );
    }, 1000);
  }

  /**
   * Momentary-switch handler for the Reset Desiccant control. Same shape
   * as Feed Now: fire on `on`, ignore explicit `off`, auto-revert after 1s.
   */
  private async handleDesiccantReset(requested: boolean): Promise<void> {
    if (!requested) {
      return; // ignore explicit off
    }

    this.platform.log.info(`Desiccant reset triggered on ${this.device.name}`);

    try {
      await this.device.resetDesiccant();
    } catch (err) {
      this.platform.log.error(`Desiccant reset failed on ${this.device.name}:`, err);
    }

    if (this.desiccantResetTimer) clearTimeout(this.desiccantResetTimer);
    this.desiccantResetTimer = setTimeout(() => {
      this.desiccantResetService.updateCharacteristic(
        this.platform.api.hap.Characteristic.On,
        false,
      );
    }, 1000);
  }
}
