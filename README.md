<div align="center">

# 🐾 Homebridge PETLIBRO Granary

**HomeKit control for PETLIBRO Granary Smart Feeders via Homebridge**

[![npm][npm-badge]][npm-url]
[![Build][build-badge]][build-url]
[![Node][node-badge]][node-url]
[![Homebridge][hb-badge]][hb-url]
[![License][license-badge]][license-url]
[![GitHub Issues][issues-badge]][issues-url]

Feed your pets, monitor food levels, manage desiccant, and automate schedules<br>
all from the Apple Home app and Siri.

[Install](#-installation) · [Configuration](#-configuration) · [HomeKit Mapping](#-homekit-mapping) · [Report a Bug][issues-url]

</div>

---

> **Homebridge port** of the feeder side of [jjjonesjr33/petlibro](https://github.com/jjjonesjr33/petlibro) (the Home Assistant integration). All credit for the API reverse-engineering belongs to Jamie Jones Jr. and contributors. Licensed GPL-3.0-or-later to match the upstream project.

---

## ⚡ Quick Start

```
1.  Homebridge UI → Plugins → search "homebridge-petlibro-granary" → Install
2.  Settings tab → enter your PETLIBRO email & password
3.  Restart Homebridge → your feeder appears in Apple Home
```

> **💡 Tip:** Use a [dedicated PETLIBRO account](#-use-a-dedicated-petlibro-account) so the mobile app and Homebridge don't fight over the single-session slot.

---

## ⚠️ Status

**Early / experimental.** Supports both Granary variants. Camera on the PLAF203 is intentionally not exposed (requires Kalay TUTK SDK that hasn't been reverse-engineered).

| Status | Device |
|:---:|---|
| ✅ Supported | **Granary Smart Feeder** (PLAF103) |
| ✅ Supported | **Granary Smart Camera Feeder** (PLAF203) — feeder controls only |
| ⬚ Out of scope | Air / Space / Polar / One RFID feeders, Dockstream fountains, Luma litter box |

---

## 📦 Installation

### Via Homebridge UI (Recommended)

1. Open the Homebridge UI in your browser
2. Go to **Plugins** → search for `homebridge-petlibro-granary`
3. Click **Install**
4. Configure under the **Settings** tab (see [Configuration](#-configuration))

### Via Command Line

```bash
npm install -g homebridge-petlibro-granary
```

Then add the platform block to your `config.json` (see below).

---

## 🏠 HomeKit Mapping

Service names adapt to your setup. If you have a pet named "Mochi" bound to the feeder in the PETLIBRO app, tiles read "Feed Mochi", "Mochi Food Low", etc. Otherwise they use the device name you set in the app.

<table>
<tr>
<td width="50%" valign="top">

### Sensors & Status
| HomeKit Service | What It Reports |
|---|---|
| 🔋 **Battery** | Battery %, low-battery flag, charging state |
| 🍽️ **Food Low** | Occupancy = food level is low |
| 🚫 **Feeder Jam** | Occupancy = grain outlet blocked |
| 🧂 **Desiccant Life** | "Change Filter" when days remaining = 0; 0-100% life level |
| 📬 **Last Fed** | Contact opens for 30s on each successful feed event |

</td>
<td width="50%" valign="top">

### Controls
| HomeKit Service | What It Controls |
|---|---|
| 🍖 **Feed Now** | Momentary: dispenses configured portions |
| 📅 **Schedule** | Enable/disable the recurring feeding plan |
| 💡 **Indicator** | Toggle the on-device LED |
| 🔒 **Child Lock** | Lock/unlock hardware buttons |
| 🔄 **Replace Desiccant** | Momentary: resets desiccant-life counter |

</td>
</tr>
</table>

> **Battery is always shown.** All other services are optional. See [`enabledServices`](#choosing-which-tiles-to-show) to control which tiles appear.

---

## ⚙️ Configuration

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

<details>
<summary><strong>Config Field Reference</strong> — click to expand</summary>

&nbsp;

| Field | Type | Default | Description |
|---|---|:---:|---|
| `email` | string | *required* | PETLIBRO account email |
| `password` | string | *required* | PETLIBRO account password |
| `region` | string | `"US"` | API region (only US currently supported) |
| `pollIntervalSeconds` | number | `60` | Fast-tier polling interval in seconds |
| `manualFeedPortions` | number | `2` | Portions dispensed per Feed Now tap |
| `desiccantCycleDays` | number | `30` | Days in desiccant replacement cycle |
| `enabledServices` | string[] | all 9 | Which optional HomeKit tiles to show |
| `debug` | boolean | `false` | Enable verbose HTTP/API logging |

</details>

---

### Choosing Which Tiles to Show

By default, all 9 optional services are enabled. If your Home app feels cluttered, trim the list. A minimal setup:

```json
"enabledServices": ["feedNow", "foodLow", "feedingSchedule"]
```

This gives you a Feed Now button, a low-food alert, and a schedule toggle, plus the always-present Battery tile.

| Key | HomeKit Service |
|---|---|
| `feedNow` | Feed Now / Feed [Pet] (momentary switch) |
| `feedingSchedule` | Schedule (on/off switch) |
| `foodLow` | Food Low (occupancy sensor) |
| `dispenser` | Feeder Jam (occupancy sensor) |
| `desiccantMaintenance` | Desiccant Life (filter maintenance) |
| `recentFeed` | Last Fed (contact sensor pulse) |
| `indicator` | Indicator Light (on/off switch) |
| `childLock` | Child Lock (on/off switch) |
| `resetDesiccant` | Replace Desiccant (momentary switch) |

> Add or remove services any time. Just restart Homebridge after changing the config.

---

### 🔐 Use a Dedicated PETLIBRO Account

PETLIBRO only allows **one active session per account**. If Homebridge logs in while the mobile app is signed in (or vice versa), one gets silently kicked out.

**Recommended setup:**

1. Create a new PETLIBRO account just for Homebridge
2. From your *primary* account, share each Granary feeder to the new account
3. Use the Homebridge account credentials in this plugin

This keeps the mobile app and Homebridge running side-by-side without conflict.

<details>
<summary><strong>🛡️ Security Notes</strong></summary>

&nbsp;

- Your PETLIBRO password is stored in Homebridge's `config.json`. The plugin MD5-hashes it before sending it to the API, but the original is needed to log in. Use a unique password for the dedicated account.
- The cached session token is encrypted at rest with **AES-256-GCM** keyed off machine-stable identifiers (hostname, primary MAC). This is defense-in-depth against backup-snapshot leaks; an attacker who can run code on the same machine can still recover the key.
- Cached token file: `<homebridge-storage>/homebridge-petlibro-granary-token.json`. Delete it to force re-login on next start.

</details>

---

## 🔄 Polling Architecture

The plugin uses a tiered strategy to balance responsiveness against PETLIBRO API load:

<table>
<tr>
<td width="50%" valign="top">

**⚡ Fast Tier** — every `pollIntervalSeconds` (default 60s)
- `realInfo` — battery, food level, online status
- `grainStatus` — dispenser/jam state
- `workRecord` — recent feed events

</td>
<td width="50%" valign="top">

**🐢 Slow Tier** — every 5 minutes
- Attribute settings (indicator, child lock)
- OTA status
- Feeding plan list
- Bound pets

</td>
</tr>
</table>

| Behavior | How It Works |
|---|---|
| **Adaptive boost** | After any user-initiated mutation, fast tier drops to 15s for 2 minutes |
| **Jitter** | Each tick has +/-10% randomization to prevent multi-instance synchronization |
| **Optimistic updates** | Toggles flip the local state immediately; next poll reconciles with the server |
| **Mutation lock** | Per-device lock serializes rapid toggles to prevent races |
| **API cost** | A single toggle costs ~1 API call thanks to optimistic updates |

---

## 🔧 Troubleshooting

<details>
<summary><strong>"Session expired" in a loop / repeated 1009 errors</strong></summary>

&nbsp;

The PETLIBRO mobile app is probably logged into the same account. Either sign out of the mobile app, or use a [dedicated Homebridge account](#-use-a-dedicated-petlibro-account).

</details>

<details>
<summary><strong>"Login circuit breaker tripped"</strong></summary>

&nbsp;

You've had 6+ consecutive failed logins. The plugin stops trying to prevent account lockout. Fix your credentials and restart Homebridge.

</details>

<details>
<summary><strong>"PETLIBRO authentication failed permanently"</strong></summary>

&nbsp;

PETLIBRO returned a "wrong credentials" code. The plugin will not retry until restart. Double-check the email and password in `config.json`.

</details>

<details>
<summary><strong>Manual feed switch does nothing</strong></summary>

&nbsp;

Feeds are skipped when the device is offline or in its configured sleep window. Both conditions are logged at `warn`. Check the Homebridge log for details.

</details>

<details>
<summary><strong>Battery shows 0% with no warning</strong></summary>

&nbsp;

Normal behavior. The Granary is mains-powered and reports 0% with `chargingState = NOT_CHARGEABLE` when no D-cell backup batteries are installed. The plugin suppresses the low-battery flag in this state.

</details>

<details>
<summary><strong>Service names didn't update after upgrading</strong></summary>

&nbsp;

As of v0.5.0, the plugin pushes updated display names on every startup. Just restart Homebridge and the new labels (pet-aware or improved defaults) appear automatically. No need to remove and re-add the accessory.

</details>

<details>
<summary><strong>Reset / start fresh</strong></summary>

&nbsp;

```bash
rm <homebridge-storage>/homebridge-petlibro-granary-token.json
# restart Homebridge
```

</details>

---

## 🆕 What's New in 0.5.0

- **🐾 Pet-aware service names** — tiles use your pet's name from the PETLIBRO app ("Feed Mochi", "Mochi Food Low")
- **🎛️ Configurable services** — choose which tiles appear via `enabledServices`
- **🎨 Improved config UI** — masked password, grouped sections, checkbox service selection
- **📝 Friendlier labels** — "Dispenser" is now "Feeder Jam", "Recent Feed" is "Last Fed"
- **🔄 Cached name updates** — upgrading from older versions? Names update on restart
- **⏱️ Timer cleanup** — proper teardown when accessories are removed or HB shuts down
- **🧪 Expanded tests** — 25+ new test cases for battery, desiccant, naming, and lifecycle

See [CHANGELOG.md](CHANGELOG.md) for the full history.

---

## 🛠️ Development

```bash
npm install
npm run build       # compile TypeScript
npm run lint        # eslint
npm test            # vitest
npm run test:watch  # watch mode
```

CI runs lint + tests + build against **Node 20 / 22 / 24** on every PR.

---

## 🙏 Credits

| | |
|---|---|
| API reverse-engineering | [jjjonesjr33/petlibro](https://github.com/jjjonesjr33/petlibro) by Jamie Jones Jr. and contributors |

## 📄 License

[GPL-3.0-or-later](LICENSE)

---

<div align="center">

**[⬆ Back to top](#-homebridge-petlibro-granary)**

</div>

<!-- Badge References -->
[npm-badge]: https://img.shields.io/npm/v/homebridge-petlibro-granary?style=flat-square&color=CB3837&logo=npm&logoColor=white
[npm-url]: https://www.npmjs.com/package/homebridge-petlibro-granary
[build-badge]: https://img.shields.io/github/actions/workflow/status/somekindawizard/homebridge-petlibro-granary/ci.yml?style=flat-square&logo=github
[build-url]: https://github.com/somekindawizard/homebridge-petlibro-granary/actions
[node-badge]: https://img.shields.io/badge/Node-20%20%7C%2022%20%7C%2024-339933?style=flat-square&logo=node.js&logoColor=white
[node-url]: https://nodejs.org
[hb-badge]: https://img.shields.io/badge/Homebridge-1.8%2B-purple?style=flat-square&logo=homebridge&logoColor=white
[hb-url]: https://homebridge.io
[license-badge]: https://img.shields.io/github/license/somekindawizard/homebridge-petlibro-granary?style=flat-square&color=blue
[license-url]: https://www.gnu.org/licenses/gpl-3.0
[issues-badge]: https://img.shields.io/github/issues/somekindawizard/homebridge-petlibro-granary?style=flat-square
[issues-url]: https://github.com/somekindawizard/homebridge-petlibro-granary/issues
