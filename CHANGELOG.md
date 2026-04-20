# Changelog

## 0.4.0 — 2026-04-19

A reliability + security pass. No HomeKit-visible behavior changes for happy
paths; substantial improvements for failure modes, rapid input, and security.

### Added

- **Per-device mutation lock.** Rapid Switch toggles in Home.app no longer race against each other — mutations serialize per device and run in submission order.
- **Optimistic local updates.** Toggling Child Lock / Indicator / Feeding Schedule flips the local state immediately. A single Switch tap now costs ~1 API call instead of ~8 (previously each toggle triggered a full 7-endpoint refresh).
- **Adaptive polling.** After any user-initiated mutation, fast-tier polling drops from 60s to 15s for 2 minutes so the UI catches up quickly. Returns to baseline automatically.
- **Tiered polling.** Fast tier (every `pollIntervalSeconds`) only fetches realInfo / grainStatus / workRecord. Slow tier (every 5 min) handles attribute settings, OTA, feeding plan list, bound pets. Cuts steady-state API load by ~60%.
- **Polling jitter.** Each tick has ±10% randomization so multiple Homebridge instances don't synchronize their polls against PETLIBRO's servers.
- **Encrypted token at rest.** The cached PETLIBRO session token is now encrypted with AES-256-GCM keyed off machine-stable identifiers (hostname, primary MAC). Defense-in-depth against backup-snapshot leaks.
- **Graceful logout on shutdown.** The plugin now logs out of PETLIBRO when Homebridge stops, freeing the single-session-per-account slot. Bounded to 3s so it never hangs shutdown.
- **Login backoff with circuit breaker.** Failed logins now back off exponentially (5s → 5min, ±20% jitter). After 6 consecutive failures the breaker trips and the plugin stops trying until restart — no more re-login storm hammering PETLIBRO on a typo.
- **Bad-credentials detection.** When PETLIBRO returns codes 1003/1004/1005 (account not found / wrong password / locked), the plugin marks credentials permanently rejected and stops polling instead of looping. Logs a clear actionable error.
- **Immediate Recent Feed pulse on local mutations.** When the plugin initiates a manual feed, the Recent Feed contact sensor pulses *immediately* rather than waiting up to a minute for the workRecord poll to surface the new entry. Polling-detected feeds (e.g. scheduled or app-initiated) still fire on poll.
- **Configurable desiccant cycle.** New `desiccantCycleDays` config (default 30) controls the FilterLifeLevel calculation.
- **Vitest test suite** covering Backoff, KeyedMutex, jitter / debounce / sleep, token crypto round-trip, and all GranarySmartFeeder state parsers.
- **GitHub Actions CI** running lint + tests + build against Node 20 / 22 / 24 on every PR.
- **Stricter ESLint** with `no-floating-promises` and type-aware rules.
- **Stricter tsconfig** (`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `useUnknownInCatchVariables`).

### Changed

- **`Promise.allSettled` everywhere in refresh paths.** A single failing endpoint no longer wipes all device state for the polling cycle; whatever succeeded is merged in.
- **Sensitive fields stripped from debug logs.** Request bodies are now sanitized before being logged at HTTP-error debug level — `password` and `token` fields are replaced with `<redacted>`.
- **Concurrent login dedup.** Multiple in-flight requests that hit a 1009 simultaneously now share a single in-flight login promise instead of stampeding the auth endpoint.
- **`PetLibroRegion` is now a typed enum** so future EU/AU shards are a one-line addition.
- **Region selection moved through typed config** (no behavior change for US users).
- **Magic numbers consolidated** in `settings.ts` (low-battery threshold, momentary-switch reset window, recent-feed pulse duration, etc.).
- **Engines:** dropped Node 18 (EOL April 2025), keeping `^20.9.0 || ^22 || ^24`.

### Removed

- The redundant inline refresh after every Switch toggle. Reconciliation now happens via the platform's adaptive fast-poll boost.

## 0.3.4 — 2026-04-19

### Fixed
- **Critical data correctness bug: all sensor readings were stuck at defaults.** The base `Device.refresh()` method was spreading `realInfo` and `getAttributeSetting` response fields directly into the top level of the device's data object, rather than keeping them as nested sub-objects. The property getters (`foodLow`, `online`, `batteryPercent`, `indicatorLightOn`, `childLockOn`, `inSleepMode`, etc.) all use `nestedGet('realInfo', …)` to read those fields — so they were looking for a nested `realInfo` object that never existed and silently falling back to their default values (`false`, `0`, etc.).
  
  Symptoms: Home app showing battery as 0% regardless of actual state, Food Low never triggering, Indicator and Child Lock switches never reflecting the real device state. Controls (Feed Now, Reset Desiccant) were unaffected since they only POST data, they don't read it.
  
  Also caused `refreshSafely()` to always return false on first run (it checks for a non-empty `realInfo` object that didn't exist), producing a spurious "Initial refresh failed" warning on every restart since v0.3.0.
  
  This bug was introduced in v0.3.0 as part of a refresh-dedup optimization that was well-intentioned but broke the nesting contract that the property getters relied on. Both the base `Device.refresh()` and `GranarySmartFeeder.refresh()` now correctly preserve the nested structure.

## 0.3.3 — 2026-04-19

### Fixed
- **`StatusActive` warning on Switch services.** The Feed Now switch had a `StatusActive` characteristic attached, but `StatusActive` isn't in HAP's required-or-optional list for the Switch service. Homebridge loaded it anyway but logged a warning on every startup. Removed the characteristic; the offline/sleep-mode guard now lives in the `handleFeedNow` handler itself — it skips the API call and logs a warning if the device can't act.
- **HomeKit "threw an error from the characteristic" warnings on control toggles.** The `onSet` handlers for Feeding Schedule, Indicator, and Child Lock let API errors bubble up to HomeKit, which logged noisy warnings. Each handler is now try/caught — errors are logged via the platform logger and the switch state self-corrects on the next poll.

### Added
- **HTTP error diagnostics at debug level.** When an axios request returns a non-2xx status (404, 500, etc.), the API layer now logs the status code, endpoint path, and a truncated request body. Enable `debug: true` in the plugin config to see these.

## 0.3.2 — 2026-04-19

### Changed
- **Package renamed** from `@prismwizard/homebridge-petlibro` to `homebridge-petlibro-granary` to match the unscoped naming convention used by the broader Homebridge community and to make the single-device scope explicit.
- **Display name** updated to "Homebridge PETLIBRO Granary" in the Homebridge UI.

### Fixed
- **Spurious "low battery" warning when no batteries installed.** The Granary is AC-powered with *optional* D-cell battery backup. When no batteries are inserted, the API reports 0% battery — we were flagging that as "low battery" in HomeKit when semantically there's no battery to be low. Now, when `chargingState` resolves to `NOT_CHARGEABLE` (no battery present), we always report `BATTERY_LEVEL_NORMAL`.

## 0.3.1 — 2026-04-19

### Fixed
- **Token persistence broken on scoped package name.** The plugin name contains a `/` (`@prismwizard/homebridge-petlibro`), which the filesystem interpreted as a directory separator when constructing the token cache filename — causing every write to fail with `ENOENT`. Sanitized the filename to `prismwizard-homebridge-petlibro-token.json`. Functionally the plugin already worked; it just couldn't cache the auth token between restarts and had to re-login each time.

## 0.3.0 — 2026-04-19

### Added
- **Dispenser Occupancy Sensor** — reports grain outlet blockages as an occupancy signal so you can automate "notify me when the feeder jams."
- **Filter Maintenance service for desiccant** — native HomeKit "Change Filter" indicator when days remaining hits zero, with a 0–100% life level against the 30-day cycle.
- **Recent Feed Contact Sensor** — briefly opens (CONTACT_NOT_DETECTED) for 30 seconds whenever a new `GRAIN_OUTPUT_SUCCESS` event is observed. Intended as an automation trigger.
- **Real Charging State** on the Battery service — reads the API's `powerState` (CHARGED / CHARGING / USING) and reports CHARGING / NOT_CHARGING / NOT_CHARGEABLE accordingly. Previously always reported NOT_CHARGEABLE.
- **Feed Now `StatusActive`** — flips off when the feeder is offline or in its configured sleep window, giving users a visual cue that a manual feed command may not take effect immediately.
- Properties exposed on the device object (not yet all surfaced as HomeKit services): `batteryState`, `chargingState`, `lastFeedTimeMs`, `lastFeedQuantity`, `wifiRssi`.

### Changed
- **Scoped package name** to `@prismwizard/homebridge-petlibro` to avoid collision with other community plugins.
- **Low-battery detection** now considers both the device-reported `batteryState` string ("LOW" / "CRITICAL") AND the <20% percentage threshold, rather than only the percentage.
- **HTTP timeout bumped from 15s to 30s** to match upstream tolerance for the occasionally-slow PETLIBRO API.
- **Transient network errors** (timeouts, DNS hiccups, connection resets) now log as single-line warnings instead of multi-hundred-line stack traces. Non-transient errors still get the full dump.
- **Startup flow hardened** — if the initial device refresh fails, the accessory still registers with defaults and the next poll fills in real state. Previously a transient error at launch would have registered no accessory at all.
- **Polling loop isolated** — a failure in one device's refresh or one handler's update can no longer cascade to break the entire polling cycle.

### Fixed
- Removed redundant `deviceRealInfo` and `deviceAttributeSettings` calls in `GranarySmartFeeder.refresh()` — these were being fetched twice per poll cycle (once in the base class, once in the subclass) even though the 10-second response cache made it a no-op in practice.

## 0.2.0 — 2026-04-18

- Initial Homebridge port of the [jjjonesjr33/petlibro](https://github.com/jjjonesjr33/petlibro) Home Assistant integration.
- Supports Granary Smart Feeder (PLAF103) and Granary Smart Camera Feeder (PLAF203) — feeder controls only; camera is excluded by design.
- HomeKit services: Battery, Food Low (Occupancy Sensor), Feed Now / Feeding Schedule / Indicator / Child Lock / Reset Desiccant (Switches).
