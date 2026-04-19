import { Logger } from 'homebridge';

import { PetLibroAPI, RawDevice } from '../api';
import { Device } from './device';
import { GranarySmartFeeder } from './feeders/granarySmartFeeder';

/**
 * Product name -> device class mapping.
 *
 * Mirrors `product_name_map` in custom_components/petlibro/devices/__init__.py.
 * Add new entries here as device classes are ported. The key must match the
 * `productName` field returned by /device/device/list.
 */
type DeviceCtor = new (data: RawDevice, api: PetLibroAPI, log: Logger) => Device;

const PRODUCT_NAME_MAP: Record<string, DeviceCtor> = {
  // PLAF103 — non-camera Granary.
  'Granary Smart Feeder': GranarySmartFeeder,

  // PLAF203 — camera variant. The HA integration has a separate
  // GranarySmartCameraFeeder class, but its non-camera surface (manual feed,
  // food low, child lock, indicator, schedule, desiccant) is identical to
  // the PLAF103. We point it at the same class here. The only meaningful
  // delta is that the PLAF103 class additionally polls /device/data/getDefaultMatrix;
  // the PLAF203 class does not. Reusing the PLAF103 class means we'll attempt
  // that call on a 203 too — the API quietly returns empty and we never read
  // the value, so it's harmless. Camera-only fields (resolution, nightVision,
  // videoRecord*) are explicitly out of scope for this plugin.
  'Granary Smart Camera Feeder': GranarySmartFeeder,

  // TODO (future sessions):
  // 'Air Smart Feeder': AirSmartFeeder,
  // 'One RFID Smart Feeder': OneRFIDSmartFeeder,
  // 'Polar Wet Food Feeder': PolarWetFoodFeeder,
  // 'Space Smart Feeder': SpaceSmartFeeder,
  // 'Dockstream Smart Fountain': DockstreamSmartFountain,
  // 'Dockstream Smart RFID Fountain': DockstreamSmartRFIDFountain,
  // 'Dockstream 2 Smart Fountain': Dockstream2SmartFountain,
  // 'Dockstream 2 Smart Cordless Fountain': Dockstream2SmartCordlessFountain,
  // 'Luma Smart Litter Box': LumaSmartLitterBox,
};

/**
 * Build a concrete Device instance from a raw /device/device/list entry.
 * Returns null for unsupported product names so the platform can log-and-skip.
 */
export function createDevice(
  data: RawDevice,
  api: PetLibroAPI,
  log: Logger,
): Device | null {
  const Ctor = PRODUCT_NAME_MAP[data.productName];
  if (!Ctor) {
    return null;
  }
  return new Ctor(data, api, log);
}

export function isSupported(productName: string): boolean {
  return productName in PRODUCT_NAME_MAP;
}

export { Device } from './device';
export { GranarySmartFeeder } from './feeders/granarySmartFeeder';
