// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys (the real wiring of src/handlers.js),
// a fake MQTT client playing the broker and the DROP hub, and the virtual
// clock of gladys-testkit (test/kit).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DropApp } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { memoryStore } from '../../src/store.js';
import { testClock } from '../kit/index.mjs';
import { DATA, DISCOVERY, HUB, N, SELECTOR, dataTopic, discoveryTopic } from '../fixtures/drop.js';
import { fakeConnector } from './fakeMqtt.js';

export const BASE = { broker_url: '192.168.1.20' };
export const ALL = {
  ...BASE,
  allow_water_close: true,
  allow_water_open: true,
  allow_bypass: true,
  allow_mode_change: true,
};

/** A logger keeping its lines (to check that nothing secret is logged). */
export function memoryLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`,
      );
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

/** The Gladys device of a fixture device, as the user created it. */
export function created(kind, { hub = HUB, name } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const d = DISCOVERY[kind];
  return buildDevice(
    gladys,
    { hub, device: N[kind], type: d.devType, name: name ?? d.name, description: d.devDesc },
    'en',
  );
}

/**
 * The hub: `hub.water` follows the water commands when `follow` is true
 * (delivered after `delay` virtual ms), likewise the bypass and the mode.
 */
export function hubBehaviour(world) {
  return (topic, payload, client) => {
    if (!world.follow) return;
    const match = /^drop_connect\/(DROP-[^/]+)\/cmd\/(\d+)$/.exec(topic);
    if (!match) return;
    const body = JSON.parse(payload);
    const deliver = () => client.deliver(`drop_connect/${match[1]}/data/${match[2]}`, body);
    if (world.delay > 0) {
      world.clock.timers.setTimeout(deliver, world.delay);
    } else {
      setImmediate(deliver);
    }
  };
}

export async function setup({
  config = BASE,
  devices = [],
  store = memoryStore(),
  getConfigFails = 0,
  follow = true,
  delay = 0,
} = {}) {
  const clock = testClock();
  const world = { follow, delay, clock };
  const connector = fakeConnector(hubBehaviour(world));
  const logger = memoryLogger();
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  let fails = getConfigFails;
  let calls = 0;
  const getConfig = gladys.getConfig.bind(gladys);
  gladys.getConfig = async () => {
    calls += 1;
    // The first call is the SDK's own resynchronization (connect()).
    if (calls > 1 && fails > 0) {
      fails -= 1;
      throw new Error('Gladys unavailable');
    }
    return getConfig();
  };
  const app = new DropApp({
    gladys,
    logger,
    store,
    connect: connector.connect,
    monotonic: clock.monotonic,
    timers: clock.timers,
  });
  registerHandlers(gladys, app, logger);
  await app.boot();
  await gladys.connect();
  await clock.advance(0);
  const t = {
    app,
    gladys,
    clock,
    world,
    connector,
    logger,
    store,
    get client() {
      return connector.last;
    },
    /** The broker accepts: CONNACK, then the subscriptions. */
    async open() {
      connector.last.open();
      await clock.advance(0);
    },
    /** The hub publishes a message (retained ones as the broker replays them). */
    async publish(topic, payload, retain = false) {
      connector.last.deliver(topic, payload, { retain });
      await clock.advance(0);
    },
    async announce(kind, { hub = HUB, data = true } = {}) {
      await t.publish(discoveryTopic(N[kind], hub), DISCOVERY[kind], true);
      if (data) await t.publish(dataTopic(N[kind], hub), DATA[kind], true);
    },
    status() {
      return gladys.fake.connectionStatus;
    },
    /** A command from Gladys; the clock moved until it is answered (bounded). */
    async press(device, key, value = 1) {
      const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
      let done = false;
      const ack = gladys.fake.setValue(device, feature, value).finally(() => {
        done = true;
      });
      for (let i = 0; i < 100 && !done; i += 1) {
        await clock.advance(50);
      }
      return ack;
    },
  };
  return t;
}
