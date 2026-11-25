// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, a fake broker and a fake DROP hub, on the virtual clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, SUBSCRIPTIONS, TIMINGS } from '../src/constants.js';
import { memoryStore } from '../src/store.js';
import { FID, HUB, ID, N, dataTopic } from './fixtures/drop.js';
import { BASE, created, setup } from './helpers/app.js';

const SECRET = 'S3cret-broker-pass';

test('start: connects, subscribes to the DROP topics, says no message heard yet', async () => {
  const t = await setup();
  assert.equal(t.connector.clients.length, 1);
  assert.equal(t.client.config.host, '192.168.1.20');
  assert.equal(t.client.config.port, 1883);
  assert.equal(t.status().connected, false);
  assert.match(t.status().message.en, /Connecting to mqtt:\/\/192\.168\.1\.20/);
  await t.open();
  assert.deepEqual(t.client.subscriptions, SUBSCRIPTIONS);
  assert.equal(t.status().connected, false);
  assert.match(t.status().message.fr, /aucun message DROP/);
  await t.announce('hub');
  await t.clock.advance(TIMINGS.statusEvery);
  assert.equal(t.status().connected, true);
  assert.match(t.status().message.en, /1 DROP device\(s\) heard/);
  await t.app.shutdown();
});

test('discovery: every type becomes a device of the Discovery tab, accepted by the fake Gladys', async () => {
  const t = await setup();
  await t.open();
  for (const kind of Object.keys(N)) {
    await t.announce(kind);
  }
  await t.clock.advance(TIMINGS.discoveryDebounce);
  const found = t.gladys.fake.discoveredDevices;
  assert.equal(found.length, Object.keys(N).length);
  const hub = found.find((d) => d.external_id === ID(N.hub));
  assert.equal(hub.name, 'Hub DROP-1_C0FFEE');
  assert.deepEqual(
    hub.params.map((p) => [p.name, p.value]),
    [
      ['hub', HUB],
      ['device', '255'],
      ['type', 'hub'],
      ['description', 'Hub'],
    ],
  );
  for (const device of found) {
    for (const f of device.features) {
      assert.ok(!(f.category === 'switch'), `${f.external_id} is a switch`);
      assert.ok(
        !(f.type === 'binary' && f.read_only === false),
        `${f.external_id} commandable binary`,
      );
    }
  }
  await t.app.shutdown();
});

test('states: only for created devices, converted (litres, m3/h, PSI, °F), unknown never 0', async () => {
  const hub = created('hub');
  const leak = created('leak');
  const t = await setup({ devices: [hub, leak] });
  await t.open();
  await t.announce('hub');
  await t.announce('leak');
  await t.announce('softener'); // not created: nothing sent for it
  await t.clock.advance(TIMINGS.flushInterval);
  const last = (id) => t.gladys.fake.lastState(id);
  assert.equal(last(FID(N.hub, FEATURES.FLOW)), 1.311); // 5.77 gpm
  assert.equal(last(FID(N.hub, FEATURES.USED_TODAY)), 881.13); // 232.77 gal
  assert.equal(last(FID(N.hub, FEATURES.PRESSURE)), 62.2);
  assert.equal(last(FID(N.hub, FEATURES.WATER)), 1);
  assert.equal(last(FID(N.hub, FEATURES.LEAK)), 0);
  assert.equal(last(FID(N.hub, FEATURES.BYPASS)), 'off');
  assert.equal(last(FID(N.hub, FEATURES.MODE)), 'home');
  assert.equal(last(FID(N.leak, FEATURES.TEMPERATURE)), 68.2);
  assert.equal(last(FID(N.leak, FEATURES.LEAK)), 1);
  assert.ok(
    t.gladys.fake.states.every((s) => !s.device_feature_external_id.includes(`_${N.softener}:`)),
  );
  // null, '' and a text are unknown: nothing published, never 0.
  const before = t.gladys.fake.states.length;
  await t.publish(dataTopic(N.hub), { psi: null, curFlow: '', battery: 'low', temp: 'n/a' });
  await t.clock.advance(TIMINGS.flushInterval);
  assert.equal(t.gladys.fake.states.length, before);
  await t.app.shutdown();
});

