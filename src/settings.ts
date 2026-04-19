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
 * Supported regions. Add new entries to API_URLS as base URLs become known.
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

/** Slow-tier polling interval (rarely-changing endpoints). */
export const SLOW_TIER_POLL_INTERVAL_SECONDS = 5 * 60;

/** Adaptive fast-poll cadence and duration after a user-initiated mutation. */
export const FAST_POLL_INTERVAL_SECONDS = 15;
export const FAST_POLL_DURATION_MS = 2 * 60_000;

/** ±ratio of jitter applied to poll cycles. */
export const POLL_JITTER_RATIO = 0.1;

/** Error code returned by the API when the session token has expired. */
export const API_CODE_NOT_LOGGED_IN = 1009;

/** Success code returned by the API. */
export const API_CODE_SUCCESS = 0;

/** Codes that indicate a permanent credential problem. */
export const API_CODES_BAD_CREDENTIALS = new Set([1003, 1004, 1005]);

/** Default desiccant pack life in days. */
export const DESICCANT_DEFAULT_DAYS = 30;

/** Battery percent below which we flag StatusLowBattery as a fallback. */
export const LOW_BATTERY_PCT = 20;

/** How long the "Recent Feed" contact sensor stays open after a feed event. */
export const RECENT_FEED_PULSE_MS = 30_000;

/** How long a momentary switch (Feed Now, Reset Desiccant) appears "on". */
export const MOMENTARY_SWITCH_RESET_MS = 1_000;

/** Debounce window for accessory-driven refresh after a Switch toggle. */
export const POST_MUTATION_REFRESH_DEBOUNCE_MS = 250;

/**
 * Per-service visibility flags. Users can disable individual services to
 * reduce clutter in Home.app. Reset Desiccant defaults to false because
 * it's an infrequent operation that most users perform manually on the
 * device or via a dedicated automation, not from a tile they tap weekly.
 */
export interface PetLibroUiConfig {
  exposeFeedNow?: boolean;
  exposeFeedingSchedule?: boolean;
  exposeIndicator?: boolean;
  exposeChildLock?: boolean;
  exposeResetDesiccant?: boolean;
  exposeRecentFeed?: boolean;
  exposeDispenser?: boolean;
  exposeDesiccant?: boolean;
  exposeFoodLow?: boolean;
  exposeBattery?: boolean;
  /**
   * If true, prepend emoji to default service names for easier scanning
   * in Home.app. Users who've already renamed their services won't see
   * any change (renames take precedence).
   */
  useEmojiNames?: boolean;
}

export const DEFAULT_UI_CONFIG: Required<PetLibroUiConfig> = {
  exposeFeedNow: true,
  exposeFeedingSchedule: true,
  exposeIndicator: true,
  exposeChildLock: true,
  exposeResetDesiccant: false, // power-user feature, off by default
  exposeRecentFeed: true,
  exposeDispenser: true,
  exposeDesiccant: true,
  exposeFoodLow: true,
  exposeBattery: true,
  useEmojiNames: true,
};

/**
 * Resolve the final UI config from a user-supplied partial. Anything
 * missing falls back to DEFAULT_UI_CONFIG.
 */
export function resolveUiConfig(input?: PetLibroUiConfig): Required<PetLibroUiConfig> {
  return { ...DEFAULT_UI_CONFIG, ...(input ?? {}) };
}

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
  ui?: PetLibroUiConfig;
  debug?: boolean;
}
