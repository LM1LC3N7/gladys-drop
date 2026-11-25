# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`).

## dropmqttapi

The DROP messages (`src/drop.js`, `src/constants.js`) port parts of
**dropmqttapi** 1.0.3 (<https://github.com/ChandlerSystems/dropmqttapi>, read
at commit `4a42b91` of 2024-04-25), the Python MQTT API published by Chandler
Systems, the maker of DROP, to JavaScript: the topics (`drop_connect/discovery/<hub>/<device>`,
`drop_connect/<hub>/data/<device>/#`, `drop_connect/<hub>/cmd/<device>`), the
discovery keys (`devType`, `devDesc`, `name`), the hub at device 255, the data
keys and their meaning (flow, peak flow, water used today, average use,
softener capacity, pressure, temperature, TDS, cartridges, battery, leak,
alert, notification, salt, reserve, pump, water, bypass, power, protect mode)
and the command payloads (`{"water":0|1}`, `{"bypass":0|1}`,
`{"pMode":"..."}`). No Python code runs here and dropmqttapi is not a
dependency. This port was modified: written in JavaScript, every value read
strictly (bounds, integers, flags 0 or 1, unknown never 0), every message
bounded in size, commands only behind options.

Its license:

```
MIT License

Copyright (c) 2023 Chandler Systems, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Home Assistant `drop_connect`

The device types (`hub`, `pv`, `leak`, `soft`, `filt`, `salt`, `alrt`, `pc`,
`ro`), the features each type has, the units (gallons, gallons per minute,
PSI, °F) and the protect modes (`home`, `away`, `schedule`) follow the Home
Assistant integration `drop_connect` (<https://github.com/home-assistant/core>,
`homeassistant/components/drop_connect`, read at commit `93e5689` of
2026-11-02), Apache License 2.0, Copyright the Home Assistant authors. The
example payloads of its tests (`tests/components/drop_connect/common.py`) are
the data of `test/fixtures/drop.js`. No code of it is copied.

## gladys-testkit

`test/kit/` holds files of gladys-testkit, Apache License 2.0, by the same
author: the virtual and real clocks of the tests (commit `f8f5301`) and the
self-signed test certificates with their keys, made for the tests only
(commit `b224c57`).