test('a refused password: stopped, never sent again by itself, even after a restart', async () => {
  const store = memoryStore();
  const config = { ...BASE, username: 'drop', password: SECRET };
  const t = await setup({ config, store });
  t.client.refuse(5);
  await t.clock.advance(0);
  assert.equal(t.client.ended, true);
  assert.match(t.status().message.en, /refused the connection \(not authorized\)/);
  await t.clock.advance(10 * 60 * 1000);
  assert.equal(t.connector.clients.length, 1, 'never tried again by itself');
  assert.ok(store.data.refused);
  assert.ok(!JSON.stringify(store.data).includes(SECRET));
  await t.app.shutdown();
  // A restart with the same credentials: nothing sent.
  const again = await setup({ config, store });
  assert.equal(again.connector.clients.length, 0);
  assert.match(again.status().message.fr, /a refusé la connexion/);
  // Other credentials: tried.
  await again.gladys.fake.configUpdated({ ...config, password: 'another one' });
  await again.clock.advance(0);
  assert.equal(again.connector.clients.length, 1);
  await again.open();
  assert.equal(store.data.refused, undefined, 'nothing kept of accepted credentials');
  for (const line of [...t.logger.lines, ...again.logger.lines]) {
    assert.ok(!line.includes(SECRET), line);
  }
  for (const s of [...t.gladys.fake.connectionStatuses, ...again.gladys.fake.connectionStatuses]) {
    assert.ok(!JSON.stringify(s).includes(SECRET));
  }
  await again.app.shutdown();
});

test('getConfig() failing in `connected`: tried again every 30 s until it works', async () => {
  const t = await setup({ getConfigFails: 2 });
  assert.equal(t.connector.clients.length, 0);
  assert.match(t.status().message.en, /could not be read from Gladys/);
  await t.clock.advance(TIMINGS.configRetry - 100);
  assert.equal(t.connector.clients.length, 0);
  await t.clock.advance(100);
  assert.equal(t.connector.clients.length, 0, 'second failure');
  await t.clock.advance(TIMINGS.configRetry);
  assert.equal(t.connector.clients.length, 1, 'third try works');
  await t.app.shutdown();
});

test('a CONNECT closed unanswered twice once sent (credentials left): counted as refused', async () => {
  const config = { ...BASE, username: 'drop', password: SECRET };
  const t = await setup({ config });
  t.connector.options[0].onOpen();
  t.client.close();
  await t.clock.advance(0);
  assert.match(t.status().message.en, /unreachable/);
  t.connector.options[0].onAttempt();
  t.connector.options[0].onOpen();
  t.client.close();
  await t.clock.advance(0);
  assert.match(t.status().message.en, /refused the connection \(.*twice\)/);
  assert.equal(t.client.ended, true);
  assert.ok(t.store.data.refused);
  await t.app.shutdown();
});

