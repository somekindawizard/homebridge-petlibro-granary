import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from 'homebridge';
import { GranarySmartFeederAccessory } from '../accessories/granarySmartFeederAccessory';
import { GranarySmartFeeder } from '../devices/feeders/granarySmartFeeder';
import { PetLibroAPI, RawDevice } from '../api';
import { PetLibroPlatform } from '../platform';

// ---------------------------------------------------------------------------
// Stubs / mocks
// ---------------------------------------------------------------------------

const stubLog: Logger = {
  prefix: 'test',
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
} as unknown as Logger;

/** Create a mock HAP Characteristic that supports onGet/onSet chaining. */
function mockCharacteristic() {
  const c: Record<string, unknown> = {};
  c.onGet = vi.fn().mockReturnValue(c);
  c.onSet = vi.fn().mockReturnValue(c);
  return c;
}

/** Create a mock HAP Service with getCharacteristic/updateCharacteristic. */
function mockService() {
  return {
    getCharacteristic: vi.fn().mockReturnValue(mockCharacteristic()),
    updateCharacteristic: vi.fn().mockReturnThis(),
    setCharacteristic: vi.fn().mockReturnThis(),
  };
}

/** HAP constants matching the real values from hap-nodejs. */
const hapCharacteristic = {
  BatteryLevel: 'BatteryLevel',
  StatusLowBattery: Object.assign('StatusLowBattery', {
    BATTERY_LEVEL_NORMAL: 0,
    BATTERY_LEVEL_LOW: 1,
  }),
  ChargingState: Object.assign('ChargingState', {
    NOT_CHARGING: 0,
    CHARGING: 1,
    NOT_CHARGEABLE: 2,
  }),
  FilterChangeIndication: Object.assign('FilterChangeIndication', {
    FILTER_OK: 0,
    CHANGE_FILTER: 1,
  }),
  FilterLifeLevel: 'FilterLifeLevel',
  ContactSensorState: Object.assign('ContactSensorState', {
    CONTACT_DETECTED: 0,
    CONTACT_NOT_DETECTED: 1,
  }),
  OccupancyDetected: Object.assign('OccupancyDetected', {
    OCCUPANCY_NOT_DETECTED: 0,
    OCCUPANCY_DETECTED: 1,
  }),
  On: 'On',
  StatusActive: 'StatusActive',
  Manufacturer: 'Manufacturer',
  Model: 'Model',
  SerialNumber: 'SerialNumber',
  FirmwareRevision: 'FirmwareRevision',
};

const hapService = {
  AccessoryInformation: 'AccessoryInformation',
  Battery: 'Battery',
  OccupancySensor: 'OccupancySensor',
  FilterMaintenance: 'FilterMaintenance',
  ContactSensor: 'ContactSensor',
  Switch: 'Switch',
};

function createMockPlatform(configOverrides: Record<string, unknown> = {}) {
  return {
    log: stubLog,
    config: {
      platform: 'PetLibro',
      email: 'test@example.com',
      password: 'test',
      region: 'US',
      ...configOverrides,
    },
    api: {
      hap: {
        Service: hapService,
        Characteristic: hapCharacteristic,
      },
    },
    boostPolling: vi.fn(),
  } as unknown as PetLibroPlatform;
}

function createMockAccessory() {
  const infoService = mockService();

  return {
    getService: vi.fn().mockImplementation((type: string) => {
      if (type === 'AccessoryInformation') return infoService;
      if (type === 'Battery') return null;
      return null;
    }),
    getServiceById: vi.fn().mockReturnValue(null),
    addService: vi.fn().mockImplementation(() => mockService()),
    removeService: vi.fn(),
    context: {} as Record<string, unknown>,
    displayName: 'Test Feeder',
  };
}

