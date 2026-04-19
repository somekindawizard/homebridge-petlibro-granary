import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { createHash, randomUUID } from 'crypto';
import { Logger } from 'homebridge';

import {
  API_CODE_NOT_LOGGED_IN,
  API_CODE_SUCCESS,
  API_URLS,
  PETLIBRO_APPID,
  PETLIBRO_APPSN,
  RESPONSE_CACHE_TTL_MS,
} from './settings';

/**
 * Raw device entry as returned by /device/device/list.
 * Only fields we actually use are typed; unknown fields pass through.
 */
export interface RawDevice {
  deviceSn: string;
  productIdentifier: string;
  productName: string;
  name?: string;
  mac?: string;
  softwareVersion?: string;
  hardwareVersion?: string;
  deviceShareState?: number;
  shareId?: number | string | null;
  enableFeedingPlan?: boolean;
  [key: string]: unknown;
}

/** Standard wrapped API response. */
interface ApiEnvelope<T = unknown> {
  code: number;
  msg?: string;
  data?: T;
}

/** Cache entry for short-lived endpoint response dedup. */
interface CacheEntry {
  at: number;
  value: unknown;
}

export class PetLibroAPIError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'PetLibroAPIError';
  }
}

/**
 * PETLIBRO API client.
 *
 * Faithful port of custom_components/petlibro/api.py from the
 * jjjonesjr33/petlibro Home Assistant integration. Key behaviours preserved:
 *
 *   - MD5 password hashing on login
 *   - Token persistence via the onTokenChange callback (so Homebridge can
 *     save it to accessory storage between restarts)
 *   - Auto re-login on API code 1009 (NOT_YET_LOGIN) with a single retry
 *   - Per-endpoint response cache with 10s TTL to dedup rapid-fire calls
 *   - Fresh UUID-derived requestId for mutation endpoints that require it
 */
