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
import { memoryStore } from '../src/store.js';
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

/** Moves the clock until every promise is settled (bounded: fails, never hangs). */
async function settled(t, promises) {
  let done = 0;
  for (const p of promises) p.finally(() => (done += 1)).catch(() => {});
  for (let i = 0; i < 200 && done < promises.length; i += 1) await t.clock.advance(50);
  assert.equal(done, promises.length, 'not answered within 10 s');
  return Promise.all(promises);
}
const said = (t) => t.status().message.en;

test('by default: the shutoff leaves without any option; the others refused, the reason said', async () => {
  const t = await setup({ config: BASE, devices: [hub()] });
  await t.open();
  await t.announce('hub');
  const device = hub();
  for (const [key, value] of [
    [FEATURES.WATER_OPEN, 1],
    [FEATURES.BYPASS, 'on'],
    [FEATURES.MODE, 'away'],
  ]) {
    const ack = await t.press(device, key, value);
    assert.equal(ack.success, false, key);
    assert.match(said(t), /is off in the configuration\. Nothing sent\./);
  }
  assert.deepEqual(sent(t), []);
  const ack = await t.press(device, FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.match(said(t), /confirmed by the device/);
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
  assert.equal(t.app.stops.size, 0, 'confirmed: not kept');
  // Confirmed: never sent again.
  await t.clock.advance(5 * 60 * 1000);
  assert.equal(sent(t).length, 1);
  await t.app.shutdown();
});

test('shut off without an answer: kept, sent again 3 times every 20 s, then held every 10 min', async () => {
  const t = await ready({ follow: false });
  const start = t.clock.elapsed;
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true, 'never a refusal: it left');
  assert.ok(t.clock.elapsed - start <= TIMINGS.commandAnswerBy + 60);
  assert.match(said(t), /shutoff sent, not confirmed yet: sent again/);
  assert.match(said(t), /1 shutoff\(s\) kept/);
  // A retained "water on" (the broker's copy): no resend.
  await t.publish(dataTopic(N.hub), { water: 1 }, true);
  assert.equal(sent(t).length, 1);
  for (let i = 2; i <= 4; i += 1) {
    await t.clock.advance(TIMINGS.stopCheck);
    assert.equal(sent(t).length, i, `resend ${i - 1}`);
  }
  await t.clock.advance(TIMINGS.stopCheck);
  assert.equal(sent(t).length, 4, 'held after 3 resends');
  await t.clock.advance(TIMINGS.statusEvery);
  assert.match(said(t), /1 held \(sent again every 10 min\)/);
  await t.clock.advance(TIMINGS.stopHeldEvery);
  assert.equal(sent(t).length, 5);
  assert.ok(sent(t).every((c) => c.body.water === 0 && c.topic === cmdTopic(N.hub)));
  // Seen applied (live): let go, never sent again.
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.equal(t.app.stops.size, 0);
  await t.clock.advance(TIMINGS.stopHeldEvery * 2);
  assert.equal(sent(t).length, 5);
  await t.app.shutdown();
});

test('shut off contradicted: a live "water on" 2 s after the send sends it again at once', async () => {
  const t = await ready({ follow: false });
  const device = hub();
  const close = device.features.find((f) => f.external_id.endsWith(`:${FEATURES.WATER_CLOSE}`));
  const ack = t.gladys.fake.setValue(device, close, 1);
  await t.clock.advance(100);
  await t.publish(dataTopic(N.hub), { water: 1 }); // in flight: too soon
  assert.equal(sent(t).length, 1);
  await t.clock.advance(TIMINGS.stopApplyDelay);
  await t.publish(dataTopic(N.hub), { water: 1 });
  assert.equal(sent(t).length, 2);
  for (let i = 0; i < 40; i += 1) await t.clock.advance(50);
  assert.equal((await ack).success, true);
  await t.app.shutdown();
});

test('shut off: late confirmation is said', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.clock.advance(5000);
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.match(said(t), /done, confirmed by the device/);
  await t.app.shutdown();
});

test('shut off clicked offline: kept, sent right after the next SUBACK, before any hub message', async () => {
  const t = await ready({ follow: false });
  t.client.close();
  await t.clock.advance(0);
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.match(said(t), /shutoff kept, sent as soon as the broker connection is back/);
  assert.deepEqual(sent(t), []);
  t.client.open();
  await t.clock.advance(0);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  await t.app.shutdown();
});

