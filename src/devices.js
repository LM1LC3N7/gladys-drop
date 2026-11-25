// -----------------------------------------------------------------------------
// The DROP devices -> Gladys devices and their states (pure).
//
// External ids (frozen), `<hub>` the hub id of the topics ("DROP-1_C0FFEE"),
// `<n>` the device number on that hub (255 for the hub itself):
//   gladys.externalIds('drop', '<hub>_<n>')            one DROP device
//   ...:<feature key>                                   its features (FEATURES)
// The same identity as Home Assistant (`<hub_id>_<device_id>`): a DROP
// device keeps its number on its hub; never an IP address nor a name.
// Every feature of a type is always built, so a republished device never
// loses one.
//
// The water valve is never a switch nor a commandable binary: a "turn
// everything off/on" (voice assistants, HomeKit, scenes on switches) must
// never move it. Closing and opening are `button/push` features, refused
// unless the configuration allows each (src/app.js). The bypass and the
// protect mode are `text/select` features, refused unless allowed too.
//
// Units: those the core lists (DEVICE_FEATURE_UNITS_BY_CATEGORY). Gallons
// become litres and gallons per minute cubic metres per hour (exact factors,
// src/drop.js); PSI and °F are kept (the core lists both). Total dissolved
// solids have no category with ppm: a plain integer, "ppm" in the name.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, FEATURES as F, PROTECT_MODES, TYPES } from './constants.js';
import { gallonsToLiters, gpmToCubicMetersPerHour, isDeviceId, isHubId } from './drop.js';
import { FEATURE_NAMES, OPTION_LABELS, TYPE_NAMES, word } from './i18n.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const binary = (category) => sensor({ category, type: T.SENSOR.BINARY, min: 0, max: 1 });
const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};
const select = (options) => ({
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  read_only: false,
  has_feedback: true,
  keep_history: false,
  options,
});
const flow = sensor({
  category: C.WATER_VALVE,
  type: T.WATER_VALVE.FLOW,
  unit: U.CUBIC_METER_PER_HOUR,
  min: 0,
  max: 230,
});
const volume = sensor({
  category: C.VOLUME_SENSOR,
  type: T.VOLUME_SENSOR.DECIMAL,
  unit: U.LITER,
  min: 0,
  max: 40_000_000,
});
const pressure = sensor({
  category: C.PRESSURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.PSI,
  min: 0,
  max: 500,
});
const percent = (category, type) => sensor({ category, type, unit: U.PERCENT, min: 0, max: 100 });
const tds = sensor({ category: C.UNKNOWN, type: T.SENSOR.INTEGER, min: 0, max: 10_000 });

/** Every feature: its Gladys definition, and how it is read from the hub's keys. */
export const DEFINITIONS = {
  [F.WATER]: { ...binary(C.UNKNOWN), key: 'water' },
  [F.WATER_CLOSE]: { ...button, command: 'close' },
  [F.WATER_OPEN]: { ...button, command: 'open' },
  [F.LEAK]: { ...binary(C.LEAK_SENSOR), key: 'leak' },
  [F.FLOW]: { ...flow, key: 'curFlow', convert: gpmToCubicMetersPerHour },
  [F.PEAK_FLOW]: { ...flow, key: 'peakFlow', convert: gpmToCubicMetersPerHour },
  [F.USED_TODAY]: { ...volume, key: 'usedToday', convert: gallonsToLiters },
  [F.AVERAGE_USED]: { ...volume, key: 'avgUsed', convert: gallonsToLiters },
  [F.CAPACITY]: { ...volume, key: 'capacity', convert: gallonsToLiters },
  [F.PRESSURE]: { ...pressure, key: 'psi' },
  [F.PRESSURE_HIGH]: { ...pressure, key: 'psiHigh' },
  [F.PRESSURE_LOW]: { ...pressure, key: 'psiLow' },
  [F.TEMPERATURE]: {
    ...sensor({
      category: C.TEMPERATURE_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: U.FAHRENHEIT,
      min: -50,
      max: 200,
    }),
    key: 'temp',
  },
  [F.BATTERY]: { ...percent(C.BATTERY, T.BATTERY.INTEGER), key: 'battery' },
  [F.NOTIFICATION]: { ...binary(C.UNKNOWN), key: 'notif' },
  [F.RESERVE]: { ...binary(C.UNKNOWN), key: 'resInUse' },
  [F.SALT_LOW]: { ...binary(C.UNKNOWN), key: 'salt' },
  [F.ALERT]: { ...binary(C.UNKNOWN), key: 'sens' },
  // dropmqttapi `power()`: on when `pwrOff` is 0.
  [F.POWER]: { ...binary(C.UNKNOWN), key: 'pwrOff', convert: (v) => (v === 0 ? 1 : 0) },
  [F.PUMP]: { ...binary(C.UNKNOWN), key: 'pump' },
  [F.TDS_IN]: { ...tds, key: 'tdsIn' },
  [F.TDS_OUT]: { ...tds, key: 'tdsOut' },
  [F.CARTRIDGE_1]: { ...percent(C.MAINTENANCE, T.MAINTENANCE.LIFE_REMAINING), key: 'cart1' },
  [F.CARTRIDGE_2]: { ...percent(C.MAINTENANCE, T.MAINTENANCE.LIFE_REMAINING), key: 'cart2' },
  [F.CARTRIDGE_3]: { ...percent(C.MAINTENANCE, T.MAINTENANCE.LIFE_REMAINING), key: 'cart3' },
  [F.BYPASS]: {
    ...select(['off', 'on']),
    key: 'bypass',
    convert: (v) => (v === 1 ? 'on' : 'off'),
    text: true,
  },
  [F.MODE]: { ...select(PROTECT_MODES), key: 'pMode', text: true },
};

