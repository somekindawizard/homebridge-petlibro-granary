/**
 * Plugin-wide constants.
 * Keep in sync with config.schema.json pluginAlias and package.json name.
 */

export const PLATFORM_NAME = 'PetLibro';
export const PLUGIN_NAME = 'homebridge-petlibro-granary';

/** PETLIBRO API internal constants (from jjjonesjr33/petlibro api.py). */
export const PETLIBRO_APPID = 1;
export const PETLIBRO_APPSN = 'c35772530d1041699c87fe62348507a8';

/** Region -> API base URL. Extend as other regions become known. */
export const API_URLS: Record<string, string> = {
  US: 'https://api.us.petlibro.com',
};

/** Default cache TTL for per-endpoint response caching, matching HA integration (10s). */
export const RESPONSE_CACHE_TTL_MS = 10_000;

/** Default polling interval if not configured. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;

/** Error code returned by the API when the session token has expired. */
export const API_CODE_NOT_LOGGED_IN = 1009;

/** Success code returned by the API. */
export const API_CODE_SUCCESS = 0;

/** Plugin configuration shape loaded from config.json. */
export interface PetLibroPluginConfig {
  platform: string;
  name?: string;
  email: string;
  password: string;
  region: 'US';
  pollIntervalSeconds?: number;
  manualFeedPortions?: number;
  debug?: boolean;
}
