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
  disconnection; retained messages count for a turn-on, they are the hub's
  last word; a shutoff is let go by a live message only, see Review r4).
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
- **Review r2 (2026-11-25)**: I2: a shutoff is let go by a `water:0` seen
  after its send (retained included at r2; reversed at r4: live only);
  when the valve was known closed as it left, a later live `water:1` is a
  turn-on made elsewhere (DROP app): let go, never fought; a shutoff never
  seen applied is given up when its device is deleted in Gladys, or 24 h
  after its click (default kept by the coordinator, said in the status and
  the docs). I3: a `leak:1` or `sens:1` of any device of the hub refuses a
  turn-on whatever its type; `LEAK_KEY` only decides what must be known.
  m1': dropped messages reset every value to unknown. m2: only a turn-on
  whose write the broker took (`ok`) lets shutoffs go. m3: tests for a
  message of another device (never a confirmation), the 2-minute rule of the
  publisher, and a bounded wait in the option test. Mutants: 69, all killed
  but #33 (writes held before verification, equivalent under Node, kept);
  the stop and confirmation ones run again after the last change; suite
  passed 20 times in `node:22-alpine` (a flaky brute-force count fixed with
  a constant salt).
- **Review r3 (2026-11-25)**: B3: a shutoff always leaves at least once; the
  24 h give-up counts on the monotonic clock from its first send in this
  process (never the wall clock, never from /data); a give-up is named in the
  status. I4: a shutoff not yet sent is let go by nothing: it leaves first;
  only a `water:0` received after its send lets it go (live only since r4);
  "known closed" (a later live turn-on made elsewhere) rests on a live
  message only, never a retained one. Checks: 73 mutants, all killed but
  #33 (equivalent, as before) and #67 (expiry without a send: equivalent, the
  check only runs from a timer armed by a send; kept as defence); #37 survived
  once in the full run and was killed in 2 reruns alone (not explained). Suite
  20/20 in `node:22-alpine`. Real Mosquitto 2 in Docker, 14 checks green: the
  shutoff without option, a turn-on made in the DROP app never fought, clicked
  with the broker down then sent at its return, a stale retained "off" only
  after the send, the retained "off" at a reconnection, a leak of an
  unknown-type device, the shutoff resent from /data after a restart.
- **Review r4 (2026-11-25)**: I5 (decided): a shutoff that left is let go
  only by a live `water:0` received after its send, never by a retained one
  (the broker replays it at the subscription; it may predate the click, the
  valve reopened since with an unretained message). In doubt the shutoff
  stays: shutting a closed valve does nothing. The price, said in the docs:
  when the live confirmation was missed (Gladys or the broker down), a
  turn-on made in the DROP app right after can be cut once (at once, or
  within 10 min when held), then the hub's live "off" lets it go; the 24 h
  give-up counts in memory and starts again at each restart (harmless, it
  protects). Tests: a retained "off" with the SUBACK and after the resend
  at a reconnection keeps it, sent again 20 s later, a live "off" lets it
  go; the missed confirmation then a turn-on in the app cut once; a shutoff
  from /data with a live "off" in the SUBACK block still leaves. Found by
  the x20 run (one flaky pass of the 16 KB test): a connection lost before
  the SUBACK (mqtt.js fails the pending SUBSCRIBE, "Connection closed") was
  taken as an ACL refusal, never tried again by itself, so a kept shutoff
  never left; lost right after it, the app said "connected" after the close.
  Now `onConnect` stops when the client is no longer connected (the next
  connection subscribes again); a test for both orders, mutant #74.
  Mutants: 75 (new #73: lifted by a retained "off"; #74), all killed but #33
  and #67 (equivalent, see r3): 74 in a full run before the SUBACK fix, then
  the 27 of the connection and the shutoffs again after it. Suite 20/20 in
  `node:22-alpine` (1 GB). Real
  Mosquitto 2.1.4 in Docker, 52 checks green over 12 scenarios: s1 (no
  option), s2 A (broker down at the click), B (hub absent, then a live "on"),
  C (turn-on in the app never fought), D (/data after a restart), F (stale
  retained "off", clicked offline), F2 (stale retained "off" after the send:
  kept, sent again), s6 (wall clock +25 h, /data 2 days old), s3 (I1, I3,
  m1'), s4 (refused credentials, one CONNECT), s5 (TLS pin). F2 replayed on
  the r4 code fails (let go, never sent again).
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

## Next patch

- Review minors: see `_lots/lot25/reviews/drop-r5.md`.
