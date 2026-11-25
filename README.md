# gladys-drop

[Gladys Assistant](https://gladysassistant.com) external integration for the
**DROP water management** devices (Chandler Systems) through the MQTT broker
of the user: the DROP Hub publishes to it (topics `drop_connect/...`), the
DROP cloud is never used. Hub, protection valve, leak detectors, softener,
filters, salt sensor, alert, pump controller, reverse osmosis filter: flow,
pressure, water used, leaks, batteries. Shutting the water off always
works and is kept until seen applied; turning it on, the bypass and the
protect mode are each behind an off-by-default option; never a switch. **Never tested with a real device. Not affiliated
with Chandler Systems.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (DropApp)
                                  ├─ src/mqtt.js       the only network access: MQTT over TCP/TLS, packets bounded, pinned certificate
                                  ├─ src/drop.js       topics, payloads (strict, bounded), units, command payloads (pure)
                                  ├─ src/devices.js    devices and states (pure)
                                  ├─ src/publisher.js  states within 300/min, nothing older than 2 min
                                  └─ src/store.js      /data/drop-state.json (shutoffs kept, 8-bit mark of refused credentials)
```

- **Topics** (dropmqttapi 1.0.3): `drop_connect/discovery/<hub>/<n>`
  (`devType`, `devDesc`, `name`; the hub is 255), `drop_connect/<hub>/data/<n>/#`
  (JSON of the keys that changed), `drop_connect/<hub>/cmd/<n>`
  (`{"water":0|1}`, `{"bypass":0|1}`, `{"pMode":"home|away|schedule"}`).
- **Devices**: `drop:<hub>_<n>` (the identity Home Assistant uses), features
  by type as in Home Assistant's `drop_connect`; gallons to litres, gpm to
  m³/h, PSI and °F kept. Values strict (bounds, integers, flags 0/1); null,
  empty or out of bounds = unknown, never 0.
- **Session**: everything heard is known for the current broker connection
  only (reset at each connection and disconnection; the retained messages
  fill it again).
- **Shutoff**: no option, out of every lane, cancels what waits on its hub;
  kept in memory and `/data` until a live `water:0` of the device or a
  turn-on of the hub that left after it; sent after the next SUBACK when
  clicked offline, again after a restart, on a live contradiction (2 s after
  sending), and every 20 s without confirmation (3 times), then every 10 min.
- **Other commands**: three options, all off; checked at the click and right
  before the publication; one at a time per device; sent within 2 s of the
  click or never, QoS 0, never queued nor retried; confirmed only by a later
  live message showing the value; Gladys answered by 3.5 s; watched 20 s.
  Turning the water on: refused on an unknown valve or leak state (any
  leak-capable device of the hub, announced or created), any leak or sensor
  alert on the hub, messages dropped in the last 2 s, or a shutoff of the hub
  sent less than 20 s ago.
- **Broker**: MQTT 5 with `maximumPacketSize` (16 KB), 3.1.1 fallback, a
  guard on the socket; nothing written before TCP connects or TLS is
  verified (authorities, or the pinned SHA-256; a refused certificate shows
  its fingerprint, read on a connection that writes nothing); refused
  credentials stop it for good (8-bit mark in `/data`) until other
  credentials or the button.

## Credits

The topics and payloads come from [dropmqttapi](https://github.com/ChandlerSystems/dropmqttapi)
(Chandler Systems, MIT, 1.0.3); the types, features and units from Home
Assistant's `drop_connect` (Apache-2.0). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The MQTT connection is
taken from [gladys-qbus](https://github.com/LM1LC3N7/gladys-qbus); the valve
rules from [gladys-flo](https://github.com/LM1LC3N7/gladys-flo) and
[gladys-guardian](https://github.com/LM1LC3N7/gladys-guardian).

## Development

```bash
npm install
npm test                                        # node --test, no network but loopback
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
node scripts/mutants.mjs                        # the mutants of scripts/mutants.json, one at a time
npx github:GladysAssistant/integration-store .  # store admission checks
```

The broker and the hub are fakes (`test/helpers/fakeMqtt.js`) on the virtual
clock of the kit; `test/broker.test.js` runs the real mqtt.js client against a
real local broker (`test/helpers/broker.js`, TCP and TLS), and
`test/realclock.test.js` the app on the real clock (×10).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the
Docker image).
