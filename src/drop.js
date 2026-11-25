// -----------------------------------------------------------------------------
// The DROP MQTT messages (pure): topics, discovery payloads, data payloads and
// command payloads, as dropmqttapi 1.0.3 (MIT, Chandler Systems) reads and
// writes them (see THIRD_PARTY_NOTICES.md), made strict:
//   - a value is a JSON number (or a decimal text, as Python's int()/float()
//     take it), within the bounds of its key; an integer key refuses a
//     decimal; a flag is 0 or 1 (or a JSON boolean);
//   - null, '', a text where a number is expected, a value out of bounds:
//     unknown (never 0), and it clears the value known so far, so a decision
//     never rests on an older one;
//   - keys we do not know are ignored, an own `__proto__` key included (the
//     values are kept in a Map, never merged into an object).
// -----------------------------------------------------------------------------

import { HUB_DEVICE, LIMITS, PROTECT_MODES, ROOT, TYPES } from './constants.js';

const HUB_ID = /^DROP-[A-Za-z0-9_-]{1,40}$/;
const DEVICE_ID = /^(0|[1-9]\d{0,2})$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export const isHubId = (value) => typeof value === 'string' && HUB_ID.test(value);
export const isDeviceId = (value) =>
  typeof value === 'string' && DEVICE_ID.test(value) && Number(value) <= 255;

/**
 * What a topic is: `{ kind: 'discovery' | 'data', hub, device }`, or
 * undefined for anything else (never thrown).
 */
export function parseTopic(topic) {
  if (typeof topic !== 'string' || topic.length > 200) {
    return undefined;
  }
  const parts = topic.split('/');
  if (parts[0] !== ROOT || parts.length < 4 || parts.length > 8) {
    return undefined;
  }
  let kind;
  let hub;
  let device;
  if (parts[1] === 'discovery' && parts.length === 4) {
    [kind, hub, device] = ['discovery', parts[2], parts[3]];
  } else if (parts[2] === 'data') {
    [kind, hub, device] = ['data', parts[1], parts[3]];
  } else {
    return undefined;
  }
  if (!isHubId(hub) || !isDeviceId(device)) {
    return undefined;
  }
  return { kind, hub, device };
}

export const dataTopic = (hub, device) => `${ROOT}/${hub}/data/${device}`;
export const commandTopic = (hub, device) => `${ROOT}/${hub}/cmd/${device}`;
export const discoveryTopic = (hub, device) => `${ROOT}/discovery/${hub}/${device}`;

/** A text given by the hub, made safe to show: no control character, bounded. */
export function cleanText(value, max = LIMITS.name) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function parseJsonObject(payload) {
  if (payload === undefined || payload === null || payload.length > LIMITS.packetBytes) {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
  } catch {
    return undefined;
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

const KNOWN_TYPES = new Set(Object.values(TYPES));

/**
 * A discovery payload: `{ type, description, name }` (type one of TYPES, or
 * `unknown: <devType>`), or undefined when incomplete (dropmqttapi needs the
 * three keys).
 */
export function parseDiscovery(payload, device) {
  const json = parseJsonObject(payload);
  if (!json) {
    return undefined;
  }
  const { devType, devDesc, name } = json;
  if (typeof devType !== 'string' || typeof devDesc !== 'string' || typeof name !== 'string') {
    return undefined;
  }
  const type = cleanText(devType, 16);
  if (!KNOWN_TYPES.has(type)) {
    return { type: undefined, unknown: type, name: cleanText(name), description: '' };
  }
  // The hub has the number 255, and only the hub: anything else is not trusted.
  if ((type === TYPES.HUB) !== (device === HUB_DEVICE)) {
    return undefined;
  }
  return { type, description: cleanText(devDesc), name: cleanText(name) };
}

const number = (min, max, integer = false) => ({ kind: 'number', min, max, integer });
const FLAG = { kind: 'flag' };

/**
 * The keys read (dropmqttapi `DropAPI`), with their bounds. Units as the hub
 * sends them: gallons, gallons per minute, PSI, °F, ppm, percent.
 */
export const KEYS = {
  curFlow: number(0, 1000),
  peakFlow: number(0, 1000),
  usedToday: number(0, 10_000_000),
  avgUsed: number(0, 10_000_000),
  capacity: number(0, 10_000_000),
  psi: number(0, 500),
  psiHigh: number(0, 500),
  psiLow: number(0, 500),
  temp: number(-50, 200),
  tdsIn: number(0, 10_000, true),
  tdsOut: number(0, 10_000, true),
  cart1: number(0, 100, true),
  cart2: number(0, 100, true),
  cart3: number(0, 100, true),
  battery: number(0, 100, true),
  leak: FLAG,
  sens: FLAG,
  notif: FLAG,
  salt: FLAG,
  resInUse: FLAG,
  pump: FLAG,
  water: FLAG,
  bypass: FLAG,
  pwrOff: FLAG,
  pMode: { kind: 'mode' },
};

/** A strict number: a JSON number, or a decimal text; anything else undefined. */
export function strictNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^-?\d{1,9}(\.\d{1,6})?$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** One value read by its spec: the value, or undefined (unknown). */
export function readValue(spec, raw) {
  if (spec.kind === 'flag') {
    if (raw === true || raw === false) {
      return raw ? 1 : 0;
    }
    const n = strictNumber(raw);
    return n === 0 || n === 1 ? n : undefined;
  }
  if (spec.kind === 'mode') {
    return typeof raw === 'string' && PROTECT_MODES.includes(raw) ? raw : undefined;
  }
  const n = strictNumber(raw);
  if (n === undefined || n < spec.min || n > spec.max) {
    return undefined;
  }
  if (spec.integer && !Number.isInteger(n)) {
    return undefined;
  }
  return n;
}

/**
 * A data payload: a Map of the known keys it carries -> value (undefined
 * when unknown, which clears it), or undefined when it is not a JSON object.
 */
export function parseData(payload) {
  const json = parseJsonObject(payload);
  if (!json) {
    return undefined;
  }
  const values = new Map();
  let seen = 0;
  for (const key of Object.keys(json)) {
    seen += 1;
    if (seen > LIMITS.keys) {
      break;
    }
    if (Object.hasOwn(KEYS, key)) {
      values.set(key, readValue(KEYS[key], json[key]));
    }
  }
  return values;
}

/** The command payloads (dropmqttapi `set_*_message`). */
export const COMMANDS = {
  water: (on) => JSON.stringify({ water: on ? 1 : 0 }),
  bypass: (on) => JSON.stringify({ bypass: on ? 1 : 0 }),
  mode: (mode) => {
    if (!PROTECT_MODES.includes(mode)) {
      throw new Error('invalid protect mode');
    }
    return JSON.stringify({ pMode: mode });
  },
};

// --- Units -------------------------------------------------------------------

/** One US gallon in litres (exact). */
export const GALLON_LITERS = 3.785411784;

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Gallons -> litres, to the hundredth. */
export const gallonsToLiters = (gallons) => round(gallons * GALLON_LITERS, 2);

/** Gallons per minute -> cubic metres per hour, to the thousandth. */
export const gpmToCubicMetersPerHour = (gpm) => round((gpm * GALLON_LITERS * 60) / 1000, 3);
