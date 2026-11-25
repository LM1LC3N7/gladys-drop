// -----------------------------------------------------------------------------
// The pure parts: topics, payloads, units, devices, configuration, /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  parseBrokerUrl,
  parseFingerprint,
} from '../src/config.js';
import { FEATURES, TYPES } from '../src/constants.js';
import {
  DEFINITIONS,
  TYPE_FEATURES,
  buildDevice,
  commandOf,
  parseExternalId,
  statesOf,
  typeOfCreated,
} from '../src/devices.js';
import {
  COMMANDS,
  cleanText,
  gallonsToLiters,
  gpmToCubicMetersPerHour,
  parseData,
  parseDiscovery,
  parseTopic,
  strictNumber,
} from '../src/drop.js';
import {
  credentialMark,
  fileStore,
  memoryStore,
  newSalt,
  normalizeMemory,
  serializeMemory,
} from '../src/store.js';
import { DATA, DISCOVERY, HUB, N } from './fixtures/drop.js';

const CORE_NORMALIZE = '/home/claude/code/Gladys/server/utils/normalizeSupportedOptions.js';
const normalizeSupportedOptions = existsSync(CORE_NORMALIZE)
  ? createRequire(import.meta.url)(CORE_NORMALIZE).normalizeSupportedOptions
  : undefined;

test('topics: exact prefix, hub id and device number; anything else ignored', () => {
  assert.deepEqual(parseTopic(`drop_connect/discovery/${HUB}/255`), {
    kind: 'discovery',
    hub: HUB,
    device: '255',
  });
  assert.deepEqual(parseTopic(`drop_connect/${HUB}/data/20`), {
    kind: 'data',
    hub: HUB,
    device: '20',
  });
  assert.deepEqual(parseTopic(`drop_connect/${HUB}/data/20/sub`), {
    kind: 'data',
    hub: HUB,
    device: '20',
  });
  for (const bad of [
    `drop_connect/discovery/FOO`,
    `drop_connect/discovery/FOO/255`,
    `drop_connect/discovery/${HUB}/256`,
    `drop_connect/discovery/${HUB}/020`,
    `drop_connect/discovery/${HUB}/1.5`,
    `drop_connect/discovery/${HUB}/255/x`,
    `drop_connect/${HUB}/cmd/255`,
    `other/${HUB}/data/255`,
    `drop_connect/DROP-a:b/data/255`,
    `drop_connect/DROP-../data/255`,
    `drop_connect/DROP-x\n/data/255`,
    `drop_connect/${HUB}/data/${'9'.repeat(300)}`,
    undefined,
  ]) {
    assert.equal(parseTopic(bad), undefined, String(bad));
  }
});

test('discovery: the three keys needed, the hub only at 255, unknown types kept apart', () => {
  assert.deepEqual(parseDiscovery(JSON.stringify(DISCOVERY.hub), '255'), {
    type: 'hub',
    description: 'Hub',
    name: 'Hub DROP-1_C0FFEE',
  });
  assert.equal(parseDiscovery('{"devDesc":"Hub"}', '255'), undefined);
  assert.equal(parseDiscovery('{BAD JSON}', '255'), undefined);
  assert.equal(parseDiscovery('[1]', '255'), undefined);
  assert.equal(parseDiscovery(JSON.stringify(DISCOVERY.hub), '20'), undefined, 'a hub at 20');
  assert.equal(parseDiscovery(JSON.stringify(DISCOVERY.leak), '255'), undefined, 'a leak at 255');
  assert.equal(parseDiscovery(JSON.stringify({ ...DISCOVERY.leak, devType: 7 }), '20'), undefined);
  assert.deepEqual(parseDiscovery(JSON.stringify({ ...DISCOVERY.leak, devType: 'xyz' }), '20'), {
    type: undefined,
    unknown: 'xyz',
    name: 'Laundry leak',
    description: '',
  });
  const hostile = parseDiscovery(
    JSON.stringify({ ...DISCOVERY.leak, name: `\u0000evil\r\nname\u2028${'x'.repeat(200)}` }),
    '20',
  );
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\u0000-\u001f\u2028]/.test(hostile.name));
  assert.ok(hostile.name.length <= 60);
  assert.equal(cleanText(42), '');
});

