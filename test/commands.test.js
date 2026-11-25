// -----------------------------------------------------------------------------
// The commands: the water valve (shut off, turn on), the bypass and the
// protect mode. Louis's rule: all off by default, the option read at the
// click and again right before the publication, never a switch; turning the
// water on decided on what the hub said in this connection; nothing clicked
// before a shutoff leaves after it; Gladys answered by 3.5 s.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, TIMINGS } from '../src/constants.js';
import { HUB, N, cmdTopic, dataTopic } from './fixtures/drop.js';
import { ALL, BASE, created, setup } from './helpers/app.js';

const hub = () => created('hub');

async function ready(options = {}) {
  const devices = options.devices ?? [hub(), created('valve'), created('leak'), created('alert')];
  const t = await setup({ config: ALL, devices, ...options });
  await t.open();
  for (const kind of ['hub', 'valve', 'leak', 'alert']) {
    await t.announce(kind, { data: false });
  }
  await t.publish(dataTopic(N.hub), { water: 1, leak: 0, bypass: 0, pMode: 'home' }, true);
  await t.publish(dataTopic(N.valve), { water: 1, leak: 0 }, true);
  await t.publish(dataTopic(N.leak), { leak: 0, battery: 90 }, true);
  await t.publish(dataTopic(N.alert), { sens: 0, pwrOff: 0 }, true);
  return t;
}

const sent = (t) => t.client.commands();
const said = (t) => t.status().message.en;

test('everything is off by default: nothing sent, the reason said', async () => {
  const t = await setup({ config: BASE, devices: [hub()] });
  await t.open();
  await t.announce('hub');
  const device = hub();
  for (const [key, value] of [
    [FEATURES.WATER_CLOSE, 1],
    [FEATURES.WATER_OPEN, 1],
    [FEATURES.BYPASS, 'on'],
    [FEATURES.MODE, 'away'],
  ]) {
    const ack = await t.press(device, key, value);
    assert.equal(ack.success, false, key);
    assert.match(said(t), /is off in the configuration\. Nothing sent\./);
  }
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
});

test('shut off: sent at once, confirmed by the next live message of the device', async () => {
  const t = await ready();
  const start = t.clock.elapsed;
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.ok(t.clock.elapsed - start < TIMINGS.commandAnswerBy);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.equal(t.client.published[0].qos, 0);
  assert.equal(t.client.published[0].retain, false);
  assert.match(said(t), /done, confirmed by the device/);
  await t.app.shutdown();
});

test('shut off without an answer: "sent, without confirmation" by 3.5 s, then "not applied" at 20 s', async () => {
  const t = await ready({ follow: false });
  const start = t.clock.elapsed;
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true, 'never a refusal: it left');
  assert.ok(t.clock.elapsed - start <= TIMINGS.commandAnswerBy + 60);
  assert.match(said(t), /sent, without confirmation/);
  // The same state as before is not a confirmation; a retained message neither.
  await t.publish(dataTopic(N.hub), { water: 1 });
  await t.publish(dataTopic(N.hub), { water: 0 }, true);
  await t.clock.advance(TIMINGS.confirmWatch);
  assert.match(said(t), /did not show it applied within 20 s/);
  await t.app.shutdown();
});

test('shut off: late confirmation within 20 s is said', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.clock.advance(5000);
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.match(said(t), /done, confirmed by the device/);
  await t.app.shutdown();
});

test('not connected, or the broker does not take it: "Nothing sent"', async () => {
  const t = await ready();
  t.client.publishMode = 'error';
  let ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, false);
  assert.match(said(t), /did not take the command\. Nothing sent\./);
  t.client.publishMode = undefined;
  t.client.close();
  await t.clock.advance(0);
  ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, false);
  assert.match(said(t), /not connected to the broker\. Nothing sent\./);
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
});

test('a write left hanging: answered "sent, without confirmation", never a refusal', async () => {
  const t = await ready({ follow: false });
  t.client.publishMode = 'hang';
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.match(said(t), /sent, without confirmation/);
  await t.app.shutdown();
});

