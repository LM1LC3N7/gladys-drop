# TODO — DROP v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `gi ci` (Prettier, ESLint, Node 22 and 24, Docker,
  store validator), `npm run audit`, the mutants (`node scripts/mutants.mjs`),
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum post from a module session: the batch reserved in /t/10385
  (lot 25, n° 546) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-11-25): one MQTT connection to the broker
      of the user (TCP/TLS, pinned certificate, MQTT 5 then 3.1.1, packets
      bounded to 16 KB), the devices the hub announces (9 types) in the
      Discovery tab, their states (units converted, strict values), the four
      commands behind off-by-default options, the status with the last
      command, the test button; docs en/fr, cover. Tested against a fake hub
      built from dropmqttapi and the Home Assistant fixtures, a real local
      broker in the tests, and Mosquitto (see Decisions).
- [ ] **Milestone 2 — real hub**: run against a real DROP Hub (see "To check"),
      turn its messages (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: what a real hub publishes beyond dropmqttapi
      (alarms, firmware, signal), only once seen.

## Decisions

- **Reference**: dropmqttapi 1.0.3 (Chandler Systems, the maker, MIT, PyPI
  latest on 2026-11-25, uploaded 2024-04-25, commit `4a42b91`), its topics,
  keys and command payloads ported to JavaScript (`src/drop.js`), notice in
  `THIRD_PARTY_NOTICES.md` (shipped in the image). The types, the features of
  each type and the units follow Home Assistant's `drop_connect` (Apache-2.0,
  commit `93e5689`); its test payloads are the fixtures. No other DROP
  client exists on npm. Runtime dependencies: the SDK and `mqtt` (mqtt.js).
- **Versions**: 0.1.0 set by hand (package.json, lock, manifest,
  `docker_image`). SDK `^0.16.1` (latest on npm, 2026-11-25), mqtt `^5.16.1`.
- **Manifest**: `countries: ["US"]` (DROP sells in the United States only)
  with `gladys_version: ">=5.3.0"` (Louis, 2026-11-12); categories
  `security` (leaks, shutoff) and `energy` (water use); no `keywords`.
- **Review r1 (2026-11-25)**: shutting the water off is the stop, never held
  back (coordinator's decision, as gladys-guardian): `allow_water_close`
  removed (B1). The shutoff is kept per device in memory and in `/data`
  (`stops`, 16 at most, a future date taken as now) until a live `water:0`
  of the device or a turn-on of the same hub that left after it; clicked
  offline it is answered "kept" and sent right after the next SUBACK
  (without waiting for a hub message); sent again after a restart, at each
  connection (new budget), on a live `water:1` 2 s or more after it left,
  and 20 s after each send without confirmation: 3 times, then every 10 min
  ("held", in the status); a failed save never delays it; a shutoff clicked
  while `/data` is unreadable connects anyway and never writes over the file
  (B2). QoS 0 kept: our own resends replace mqtt.js's. Turning the water on
  is refused while any leak-capable device of the hub (hub, pv, leak, pc,
  ro; alrt by `sens`), announced or created in Gladys, has no known state in
  this connection, named in the refusal (I1); while messages were dropped in
  the current or previous second (m1); within 20 s of a shutoff of the same
  hub, and a shutoff cancels the queued commands of its whole hub (m2: which
  valve the hub's `water` drives is unknown). A refused TLS certificate shows
  its fingerprint, read on a connection that writes nothing (m3). Away stays
  behind `allow_mode_change` (m4, said in the docs). The type of a device
  comes from the hub's last announcement, kept across reconnections (m5).
- **No read request in DROP**: decisions rest on what the hub published in
  the current broker connection (values reset at each connection and
  disconnection; retained messages count, they are the hub's last word).
  No age bound on them: the hub publishes on change, and a closed valve
  without flow may stay silent for hours (an age bound would refuse every
  turn-on of a closed valve). Asked in "To check".
- **Confirmation**: only a live (not retained) message received after the
  publication, showing the value asked. A shutoff of a valve already closed
  is confirmed by the next message showing it closed.
- **QoS 0 for commands**: with QoS 1, mqtt.js keeps the message and sends it
  again after a reconnection, possibly minutes later; QoS 0 with
  `queueQoSZero: false` leaves now or never.
- **Turn on** refused on: option off, not connected, valve state or any leak
  state of the hub unknown, a leak reported by any device of the hub (`leak`
  = 1) or a sensor alert (`sens` = 1), messages dropped (2 s), a shutoff of
  the hub sent in the last 20 s or clicked since, more than 2 s waiting for
  its turn.
- **Identity**: `drop:<hub>_<n>` (Home Assistant's unique id). Only the
  device 255 may be a hub, and a hub only at 255 (dropmqttapi). The type comes
  from the hub's last announcement (kept across reconnections), else from the
  device created in Gladys; both known and different: commands refused ("scan again").
- **Units**: gallons -> litres, gpm -> m³/h (exact factors); PSI and °F kept
  (both listed by the core for their category). TDS: no category takes ppm,
  so a plain integer with "(ppm)" in its name. Cartridge life: `maintenance /
life-remaining` (core 4.86+).
- **Bypass and protect mode** are `text/select` features (never a switch);
  each behind its option. The bypass of the hub is exposed as Home Assistant
  does (its exact effect on a hub is to check on a real one).
- **Credentials refused**: an 8-bit salted mark in `/data` (never the
  password, never a full hash; brute force test in `test/pure.test.js`); one
  password in 256 shares it, the button lifts it. `/data` unreadable (I/O):
  read again every 10 s, no connection before; content not ours: waits for
  the button (it resets the file).
- **Limits**: 16 KB per packet, 200 messages a second, 8 hubs, 64 devices, 64
  keys per message, names 60 characters (control characters removed).
- **Battery 0**: published as 0 (the Home Assistant fixture of a protection
  valve has `battery: 0`; whether that means "mains powered" is to check).
- **Unknown device types** are ignored and counted in the status.
- **Mutants (r1)**: 62 in `scripts/mutants.json` (the shutoff kept, its
  resends, /data, the unknown leak states, the flood, the hub-wide cancel,
  the probe), run one at a time (`node scripts/mutants.mjs`): 61 killed; the
  suite passed 20 times in `node:22-alpine` (3 GB). Milestone 1 had 44
  mutants, 43 killed. #38 (the writes of `src/mqtt.js`
  not held until the transport is verified) survives as equivalent under
  Node 22/24: net and TLS sockets already buffer what is written before the
  connection or the handshake, and the pinned check runs first in
  `secureConnect`. Kept as defence in depth (a CONNECT carries the password).
- **Real broker**: a scenario against Mosquitto 2 in Docker (password file, a
  simulated hub publishing retained discovery and data, following the
  commands): connected, states, Discovery, shutoff and turn-on confirmed in
  about 300 ms, turn-on refused on a detector's leak, a 100 KB retained
  message dropped by Mosquitto (`maximumPacketSize`) without a disconnection,
  a wrong password refused once and never tried again (1 refusal in the
  broker log over 12 s).

## To check on a real hub

- The exact name of the MQTT setting in the DROP Connect app.
- Whether the hub retains its discovery and data messages, and how often it
  publishes without change (an age bound for turning the water on).
- Whether `battery: 0` on a mains-powered device means "no battery".
- The temperature unit of the leak detectors (°F per Home Assistant).
- The meaning of the hub's `bypass`, and the protect modes it accepts.