test('data: strict numbers, bounds, flags 0/1; unknown never 0; no prototype pollution', () => {
  const hub = parseData(JSON.stringify(DATA.hub));
  assert.equal(hub.get('curFlow'), 5.77);
  assert.equal(hub.get('pMode'), 'home');
  assert.equal(hub.get('water'), 1);
  const odd = parseData(
    JSON.stringify({
      psi: null,
      curFlow: '',
      battery: 50.5,
      temp: '70.2',
      leak: true,
      water: 2,
      bypass: '1',
      pMode: 'vacation',
      cart1: 101,
      tdsIn: -1,
      usedToday: 'NaN',
      foo: 1,
      __proto__: { polluted: 1 },
      constructor: 1,
    }),
  );
  assert.equal(odd.get('psi'), undefined);
  assert.ok(odd.has('psi'), 'null clears');
  assert.equal(odd.get('curFlow'), undefined);
  assert.equal(odd.get('battery'), undefined, 'a decimal battery');
  assert.equal(odd.get('temp'), 70.2);
  assert.equal(odd.get('leak'), 1);
  assert.equal(odd.get('water'), undefined);
  assert.equal(odd.get('bypass'), 1);
  assert.equal(odd.get('pMode'), undefined);
  assert.equal(odd.get('cart1'), undefined);
  assert.equal(odd.get('tdsIn'), undefined);
  assert.equal(odd.get('usedToday'), undefined);
  assert.ok(!odd.has('foo') && !odd.has('__proto__') && !odd.has('constructor'));
  assert.equal({}.polluted, undefined);
  assert.equal(parseData('not json'), undefined);
  assert.equal(parseData('[]'), undefined);
  assert.equal(parseData('null'), undefined);
  assert.equal(strictNumber(''), undefined);
  assert.equal(strictNumber(null), undefined);
  assert.equal(strictNumber(Infinity), undefined);
  assert.equal(strictNumber('1e3'), undefined);
  assert.equal(strictNumber(' 5'), undefined);
  // Keys beyond the limit are not read.
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
  assert.equal(parseData(JSON.stringify({ ...many, psi: 50 })).has('psi'), false);
});

test('units: exact factors, rounded', () => {
  assert.equal(gallonsToLiters(1), 3.79);
  assert.equal(gallonsToLiters(232.77), 881.13);
  assert.equal(gallonsToLiters(0), 0);
  assert.equal(gpmToCubicMetersPerHour(1), 0.227);
  assert.equal(gpmToCubicMetersPerHour(5.77), 1.311);
  assert.equal(gpmToCubicMetersPerHour(1000), 227.125);
});

test('commands: the dropmqttapi payloads, nothing else', () => {
  assert.equal(COMMANDS.water(false), '{"water":0}');
  assert.equal(COMMANDS.water(true), '{"water":1}');
  assert.equal(COMMANDS.bypass(true), '{"bypass":1}');
  assert.equal(COMMANDS.mode('away'), '{"pMode":"away"}');
  assert.throws(() => COMMANDS.mode('"},{"water":1'));
});

test('devices: ids, features, no switch; commands only where the type has them', () => {
  const gladys = createFakeGladys({ selector: 'drop' });
  for (const [kind, n] of Object.entries(N)) {
    const d = DISCOVERY[kind];
    const device = buildDevice(
      gladys,
      { hub: HUB, device: n, type: d.devType, name: d.name },
      'fr',
    );
    assert.equal(device.external_id, `ext:drop:drop:${HUB}_${n}`);
    assert.equal(typeOfCreated(device), d.devType);
    for (const f of device.features) {
      assert.notEqual(f.category, 'switch');
      if (f.type === 'binary') assert.equal(f.read_only, true, f.external_id);
      const parsed = parseExternalId(f.external_id);
      assert.deepEqual(parsed, { hub: HUB, device: n, key: f.external_id.split(':').at(-1) });
      for (const column of [
        'name',
        'min',
        'max',
        'read_only',
        'has_feedback',
        'category',
        'type',
      ]) {
        assert.ok(f[column] !== undefined, `${f.external_id} ${column}`);
      }
    }
  }
  assert.equal(commandOf(TYPES.HUB, FEATURES.WATER_CLOSE), 'close');
  assert.equal(commandOf(TYPES.VALVE, FEATURES.WATER_OPEN), 'open');
  assert.equal(commandOf(TYPES.LEAK, FEATURES.WATER_CLOSE), undefined);
  assert.equal(commandOf(TYPES.SOFTENER, FEATURES.BYPASS), 'bypass');
  assert.equal(commandOf(TYPES.VALVE, FEATURES.MODE), undefined);
  assert.equal(commandOf(undefined, FEATURES.WATER_CLOSE), undefined);
  assert.equal(commandOf(TYPES.HUB, FEATURES.FLOW), undefined);
  assert.equal(parseExternalId(`ext:drop:drop:${HUB}_255:nope`), undefined);
  assert.equal(parseExternalId(`ext:drop:drop:${HUB}_256:leak`), undefined);
  assert.equal(parseExternalId('ext:drop:guardian:X_255:leak'), undefined);
  assert.equal(parseExternalId(42), undefined);
  assert.equal(typeOfCreated({ params: [{ name: 'type', value: '__proto__' }] }), undefined);
  // Every feature listed exists.
  for (const keys of Object.values(TYPE_FEATURES)) {
    for (const key of keys) assert.ok(DEFINITIONS[key], key);
  }
});

