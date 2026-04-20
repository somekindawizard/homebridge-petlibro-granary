/**
 * Plugin-wide constants.
 * Keep in sync with config.schema.json pluginAlias and package.json name.
 */

export const PLATFORM_NAME = 'PetLibro';
export const PLUGIN_NAME = 'homebridge-petlibro-granary';

/** PETLIBRO API internal constants (from jjjonesjr33/petlibro api.py). */
export const PETLIBRO_APPID = 1;
export const PETLIBRO_APPSN = 'c35772530d1041699c87fe62348507a8';

/**
 * Supported regions. Add new entries to API_URLS as base URLs become known
 * -- the EU/AU shards exist on PETLIBRO's side but the upstream HA project
 * has only verified the US base URL.
 */
export type PetLibroRegion = 'US';

/** Region -> API base URL. */
export const API_URLS: Record<PetLibroRegion, string> = {
  US: 'https://api.us.petlibro.com',
};

/** Default cache TTL for per-endpoint response caching, matching HA integration (10s). */
export const RESPONSE_CACHE_TTL_MS = 10_000;

/** Default polling interval if not configured. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;

/**
 * "Slow" tier polling interval. Endpoints in this tier change rarely
 * (feeding plan list, OTA upgrade, bound pets, attribute settings) so we
 * skip them on most ticks. Default: poll the slow tier every 5 minutes.
 */
export const SLOW_TIER_POLL_INTERVAL_SECONDS = 5 * 60;

/**
 * Adaptive polling: after a user-initiated mutation we poll faster for a
 * short window to give snappy UI feedback. Default: 15s for 2 minutes.
 */
export const FAST_POLL_INTERVAL_SECONDS = 15;
export const FAST_POLL_DURATION_MS = 2 * 60_000;

/** +/-ratio of jitter applied to poll cycles to desynchronize bridges. */
export const POLL_JITTER_RATIO = 0.1;

/** Error code returned by the API when the session token has expired. */
export const API_CODE_NOT_LOGGED_IN = 1009;

/** Success code returned by the API. */
export const API_CODE_SUCCESS = 0;

/**
 * Codes that indicate a permanent credential problem (wrong email/password).
 * When the API returns one of these, we do *not* re-attempt login -- that
 * way a typo doesn't trigger an infinite re-login storm.
 *
 * Observed in the wild from the upstream HA integration:
 *   1003 -- account not found
 *   1004 -- wrong password
 *   1005 -- account locked
 */
export const API_CODES_BAD_CREDENTIALS = new Set([1003, 1004, 1005]);

/** Default desiccant pack life in days; HA integration uses 30. */
export const DESICCANT_DEFAULT_DAYS = 30;

/** Battery percent below which we flag StatusLowBattery as a fallback. */
export const LOW_BATTERY_PCT = 20;

/** How long the "Recent Feed" contact sensor stays open after a feed event. */
export const RECENT_FEED_PULSE_MS = 30_000;

/** How long a momentary switch (Feed Now, Reset Desiccant) appears "on". */
export const MOMENTARY_SWITCH_RESET_MS = 1_000;

/** Debounce window for accessory-driven refresh after a Switch toggle. */
export const POST_MUTATION_REFRESH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Configurable HomeKit service keys
// ---------------------------------------------------------------------------

/**
 * Identifiers for optional HomeKit services on the Granary accessory.
 * Battery is always present and not included here.
 */
export type GranaryServiceKey =
  | 'foodLow'
  | 'dispenser'
  | 'desiccantMaintenance'
  | 'recentFeed'
  | 'feedNow'
  | 'feedingSchedule'
  | 'indicator'
  | 'childLock'
  | 'resetDesiccant';

/**
 * All available service keys. Used as the default when the user omits
 * enabledServices from config (backward compatible: everything on).
 */
export const ALL_GRANARY_SERVICES: readonly GranaryServiceKey[] = [
  'foodLow',
  'dispenser',
  'desiccantMaintenance',
  'recentFeed',
  'feedNow',
  'feedingSchedule',
  'indicator',
  'childLock',
  'resetDesiccant',
];

// ---------------------------------------------------------------------------
// Plugin config shape
// ---------------------------------------------------------------------------

/** Plugin configuration shape loaded from config.json. */
export interface PetLibroPluginConfig {
  platform: string;
  name?: string;
  email: string;
  password: string;
  region: PetLibroRegion;
  pollIntervalSeconds?: number;
  manualFeedPortions?: number;
  desiccantCycleDays?: number;
  enabledServices?: GranaryServiceKey[];
  debug?: boolean;
}