test('shut off: a write error keeps it, sent again; /data failing never holds it back', async () => {
  const t = await ready({ follow: false, store: memoryStore(null, { failing: true }) });
  t.client.publishMode = 'error';
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.match(said(t), /shutoff kept/);
  t.client.publishMode = undefined;
  await t.clock.advance(TIMINGS.stopCheck);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  await t.app.shutdown();
});

test('the other commands: not connected, or the broker does not take it: "Nothing sent"', async () => {
  const t = await ready();
  t.client.publishMode = 'error';
  let ack = await t.press(hub(), FEATURES.BYPASS, 'on');
  assert.equal(ack.success, false);
  assert.match(said(t), /did not take the command\. Nothing sent\./);
  t.client.publishMode = undefined;
  t.client.close();
  await t.clock.advance(0);
  ack = await t.press(hub(), FEATURES.BYPASS, 'on');
  assert.equal(ack.success, false);
  assert.match(said(t), /not connected to the broker\. Nothing sent\./);
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
});

test('a write left hanging: answered "sent", never a refusal', async () => {
  const t = await ready({ follow: false });
  t.client.publishMode = 'hang';
  let ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.match(said(t), /shutoff sent, not confirmed yet/);
  ack = await t.press(hub(), FEATURES.BYPASS, 'on');
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
  // The protection valve of the same hub, closed: its turn-on waits for the hub's shutoff.
  await t.publish(dataTopic(N.valve), { water: 0, leak: 0 });
  const ack = await t.press(created('valve'), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /shutoff of this hub left less than 20 s ago/);
  // The live "water on" after the shutoff contradicted it: sent again, never a turn-on.
  assert.deepEqual(
    sent(t).map((x) => x.body),
    [{ water: 0 }, { water: 0 }],
  );
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
  // Bounded: the clock moves until both are answered, never a wait on a timer that never fires.
  const [a, b] = await settled(t, [first, second]);
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
  await t.publish(dataTopic(N.valve), { water: 0, leak: 0 });
  const ack = await t.press(created('valve'), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /shutoff of this hub left less than 20 s ago/);
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

test('restart: a shutoff kept in /data leaves at the connection, without a click nor a hub message', async () => {
  const store = memoryStore();
  const t = await ready({ follow: false, store });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.clock.advance(0);
  assert.equal(store.data.stops.length, 1);
  assert.equal(store.data.stops[0].device, N.hub);
  await t.app.shutdown();
  const again = await setup({ config: BASE, devices: [hub()], store, follow: false });
  assert.deepEqual(again.client.published, []);
  await again.open();
  assert.deepEqual(again.client.commands(), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  // Seen applied: let go, /data emptied.
  await again.publish(dataTopic(N.hub), { water: 0 });
  await again.clock.advance(0);
  assert.equal(store.data.stops, undefined);
  await again.app.shutdown();
});

test('a turn-on that left after a kept shutoff lets it go: never sent again after it', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  // Not seen applied: 3 resends, then held (the last send 20 s ago, so a turn-on may leave).
  for (let i = 0; i < 4; i += 1) await t.clock.advance(TIMINGS.stopCheck);
  assert.equal(sent(t).length, 4);
  await t.publish(dataTopic(N.hub), { water: 1, leak: 0 }, true);
  t.world.follow = true;
  await t.publish(dataTopic(N.hub), { water: 0, leak: 0 }, true);
  const ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, true);
  assert.deepEqual(sent(t).at(-1).body, { water: 1 });
  assert.equal(t.app.stops.size, 0);
  const count = sent(t).length;
  await t.clock.advance(2 * TIMINGS.stopHeldEvery);
  assert.equal(sent(t).length, count, 'the shutoff is not sent against the turn-on');
  await t.app.shutdown();
});

test('/data unreadable: a shutoff clicked connects anyway and leaves', async () => {
  const store = memoryStore(null, { unreadable: 'invalid' });
  const t = await setup({ store, devices: [hub()] });
  assert.equal(t.connector.clients.length, 0);
  const ack = await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(ack.success, true);
  assert.equal(t.connector.clients.length, 1);
  await t.open();
  assert.deepEqual(t.client.commands(), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.equal(store.saves, 0, 'never written over the unreadable file');
  await t.app.shutdown();
});

test('turn on refused while a leak-capable device of the hub has an unknown state', async () => {
  // A detector created in Gladys and never heard in this connection.
  const basement = created('leak', { name: 'Basement leak' });
  basement.external_id = basement.external_id.replace(`_${N.leak}`, '_21');
  const t = await ready({ devices: [hub(), created('valve'), created('alert'), basement] });
  await t.publish(dataTopic(N.hub), { water: 0 });
  let ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /leak state of Basement leak is unknown/);
  // A detector announced without data: unknown too.
  const u = await ready();
  await u.publish(dataTopic(N.hub), { water: 0 });
  await u.publish(`drop_connect/discovery/${HUB}/30`, {
    devType: 'leak',
    devDesc: 'Leak Detector',
    name: 'Attic leak',
  });
  ack = await u.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(u), /leak state of Attic leak is unknown/);
  await u.publish(dataTopic('30'), { leak: 0 });
  ack = await u.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, true);
  assert.deepEqual(sent(u).at(-1).body, { water: 1 });
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
  await u.app.shutdown();
});