test('a subscription refused (ACL): stopped, said', async () => {
  const t = await setup();
  t.client.granted = [{ qos: 128 }, { qos: 128 }];
  await t.open();
  assert.equal(t.client.ended, true);
  assert.match(t.status().message.en, /subscription to drop_connect\/# refused/);
  await t.app.shutdown();
});

test('too many messages: dropped beyond 200 a second, said; at most 64 devices followed', async () => {
  const t = await setup({ devices: [created('hub')] });
  await t.open();
  for (let i = 0; i < 250; i += 1) {
    t.client.deliver(dataTopic(N.hub), { psi: 40 + (i % 10) });
  }
  t.client.deliver(dataTopic(N.hub), { psi: 99 });
  await t.clock.advance(TIMINGS.statusEvery);
  assert.match(t.status().message.en, /Messages dropped/);
  assert.notEqual(t.gladys.fake.lastState(FID(N.hub, FEATURES.PRESSURE)), 99);
  await t.clock.advance(1000);
  for (let i = 0; i < 70; i += 1) {
    await t.publish(dataTopic(String(i)), { battery: 50 });
  }
  await t.clock.advance(TIMINGS.statusEvery);
  // 64 followed: the hub and 63 of the 70; 7 ignored.
  assert.match(t.status().message.en, /7 device\(s\) ignored/);
  await t.app.shutdown();
});

test('a device created later gets the values of the last 2 minutes only, never older', async () => {
  const t = await setup();
  await t.open();
  await t.announce('leak', { data: false });
  await t.publish(dataTopic(N.leak), { battery: 80 });
  await t.clock.advance(5 * 60 * 1000);
  await t.publish(dataTopic(N.leak), { temp: 70 });
  const device = created('leak');
  await t.gladys.fake.deviceCreated(device);
  await t.clock.advance(TIMINGS.flushInterval);
  assert.equal(t.gladys.fake.lastState(FID(N.leak, FEATURES.TEMPERATURE)), 70);
  assert.equal(t.gladys.fake.lastState(FID(N.leak, FEATURES.BATTERY)), undefined);
  await t.app.shutdown();
});

test('/data unreadable: no connection, read again every 10 s; the button connects anyway', async () => {
  const store = memoryStore(null, { unreadable: 'io' });
  const t = await setup({ store });
  assert.equal(t.connector.clients.length, 0);
  assert.match(t.status().message.en, /cannot be read/);
  await t.clock.advance(TIMINGS.storeRetry);
  assert.equal(store.loads, 2);
  assert.equal(t.connector.clients.length, 0);
  store.unreadable = undefined;
  await t.clock.advance(TIMINGS.storeRetry);
  assert.equal(t.connector.clients.length, 1);
  await t.app.shutdown();
  // Content not ours: it waits for the button, which connects.
  const bad = memoryStore(null, { unreadable: 'invalid' });
  const u = await setup({ store: bad });
  await u.clock.advance(5 * TIMINGS.storeRetry);
  assert.equal(bad.loads, 1);
  assert.equal(u.connector.clients.length, 0);
  await u.app.testConnection();
  await u.clock.advance(0);
  assert.equal(u.connector.clients.length, 1);
  await u.app.shutdown();
});

test('the test button: at most every 10 s; lifts a refusal', async () => {
  const config = { ...BASE, username: 'drop', password: SECRET };
  const t = await setup({ config });
  t.client.refuse(135);
  await t.clock.advance(0);
  assert.equal(t.connector.clients.length, 1);
  assert.match(await t.app.testConnection(), /Connexion à mqtt/);
  assert.equal(t.connector.clients.length, 2);
  assert.match(await t.app.testConnection(), /attendez 10 s/);
  assert.equal(t.connector.clients.length, 2);
  await t.clock.advance(TIMINGS.testEvery);
  await t.app.testConnection();
  assert.equal(t.connector.clients.length, 3);
  await t.app.shutdown();
});

test('Gladys reconnects: the status and the Discovery sent again, the MQTT client kept', async () => {
  const t = await setup();
  await t.open();
  await t.announce('hub');
  await t.clock.advance(TIMINGS.discoveryDebounce);
  const scans = t.gladys.fake.discoveredDevices.length;
  const statuses = t.gladys.fake.connectionStatuses.length;
  await t.app.onConnected(() => t.gladys.getConfig());
  await t.clock.advance(0);
  assert.equal(t.connector.clients.length, 1);
  assert.ok(t.gladys.fake.connectionStatuses.length > statuses);
  assert.equal(t.gladys.fake.discoveredDevices.length, scans);
  await t.app.shutdown();
});

test('two configurations saved quickly: one client only, the older start gives way', async () => {
  const store = memoryStore();
  const t = await setup({ config: { ...BASE, username: 'drop', password: SECRET }, store });
  t.client.refuse(5);
  await t.clock.advance(0);
  // Saves now wait: the first new configuration lifts the mark and waits on /data.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const save = store.save.bind(store);
  store.save = async (data) => {
    await gate;
    return save(data);
  };
  const first = t.app.configUpdated({ ...BASE, username: 'drop', password: 'second' });
  await t.clock.advance(0);
  const second = t.app.configUpdated({ ...BASE, username: 'drop', password: 'third' });
  await t.clock.advance(0);
  release();
  await Promise.all([first, second]);
  await t.clock.advance(0);
  const live = t.connector.clients.filter((c) => !c.ended);
  assert.equal(live.length, 1, `${live.length} clients left open`);
  assert.equal(live[0].config.password, 'third');
  await t.app.shutdown();
});

test('disconnected: what was heard is unknown again, never published to a device created meanwhile', async () => {
  const t = await setup();
  await t.open();
  await t.announce('leak', { data: false });
  await t.publish(dataTopic(N.leak), { battery: 80, leak: 0 });
  t.client.close();
  await t.clock.advance(0);
  await t.gladys.fake.deviceCreated(created('leak'));
  await t.clock.advance(TIMINGS.flushInterval);
  assert.equal(t.gladys.fake.lastState(FID(N.leak, FEATURES.BATTERY)), undefined);
  await t.app.shutdown();
});

test('a value left waiting more than 2 minutes for Gladys is never sent as new', async () => {
  const t = await setup({ devices: [created('hub')] });
  await t.open();
  const publish = t.gladys.publishChangedStates.bind(t.gladys);
  let failing = true;
  t.gladys.publishChangedStates = async (...args) => {
    if (failing) throw new Error('Gladys unavailable');
    return publish(...args);
  };
  await t.announce('hub');
  await t.clock.advance(TIMINGS.freshFor + 2000);
  failing = false;
  await t.clock.advance(TIMINGS.flushInterval * 2);
  assert.equal(t.gladys.fake.lastState(FID(N.hub, FEATURES.FLOW)), undefined);
  await t.publish(dataTopic(N.hub), { curFlow: 1 });
  await t.clock.advance(TIMINGS.flushInterval);
  assert.equal(t.gladys.fake.lastState(FID(N.hub, FEATURES.FLOW)), 0.227);
  await t.app.shutdown();
});