/** The features of each DROP type, in display order (Home Assistant's lists). */
export const TYPE_FEATURES = {
  [TYPES.HUB]: [
    F.WATER,
    F.WATER_CLOSE,
    F.WATER_OPEN,
    F.LEAK,
    F.FLOW,
    F.PEAK_FLOW,
    F.USED_TODAY,
    F.AVERAGE_USED,
    F.PRESSURE,
    F.PRESSURE_HIGH,
    F.PRESSURE_LOW,
    F.BYPASS,
    F.MODE,
    F.NOTIFICATION,
    F.BATTERY,
  ],
  [TYPES.VALVE]: [
    F.WATER,
    F.WATER_CLOSE,
    F.WATER_OPEN,
    F.LEAK,
    F.FLOW,
    F.PRESSURE,
    F.TEMPERATURE,
    F.BATTERY,
  ],
  [TYPES.SOFTENER]: [F.CAPACITY, F.RESERVE, F.FLOW, F.PRESSURE, F.BYPASS, F.BATTERY],
  [TYPES.FILTER]: [F.FLOW, F.PRESSURE, F.BYPASS, F.BATTERY],
  [TYPES.LEAK]: [F.LEAK, F.TEMPERATURE, F.BATTERY],
  [TYPES.ALERT]: [F.ALERT, F.POWER, F.TEMPERATURE, F.BATTERY],
  [TYPES.PUMP]: [F.PUMP, F.LEAK, F.FLOW, F.PRESSURE, F.TEMPERATURE],
  [TYPES.RO]: [F.LEAK, F.TDS_IN, F.TDS_OUT, F.CARTRIDGE_1, F.CARTRIDGE_2, F.CARTRIDGE_3],
  [TYPES.SALT]: [F.SALT_LOW],
};

/** The commandable features of a type: feature key -> command. */
export function commandOf(type, key) {
  if (!TYPE_FEATURES[type]?.includes(key)) {
    return undefined;
  }
  const definition = DEFINITIONS[key];
  if (definition.command) {
    return definition.command;
  }
  if (key === F.BYPASS) return 'bypass';
  if (key === F.MODE) return 'mode';
  return undefined;
}

export const platformId = (hub, device) => `${hub}_${device}`;
export const deviceIds = (gladys, hub, device) =>
  gladys.externalIds(EXTERNAL_ID_TYPE, platformId(hub, device));

const ID = /^ext:[^:]{1,100}:drop:(DROP-[A-Za-z0-9_-]{1,40})_(\d{1,3})(?::([a-z0-9-]{1,20}))?$/;

/** `{ hub, device, key }` of one of our device or feature external ids, else undefined. */
export function parseExternalId(externalId) {
  if (typeof externalId !== 'string' || externalId.length > 200) {
    return undefined;
  }
  const match = ID.exec(externalId);
  if (!match || !isHubId(match[1]) || !isDeviceId(match[2])) {
    return undefined;
  }
  const key = match[3];
  if (key !== undefined && !Object.hasOwn(DEFINITIONS, key)) {
    return undefined;
  }
  return { hub: match[1], device: match[2], key };
}

/** The DROP type a device created in Gladys was given (its `type` param), else undefined. */
export function typeOfCreated(device) {
  const value = (device?.params ?? []).find((p) => p?.name === 'type')?.value;
  return typeof value === 'string' && Object.hasOwn(TYPE_FEATURES, value) ? value : undefined;
}

const short = (hub) => hub.replace(/^DROP-/, '').slice(-6);

/** The name of a device: the one the hub gives, else its type and number. */
export function deviceName(d, language) {
  if (d.name) {
    return d.name;
  }
  const type = word(TYPE_NAMES[d.type], language);
  return d.type === TYPES.HUB ? `DROP ${type} ${short(d.hub)}` : `DROP ${type} ${d.device}`;
}

/** The Gladys device of one DROP device (`d`: hub, device, type, name, description). */
export function buildDevice(gladys, d, language) {
  const ids = deviceIds(gladys, d.hub, d.device);
  return {
    name: deviceName(d, language),
    external_id: ids.device,
    features: TYPE_FEATURES[d.type].map((key) => {
      const {
        key: _source,
        convert: _convert,
        command: _command,
        text: _text,
        options,
        ...def
      } = DEFINITIONS[key];
      return {
        name: word(FEATURE_NAMES[key], language),
        external_id: ids.feature(key),
        ...def,
        ...(options
          ? {
              supported_options: options.map((value, i) => ({
                value,
                label: word(OPTION_LABELS[value], language),
                sort_order: i,
              })),
            }
          : {}),
      };
    }),
    params: [
      { name: 'hub', value: d.hub },
      { name: 'device', value: d.device },
      { name: 'type', value: d.type },
      ...(d.description ? [{ name: 'description', value: d.description }] : []),
    ],
  };
}

/**
 * The states of the keys `changed` of a device (`values`: Map key -> value):
 * `[{ device_feature_external_id, state } | { ..., text }]`; an unknown value
 * is left out (never 0).
 */
export function statesOf(gladys, d, values, changed) {
  const ids = deviceIds(gladys, d.hub, d.device);
  const states = [];
  for (const key of TYPE_FEATURES[d.type] ?? []) {
    const def = DEFINITIONS[key];
    if (!def.key || !changed.has(def.key)) {
      continue;
    }
    const raw = values.get(def.key);
    if (raw === undefined) {
      continue;
    }
    const value = def.convert ? def.convert(raw) : raw;
    if (def.text) {
      states.push({ device_feature_external_id: ids.feature(key), text: String(value) });
    } else if (Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  }
  return states;
}