test('turn on refused while messages are being dropped (a leak may be among them)', async () => {
  const t = await ready();
  await t.publish(dataTopic(N.hub), { water: 0 });
  for (let i = 0; i < 260; i += 1) t.client.deliver(dataTopic(N.hub), { psi: 50 });
  t.client.deliver(dataTopic(N.leak), { leak: 1 }); // dropped
  await t.clock.advance(0);
  let ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /state is uncertain/);
  // 3 s later: still refused, every value unknown until the next message of each device.
  await t.clock.advance(3000);
  ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  await t.publish(dataTopic(N.hub), { water: 0, leak: 0 });
  await t.publish(dataTopic(N.valve), { water: 1, leak: 0 });
  await t.publish(dataTopic(N.alert), { sens: 0 });
  ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false, 'the detector is still unknown');
  assert.match(said(t), /leak state of Laundry leak is unknown/);
  await t.publish(dataTopic(N.leak), { leak: 0 });
  ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, true);
  await t.app.shutdown();
});

test('a shutoff of the hub cancels and refuses for 20 s a turn-on of a valve of the same hub', async () => {
  const t = await ready({ delay: 1000 });
  await t.publish(dataTopic(N.valve), { water: 0 });
  const valve = created('valve');
  const feature = (d, key) => d.features.find((f) => f.external_id.endsWith(`:${key}`));
  const bypass = t.gladys.fake.setValue(hub(), feature(hub(), FEATURES.BYPASS), 'on');
  await t.clock.advance(10);
  // The valve's turn-on is in the lane of the valve; the hub's shutoff must still cancel it.
  const open = t.gladys.fake.setValue(valve, feature(valve, FEATURES.WATER_OPEN), 1);
  const close = t.gladys.fake.setValue(hub(), feature(hub(), FEATURES.WATER_CLOSE), 1);
  for (let i = 0; i < 80; i += 1) await t.clock.advance(50);
  const [, o, c] = await Promise.all([bypass, open, close]);
  assert.equal(c.success, true);
  assert.equal(o.success, false);
  assert.ok(sent(t).every((x) => x.body.water !== 1));
  await t.app.shutdown();
});

test('a command is confirmed only by a live message with the value asked', async () => {
  const t = await ready({ follow: false });
  const device = hub();
  const bypass = device.features.find((f) => f.external_id.endsWith(`:${FEATURES.BYPASS}`));
  const ack = t.gladys.fake.setValue(device, bypass, 'on');
  await t.clock.advance(100);
  await t.publish(dataTopic(N.hub), { bypass: 1 }, true); // retained: the broker's copy
  await t.publish(dataTopic(N.hub), { bypass: 0 }); // live, the value before
  for (let i = 0; i < 80; i += 1) await t.clock.advance(50);
  assert.equal((await ack).success, true);
  assert.match(said(t), /sent, without confirmation/);
  await t.publish(dataTopic(N.hub), { bypass: 1 });
  assert.match(said(t), /done, confirmed by the device/);
  await t.app.shutdown();
});

test('a shutoff of a valve known closed: a turn-on made elsewhere later is never fought', async () => {
  const t = await ready({ follow: false });
  await t.publish(dataTopic(N.hub), { water: 0 });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(t.app.stops.size, 1);
  await t.clock.advance(1000);
  // The DROP app opens the water: a live "water on".
  await t.publish(dataTopic(N.hub), { water: 1 });
  assert.equal(t.app.stops.size, 0);
  await t.clock.advance(TIMINGS.stopHeldEvery * 2);
  assert.equal(sent(t).length, 1, 'never sent again against it');
  await t.app.shutdown();
});

