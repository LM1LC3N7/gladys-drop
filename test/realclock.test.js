// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, setTimeout), sped up 10
// times: the publications to Gladys every second (never sooner), a command
// without confirmation answered at 3.5 s (never later, never much sooner),
// its effect watched 20 s, and no timer left after shutdown().
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DropApp } from '../src/app.js';
import { FEATURES, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { memoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/index.mjs';
import { DATA, DISCOVERY, N, dataTopic, discoveryTopic } from './fixtures/drop.js';
import { ALL, created, memoryLogger } from './helpers/app.js';
import { fakeConnector } from './helpers/fakeMqtt.js';

const SPEED = 10;

test('real clock: flushes every second, answers by 3.5 s, watches 20 s, leaves no timer', async (t) => {
  const clock = realClock({ speed: SPEED });
  const live = new Set();
  const timers = {
    setTimeout: (fn, ms) => {
      const h = clock.timers.setTimeout(() => {
        live.delete(h);
        fn();
      }, ms);
      live.add(h);
      return h;
    },
    setInterval: (fn, ms) => {
      const h = clock.timers.setInterval(fn, ms);
      live.add(h);
      return h;
    },
    clearTimeout: (h) => {
      live.delete(h);
      clock.timers.clearTimeout(h);
    },
    clearInterval: (h) => {
      live.delete(h);
      clock.timers.clearInterval(h);
    },
  };
  const hub = created('hub');
  const gladys = createFakeGladys({ selector: 'drop', config: ALL, devices: [hub] });
  const connector = fakeConnector();
  const app = new DropApp({
    gladys,
    logger: memoryLogger(),
    store: memoryStore(),
    connect: connector.connect,
    monotonic: clock.monotonic,
    timers,
  });
  registerHandlers(gladys, app);
  t.after(async () => {
    await app.shutdown();
    clock.close();
  });
  const flush = spyOn(app.publisher, 'flush', clock);
  await app.boot();
  await gladys.connect();
  const deadline = performance.now() + 2000;
  while (!connector.last && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  connector.last.open();
  connector.last.deliver(discoveryTopic(N.hub), DISCOVERY.hub, { retain: true });
  connector.last.deliver(dataTopic(N.hub), DATA.hub, { retain: true });
  await measurePeriod(flush, { count: 3, period: TIMINGS.flushInterval, timeoutMs: 5000 });
  assert.equal(gladys.fake.lastState(`${hub.external_id}:${FEATURES.WATER}`), 1);

  // No confirmation: answered at 3.5 s after the click (simulated), sent at once.
  const feature = hub.features.find((f) => f.external_id.endsWith(`:${FEATURES.WATER_CLOSE}`));
  const clickAt = clock.monotonic();
  const ack = await gladys.fake.setValue(hub, feature, 1);
  const answeredAfter = clock.monotonic() - clickAt;
  assert.equal(ack.success, true);
  assert.equal(connector.last.published.length, 1);
  assert.ok(answeredAfter >= TIMINGS.commandAnswerBy - 50, `answered after ${answeredAfter} ms`);
  assert.ok(answeredAfter < TIMINGS.commandAnswerBy + 1500, `answered after ${answeredAfter} ms`);
  assert.match(gladys.fake.connectionStatus.message.en, /sent, without confirmation/);
  // The watch: "not applied" at 20 s after sending, not before.
  await new Promise((resolve) => setTimeout(resolve, (TIMINGS.confirmWatch - 6000) / SPEED));
  assert.match(gladys.fake.connectionStatus.message.en, /sent, without confirmation/);
  const until = performance.now() + 2000;
  while (
    !/did not show it applied/.test(gladys.fake.connectionStatus.message.en) &&
    performance.now() < until
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(gladys.fake.connectionStatus.message.en, /did not show it applied within 20 s/);

  await app.shutdown();
  assert.equal(live.size, 0, `${live.size} timer(s) left after shutdown`);
  const flushes = flush.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 3000 / SPEED));
  assert.equal(flush.calls.length, flushes, 'nothing after shutdown');
});
