# homebridge-petlibro-granary

A [Homebridge](https://homebridge.io) plugin for the PETLIBRO Granary Smart Feeder.

This is a Homebridge port of the feeder-side of [jjjonesjr33/petlibro](https://github.com/jjjonesjr33/petlibro)
(the Home Assistant integration). All credit for the API reverse-engineering
belongs to Jamie Jones Jr. and contributors. Licensed GPL-3.0-or-later to
match the upstream project.

## Status

**Early / experimental.** Supports both variants of the PETLIBRO Granary
Smart Feeder. The camera on the PLAF203 is intentionally not exposed — the
PETLIBRO camera API requires Kalay TUTK SDK integration that hasn't been
reverse-engineered yet.

- [x] Granary Smart Feeder (PLAF103)
- [x] Granary Smart Camera Feeder (PLAF203) — feeder controls only

Other PETLIBRO devices (Air / Space / Polar / One RFID feeders, Dockstream
fountains, Luma litter box) are out of scope for this plugin. If you want
those, use the original [Home Assistant integration](https://github.com/jjjonesjr33/petlibro)
directly, or watch for separate Homebridge ports.

## HomeKit mapping

The Granary feeder exposes these services:

| HomeKit service              | What it reports / controls                                   |
|------------------------------|--------------------------------------------------------------|
| Battery                      | Battery %, low-battery flag, and charging state (CHARGING / NOT_CHARGING / NOT_CHARGEABLE) based on AC / D-cell backup mode |
| Occupancy Sensor: Food Low   | Occupied = food is low                                       |
| Occupancy Sensor: Dispenser  | Occupied = grain outlet is blocked / jammed                  |
| Filter Maintenance: Desiccant | "Change Filter" when remaining days ≤ 0; life level shown as 0–100% against a 30-day cycle |
| Contact Sensor: Recent Feed  | Briefly opens (CONTACT_NOT_DETECTED) for 30s when a new successful feed event is detected — use as an automation trigger |
| Switch: Feed Now             | Momentary — dispenses configured portion count. `StatusActive` flips off when the feeder is offline or in sleep mode |
| Switch: Feeding Schedule     | Enable/disable the recurring feeding plan                    |
| Switch: Indicator            | Turns the on-device LED on/off                               |
| Switch: Child Lock           | Locks/unlocks the hardware buttons                           |
| Switch: Reset Desiccant      | Momentary — resets the desiccant-life day counter            |

## Configuration

```json
{
  "platforms": [
    {
      "platform": "PetLibro",
      "email": "you@example.com",
      "password": "your-petlibro-password",
      "region": "US",
      "pollIntervalSeconds": 60,
      "manualFeedPortions": 2,
      "debug": false
    }
  ]
}
```

> **Only one session can be logged in per account at a time.** If you want
> to keep the PETLIBRO mobile app signed in alongside Homebridge, create a
> dedicated account for the plugin and share your device(s) to it.

## Development

```bash
npm install
npm run build
```

## License

GPL-3.0-or-later. See `LICENSE`.
