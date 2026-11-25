# DROP (Chandler Systems)

This integration shows the **DROP** water management devices (Chandler Systems, United
States) in Gladys through **your own MQTT broker**, locally, without the DROP cloud: the
hub publishes its data to your broker (Mosquitto...), Gladys reads it there.

Unofficial, not affiliated with Chandler Systems. **Never tested with a real device**: it
follows the MQTT topics the maker published (dropmqttapi) and the Home Assistant
integration. Your feedback is welcome.

## What is shown

| DROP device            | Features                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub                    | water on, shut the water off, turn the water on, leak, flow, peak flow today, water used today, average daily use, pressure (current, highest and lowest today), bypass, protect mode, notification pending, battery |
| Protection valve       | water on, shut the water off, turn the water on, leak, flow, pressure, temperature, battery                                                                                                                          |
| Leak detector          | leak, temperature, battery                                                                                                                                                                                           |
| Softener               | capacity remaining, reserve in use, flow, pressure, bypass, battery                                                                                                                                                  |
| Filter                 | flow, pressure, bypass, battery                                                                                                                                                                                      |
| Salt sensor            | salt low                                                                                                                                                                                                             |
| Alert                  | sensor alert, powered, temperature, battery                                                                                                                                                                          |
| Pump controller        | pump running, leak, flow, pressure, temperature                                                                                                                                                                      |
| Reverse osmosis filter | leak, inlet and outlet TDS (ppm), cartridge 1 to 3 life                                                                                                                                                              |

Units: gallons become litres, gallons per minute m³/h; the pressure stays in PSI and the
temperature in °F (Gladys converts them for display). A value missing, empty or out of
bounds stays unknown: never published as 0.

## Setting up

1. An MQTT broker on your network (Mosquitto, or the one of your home automation box),
   preferably with a user name and a password.
2. In the DROP Connect app, set the hub to publish to this broker (the same setting as
   for Home Assistant). The topics start with `drop_connect/`.
3. In Gladys, enter the broker address (`192.168.1.20`, or `mqtts://broker.lan:8883` in
   TLS), the user name and the password, save.
4. **Discovery** tab: add the devices the hub announced.

A broker in TLS with a self-signed certificate: enter the SHA-256 fingerprint of its
certificate. The connection is then accepted for this certificate only; another
certificate stops everything before the password leaves and the status shows the
fingerprint seen. Without a fingerprint, the certificate must be signed by a known
authority; a refused certificate also shows its fingerprint in the status (read on a
connection that sends nothing), to paste in the field if you trust it.

## Commands

They are never switches: a "turn everything off" or a voice assistant cannot touch the
valve. Shutting the water off and turning it on are two buttons; the bypass and the protect
mode are lists.

### Shutting the water off: always allowed

**Shutting the water off** (hub, protection valve) has no option: it is the safety of the
device. It reads nothing before leaving and does not wait behind the other commands: it
leaves at once and cancels those of the same hub still waiting for their turn (nothing
clicked before a shutoff leaves after it). It leaves even when the valve seems closed
already.

It is **kept** (in memory and in `/data`) until a live message of the device shows the
water off, or a turn-on of this hub leaves after it:

- clicked without a broker connection: answered "shutoff kept", sent right after the next
  connection, without waiting for a message of the hub;
- after a restart of the integration: sent again from `/data` at the connection;
- sent again when the device still shows the water on at least 2 s after it left, and
  20 s after each send without a confirmation: 3 times, then every 10 min ("held", said in
  the status), until confirmed;
- a write of `/data` that fails never delays it.

It is not sent only when the identity is wrong: a value other than the button press, or a
device the hub now announces with another type (scan again). Without a possible broker
connection (credentials refused, certificate refused), it stays kept and leaves as soon as
the connection is back.

### The other commands: off by default

Each has its own box in the configuration, read at the click and again right before
sending. A command leaves within 2 s of its click, once, or is not sent. Gladys gets its
answer within 3.5 s: "done, confirmed by the device" (a message of the device received
after sending shows the value asked), "sent, without confirmation" (the status then says
whether the device showed it within 20 s), or a refusal ending with "Nothing sent". The
last command is shown in the status of the configuration page.

**Turning the water on** is sent only when all of this is true, from what the hub
published since the connection to the broker (DROP has no read request; at each
connection or disconnection everything is unknown again until the next messages):

- "Allow turning the water on" is checked, at the click and right before sending;
- the valve state of the device is known; already on: nothing is sent;
- its leak state is known and without a leak;
- every device of the same hub able to report a leak (hub, valve, detectors, pump,
  reverse osmosis, alert), announced by the hub or created in Gladys, has a known state,
  without a leak nor an alert. A detector removed or out of order blocks turning on:
  delete it in Gladys;
- no message of the broker was dropped (over 200 a second) in the last 2 seconds;
- no shutoff of this hub left less than 20 s ago, and none was clicked since this click.

A turn-on that leaves lets go the shutoffs kept on this hub.

**Bypass** (hub, softener, filter; on: the water goes around the treatment) and **protect
mode** (hub: Home, Away, Schedule; Away is the strictest): refused when their option is
unchecked; nothing is sent when already in the state asked. Switching to Away is not a
shutoff: it stays behind the option of the protect mode.

## Security

- Anyone who can publish on your broker can command the valve and forge messages of the
  hub: protect the broker with a password and access rules (ACL), keep it on a trusted
  network.
- The password is kept by Gladys in its database, never shown again, sent only to your
  broker; it is in no log, nor in `/data`, nor in the status.
- Credentials refused by the broker: the integration stops and does not try again by
  itself, even after a restart (it keeps in `/data` an 8-bit mark, useless to find the
  password back). Save other credentials or click "Test the connection". One password in
  256 shares the mark: the button then lifts the stop.
- Every message of the broker is bounded to 16 KB before it is read; beyond 200 messages a
  second, the next ones are dropped; 8 hubs and 64 devices at most.

## Limits

- Never tested with a real device; the name of the MQTT setting in the DROP Connect app
  may differ.
- The hub publishes at its own pace: a value may stay a long time without an update
  (nothing is made up between two messages).
- A device type the hub announces and the integration does not know is ignored (counted
  in the status).
