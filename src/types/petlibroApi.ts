/**
 * Typed shapes for PETLIBRO API responses.
 *
 * These are *advisory* -- the wire protocol is not formally documented and may
 * drift, so all consumers still need to handle missing/null values gracefully.
 * Their purpose is to:
 *   - document the fields we actually depend on
 *   - catch typos at compile time when accessing nested properties
 *   - make it obvious when upstream adds/renames a field
 *
 * Anything we haven't observed is left off; callers should use `Partial<...>`
 * style access via `nestedGet` (which provides a fallback) rather than
 * destructuring.
 */

/** /device/device/realInfo response shape (Granary feeder subset). */
export interface RealInfo {
  online?: boolean;
  surplusGrain?: boolean;
  grainOutletState?: boolean;
  childLockSwitch?: boolean;
  lightSwitch?: boolean;
  electricQuantity?: number;
  batteryState?: string;
  /** Observed values: 'CHARGED' | 'CHARGING' | 'USING'. */
  powerState?: string;
  wifiRssi?: number;
}

/** /device/setting/getAttributeSetting response shape (Granary subset). */
export interface AttributeSetting {
  enableSleepMode?: boolean;
  sleepModeStartTime?: string;
  sleepModeEndTime?: string;
  desiccantFrequency?: number;
}

/** /device/data/grainStatus response shape. */
export interface GrainStatus {
  todayFeedingQuantity?: number;
  todayFeedingTimes?: number;
}

/** Single record inside /device/workRecord/list. */
export interface WorkRecordEntry {
  type?: string;
  recordTime?: number;
  actualGrainNum?: number;
}

/** Day-grouped wrapper around WorkRecordEntry[]. */
export interface WorkRecordDay {
  workRecords?: WorkRecordEntry[];
}

/** Bound pet entry from /device/devicePetRelation/getBoundPets. */
export interface BoundPet {
  name?: string;
  petName?: string;
  [key: string]: unknown;
}

/** Whole-device merged data shape held by Device.raw. */
export interface DeviceRawData {
  deviceSn?: string;
  productIdentifier?: string;
  productName?: string;
  name?: string;
  mac?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
  deviceShareState?: number;
  enableFeedingPlan?: boolean;
  remainingDesiccantDays?: number;
  realInfo?: RealInfo;
  getAttributeSetting?: AttributeSetting;
  grainStatus?: GrainStatus;
  workRecord?: WorkRecordDay[];
  feedingPlan?: Array<Record<string, unknown>>;
  // sic -- lowercase, no separators. Ported verbatim from the Python
  // integration's data dict key. Renaming would break the merge path
  // in GranarySmartFeeder.refresh().
  getfeedingplantoday?: Record<string, unknown>;
  getUpgrade?: Record<string, unknown> | null;
  boundPets?: BoundPet[];
  [key: string]: unknown;
}
