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

import { PetLibroAPI, PetLibroAuthFatalError } from './api';
import { GranarySmartFeederAccessory } from './accessories/granarySmartFeederAccessory';
import { createDevice, Device, GranarySmartFeeder } from './devices';
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  FAST_POLL_DURATION_MS,
  FAST_POLL_INTERVAL_SECONDS,
  PLATFORM_NAME,
  PLUGIN_NAME,
  PetLibroPluginConfig,
  PetLibroRegion,
  POLL_JITTER_RATIO,
  SLOW_TIER_POLL_INTERVAL_SECONDS,
} from './settings';
import { decryptToken, encryptToken } from './util/tokenCrypto';
import { jitter } from './util/jitter';

type AccessoryHandler = GranarySmartFeederAccessory;

/**
 * PETLIBRO dynamic platform plugin.
 *
 * Polling architecture:
 *   - Fast tier (every pollIntervalSeconds, default 60s):
 *       device.refresh('light') -- only realInfo, grainStatus, workRecord.
 *   - Slow tier (every SLOW_TIER_POLL_INTERVAL_SECONDS, default 5min):
 *       device.refresh('full') -- adds attribute settings, OTA, plan list.
 *   - Adaptive boost: after a user-initiated mutation we drop to
 *       FAST_POLL_INTERVAL_SECONDS (15s) for FAST_POLL_DURATION_MS (2min)
 *       so the UI reflects the new state quickly.
 *   - Each tick has +/-POLL_JITTER_RATIO randomization so multiple
 *       Homebridge instances don't all hit PETLIBRO at the same instant.
 */
export class PetLibroPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly restoredAccessories: PlatformAccessory[] = [];
  private readonly handlers = new Map<string, AccessoryHandler>();
  private readonly devices = new Map<string, Device>();
  private apiClient: PetLibroAPI | null = null;
  private fastPollTimer: NodeJS.Timeout | null = null;
  private slowPollTimer: NodeJS.Timeout | null = null;
  private fastBoostUntil = 0;
  private readonly tokenPath: string;
  private shuttingDown = false;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig & Partial<PetLibroPluginConfig>,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    const safeName = PLUGIN_NAME.replace(/[\\/]/g, '-').replace(/^@/, '');
    this.tokenPath = path.join(this.api.user.storagePath(), `${safeName}-token.json`);

    this.log.debug('PetLibro platform initializing.');

    this.api.on('didFinishLaunching', () => {
      this.discoverAndRegister().catch((err) => {
        this.log.error('Initial discovery failed:', err);
      });
    });

    this.api.on('shutdown', () => {
      this.shuttingDown = true;
      if (this.fastPollTimer) clearInterval(this.fastPollTimer);
      if (this.slowPollTimer) clearInterval(this.slowPollTimer);
      this.fastPollTimer = null;
      this.slowPollTimer = null;

      // Destroy all handlers so outstanding timers don't fire post-shutdown.
      for (const handler of this.handlers.values()) {
        handler.destroy();
      }

      // Best-effort logout to release the single-session slot. We bound
      // this to 3s so we don't hang Homebridge shutdown if PETLIBRO is
      // unresponsive -- the session will eventually time out server-side.
      const client = this.apiClient;
      if (client) {
        Promise.race([
          client.logout(),
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]).catch(() => undefined);
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
      (this.config.region ?? 'US') as PetLibroRegion,
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
      if (err instanceof PetLibroAuthFatalError) {
        this.log.error(
          'PETLIBRO authentication failed permanently. Verify your email/password ' +
          'in config.json, then restart Homebridge. The plugin will stop polling.',
        );
        return;
      }
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

      // Destroy handlers for orphaned accessories so their timers are cleared.
      for (const orphan of orphans) {
        const serial = orphan.context?.serial as string | undefined;
        if (serial) {
          const handler = this.handlers.get(serial);
          if (handler) {
            handler.destroy();
            this.handlers.delete(serial);
          }
        }
      }

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, orphans);
    }
  }

  // ------------------------------------------------------------------
  // Polling
  // ------------------------------------------------------------------

  private startPolling(): void {
    const fastSec = this.config.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
    this.log.debug(
      `Starting polling: fast tier every ~${fastSec}s, slow tier every ` +
      `~${SLOW_TIER_POLL_INTERVAL_SECONDS}s, fast-boost ${FAST_POLL_INTERVAL_SECONDS}s ` +
      `for ${FAST_POLL_DURATION_MS}ms after mutations.`,
    );

    const scheduleFast = () => {
      const baseSec = Date.now() < this.fastBoostUntil
        ? FAST_POLL_INTERVAL_SECONDS
        : fastSec;
      const ms = jitter(baseSec * 1000, POLL_JITTER_RATIO);
      this.fastPollTimer = setTimeout(async () => {
        if (this.shuttingDown) return;
        try {
          await this.pollAll('light');
        } catch (err) {
          this.log.error('Fast-tier poll failed:', err);
        }
        scheduleFast();
      }, ms);
    };

    const scheduleSlow = () => {
      const ms = jitter(SLOW_TIER_POLL_INTERVAL_SECONDS * 1000, POLL_JITTER_RATIO);
      this.slowPollTimer = setTimeout(async () => {
        if (this.shuttingDown) return;
        try {
          await this.pollAll('full');
        } catch (err) {
          this.log.error('Slow-tier poll failed:', err);
        }
        scheduleSlow();
      }, ms);
    };

    scheduleFast();
    scheduleSlow();
  }

  /**
   * Boost polling cadence after a user-initiated mutation. Called by the
   * accessory layer; the next ~2 minutes of fast-tier polls run at 15s.
   */
  boostPolling(): void {
    this.fastBoostUntil = Date.now() + FAST_POLL_DURATION_MS;
  }

  private async pollAll(mode: 'full' | 'light'): Promise<void> {
    if (this.apiClient?.isCredentialsRejected()) {
      // Don't keep poking the API -- the credentials have been rejected.
      return;
    }
    for (const [serial, device] of this.devices) {
      try {
        if (device instanceof GranarySmartFeeder) {
          await device.refresh(mode);
        } else {
          await device.refresh();
        }
      } catch (err) {
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
  // Token persistence (encrypted at rest)
  // ------------------------------------------------------------------

  private async loadStoredToken(): Promise<string | null> {
    try {
      const data = await fs.readFile(this.tokenPath, 'utf8');
      const decrypted = decryptToken(data, this.config.email ?? '');
      if (decrypted) {
        this.log.debug('Loaded cached PETLIBRO token from disk.');
        return decrypted;
      }
      // Legacy plaintext file or fingerprint mismatch -- drop it.
      this.log.debug('Discarding stale/invalid cached token; will re-login.');
    } catch {
      // No token cached yet -- normal on first run.
    }
    return null;
  }

  private async persistToken(token: string): Promise<void> {
    try {
      const payload = encryptToken(token, this.config.email ?? '');
      await fs.writeFile(this.tokenPath, payload, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (err) {
      this.log.warn('Failed to persist PETLIBRO token:', err);
    }
  }
}
