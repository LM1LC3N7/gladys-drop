# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-25

### Added

- DROP water management (Chandler Systems) through the MQTT broker of the
  user, no cloud: hub, protection valve, leak detectors, softener, filter,
  salt sensor, alert, pump controller and reverse osmosis filter, announced
  by the hub and added from the Discovery tab.
- Flow (m³/h), peak flow, water used today and average daily use (litres),
  pressure (PSI), temperature (°F), leaks, batteries, softener capacity and
  reserve, salt, pump, TDS, cartridge life, bypass and protect mode.
- Shutting the water off, always allowed (no option, never a switch), kept
  until a live message of the device shows the water off (never a retained
  one, it may predate the click): sent at the next connection when
  clicked offline, again after a restart, when contradicted and without a
  confirmation; never against a turn-on made elsewhere once seen closed;
  given up when the device is deleted or 24 h after it first left.
- Turning the water on, the bypass and the protect mode, each behind its own
  option, off by default; never a switch. Turning the water on is refused on
  any leak or unknown leak state of the hub, dropped messages, or a recent
  shutoff.
- MQTT over TCP or TLS (system authorities, or a pinned SHA-256 fingerprint
  for a self-signed broker, the fingerprint of a refused certificate shown),
  MQTT 5 with a 3.1.1 fallback; every message
  bounded to 16 KB; refused credentials never tried again by themselves.
- Documentation in English and French.

[Unreleased]: https://github.com/LM1LC3N7/gladys-drop/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-drop/releases/tag/v0.1.1
