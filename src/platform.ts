import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { promises as fs } from 'fs';
import * as path from 'path';

import { PetLibroAPI } from './api';
import { GranarySmartFeederAccessory } from './accessories/granarySmartFeederAccessory';
import { createDevice, Device, GranarySmartFeeder } from './devices';
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  PLATFORM_NAME,
  PLUGIN_NAME,
  PetLibroPluginConfig,
} from './settings';

type AccessoryHandler = GranarySmartFeederAccessory; // expand union as device types are added

/**
 * PETLIBRO dynamic platform plugin.
 *
 * On launch:
 *   1. Read config.json (email, password, region, polling cadence).
 *   2. Restore a cached auth token from disk if available (so we don't
 *      re-login on every Homebridge restart).
 *   3. Log into PETLIBRO, fetch the device list, and create Device objects
 *      for each supported product.
 *   4. Register a PlatformAccessory + HomeKit service layer for each.
 *   5. Start a polling loop on pollIntervalSeconds (default 60s), matching
 *      the HA integration's UPDATE_INTERVAL_SECONDS.
 */
export class PetLibroPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly restoredAccessories: PlatformAccessory[] = [];
  private readonly handlers = new Map<string, AccessoryHandler>();
  private readonly devices = new Map<string, Device>();
  private apiClient: PetLibroAPI | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly tokenPath: string;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & Partial<PetLibroPluginConfig>,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    // Sanitize PLUGIN_NAME for use as a filename — scoped package names
    // contain '/' (e.g. '@prismwizard/homebridge-petlibro') which the
    // filesystem would interpret as a directory separator.
    const safeName = PLUGIN_NAME.replace(/[\\/]/g, '-').replace(/^@/, '');
    this.tokenPath = path.join(this.api.user.storagePath(), `${safeName}-token.json`);

    this.log.debug('PetLibro platform initializing.');

    this.api.on('didFinishLaunching', () => {
      this.discoverAndRegister().catch((err) => {
        this.log.error('Initial discovery failed:', err);
      });
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });
  }

  /** Homebridge calls this for each accessory it restores from cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Restoring accessory from cache: ${accessory.displayName}`);
    this.restoredAccessories.push(accessory);
  }

  // ------------------------------------------------------------------
  // Setup pipeline
  // ------------------------------------------------------------------

  private async discoverAndRegister(): Promise<void> {
    if (!this.validateConfig()) return;

    const initialToken = await this.loadStoredToken();
    this.apiClient = new PetLibroAPI(
      this.config.email!,
      this.config.password!,
      this.config.region ?? 'US',
      // Homebridge doesn't expose HA's time_zone; use the OS default.
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago',
      this.log,
      initialToken,
      (token) => this.persistToken(token),
    );

    try {
      if (!initialToken) {
        await this.apiClient.login();
      }
      const raw = await this.apiClient.listDevices();
      this.log.info(`Fetched ${raw.length} device(s) from PETLIBRO.`);

      for (const entry of raw) {
        const device = createDevice(entry, this.apiClient, this.log);
        if (!device) {
          this.log.warn(
            `Skipping unsupported device "${entry.productName}" (${entry.deviceSn}). ` +
            'Supported: Granary Smart Feeder (PLAF103), Granary Smart Camera Feeder (PLAF203).',
          );
          continue;
        }
        this.devices.set(device.serial, device);

        // Run the initial refresh so the accessory comes up with real state
        // rather than defaults. If the first refresh fails (e.g. transient
        // network error), we still register the accessory — the polling loop
        // will retry every `pollIntervalSeconds` and fill in the real values.
        // This is preferred over bailing because a bailed accessory would
        // disappear from HomeKit on every restart during an outage.
        const ok = await device.refreshSafely();
        if (!ok) {
          this.log.warn(
            `Initial refresh failed for ${device.name}; registering with defaults ` +
            'and will retry on next poll.',
          );
        }
        this.registerAccessoryFor(device);
      }

      this.pruneOrphans();
      this.startPolling();
    } catch (err) {
      this.log.error('Discovery/login failed:', err);
    }
  }

  private validateConfig(): boolean {
    const missing: string[] = [];
    if (!this.config.email) missing.push('email');
    if (!this.config.password) missing.push('password');
    if (missing.length) {
      this.log.error(
        `Missing required config fields: ${missing.join(', ')}. Edit your Homebridge config.`,
      );
      return false;
    }
    return true;
  }

  private registerAccessoryFor(device: Device): void {
    const uuid = this.api.hap.uuid.generate(`petlibro:${device.serial}`);
    let accessory = this.restoredAccessories.find((a) => a.UUID === uuid);

    if (!accessory) {
      this.log.info(`Adding new accessory: ${device.name} (${device.serial})`);
      accessory = new this.api.platformAccessory(device.name, uuid);
      accessory.context.serial = device.serial;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    } else {
      this.log.info(`Reusing cached accessory: ${device.name} (${device.serial})`);
      accessory.context.serial = device.serial;
      this.api.updatePlatformAccessories([accessory]);
    }

    // Dispatch on concrete device type. When more device classes are ported,
    // extend this switch rather than smearing HomeKit logic into device.ts.
    if (device instanceof GranarySmartFeeder) {
      const handler = new GranarySmartFeederAccessory(this, accessory, device);
      this.handlers.set(device.serial, handler);
    } else {
      this.log.warn(
        `No HomeKit handler registered for ${device.modelName} (${device.serial}); ` +
        'accessory will appear but have no services.',
      );
    }
  }

  /** Remove cached accessories that no longer correspond to a discovered device. */
  private pruneOrphans(): void {
    const activeUuids = new Set(
      Array.from(this.devices.values()).map((d) =>
        this.api.hap.uuid.generate(`petlibro:${d.serial}`),
      ),
    );
    const orphans = this.restoredAccessories.filter((a) => !activeUuids.has(a.UUID));
    if (orphans.length) {
      this.log.info(`Removing ${orphans.length} stale accessor(ies).`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphans);
    }
  }

  // ------------------------------------------------------------------
  // Polling
  // ------------------------------------------------------------------

  private startPolling(): void {
    const intervalSec = this.config.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
    this.log.debug(`Starting polling loop every ${intervalSec}s.`);
    this.pollTimer = setInterval(() => {
      this.pollAll().catch((err) => this.log.error('Polling cycle failed:', err));
    }, intervalSec * 1000);
  }

  private async pollAll(): Promise<void> {
    for (const [serial, device] of this.devices) {
      try {
        await device.refresh();
      } catch (err) {
        // Device.refresh() already logs internally via logRefreshError;
        // catching here is belt-and-suspenders in case a subclass throws.
        this.log.debug(`Poll refresh threw for ${device.name}:`, err);
        continue;
      }
      try {
        this.handlers.get(serial)?.refreshCharacteristics();
      } catch (err) {
        this.log.error(`Handler update failed for ${device.name}:`, err);
      }
    }
  }

  // ------------------------------------------------------------------
  // Token persistence
  // ------------------------------------------------------------------

  private async loadStoredToken(): Promise<string | null> {
    try {
      const data = await fs.readFile(this.tokenPath, 'utf8');
      const parsed = JSON.parse(data) as { email?: string; token?: string };
      if (parsed.email === this.config.email && parsed.token) {
        this.log.debug('Loaded cached PETLIBRO token from disk.');
        return parsed.token;
      }
    } catch {
      // No token cached yet — normal on first run.
    }
    return null;
  }

  private async persistToken(token: string): Promise<void> {
    try {
      await fs.writeFile(
        this.tokenPath,
        JSON.stringify({ email: this.config.email, token }),
        { encoding: 'utf8', mode: 0o600 },
      );
    } catch (err) {
      this.log.warn('Failed to persist PETLIBRO token:', err);
    }
  }
}