function makeFeeder(overrides: Partial<RawDevice> = {}): GranarySmartFeeder {
  const api = {} as PetLibroAPI;
  const raw: RawDevice = {
    deviceSn: 'SN123',
    productIdentifier: 'PLAF103',
    productName: 'Granary Smart Feeder',
    name: 'Test Feeder',
    enableFeedingPlan: false,
    ...overrides,
  };
  return new GranarySmartFeeder(raw, api, stubLog);
}

function createAccessoryHandler(
  deviceOverrides: Partial<RawDevice> = {},
  configOverrides: Record<string, unknown> = {},
): GranarySmartFeederAccessory {
  const platform = createMockPlatform(configOverrides);
  const accessory = createMockAccessory();
  const device = makeFeeder(deviceOverrides);
  return new GranarySmartFeederAccessory(
    platform,
    accessory as never,
    device,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GranarySmartFeederAccessory', () => {
  describe('computeLowBattery', () => {
    it('returns NORMAL when chargingState is NOT_CHARGEABLE (no battery installed)', () => {
      const handler = createAccessoryHandler();
      // Default: electricQuantity=0, no powerState => NOT_CHARGEABLE
      expect(handler.computeLowBattery()).toBe(0); // BATTERY_LEVEL_NORMAL
    });

    it('returns LOW when battery percent is below threshold', () => {
      const handler = createAccessoryHandler();
      // Set battery to 15% with a valid powerState so it's NOT_CHARGING, not NOT_CHARGEABLE
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { electricQuantity: 15, powerState: 'USING' },
      });
      expect(handler.computeLowBattery()).toBe(1); // BATTERY_LEVEL_LOW
    });

    it('returns LOW when batteryState is LOW', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { electricQuantity: 50, batteryState: 'LOW', powerState: 'USING' },
      });
      expect(handler.computeLowBattery()).toBe(1); // BATTERY_LEVEL_LOW
    });

    it('returns LOW when batteryState is CRITICAL', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { electricQuantity: 5, batteryState: 'CRITICAL', powerState: 'USING' },
      });
      expect(handler.computeLowBattery()).toBe(1); // BATTERY_LEVEL_LOW
    });

    it('returns NORMAL when battery is healthy and charging', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { electricQuantity: 80, powerState: 'CHARGING' },
      });
      expect(handler.computeLowBattery()).toBe(0); // BATTERY_LEVEL_NORMAL
    });

    it('returns NORMAL when battery is at exactly 20% (threshold boundary)', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { electricQuantity: 20, powerState: 'USING' },
      });
      // 20 is NOT < 20, so should be NORMAL
      expect(handler.computeLowBattery()).toBe(0); // BATTERY_LEVEL_NORMAL
    });
  });

  describe('computeChargingState', () => {
    it('returns CHARGING when device reports CHARGING', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { powerState: 'CHARGING', electricQuantity: 50 },
      });
      expect(handler.computeChargingState()).toBe(1); // CHARGING
    });

    it('returns NOT_CHARGING when device reports USING', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        realInfo: { powerState: 'USING', electricQuantity: 50 },
      });
      expect(handler.computeChargingState()).toBe(0); // NOT_CHARGING
    });

    it('returns NOT_CHARGEABLE when no battery present', () => {
      const handler = createAccessoryHandler();
      // Default: no powerState, 0 battery
      expect(handler.computeChargingState()).toBe(2); // NOT_CHARGEABLE
    });
  });

  describe('computeDesiccantChangeIndication', () => {
    it('returns FILTER_OK when days remaining is null', () => {
      const handler = createAccessoryHandler();
      expect(handler.computeDesiccantChangeIndication()).toBe(0); // FILTER_OK
    });

    it('returns CHANGE_FILTER when days remaining is 0', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 0,
      });
      expect(handler.computeDesiccantChangeIndication()).toBe(1); // CHANGE_FILTER
    });

    it('returns CHANGE_FILTER when days remaining is negative', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: -5,
      });
      expect(handler.computeDesiccantChangeIndication()).toBe(1); // CHANGE_FILTER
    });

    it('returns FILTER_OK when days remaining is positive', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 15,
      });
      expect(handler.computeDesiccantChangeIndication()).toBe(0); // FILTER_OK
    });
  });

  describe('computeDesiccantLifeLevel', () => {
    it('returns 100 when remaining equals full cycle', () => {
      const handler = createAccessoryHandler({}, { desiccantCycleDays: 30 });
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 30,
      });
      expect(handler.computeDesiccantLifeLevel()).toBe(100);
    });

    it('returns 50 when half the cycle remains', () => {
      const handler = createAccessoryHandler({}, { desiccantCycleDays: 30 });
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 15,
      });
      expect(handler.computeDesiccantLifeLevel()).toBe(50);
    });

    it('clamps to 0 when remaining is negative', () => {
      const handler = createAccessoryHandler({}, { desiccantCycleDays: 30 });
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: -10,
      });
      expect(handler.computeDesiccantLifeLevel()).toBe(0);
    });

    it('clamps to 100 when remaining exceeds cycle', () => {
      const handler = createAccessoryHandler({}, { desiccantCycleDays: 30 });
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 60,
      });
      expect(handler.computeDesiccantLifeLevel()).toBe(100);
    });

    it('returns 0 when remaining is null (defaults to 0)', () => {
      const handler = createAccessoryHandler({}, { desiccantCycleDays: 30 });
      // remainingDesiccantDays is not set, so null
      expect(handler.computeDesiccantLifeLevel()).toBe(0);
    });

    it('uses default cycle (30) when config omits desiccantCycleDays', () => {
      const handler = createAccessoryHandler();
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 15,
      });
      expect(handler.computeDesiccantLifeLevel()).toBe(50);
    });

    it('falls back to default cycle on invalid config value', () => {
      const handler = createAccessoryHandler({}, { desiccantCycleDays: 'garbage' });
      (handler as unknown as { device: GranarySmartFeeder }).device.updateData({
        remainingDesiccantDays: 15,
      });
      // NaN cycle => falls back to 30 => 15/30 = 50%
      expect(handler.computeDesiccantLifeLevel()).toBe(50);
    });
  });

  describe('service opt-in', () => {
    it('creates all services when enabledServices is not configured', () => {
      const accessory = createMockAccessory();
      const platform = createMockPlatform();
      const device = makeFeeder();
      new GranarySmartFeederAccessory(platform, accessory as never, device);

      // Battery always + 9 optional services = 10 addService calls
      const addCalls = accessory.addService.mock.calls;
      expect(addCalls.length).toBe(10);
    });

    it('only creates specified services when enabledServices is set', () => {
      const accessory = createMockAccessory();
      const platform = createMockPlatform({
        enabledServices: ['feedNow', 'foodLow'],
      });
      const device = makeFeeder();
      new GranarySmartFeederAccessory(platform, accessory as never, device);

      // Battery (always) + feedNow + foodLow = 3 addService calls
      const addCalls = accessory.addService.mock.calls;
      expect(addCalls.length).toBe(3);
    });

    it('removes previously-cached services that are now disabled', () => {
      const cachedService = mockService();
      const accessory = createMockAccessory();

      // Simulate a cached "indicator" service from a previous config
      accessory.getServiceById.mockImplementation(
        (_type: string, subtype: string) => {
          if (subtype === 'indicator') return cachedService;
          return null;
        },
      );

      const platform = createMockPlatform({
        enabledServices: ['feedNow'], // indicator not included
      });
      const device = makeFeeder();
      new GranarySmartFeederAccessory(platform, accessory as never, device);

      // Should have called removeService for the cached indicator service
      expect(accessory.removeService).toHaveBeenCalledWith(cachedService);
    });
  });

  describe('refreshCharacteristics with disabled services', () => {
    it('does not crash when optional services are disabled', () => {
      const handler = createAccessoryHandler({}, {
        enabledServices: ['feedNow'],
      });

      // Should not throw even though most services are null
      expect(() => handler.refreshCharacteristics()).not.toThrow();
    });
  });
});