test('supported_options: the rules of the core (string labels, unique values, sort_order)', () => {
  const gladys = createFakeGladys({ selector: 'drop' });
  for (const language of ['en', 'fr']) {
    const device = buildDevice(gladys, { hub: HUB, device: '255', type: 'hub' }, language);
    const selects = device.features.filter((f) => f.supported_options);
    assert.deepEqual(
      selects.map((f) => f.external_id.split(':').at(-1)),
      [FEATURES.BYPASS, FEATURES.MODE],
    );
    for (const f of selects) {
      assert.equal(f.category, 'text');
      assert.equal(f.type, 'select');
      for (const option of f.supported_options) {
        assert.deepEqual(Object.keys(option).sort(), ['label', 'sort_order', 'value']);
        assert.equal(typeof option.label, 'string');
        assert.ok(option.label.length > 0 && option.label === option.label.trim());
        assert.ok(typeof option.value === 'string' && option.value.trim() === option.value);
        assert.ok(Number.isInteger(option.sort_order));
      }
      const values = f.supported_options.map((o) => `${o.value}`);
      assert.equal(new Set(values).size, values.length);
      if (normalizeSupportedOptions) {
        assert.deepEqual(
          normalizeSupportedOptions(f.supported_options, { allowStringValues: true }),
          f.supported_options,
        );
      }
    }
  }
});

test('states: only the keys changed; text for the selects; power from pwrOff', () => {
  const gladys = createFakeGladys({ selector: 'drop' });
  const values = new Map([
    ['pwrOff', 0],
    ['sens', 1],
    ['temp', 68.2],
    ['battery', 100],
  ]);
  const states = statesOf(
    gladys,
    { hub: HUB, device: '81', type: 'alrt' },
    values,
    new Set(['pwrOff', 'sens']),
  );
  assert.deepEqual(
    states.map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
    [
      [FEATURES.ALERT, 1],
      [FEATURES.POWER, 1],
    ],
  );
  const hub = statesOf(
    gladys,
    { hub: HUB, device: '255', type: 'hub' },
    new Map([
      ['bypass', 1],
      ['pMode', 'away'],
    ]),
    new Set(['bypass', 'pMode']),
  );
  assert.deepEqual(
    hub.map((s) => s.text),
    ['on', 'away'],
  );
});

test('configuration: defaults off, URL checks, password needs a user, fingerprint format', () => {
  const c = normalizeConfig({});
  assert.equal(c.problem, 'broker:empty');
  assert.ok(!('allow_water_close' in DEFAULT_CONFIG));
  for (const key of ['allow_water_open', 'allow_bypass', 'allow_mode_change']) {
    assert.equal(DEFAULT_CONFIG[key], false);
  }
  const allowed = normalizeConfig({
    broker_url: 'x',
    allow_water_open: 'yes',
    allow_bypass: 1,
  });
  assert.equal(allowed.allowWaterOpen, false, 'only true allows');
  assert.equal(allowed.allowBypass, false);
  assert.equal(normalizeConfig({ broker_url: 'x', allow_water_open: true }).allowWaterOpen, true);
  assert.deepEqual(parseBrokerUrl('192.168.1.2'), {
    url: 'mqtt://192.168.1.2',
    host: '192.168.1.2',
    port: 1883,
    tls: false,
  });
  assert.equal(parseBrokerUrl('mqtts://broker.lan').port, 8883);
  assert.equal(parseBrokerUrl('mqtt://u:p@host').error, 'credentials');
  assert.equal(parseBrokerUrl('ws://host').error, 'invalid');
  assert.equal(parseBrokerUrl('mqtt://host/path').error, 'invalid');
  assert.equal(parseBrokerUrl('0.0.0.0').error, 'invalid');
  assert.equal(parseBrokerUrl('224.0.0.1').error, 'invalid');
  assert.equal(parseBrokerUrl('host\r\nx').error, 'invalid');
  assert.equal(normalizeConfig({ broker_url: 'h', password: 'p' }).problem, 'password-alone');
  assert.equal(normalizeConfig({ broker_url: 'h', password: 'p' }).password, '');
  assert.equal(normalizeConfig({ broker_url: 'h', username: 'a\nb' }).problem, 'username');
  const fp = 'ab'.repeat(32);
  assert.equal(parseFingerprint(fp).fingerprint, 'AB:'.repeat(31) + 'AB');
  assert.equal(parseFingerprint('zz').error, 'fingerprint');
  assert.equal(
    normalizeConfig({ broker_url: 'h', broker_fingerprint: fp }).problem,
    'fingerprint-plain',
  );
  assert.equal(
    normalizeConfig({ broker_url: 'mqtts://h', broker_fingerprint: fp }).problem,
    undefined,
  );
  assert.equal(normalizeConfig({ broker_url: 'h', language: 'de' }).language, 'fr');
});