test('I5: a shutoff that left is never let go by a retained "water off"; a live one lets it go', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  assert.equal(sent(t).length, 1);
  // Reconnection: the retained "off" (maybe older than the click) comes with the SUBACK, before the resend.
  t.client.close();
  await t.clock.advance(0);
  t.client.withSuback = [[dataTopic(N.hub), { water: 0, leak: 0 }]];
  t.client.open();
  await t.clock.advance(0);
  assert.equal(sent(t).length, 2, 'sent again at the connection');
  assert.equal(t.app.stops.size, 1, 'kept: a retained message never lets it go');
  // The same retained "off" once more after the resend: still kept.
  await t.publish(dataTopic(N.hub), { water: 0 }, true);
  assert.equal(t.app.stops.size, 1);
  // Not confirmed live: sent again 20 s later.
  await t.clock.advance(TIMINGS.stopCheck);
  assert.equal(sent(t).length, 3, 'sent again without a live confirmation');
  assert.ok(sent(t).every((c) => c.body.water === 0 && c.topic === cmdTopic(N.hub)));
  // A live "off" received after the send: let go, never sent again.
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.equal(t.app.stops.size, 0);
  await t.clock.advance(TIMINGS.stopHeldEvery * 2);
  assert.equal(sent(t).length, 3);
  await t.app.shutdown();
});

test('I5: a missed live confirmation: a turn-on made in the DROP app is cut once, then let go by the live "off"', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  // The live "off" of the hub is missed (the integration was disconnected).
  t.client.close();
  await t.clock.advance(0);
  t.client.withSuback = [[dataTopic(N.hub), { water: 0, leak: 0 }]];
  t.client.open();
  await t.clock.advance(0);
  assert.equal(sent(t).length, 2);
  assert.equal(t.app.stops.size, 1);
  // The DROP app turns the water on: a contradiction (a retained "off" is never "known closed").
  await t.clock.advance(TIMINGS.stopApplyDelay);
  await t.publish(dataTopic(N.hub), { water: 1 });
  assert.equal(sent(t).length, 3, 'cut once');
  // The hub shows it closed, live: let go; the next turn-on made in the app is never fought.
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.equal(t.app.stops.size, 0);
  await t.clock.advance(TIMINGS.stopApplyDelay);
  await t.publish(dataTopic(N.hub), { water: 1 });
  await t.clock.advance(TIMINGS.stopHeldEvery * 2);
  assert.equal(sent(t).length, 3);
  await t.app.shutdown();
});

test('a shutoff never seen applied: given up when the device is deleted, or after 24 h', async () => {
  const t = await ready({ follow: false });
  const device = hub();
  await t.press(device, FEATURES.WATER_CLOSE);
  await t.gladys.fake.deviceDeleted(device);
  await t.clock.advance(0);
  assert.equal(t.app.stops.size, 0);
  const u = await ready({ follow: false });
  await u.press(hub(), FEATURES.WATER_CLOSE);
  await u.clock.advance(TIMINGS.stopExpiry + TIMINGS.stopHeldEvery);
  assert.equal(u.app.stops.size, 0);
  const count = sent(u).length;
  await u.clock.advance(TIMINGS.stopHeldEvery * 2);
  assert.equal(sent(u).length, count);
  assert.ok(u.logger.lines.some((l) => /given up: not seen applied in 24 h/.test(l)));
  await t.app.shutdown();
  await u.app.shutdown();
});

test('a leak heard from any device of the hub refuses, even of an unknown type', async () => {
  const t = await ready();
  await t.publish(dataTopic(N.hub), { water: 0 });
  // Device 22: heard by its data only, neither announced nor created.
  await t.publish(dataTopic('22'), { leak: 1 });
  const ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, false);
  assert.match(said(t), /a leak is reported/);
  assert.deepEqual(sent(t), []);
  await t.app.shutdown();
});

test('a turn-on whose write was left hanging never lets a shutoff go', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  for (let i = 0; i < 4; i += 1) await t.clock.advance(TIMINGS.stopCheck);
  await t.publish(dataTopic(N.hub), { water: 1, leak: 0 }, true);
  t.client.publishMode = 'hang';
  await t.publish(dataTopic(N.hub), { water: 0, leak: 0 });
  // A live "water off" lets it go: start again with a stop kept and the valve still on.
  assert.equal(t.app.stops.size, 0);
  t.client.publishMode = undefined;
  await t.publish(dataTopic(N.hub), { water: 1 });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  for (let i = 0; i < 4; i += 1) await t.clock.advance(TIMINGS.stopCheck);
  t.client.publishMode = 'hang';
  t.app.registry.get(`${HUB}_${N.hub}`).values.set('water', { value: 0, at: 0, live: true });
  const ack = await t.press(hub(), FEATURES.WATER_OPEN);
  assert.equal(ack.success, true, 'answered "sent"');
  assert.equal(t.app.stops.size, 1, 'in doubt, the shutoff stays');
  await t.app.shutdown();
});

