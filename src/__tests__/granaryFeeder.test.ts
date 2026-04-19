import { describe, it, expect } from 'vitest';
import { Logger } from 'homebridge';
import { GranarySmartFeeder } from '../devices/feeders/granarySmartFeeder';
import { PetLibroAPI, RawDevice } from '../api';

const stubLog: Logger = {
  prefix: 'test',
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, log: () => {}, success: () => {},
} as unknown as Logger;

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

describe('GranarySmartFeeder state accessors', () => {
  describe('foodLow', () => {
    it('returns false when surplusGrain is true', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { surplusGrain: true } });
      expect(f.foodLow).toBe(false);
    });
    it('returns true when surplusGrain is false', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { surplusGrain: false } });
      expect(f.foodLow).toBe(true);
    });
    it('defaults to false when realInfo missing (assume food OK)', () => {
      const f = makeFeeder();
      expect(f.foodLow).toBe(false);
    });
  });

  describe('foodDispenserProblem', () => {
    it('inverts grainOutletState', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { grainOutletState: false } });
      expect(f.foodDispenserProblem).toBe(true);
      f.updateData({ realInfo: { grainOutletState: true } });
      expect(f.foodDispenserProblem).toBe(false);
    });
  });

  describe('chargingState', () => {
    it('CHARGING when API says CHARGING', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { powerState: 'CHARGING' } });
      expect(f.chargingState).toBe('CHARGING');
    });
    it('NOT_CHARGING for CHARGED and USING', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { powerState: 'CHARGED' } });
      expect(f.chargingState).toBe('NOT_CHARGING');
      f.updateData({ realInfo: { powerState: 'USING' } });
      expect(f.chargingState).toBe('NOT_CHARGING');
    });
    it('NOT_CHARGEABLE when battery is 0 and powerState empty', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { electricQuantity: 0 } });
      expect(f.chargingState).toBe('NOT_CHARGEABLE');
    });
    it('NOT_CHARGING fallback when battery > 0 but no powerState', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { electricQuantity: 50 } });
      expect(f.chargingState).toBe('NOT_CHARGING');
    });
  });

  describe('batteryState', () => {
    it('uppercases the value', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { batteryState: 'low' } });
      expect(f.batteryState).toBe('LOW');
    });
    it('returns UNKNOWN when missing', () => {
      const f = makeFeeder();
      expect(f.batteryState).toBe('UNKNOWN');
    });
  });

  describe('batteryPercent', () => {
    it('coerces strings to numbers', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { electricQuantity: '75' } });
      expect(f.batteryPercent).toBe(75);
    });
    it('returns 0 for non-finite', () => {
      const f = makeFeeder();
      f.updateData({ realInfo: { electricQuantity: 'NaN' } });
      expect(f.batteryPercent).toBe(0);
    });
  });

  describe('lastFeedTimeMs / lastFeedQuantity', () => {
    it('returns the most-recent GRAIN_OUTPUT_SUCCESS', () => {
      const f = makeFeeder();
      f.updateData({
        workRecord: [
          { workRecords: [
            { type: 'GRAIN_OUTPUT_SUCCESS', recordTime: 1700000003000, actualGrainNum: 4 },
            { type: 'GRAIN_OUTPUT_SUCCESS', recordTime: 1700000001000, actualGrainNum: 1 },
          ] },
        ],
      });
      expect(f.lastFeedTimeMs).toBe(1700000003000);
      expect(f.lastFeedQuantity).toBe(4);
    });

    it('skips non-success entries', () => {
      const f = makeFeeder();
      f.updateData({
        workRecord: [
          { workRecords: [
            { type: 'GRAIN_OUTPUT_FAIL', recordTime: 1700000005000 },
            { type: 'GRAIN_OUTPUT_SUCCESS', recordTime: 1700000002000, actualGrainNum: 2 },
          ] },
        ],
      });
      expect(f.lastFeedTimeMs).toBe(1700000002000);
      expect(f.lastFeedQuantity).toBe(2);
    });

    it('returns null/0 when workRecord is missing or shaped wrong', () => {
      expect(makeFeeder().lastFeedTimeMs).toBeNull();
      expect(makeFeeder().lastFeedQuantity).toBe(0);

      const f = makeFeeder();
      f.updateData({ workRecord: 'garbage' });
      expect(f.lastFeedTimeMs).toBeNull();
    });
  });

  describe('remainingDesiccantDays', () => {
    it('returns null when missing', () => {
      expect(makeFeeder().remainingDesiccantDays).toBeNull();
    });
    it('coerces strings', () => {
      const f = makeFeeder();
      f.updateData({ remainingDesiccantDays: '12' });
      expect(f.remainingDesiccantDays).toBe(12);
    });
    it('returns null for garbage', () => {
      const f = makeFeeder();
      f.updateData({ remainingDesiccantDays: 'oops' });
      expect(f.remainingDesiccantDays).toBeNull();
    });
  });

  describe('feedingPlanEnabled / online', () => {
    it('feedingPlanEnabled tracks enableFeedingPlan', () => {
      const f = makeFeeder({ enableFeedingPlan: true });
      expect(f.feedingPlanEnabled).toBe(true);
    });
    it('online defaults to false', () => {
      expect(makeFeeder().online).toBe(false);
    });
  });
});