test('/data: the mark is 8 bits, salted; unreadable is never empty', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'drop-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { brokerUrl: 'mqtt://h', username: 'u', password: 'secret' };
  const salt = newSalt();
  const mark = credentialMark(config, salt);
  assert.ok(Number.isInteger(mark) && mark >= 0 && mark <= 255);
  assert.equal(credentialMark(config, salt), mark);
  // Brute force: 1 password in 256 shares the mark, so the mark tells nothing.
  let same = 0;
  for (let i = 0; i < 4096; i += 1) {
    if (credentialMark({ ...config, password: `guess${i}` }, salt) === mark) same += 1;
  }
  assert.ok(same > 4 && same < 40, `${same} of 4096 share the mark`);
  const store = fileStore(join(dir, 'state.json'));
  assert.deepEqual(await store.load(), { ok: true, data: null });
  await store.save(serializeMemory({ refused: { salt, mark } }));
  const loaded = await store.load();
  assert.deepEqual(normalizeMemory(loaded.data), { refused: { salt, mark }, stops: [] });
  assert.ok(!JSON.stringify(loaded.data).includes('secret'));
  await writeFile(join(dir, 'state.json'), '{not json');
  assert.deepEqual(await store.load(), { ok: false, reason: 'invalid' });
  await writeFile(join(dir, 'state.json'), 'x'.repeat(5000));
  assert.deepEqual(await store.load(), { ok: false, reason: 'invalid' });
  await writeFile(join(dir, 'state.json'), '{}');
  await chmod(join(dir, 'state.json'), 0o000);
  if (process.getuid?.() !== 0) {
    assert.deepEqual(await store.load(), { ok: false, reason: 'io' });
  }
  await chmod(join(dir, 'state.json'), 0o600);
  assert.deepEqual(normalizeMemory({ refused: { salt: 'x', mark: 1 } }), {
    refused: undefined,
    stops: [],
  });
  assert.deepEqual(normalizeMemory({ refused: { salt, mark: 256 } }), {
    refused: undefined,
    stops: [],
  });
  assert.deepEqual(normalizeMemory(JSON.parse('{"__proto__":{"refused":1}}')), {
    refused: undefined,
    stops: [],
  });
  const failing = memoryStore(null, { failing: true });
  await assert.rejects(failing.save({}));
});

test('/data: the shutoffs kept, read strictly; a future date taken as now', () => {
  const now = 1_800_000_000_000;
  const memory = normalizeMemory(
    {
      stops: [
        { hub: 'DROP-1_C0FFEE', device: '255', name: 'Hub\nx', at: now - 1000 },
        { hub: 'DROP-1_C0FFEE', device: '78', name: 'Valve', at: now + 86_400_000 },
        { hub: 'DROP-1_C0FFEE', device: '255', name: 'twice', at: now },
        { hub: 'evil', device: '255', at: now },
        { hub: 'DROP-A', device: '256', at: now },
        { hub: 'DROP-A', device: '1', at: 'x' },
        null,
      ],
    },
    now,
  );
  assert.deepEqual(memory.stops, [
    { hub: 'DROP-1_C0FFEE', device: '255', name: 'Hub x', at: now - 1000 },
    { hub: 'DROP-1_C0FFEE', device: '78', name: 'Valve', at: now },
    { hub: 'DROP-A', device: '1', name: '', at: now },
  ]);
  const many = Array.from({ length: 40 }, (_, i) => ({
    hub: 'DROP-A',
    device: String(i),
    at: now,
  }));
  assert.equal(normalizeMemory({ stops: many }, now).stops.length, 16);
  assert.deepEqual(serializeMemory({ refused: undefined, stops: [] }), {});
  assert.deepEqual(
    serializeMemory({ stops: [{ hub: 'DROP-A', device: '1', name: 'n', at: 5, extra: 1 }] }),
    { stops: [{ hub: 'DROP-A', device: '1', name: 'n', at: 5 }] },
  );
});