test('a command is never confirmed by a message of another device', async () => {
  const t = await ready({
    follow: false,
    devices: [hub(), created('softener'), created('valve'), created('leak'), created('alert')],
  });
  const device = hub();
  const bypass = device.features.find((f) => f.external_id.endsWith(`:${FEATURES.BYPASS}`));
  const ack = t.gladys.fake.setValue(device, bypass, 'on');
  await t.clock.advance(100);
  await t.publish(dataTopic(N.softener), { bypass: 1 });
  const [result] = await settled(t, [ack]);
  assert.equal(result.success, true);
  assert.match(said(t), /sent, without confirmation/);
  await t.app.shutdown();
});

test('B3: clicked offline, the wall clock jumps 25 h before the connection: sent all the same', async () => {
  const t = await ready({ follow: false });
  t.client.close();
  await t.clock.advance(0);
  await t.press(hub(), FEATURES.WATER_CLOSE);
  const wall = t.app.now;
  t.app.now = () => wall() + 25 * 3600 * 1000;
  t.client.open();
  await t.clock.advance(0);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.equal(t.app.stops.size, 1, 'kept: never given up by the wall clock');
  await t.app.shutdown();
});

test('B3: a shutoff read from a 2-day-old /data leaves at the connection', async () => {
  const store = memoryStore({
    stops: [{ hub: HUB, device: N.hub, name: 'Hub', at: Date.UTC(2025, 11, 30) }],
  });
  const t = await setup({ config: BASE, devices: [hub()], store, follow: false });
  await t.open();
  assert.deepEqual(t.client.commands(), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.equal(t.app.stops.size, 1);
  await t.app.shutdown();
});

test('B3: given up 24 h (monotonic) after the first send, named in the status', async () => {
  const t = await ready({ follow: false });
  await t.press(hub(), FEATURES.WATER_CLOSE);
  await t.clock.advance(TIMINGS.stopExpiry - TIMINGS.stopHeldEvery);
  assert.equal(t.app.stops.size, 1);
  await t.clock.advance(2 * TIMINGS.stopHeldEvery);
  assert.equal(t.app.stops.size, 0);
  assert.match(said(t), /Shutoff given up after 24 h without the valve showing the water off: Hub/);
  await t.app.shutdown();
});

test('I4: a stale retained "water off" in the same block as the SUBACK never lets a shutoff go before it left', async () => {
  const t = await ready({ follow: false });
  t.client.close();
  await t.clock.advance(0);
  await t.press(hub(), FEATURES.WATER_CLOSE);
  t.client.withSuback = [[dataTopic(N.hub), { water: 0, leak: 0 }]];
  t.client.open();
  await t.clock.advance(0);
  assert.deepEqual(sent(t), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.equal(t.app.stops.size, 1, 'the retained message came before the send');
  // That retained "off" is not "known closed": a live "on" is a contradiction, sent again.
  await t.clock.advance(TIMINGS.stopApplyDelay);
  await t.publish(dataTopic(N.hub), { water: 1 });
  assert.equal(sent(t).length, 2);
  assert.equal(t.app.stops.size, 1);
  // A live "water off" received after the send lets it go.
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.equal(t.app.stops.size, 0);
  await t.app.shutdown();
});

test('I4: a shutoff read from /data is let go by nothing before it left, a live "water off" included', async () => {
  const store = memoryStore({ stops: [{ hub: HUB, device: N.hub, name: 'Hub', at: 1000 }] });
  const t = await setup({ config: BASE, devices: [hub()], store, follow: false });
  t.client.withSuback = [[dataTopic(N.hub), { water: 0, leak: 0 }, false]];
  await t.open();
  assert.deepEqual(t.client.commands(), [{ topic: cmdTopic(N.hub), body: { water: 0 } }]);
  assert.equal(t.app.stops.size, 1, 'the live message came before the send');
  await t.clock.advance(TIMINGS.stopCheck);
  assert.equal(t.client.commands().length, 2, 'sent again without a confirmation');
  await t.publish(dataTopic(N.hub), { water: 0 });
  assert.equal(t.app.stops.size, 0);
  await t.app.shutdown();
});