export class PetLibroAPI {
  private readonly http: AxiosInstance;
  private readonly cache = new Map<string, CacheEntry>();
  private token: string | null;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly region: 'US',
    private readonly timezone: string,
    private readonly log: Logger,
    initialToken: string | null = null,
    private readonly onTokenChange: (token: string) => void = () => { /* noop */ },
  ) {
    this.token = initialToken;

    const baseURL = API_URLS[region];
    if (!baseURL) {
      throw new PetLibroAPIError(`Unsupported region: ${region}`);
    }

    this.http = axios.create({
      baseURL,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        source: 'ANDROID',
        language: 'EN',
        timezone: this.timezone || 'America/Chicago',
        version: '1.3.45',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  private static hashPassword(password: string): string {
    return createHash('md5').update(password, 'utf8').digest('hex');
  }

  /**
   * Log in and retrieve a session token. Called automatically on construction
   * if no initial token is supplied, and by the request loop on 1009 errors.
   */
  async login(): Promise<string> {
    this.log.debug(`Logging in as ${this.email}`);

    const body = {
      appId: PETLIBRO_APPID,
      appSn: PETLIBRO_APPSN,
      country: this.region,
      email: this.email,
      password: PetLibroAPI.hashPassword(this.password),
      phoneBrand: '',
      phoneSystemVersion: '',
      timezone: this.timezone,
      thirdId: null,
      type: null,
    };

    const resp = await this.http.post<ApiEnvelope<{ token?: string }>>(
      '/member/auth/login',
      body,
    );

    const data = resp.data;
    if (!data || data.code !== API_CODE_SUCCESS || !data.data?.token) {
      throw new PetLibroAPIError(
        `Login failed: code=${data?.code} msg=${data?.msg ?? 'unknown'}`,
        data?.code,
      );
    }

    this.token = data.data.token;
    this.onTokenChange(this.token);
    this.log.debug('Login successful, token cached.');
    return this.token;
  }

  async logout(): Promise<void> {
    if (!this.token) return;
    try {
      await this.request('/member/auth/logout');
    } catch (err) {
      this.log.debug('Logout request failed (continuing):', err);
    }
    this.token = null;
  }

  // ---------------------------------------------------------------------------
  // Core request plumbing
  // ---------------------------------------------------------------------------

  /**
   * Perform a request to the PETLIBRO API.
   *
   * If the API returns code 1009 (NOT_YET_LOGIN), transparently re-login
   * and retry once. Any non-zero non-1009 code is thrown as PetLibroAPIError.
   */
  private async request<T = unknown>(
    path: string,
    body: Record<string, unknown> = {},
    method: 'POST' | 'GET' = 'POST',
    params?: Record<string, unknown>,
  ): Promise<T> {
    const doCall = async (): Promise<ApiEnvelope<T>> => {
      if (!this.token) {
        await this.login();
      }
      const config: AxiosRequestConfig = {
        headers: { token: this.token ?? '' },
        params,
      };
      try {
        const resp = method === 'GET'
          ? await this.http.get<ApiEnvelope<T>>(path, config)
          : await this.http.post<ApiEnvelope<T>>(path, body, config);
        return resp.data;
      } catch (err) {
        // Axios errors from HTTP-level failures (404, 500, etc.) are raised
        // before we ever see an envelope. Attach enough context to debug
        // which endpoint + payload combination the server rejected.
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (typeof status === 'number') {
          this.log.debug(
            `HTTP ${status} on ${path} (body=${JSON.stringify(body).slice(0, 200)})`,
          );
        }
        throw err;
      }
    };

    let envelope = await doCall();

    if (envelope.code === API_CODE_NOT_LOGGED_IN) {
      this.log.debug(`Session expired on ${path}, re-logging in.`);
      this.token = null;
      await this.login();
      envelope = await doCall();
    }

    if (envelope.code !== API_CODE_SUCCESS) {
      throw new PetLibroAPIError(
        `API error on ${path}: code=${envelope.code} msg=${envelope.msg ?? ''}`,
        envelope.code,
      );
    }

    // The HA integration treats a missing `data` field as `{}` for robustness.
    return (envelope.data ?? ({} as T));
  }

  /**
   * POST a body that implicitly carries the device serial as both `id` and
   * `deviceSn`. This matches how the HA integration's `post_serial` helper
   * works — many endpoints accept either field name.
   */
  private async requestWithSerial<T = unknown>(
    path: string,
    serial: string,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    return this.request<T>(path, { id: serial, deviceSn: serial, ...extra });
  }

  /**
   * Cached request wrapper. Dedups rapid-fire identical calls within the
   * RESPONSE_CACHE_TTL_MS window to avoid hammering the API during a polling
   * cycle that touches many fields of the same device.
   */
  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key);
    const now = Date.now();
    if (entry && now - entry.at < RESPONSE_CACHE_TTL_MS) {
      return entry.value as T;
    }
    const value = await fn();
    this.cache.set(key, { at: now, value });
    return value;
  }

  // ---------------------------------------------------------------------------
  // Device listing / info
  // ---------------------------------------------------------------------------

  async listDevices(): Promise<RawDevice[]> {
    const data = await this.request<RawDevice[]>('/device/device/list');
    return Array.isArray(data) ? data : [];
  }

  async deviceBaseInfo(serial: string): Promise<Record<string, unknown>> {
    return this.cached(`${serial}:baseInfo`, () =>
      this.requestWithSerial('/device/device/baseInfo', serial),
    );
  }

  async deviceRealInfo(serial: string): Promise<Record<string, unknown>> {
    return this.cached(`${serial}:realInfo`, () =>
      this.requestWithSerial('/device/device/realInfo', serial),
    );
  }

  async deviceAttributeSettings(serial: string): Promise<Record<string, unknown>> {
    return this.cached(`${serial}:attrSettings`, () =>
      this.requestWithSerial('/device/setting/getAttributeSetting', serial),
    );
  }

  async deviceGrainStatus(serial: string): Promise<Record<string, unknown>> {
    return this.cached(`${serial}:grainStatus`, () =>
      this.requestWithSerial('/device/data/grainStatus', serial),
    );
  }

  async deviceUpgrade(serial: string): Promise<Record<string, unknown> | null> {
    return this.cached(`${serial}:getUpgrade`, async () => {
      const resp = await this.request<Record<string, unknown> | null>(
        '/device/ota/getUpgrade',
        { id: serial },
      );
      return resp;
    });
  }

  async deviceFeedingPlanTodayNew(serial: string): Promise<Record<string, unknown>> {
    return this.cached(`${serial}:feedingPlanToday`, () =>
      this.requestWithSerial('/device/feedingPlan/todayNew', serial),
    );
  }

  async deviceFeedingPlanList(serial: string): Promise<Array<Record<string, unknown>>> {
    return this.cached(`${serial}:feedingPlanList`, async () => {
      const resp = await this.requestWithSerial<Array<Record<string, unknown>>>(
        '/device/feedingPlan/list',
        serial,
      );
      return Array.isArray(resp) ? resp : [];
    });
  }

  async deviceWorkRecord(serial: string): Promise<Array<Record<string, unknown>>> {
    return this.cached(`${serial}:workRecord`, async () => {
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const resp = await this.request<Array<Record<string, unknown>> | null>(
        '/device/workRecord/list',
        {
          deviceSn: serial,
          startTime: now - thirtyDaysMs,
          endTime: now,
          size: 25,
          type: ['GRAIN_OUTPUT_SUCCESS'],
        },
      );
      return Array.isArray(resp) ? resp : [];
    });
  }

  async deviceGetBoundPets(serial: string): Promise<Array<Record<string, unknown>>> {
    const resp = await this.request<Array<Record<string, unknown>> | null>(
      '/device/devicePetRelation/getBoundPets',
      { deviceSn: serial },
    );
    return Array.isArray(resp) ? resp : [];
  }

  // ---------------------------------------------------------------------------
  // Control / mutation endpoints (Granary-relevant subset)
  // ---------------------------------------------------------------------------

  async setFeedingPlan(serial: string, enable: boolean): Promise<void> {
    await this.request('/device/setting/updateFeedingPlanSwitch', {
      deviceSn: serial,
      enable,
    });
  }

  async setChildLock(serial: string, enable: boolean): Promise<void> {
    await this.request('/device/setting/updateChildLockSwitch', {
      deviceSn: serial,
      enable,
    });
  }

  async setLightOn(serial: string): Promise<void> {
    await this.request('/device/setting/updateLightingSetting', {
      deviceSn: serial,
      lightSwitch: true,
      lightAgingType: 1,
      lightingStartTime: null,
      lightingEndTime: null,
    });
  }

  async setLightOff(serial: string): Promise<void> {
    await this.request('/device/setting/updateLightingSetting', {
      deviceSn: serial,
      lightSwitch: false,
      lightAgingType: 1,
      lightingStartTime: null,
      lightingEndTime: null,
    });
  }

  async setManualFeed(serial: string, portions: number): Promise<void> {
    const requestId = randomUUID().replace(/-/g, '');
    await this.request('/device/device/manualFeeding', {
      deviceSn: serial,
      grainNum: Math.max(1, Math.round(portions)),
      requestId,
    });
  }

  async setDesiccantReset(serial: string): Promise<void> {
    const requestId = randomUUID().replace(/-/g, '');
    await this.request('/device/device/desiccantReset', {
      deviceSn: serial,
      requestId,
      timeout: 5000,
    });
  }

  // ---------------------------------------------------------------------------
  // Misc
  // ---------------------------------------------------------------------------

  /** Drop all cached responses — called before forced refreshes. */
  invalidateCache(serial?: string): void {
    if (!serial) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${serial}:`)) {
        this.cache.delete(key);
      }
    }
  }

  getToken(): string | null {
    return this.token;
  }
}