test('turn on: sent only on a known closed valve without any leak of the hub', async () => {
  const t = await ready();
  // Already on: nothing sent.
  let ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, true);
  assert.match(said(t), /already in that state\. Nothing sent\./);
  assert.deepEqual(sent(t), []);
  await t.publish(dataTopic(N.hub), { water: 0 });
  ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, true);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 1 } }]);
  assert.match(said(t), /confirmed/);
  await t.app.shutdown();
});

test('turn on refused: leak on the device, a detector, an alert, or unknown leak state', async () => {
  const cases = [
    [dataTopic(N.hub), { water: 0, leak: 1 }, /a leak is reported/],
    [dataTopic(N.leak), { leak: 1 }, /a leak is reported \(Laundry leak\)/],
    [dataTopic(N.alert), { sens: 1 }, /a leak is reported \(Sump alert\)/],
    [dataTopic(N.hub), { water: 0, leak: null }, /leak state is unknown/],
    [dataTopic(N.hub), { water: 0, leak: 2 }, /leak state is unknown/],
  ];
  for (const [topic, payload, reason] of cases) {
    const t = await ready();
    await t.publish(dataTopic(N.hub), { water: 0 });
    await t.publish(topic, payload);
    const ack = await t.press(hub(), FEATURES.WATER_OPEN);
    assert.equal(ack.success, false, JSON.stringify(payload));
    assert.match(said(t), reason);
    assert.deepEqual(sent(t), []);
    await t.app.shutdown();
  }
});

test('turn on refused when nothing heard in this connection (values reset at reconnection)', async () => {
  const t = await ready();
  await t.publish(dataTopic(N.hub), { water: 0 });
  t.client.close();
  await t.clock.advance(0);
  t.client.open();
  await t.clock.advance(0);
  let ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /not heard since the connection/);
  // The leak state must come with it.
  await t.publish(dataTopic(N.hub), { water: 0 });
  ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /leak state is unknown/);
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
});

test('turn on refused while a shutoff is under way', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.publish(dataTopic(N.hub), { water: 1 });
  await t.publish(dataTopic(N.hub), { water: 0, leak: 0 }, true); // retained: not live
  const ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /shutoff is still under way/);
  assert.equal(sent(t).length, 1);
  await t.app.shutdown();
});

test('the option unchecked while the command waits its turn: never sent', async () => {
  const t = await ready({ delay: 1000 });
  await t.publish(dataTopic(N.hub), { water: 0 });
  const device = hub();
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const first = t.gladys.fake.setValue(device, feature(FEATURES.BYPASS), 'on');
  await t.clock.advance(10);
  const second = t.gladys.fake.setValue(device, feature(FEATURES.WATER_OPEN), 1);
  await t.clock.advance(10);
  await t.gladys.fake.configUpdated({ ...ALL, allow_water_open: false });
  await t.clock.advance(1500);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.success, true);
  assert.equal(b.success, false);
  assert.deepEqual(
    sent(t).map((c) => c.body),
    [{ bypass: 1 }],
  );
  await t.app.shutdown();
});

test('nothing clicked before a shutoff leaves after it', async () => {
  const t = await ready({ delay: 1000 });
  await t.publish(dataTopic(N.hub), { water: 0 });
  const device = hub();
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const bypass = t.gladys.fake.setValue(device, feature(FEATURES.BYPASS), 'on');
  await t.clock.advance(10);
  const open = t.gladys.fake.setValue(device, feature(FEATURES.WATER_OPEN), 1);
  await t.clock.advance(10);
  const close = t.gladys.fake.setValue(device, feature(FEATURES.WATER_CLOSE), 1);
  for (let i = 0; i < 80; i += 1) await t.clock.advance(50);
  const [, o, c] = await Promise.all([bypass, open, close]);
  assert.equal(c.success, true);
  assert.equal(o.success, false);
  assert.deepEqual(
    sent(t).map((x) => x.body),
    [{ bypass: 1 }, { water: 0 }],
  );
  assert.ok(sent(t).every((x) => x.body.water !== 1));
  await t.app.shutdown();
});

