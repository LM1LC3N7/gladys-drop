// -----------------------------------------------------------------------------
// The real mqtt.js client and src/mqtt.js against a real local broker
// (helpers/broker.js, TCP or TLS), on the real clock: the size guard, the
// refusals, the MQTT 3.1.1 fallback, the pinned certificate (nothing written,
// so no password, before it is checked), and a command end to end.
// Every wait is bounded; the app and the broker are closed in t.after.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DropApp } from '../src/app.js';
import { FEATURES, LIMITS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { certs } from './kit/index.mjs';
import { DATA, DISCOVERY, HUB, N, cmdTopic, dataTopic, discoveryTopic } from './fixtures/drop.js';
import { ALL, created, memoryLogger } from './helpers/app.js';
import { fakeBroker, hugePublishHeader } from './helpers/broker.js';

const PASSWORD = 'broker-Pa55';

async function until(check, what, ms = 5000) {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function start(t, broker, config, { devices = [], store = memoryStore() } = {}) {
  const gladys = createFakeGladys({ selector: 'drop', config, devices });
  const logger = memoryLogger();
  const app = new DropApp({ gladys, logger, store });
  registerHandlers(gladys, app, logger);
  t.after(async () => {
    await app.shutdown();
    await broker.close();
  });
  await app.boot();
  await gladys.connect();
  return { gladys, app, logger, status: () => gladys.fake.connectionStatus };
}

test('a message over 16 KB cuts the connection before it is read', async (t) => {
  const broker = await fakeBroker();
  const s = await start(t, broker, { broker_url: `127.0.0.1:${broker.port}` });
  await until(() => broker.subscribed.length === 2, 'subscribed');
  assert.equal(broker.connects[0].properties?.maximumPacketSize, LIMITS.packetBytes);
  broker.raw(hugePublishHeader(100 * 1024 * 1024));
  await until(() => /16 KB: connection cut/.test(s.status()?.message?.en ?? ''), 'cut');
});

test('refused credentials: one CONNECT, then nothing, the password never in the logs', async (t) => {
  const broker = await fakeBroker({ connack: () => ({ returnCode: 5 }) });
  const s = await start(t, broker, {
    broker_url: `127.0.0.1:${broker.port}`,
    username: 'drop',
    password: PASSWORD,
  });
  await until(() => /refused the connection/.test(s.status()?.message?.en ?? ''), 'refused');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(broker.connects.length, 1);
  assert.ok(broker.connects[0].password === PASSWORD);
  assert.ok(s.logger.lines.every((l) => !l.includes(PASSWORD)));
  assert.ok(!JSON.stringify(s.gladys.fake.connectionStatuses).includes(PASSWORD));
});

test('a broker without MQTT 5: used in MQTT 3.1.1, said in the status', async (t) => {
  const broker = await fakeBroker({
    connack: (packet) => (packet.protocolVersion === 5 ? { v311Refusal: true } : { returnCode: 0 }),
  });
  const s = await start(t, broker, { broker_url: `127.0.0.1:${broker.port}` });
  await until(() => broker.subscribed.length === 2, 'subscribed');
  assert.deepEqual(
    broker.connects.map((c) => c.protocolVersion),
    [5, 4],
  );
  broker.send(discoveryTopic(N.hub), DISCOVERY.hub);
  broker.send(dataTopic(N.hub), DATA.hub);
  await until(() => s.status()?.connected === true, 'live', 8000);
  assert.match(s.status().message.en, /MQTT 3\.1\.1/);
});

test('TLS with a pinned fingerprint: another certificate gets no byte, the one seen is shown', async (t) => {
  const broker = await fakeBroker({
    tlsOptions: { key: certs.device.key, cert: certs.device.cert },
  });
  const s = await start(t, broker, {
    broker_url: `mqtts://127.0.0.1:${broker.port}`,
    username: 'drop',
    password: PASSWORD,
    broker_fingerprint: certs.impostor.fingerprint256,
  });
  await until(() => /not the pinned one/.test(s.status()?.message?.en ?? ''), 'mismatch');
  assert.ok(s.status().message.en.includes(certs.device.fingerprint256));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(broker.connects.length, 0, 'no CONNECT, so no password');
  assert.ok(
    broker.received.every((r) => r.count === 0),
    'not a byte after the handshake',
  );
  // The right fingerprint: connected, the password sent over the verified connection.
  await s.gladys.fake.configUpdated({
    broker_url: `mqtts://127.0.0.1:${broker.port}`,
    username: 'drop',
    password: PASSWORD,
    broker_fingerprint: certs.device.fingerprint256.toLowerCase(),
  });
  await until(() => broker.subscribed.length === 2, 'subscribed');
  assert.equal(broker.connects.at(-1).password, PASSWORD);
});

test('TLS without a fingerprint: a self-signed certificate is refused, nothing sent', async (t) => {
  const broker = await fakeBroker({
    tlsOptions: { key: certs.device.key, cert: certs.device.cert },
  });
  const s = await start(t, broker, {
    broker_url: `mqtts://127.0.0.1:${broker.port}`,
    username: 'drop',
    password: PASSWORD,
  });
  await until(() => /unreachable/.test(s.status()?.message?.en ?? ''), 'refused certificate');
  assert.equal(broker.connects.length, 0);
});

test('end to end: discovery, states, a shutoff published and confirmed', async (t) => {
  const broker = await fakeBroker();
  const hub = created('hub');
  const s = await start(
    t,
    broker,
    { ...ALL, broker_url: `127.0.0.1:${broker.port}` },
    { devices: [hub] },
  );
  await until(() => broker.subscribed.length === 2, 'subscribed');
  broker.send(discoveryTopic(N.hub), DISCOVERY.hub, { retain: true });
  broker.send(dataTopic(N.hub), DATA.hub, { retain: true });
  await until(() => s.gladys.fake.lastState(`${hub.external_id}:${FEATURES.WATER}`) === 1, 'state');
  const feature = hub.features.find((f) => f.external_id.endsWith(`:${FEATURES.WATER_CLOSE}`));
  const ack = s.gladys.fake.setValue(hub, feature, 1);
  await until(() => broker.published.length === 1, 'published');
  assert.deepEqual(broker.published[0], {
    topic: cmdTopic(N.hub),
    payload: '{"water":0}',
    qos: 0,
    retain: false,
  });
  broker.send(dataTopic(N.hub), { water: 0 });
  const result = await ack;
  assert.equal(result.success, true);
  assert.match(s.status().message.en, /confirmed by the device/);
  assert.equal(HUB, 'DROP-1_C0FFEE');
});
