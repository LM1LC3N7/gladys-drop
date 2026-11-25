// -----------------------------------------------------------------------------
// Protocol, keys, timings and limits.
//
// DROP (Chandler Systems) speaks MQTT to the broker of the user: the DROP Hub
// publishes, as dropmqttapi 1.0.3 (MIT, Chandler Systems) and the Home
// Assistant integration read it:
//   drop_connect/discovery/<hub>/<device>   {"devType","devDesc","name"}
//   drop_connect/<hub>/data/<device>[/...]  {"curFlow":5.77,"water":1,...}
// and listens on
//   drop_connect/<hub>/cmd/<device>         {"water":0} | {"bypass":1} | {"pMode":"away"}
// `<hub>` is "DROP-" + the hub id, `<device>` a number (the hub itself is 255).
// No reply to a command: the effect is seen in the next data message.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** The root of every DROP topic (fixed by the hub). */
export const ROOT = 'drop_connect';

export const SUBSCRIPTIONS = [`${ROOT}/discovery/#`, `${ROOT}/+/data/#`];

/** The device number of the hub (dropmqttapi `owner_id`). */
export const HUB_DEVICE = '255';

/** The DROP device types (`devType`), as Home Assistant names them. */
export const TYPES = {
  HUB: 'hub',
  VALVE: 'pv',
  LEAK: 'leak',
  SOFTENER: 'soft',
  FILTER: 'filt',
  SALT: 'salt',
  ALERT: 'alrt',
  PUMP: 'pc',
  RO: 'ro',
};

/** The external id type of every DROP device (frozen: it keys the devices of the users). */
export const EXTERNAL_ID_TYPE = 'drop';

/** The feature keys (frozen). */
export const FEATURES = {
  WATER: 'water',
  WATER_CLOSE: 'water-close',
  WATER_OPEN: 'water-open',
  BYPASS: 'bypass',
  MODE: 'protect-mode',
  LEAK: 'leak',
  FLOW: 'flow',
  PEAK_FLOW: 'peak-flow',
  USED_TODAY: 'used-today',
  AVERAGE_USED: 'average-used',
  PRESSURE: 'pressure',
  PRESSURE_HIGH: 'pressure-high',
  PRESSURE_LOW: 'pressure-low',
  BATTERY: 'battery',
  TEMPERATURE: 'temperature',
  NOTIFICATION: 'notification',
  CAPACITY: 'capacity',
  RESERVE: 'reserve-in-use',
  SALT_LOW: 'salt-low',
  ALERT: 'alert',
  POWER: 'power',
  PUMP: 'pump',
  TDS_IN: 'tds-in',
  TDS_OUT: 'tds-out',
  CARTRIDGE_1: 'cartridge-1',
  CARTRIDGE_2: 'cartridge-2',
  CARTRIDGE_3: 'cartridge-3',
};

/** The protect modes of the hub (Home Assistant `PROTECT_MODE_OPTIONS`). */
export const PROTECT_MODES = ['home', 'away', 'schedule'];

/** The values of the bypass select. */
export const BYPASS_VALUES = { on: 1, off: 0 };

/** A button pushed in Gladys (`button/push`) sends 1. */
export const PRESSED = 1;

/** Keys of the configuration screen buttons. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const LIMITS = {
  /** The largest MQTT packet accepted from the broker (a DROP message is under 1 KB). */
  packetBytes: 16 * 1024,
  /** Hubs and devices followed (beyond, ignored and said in the status). */
  hubs: 8,
  devices: 64,
  /** Keys read in one data message. */
  keys: 64,
  /** Characters kept of a name or description given by the hub. */
  name: 60,
  /** Messages handled per second (beyond, dropped until the next second). */
  messagesPerSecond: 200,
  /** Gladys accepts 300 states a minute; 100 per request. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** Bytes of /data/drop-state.json. */
  stateFile: 4096,
};

export const TIMINGS = {
  /** mqtt.js: the next try while the broker is unreachable, and the CONNACK wait. */
  reconnectPeriod: 10 * SECOND,
  connectTimeout: 10 * SECOND,
  /** A command clicked is answered to Gladys by then (Gladys gives up at 5 s). */
  commandAnswerBy: 3500,
  /** A command still waiting its turn this long after its click is never sent. */
  commandSendBy: 2000,
  /** The broker has this long to take a command written (else: sent, without confirmation). */
  publishWait: 1000,
  /** After the answer to Gladys, the effect is still watched for this long (status). */
  confirmWatch: 20 * SECOND,
  /** A shutoff kept: checked this long after each send, sent again without a confirmation. */
  stopCheck: 20 * SECOND,
  /** A water-on message this long after a shutoff left contradicts it (before: in flight). */
  stopApplyDelay: 2 * SECOND,
  /** Sent again at most this many times (a new budget at each click and connection), */
  stopResends: 3,
  /** then held: sent again this often, forever, until seen applied or a turn-on leaves. */
  stopHeldEvery: 10 * MINUTE,
  /** A shutoff never seen applied is given up this long after it first left in this process (monotonic; said in the status). */
  stopExpiry: 24 * HOUR,
  /** A turn-on is refused this long after a shutoff of the same hub left. */
  stopWindow: 20 * SECOND,
  /** A TLS certificate refused: its fingerprint read (nothing written) within this. */
  probeTimeout: 5 * SECOND,
  /** `getConfig()` failed: tried again this much later, forever. */
  configRetry: 30 * SECOND,
  /** /data unreadable: read again this much later, forever. */
  storeRetry: 10 * SECOND,
  /** A save of /data waits this long at most. */
  saveWait: 2 * SECOND,
  /** Publications to Gladys: flushed every second, unchanged values every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** A value left waiting for Gladys longer than this is never sent as current. */
  freshFor: 2 * MINUTE,
  /** A new device heard: the Discovery tab is updated this much later (several arrive together). */
  discoveryDebounce: 2 * SECOND,
  /** The "Test the connection" button acts at most this often. */
  testEvery: 10 * SECOND,
  /** The status is sent at most this often when only counters change. */
  statusEvery: 5 * SECOND,
};