test('a command waiting more than 2 s for its turn is never sent', async () => {
  const t = await ready({ delay: 3000 });
  const device = hub();
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const first = t.gladys.fake.setValue(device, feature(FEATURES.BYPASS), 'on');
  await t.clock.advance(10);
  const clickAt = t.clock.elapsed;
  let answeredAt;
  const second = t.gladys.fake.setValue(device, feature(FEATURES.MODE), 'away').finally(() => {
    answeredAt = t.clock.elapsed;
  });
  for (let i = 0; i < 120; i += 1) await t.clock.advance(50);
  const [a, b] = await Promise.all([first, second]);
  assert.ok(
    answeredAt - clickAt <= TIMINGS.commandAnswerBy + 60,
    `answered after ${answeredAt - clickAt}`,
  );
  assert.equal(a.success, true);
  assert.equal(b.success, false);
  assert.deepEqual(
    sent(t).map((x) => x.body),
    [{ bypass: 1 }],
  );
  await t.app.shutdown();
});

test('bypass and protect mode: sent when allowed, nothing when already so, bad values refused', async () => {
  const t = await ready();
  let ack = await t.press(hub(), FEATURES.BYPASS, 'off');
  assert.equal(ack.success, true);
  assert.match(said(t), /already in that state/);
  ack = await t.press(hub(), FEATURES.BYPASS, 'on');
  assert.equal(ack.success, true);
  ack = await t.press(hub(), FEATURES.MODE, 'away');
  assert.equal(ack.success, true);
  ack = await t.press(hub(), FEATURES.MODE, 'vacation');
  assert.equal(ack.success, false);
  ack = await t.press(hub(), FEATURES.BYPASS, 1);
  assert.equal(ack.success, false);
  ack = await t.press(hub(), FEATURES.WATER_CLOSE, 0);
  assert.equal(ack.success, false);
  assert.deepEqual(
    sent(t).map((x) => [x.topic, x.body]),
    [
      [cmdTopic(N.hub), { bypass: 1 }],
      [cmdTopic(N.hub), { pMode: 'away' }],
    ],
  );
  await t.app.shutdown();
});

test('identity: a feature the type has not, or a type changed on the hub, is refused', async () => {
  const leak = created('leak');
  const t = await ready();
  // A leak detector has no valve.
  const forged = {
    ...leak,
    features: [{ ...leak.features[0], external_id: `${leak.external_id}:${FEATURES.WATER_CLOSE}` }],
  };
  let ack = await t.press(forged, FEATURES.WATER_CLOSE);
  assert.equal(ack.success, false);
  // The hub now says the device 20 is a valve: the created leak detector is not commanded.
  await t.publish(`drop_connect/discovery/${HUB}/20`, {
    devType: 'pv',
    devDesc: 'Protection Valve',
    name: 'x',
  });
  const asValve = created('valve');
  const shifted = {
    ...leak,
    features: asValve.features.map((f) => ({
      ...f,
      external_id: f.external_id.replace(`_${N.valve}:`, `_${N.leak}:`),
    })),
  };
  ack = await t.press(shifted, FEATURES.WATER_CLOSE);
  assert.equal(ack.success, false);
  assert.match(said(t), /another type/);
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
});

test('a scene shutting 5 slow valves off: all 5 sent and answered in time', async () => {
  const hubs = ['DROP-A1', 'DROP-B2', 'DROP-C3', 'DROP-D4', 'DROP-E5'];
  const devices = hubs.map((h) => created('valve', { hub: h }));
  const t = await setup({ config: ALL, devices, delay: 800 });
  await t.open();
  for (const h of hubs) {
    await t.announce('valve', { hub: h });
  }
  const acks = devices.map((d) =>
    t.gladys.fake.setValue(
      d,
      d.features.find((f) => f.external_id.endsWith(`:${FEATURES.WATER_CLOSE}`)),
      1,
    ),
  );
  for (let i = 0; i < 40; i += 1) await t.clock.advance(50);
  const results = await Promise.all(acks);
  assert.ok(results.every((r) => r.success));
  assert.deepEqual(
    sent(t)
      .map((x) => x.topic)
      .sort(),
    hubs.map((h) => cmdTopic(N.valve, h)).sort(),
  );
  await t.app.shutdown();
});

