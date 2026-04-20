# homebridge-petlibro-granary

[![npm](https://img.shields.io/npm/v/homebridge-petlibro-granary)](https://www.npmjs.com/package/homebridge-petlibro-granary)
[![Build](https://github.com/somekindawizard/homebridge-petlibro-granary/actions/workflows/ci.yml/badge.svg)](https://github.com/somekindawizard/homebridge-petlibro-granary/actions)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A [Homebridge](https://homebridge.io) plugin for the PETLIBRO Granary Smart Feeder.

This is a Homebridge port of the feeder-side of [jjjonesjr33/petlibro](https://github.com/jjjonesjr33/petlibro)
(the Home Assistant integration). All credit for the API reverse-engineering
belongs to Jamie Jones Jr. and contributors. Licensed GPL-3.0-or-later to
match the upstream project.

## Installation

### Via Homebridge UI (recommended)

1. Open the Homebridge UI in your browser.
2. Go to the **Plugins** tab and search for `homebridge-petlibro-granary`.
3. Click **Install**.
4. Configure the plugin under the **Settings** tab (see [Configuration](#configuration) below).

### Via command line

```bash
npm install -g homebridge-petlibro-granary
```

Then add the platform block to your Homebridge `config.json` (see below).

## Status

**Early / experimental.** Supports both variants of the PETLIBRO Granary
Smart Feeder. The camera on the PLAF203 is intentionally not exposed -- the
PETLIBRO camera API requires Kalay TUTK SDK integration that hasn't been
reverse-engineered yet.

- [x] Granary Smart Feeder (PLAF103)
- [x] Granary Smart Camera Feeder (PLAF203) -- feeder controls only

Other PETLIBRO devices (Air / Space / Polar / One RFID feeders, Dockstream
fountains, Luma litter box) are out of scope for this plugin.

## HomeKit mapping

Service names adapt to your setup. If you have a pet named "Mochi" bound to
the feeder in the PETLIBRO app, tiles will read "Feed Mochi", "Mochi Food Low",
etc. Otherwise they use the device name you set in the app.

| HomeKit service                  | What it reports / controls                                   |
|----------------------------------|--------------------------------------------------------------|
| Battery                          | Battery %, low-battery flag, charging state (CHARGING / NOT_CHARGING / NOT_CHARGEABLE) |
| Occupancy Sensor: Food Low       | Occupied = food is low                                       |
| Occupancy Sensor: Feeder Jam     | Occupied = grain outlet is blocked / jammed                  |
| Filter Maintenance: Desiccant    | "Change Filter" when remaining days <= 0; life level shown as 0-100% against the configured cycle (default 30 days) |
| Contact Sensor: Last Fed         | Briefly opens (CONTACT_NOT_DETECTED) for 30s when a new successful feed event is detected; pulses immediately for plugin-initiated feeds, otherwise on next poll |
| Switch: Feed Now                 | Momentary: dispenses configured portion count. Skipped when offline or in sleep mode |
| Switch: Schedule                 | Enable/disable the recurring feeding plan                    |
| Switch: Indicator                | Turns the on-device LED on/off                               |
| Switch: Child Lock               | Locks/unlocks the hardware buttons                           |
| Switch: Replace Desiccant        | Momentary: resets the desiccant-life day counter             |

> **Tip:** Battery is always shown. All other services are optional. See the
> `enabledServices` config below to choose which tiles appear in the Home app.

## Configuration

```json
{
  "platforms": [
    {
      "platform": "PetLibro",
      "email": "homebridge@example.com",
      "password": "your-petlibro-password",
      "region": "US",
      "pollIntervalSeconds": 60,
      "manualFeedPortions": 2,
      "desiccantCycleDays": 30,
      "enabledServices": [
        "feedNow",
        "feedingSchedule",
        "foodLow",
        "dispenser",
        "desiccantMaintenance",
        "recentFeed",
        "indicator",
        "childLock",
        "resetDesiccant"
      ],
      "debug": false
    }
  ]
}
```

### Choosing which tiles to show

By default, all 9 optional services are enabled. If your Home app feels
cluttered, you can trim the list. A minimal setup might look like:

```json
"enabledServices": ["feedNow", "foodLow", "feedingSchedule"]
```

This gives you a Feed Now button, a low-food alert, and a schedule toggle,
plus the always-present Battery tile. You can always add services back later;
just restart Homebridge after changing the config.

| Key                    | Service                                  |
|------------------------|------------------------------------------|
| `feedNow`              | Feed Now / Feed [Pet] (momentary switch) |
| `feedingSchedule`      | Schedule (on/off switch)                 |
| `foodLow`              | Food Low (occupancy sensor)              |
| `dispenser`            | Feeder Jam (occupancy sensor)            |
| `desiccantMaintenance` | Desiccant Life (filter maintenance)      |
| `recentFeed`           | Last Fed (contact sensor pulse)          |
| `indicator`            | Indicator Light (on/off switch)          |
| `childLock`            | Child Lock (on/off switch)               |
| `resetDesiccant`       | Replace Desiccant (momentary switch)     |

### Use a dedicated PETLIBRO account

PETLIBRO only allows **one active session per account**. If Homebridge logs in
while the PETLIBRO mobile app is signed in (or vice versa), one of them gets
silently kicked out.

**Recommended setup:**

1. Create a new PETLIBRO account just for Homebridge (`homebridge@yourdomain.com` works fine).
2. From your *primary* account, share each Granary feeder to the Homebridge account.
3. Use the Homebridge account credentials in this plugin.

This keeps the mobile app and Homebridge running side-by-side without fighting.

### Security notes

- Your PETLIBRO password is stored in Homebridge's `config.json`. The plugin
  MD5-hashes it before sending it to the API, but the original is needed to
  log in. We recommend using a unique password for the dedicated account.
- The cached session token is encrypted at rest with AES-256-GCM keyed off
  machine-stable identifiers (hostname, primary MAC). This is defense-in-depth
  against backup-snapshot leaks; an attacker who can run code on the same machine
  can still recover the key.
- Cached token file: `<homebridge-storage>/homebridge-petlibro-granary-token.json`.
  Delete it to force re-login on next start.

## Polling architecture

The plugin uses a tiered polling strategy to balance responsiveness against
PETLIBRO API load:

- **Fast tier** (every `pollIntervalSeconds`, default 60s):
  realInfo, grainStatus, workRecord -- anything that changes minute-to-minute.
- **Slow tier** (every 5 min):
  attribute settings, OTA, feeding plan list, bound pets -- rarely change.
- **Adaptive boost**: after any user-initiated mutation (toggle, manual feed),
  the fast tier drops to 15s for 2 minutes so the UI catches up quickly.
- **Jitter**: each tick has +/-10% randomization so multiple Homebridge instances
  don't synchronize against PETLIBRO's servers.

A single PETLIBRO Switch toggle costs ~1 API call thanks to optimistic local
updates and a per-device mutation lock. The HomeKit UI flips instantly; the
next polling cycle reconciles against the server.

## Troubleshooting

### "Session expired" in a loop / repeated 1009 errors

The PETLIBRO mobile app is probably logged into the same account. Either sign
out of the mobile app, or use a dedicated Homebridge account (see above).

### "Login circuit breaker tripped"

You've had 6 or more consecutive failed logins. The plugin stops trying so it
doesn't get your account locked. Fix your credentials and restart Homebridge.

### "PETLIBRO authentication failed permanently"

PETLIBRO returned a "wrong credentials" code. The plugin will not retry until
restart. Check the email/password in config.json carefully.

### Manual feed switch does nothing

Check the log. Feeds are skipped when the device is offline or in its
configured sleep window. Both conditions are logged at `warn`.

### Battery shows 0% with no warning

Normal: the Granary is mains-powered and reports 0% with `chargingState =
NOT_CHARGEABLE` when no D-cell backup batteries are installed. The plugin
suppresses the StatusLowBattery flag in this state.

### Service names didn't update after upgrading

As of v0.5.0 the plugin pushes updated display names to cached services on
every startup. If you're upgrading from an older version, just restart
Homebridge and the new labels (pet-aware or improved defaults) will appear
automatically. No need to remove and re-add the accessory.

### Reset / start fresh

```bash
rm <homebridge-storage>/homebridge-petlibro-granary-token.json
# restart Homebridge
```

## What's new in 0.5.0

- **Pet-aware service names.** Tiles now use your pet's name from the PETLIBRO
  app: "Feed Mochi", "Mochi Food Low", etc. Falls back to the device name when
  no pet is bound.
- **Configurable HomeKit services.** Choose which tiles appear in the Home app
  via the `enabledServices` config array. Disable services you don't need to
  reduce clutter.
- **Improved config UI.** Password field is now masked. Settings are grouped
  into Account, Feeder Settings, HomeKit Services, and Advanced sections.
  Service selection uses checkboxes.
- **Friendlier default labels.** "Dispenser" is now "Feeder Jam", "Recent Feed"
  is now "Last Fed", "Reset Desiccant" is now "Replace Desiccant".
- **Cached name updates.** Upgrading from an older version? Service names
  update automatically on restart. No need to remove accessories.
- **Timer cleanup.** Outstanding timers are properly cleared when accessories
  are removed or Homebridge shuts down.
- **Expanded test coverage.** 25+ new tests for battery logic, desiccant
  calculations, service opt-in, pet-aware naming, and lifecycle safety.

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Development

```bash
npm install
npm run build       # compile TypeScript
npm run lint        # eslint
npm test            # vitest
npm run test:watch  # watch mode
```

CI runs lint + tests + build against Node 20 / 22 / 24 on every PR.

## License

GPL-3.0-or-later. See `LICENSE`.