test('a shutoff refused (its option off) never cancels a command waiting its turn', async () => {
  const t = await ready({ delay: 1000, config: { ...ALL, allow_water_close: false } });
  await t.publish(dataTopic(N.hub), { water: 0 });
  const device = hub();
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const bypass = t.gladys.fake.setValue(device, feature(FEATURES.BYPASS), 'on');
  await t.clock.advance(10);
  const open = t.gladys.fake.setValue(device, feature(FEATURES.WATER_OPEN), 1);
  await t.clock.advance(10);
  const close = t.gladys.fake.setValue(device, feature(FEATURES.WATER_CLOSE), 1);
  for (let i = 0; i < 80; i += 1) await t.clock.advance(50);
  const [, o, c] = await Promise.all([bypass, open, close]);
  assert.equal(c.success, false);
  assert.equal(o.success, true);
  assert.deepEqual(
    sent(t).map((x) => x.body),
    [{ bypass: 1 }, { water: 1 }],
  );
  await t.app.shutdown();
});

test('a command that left late in its turn is answered "sent", never "Nothing sent"', async () => {
  const t = await ready({ delay: 1900 });
  await t.publish(dataTopic(N.hub), { water: 0 });
  const device = hub();
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const first = t.gladys.fake.setValue(device, feature(FEATURES.BYPASS), 'on');
  await t.clock.advance(1);
  const second = t.gladys.fake.setValue(device, feature(FEATURES.WATER_OPEN), 1);
  for (let i = 0; i < 100; i += 1) await t.clock.advance(50);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.success, true);
  assert.equal(b.success, true);
  assert.deepEqual(
    sent(t).map((x) => x.body),
    [{ bypass: 1 }, { water: 1 }],
  );
  assert.ok(t.logger.lines.some((l) => /water_open|open sent/.test(l)));
  await t.app.shutdown();
});

test('two shutoffs: the end of the first watch does not end the second', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.clock.advance(10_000);
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.clock.advance(TIMINGS.confirmWatch - 10_000);
  // Retained: the hub's state, not a confirmation of the second shutoff.
  await t.publish(dataTopic(N.hub), { water: 0, leak: 0 }, true);
  const ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /shutoff is still under way/);
  await t.app.shutdown();
});

test('a shutoff confirmed at once still cancels a turn-on waiting behind a slow command', async () => {
  const t = await ready();
  await t.publish(dataTopic(N.hub), { water: 0 });
  // The hub: the water at once, the bypass after 1 s.
  t.connector.responder = (topic, payload, client) => {
    const body = JSON.parse(payload);
    const deliver = () => client.deliver(dataTopic(N.hub), body);
    if ('bypass' in body) t.clock.timers.setTimeout(deliver, 1000);
    else setImmediate(deliver);
  };
  const device = hub();
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const bypass = t.gladys.fake.setValue(device, feature(FEATURES.BYPASS), 'on');
  await t.clock.advance(10);
  const open = t.gladys.fake.setValue(device, feature(FEATURES.WATER_OPEN), 1);
  await t.clock.advance(10);
  const close = t.gladys.fake.setValue(device, feature(FEATURES.WATER_CLOSE), 1);
  for (let i = 0; i < 80; i += 1) await t.clock.advance(50);
  const [, o, c] = await Promise.all([bypass, open, close]);
  assert.equal(c.success, true);
  assert.equal(o.success, false);
  assert.deepEqual(
    sent(t).map((x) => x.body),
    [{ bypass: 1 }, { water: 0 }],
  );
  await t.app.shutdown();
});
