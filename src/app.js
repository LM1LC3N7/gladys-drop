// -----------------------------------------------------------------------------
// The integration: one connection to the MQTT broker of the user, where the
// DROP Hub publishes; the devices it announces (discovery) turned into Gladys
// devices; their states sent within the Gladys rate limit; the commands sent
// back; the status and the "Test the connection" button. index.js only wires
// the SDK handlers (src/handlers.js).
//
// Connection (lessons of gladys-qbus):
//   - credentials refused by the broker (CONNACK 4, 5, 134, 135, 138): the
//     client stops and is never started again by itself, even after a
//     restart (an 8-bit mark of the refused credentials in /data, see
//     src/store.js); other credentials saved, or "Test the connection",
//     try again;
//   - a CONNECT closed or left unanswered once the transport opened (so the
//     password left), twice in a row with credentials: counted as refused;
//   - broker unreachable: mqtt.js tries again every 10 s;
//   - a pinned certificate that does not match: stopped, the fingerprint
//     seen shown, never learned by itself;
//   - /data unreadable: never taken for empty, read again every 10 s, no
//     connection before (a refused password must not leave again);
//   - every packet bounded before it is read (src/mqtt.js); messages beyond
//     200 a second dropped; at most 8 hubs and 64 devices followed.
//
// What the hub said is known for the current connection only: at each
// connection and disconnection every value goes back to unknown (the
// retained messages the broker sends at once fill them again).
//
// Commands (never a switch):
//   - shutting the water off is the stop of this module: behind no option,
//     never in the lane of its device, cancelling every command of the same
//     hub still waiting there (nothing clicked before a shutoff leaves after
//     it). It is kept, in memory and in /data, until a live message of the
//     device shows its water off or a turn-on of the same hub leaves after
//     it: clicked offline it leaves right after the next SUBACK; it is sent
//     again after a restart, at each connection, when a live message shows
//     the water still on (2 s after it left at least), and 20 s after each
//     send without a confirmation: 3 times, then every 10 min (held). A
//     failed save of /data never holds it back;
//   - turning the water on (`allow_water_open`), the bypass (`allow_bypass`)
//     and the protect mode (`allow_mode_change`) are refused unless the
//     configuration allows each, checked at the click and again right
//     before the publication; one at a time per device (a lane);
//   - turning the water on is decided on what the hub published in this
//     connection (DROP has no read request): refused when the valve state,
//     its leak state or the leak state of any leak-capable device of the hub
//     (announced, or created in Gladys) is unknown, on a leak or a sensor
//     alert of the hub, while messages are being dropped (flood), and within
//     20 s of a shutoff of the same hub; nothing sent when already on;
//   - those commands leave within 2 s of their click or never, once (QoS 0)
//     and are confirmed only by a later live message of the device showing
//     the value asked; Gladys is answered by 3.5 s: done, sent without
//     confirmation, or refused with "Nothing sent"; the effect is still
//     watched 20 s, in the status.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { connectionKey, normalizeConfig } from './config.js';
import {
  BYPASS_VALUES,
  LIMITS,
  PRESSED,
  PROTECT_MODES,
  SECOND,
  SUBSCRIPTIONS,
  TIMINGS,
  TYPES,
} from './constants.js';
import {
  buildDevice,
  commandOf,
  deviceIds,
  deviceName,
  parseExternalId,
  platformId,
  statesOf,
  typeOfCreated,
} from './devices.js';
import { COMMANDS, commandTopic, parseData, parseDiscovery, parseTopic } from './drop.js';
import { C, T, TEST, word } from './i18n.js';
import {
  connectBroker,
  errorReason,
  isCertificateRefusal,
  isProtocolRefusal,
  isRefusal,
  probeFingerprint,
} from './mqtt.js';
import { StatePublisher } from './publisher.js';
import {
  MAX_STOPS,
  credentialMark,
  fileStore,
  newSalt,
  normalizeMemory,
  serializeMemory,
} from './store.js';

/** What each command needs allowed in the configuration. */
const OPTION_OF = {
  open: 'allowWaterOpen',
  bypass: 'allowBypass',
  mode: 'allowModeChange',
};

/** The leak state of each leak-capable DROP type (an alert by its sensor). */
const LEAK_KEY = {
  [TYPES.HUB]: 'leak',
  [TYPES.VALVE]: 'leak',
  [TYPES.LEAK]: 'leak',
  [TYPES.PUMP]: 'leak',
  [TYPES.RO]: 'leak',
  [TYPES.ALERT]: 'sens',
};

const join = (a, b) => ({ en: `${a.en}${b.en}`, fr: `${a.fr}${b.fr}` });

export class DropApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'drop' }),
    store = fileStore(),
    connect = connectBroker,
    probe = probeFingerprint,
    now = () => Date.now(),
    monotonic = () => performance.now(),
    timers = globalThis,
  }) {
    this.probe = probe;
    this.now = now;
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.connect = connect;
    this.monotonic = monotonic;
    this.timers = timers;
    this.publisher = new StatePublisher({ gladys, logger, now: monotonic, timers });

    this.generation = 0;
    this.started = false;
    this.closed = false;
    this.rawConfig = {};
    this.config = normalizeConfig({});
    this.connKey = undefined;
    /** /data: 'unread' | 'ok' | 'io' | 'invalid'. */
    this.memoryState = 'unread';
    this.memory = { refused: undefined, stops: [] };
    this.reading = undefined;
    this.storeTimer = undefined;
    this.configTimer = undefined;

    this.client = null;
    this.mqttConnected = false;
    this.protocolVersion = 5;
    this.lastError = undefined;
    this.unanswered = 0;
    this.refusedNow = undefined;
    this.certSeen = undefined;
    this.certStopped = false;

    /** platformId -> { hub, device, pid, discovered, values: Map key -> { value, at, live }, heard } */
    this.registry = new Map();
    this.ignored = new Set();
    this.flood = { second: -1, count: 0, dropped: false, lastDrop: undefined };

    /** The shutoffs kept: platformId -> { pid, hub, device, name, at, budget, sends, lastSent, held, seq }. */
    this.stops = new Map();

    /** Commands: the lane of each device, the shutoffs clicked, those under way. */
    this.lanes = new Map();
    /** Shutoffs clicked, by hub: a command of the hub waiting its turn is cancelled by a newer one. */
    this.stopSeq = new Map();
    this.waiters = new Set();
    this.lastCommand = undefined;
    this.commandSeq = 0;

    this.timersById = {};
    this.statusKey = undefined;
    this.statusAt = -Infinity;
    this.lastTestAt = -Infinity;
  }

  // --- Timers ------------------------------------------------------------------

  later(name, delay, fn) {
    this.timers.clearTimeout(this.timersById[name]);
    const generation = this.generation;
    this.timersById[name] = this.timers.setTimeout(() => {
      this.timersById[name] = undefined;
      if (generation === this.generation && !this.closed) {
        Promise.resolve()
          .then(fn)
          .catch((err) => this.logger.error(`${name} failed: ${err.message}`));
      }
    }, delay);
  }

  clearTimers() {
    for (const id of Object.values(this.timersById)) {
      this.timers.clearTimeout(id);
    }
    this.timersById = {};
  }

  // --- /data -------------------------------------------------------------------

  /** Boot: /data read once, then again every 10 s while it cannot be. */
  boot() {
    return this.readStore();
  }

  readStore() {
    if (!this.reading) {
      this.reading = this.loadStore().finally(() => {
        this.reading = undefined;
      });
    }
    return this.reading;
  }

  async loadStore() {
    if (this.closed || this.memoryState === 'ok') {
      return;
    }
    let result;
    try {
      result = await this.store.load();
    } catch {
      result = { ok: false, reason: 'io' };
    }
    if (this.closed || this.memoryState === 'ok') {
      return;
    }
    if (result?.ok) {
      this.memory = normalizeMemory(result.data, this.now());
      this.memoryState = 'ok';
      this.restoreStops();
      if (this.started && !this.client && !this.config.problem) {
        await this.start(this.rawConfig);
      } else if (this.stops.size > 0) {
        this.saveMemory().catch(() => {});
      }
      return;
    }
    this.memoryState = result?.reason === 'invalid' ? 'invalid' : 'io';
    this.logger.warn(`/data/drop-state.json cannot be read (${this.memoryState})`);
    if (this.started) {
      await this.statusNow();
    }
    // An I/O error may pass; a file that is not ours waits for the test button.
    if (this.memoryState === 'io') {
      this.timers.clearTimeout(this.storeTimer);
      this.storeTimer = this.timers.setTimeout(() => {
        this.storeTimer = undefined;
        this.readStore().catch(() => {});
      }, TIMINGS.storeRetry);
    }
  }

  async saveMemory() {
    if (this.memoryState !== 'ok') {
      // Never written over a file that could not be read.
      return false;
    }
    this.memory.stops = [...this.stops.values()].slice(0, MAX_STOPS);
    let timer;
    try {
      await Promise.race([
        this.store.save(serializeMemory(this.memory)),
        new Promise((_, reject) => {
          timer = this.timers.setTimeout(() => reject(new Error('timed out')), TIMINGS.saveWait);
        }),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(`Saving /data/drop-state.json failed: ${err.message}`);
      return false;
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  // --- Configuration -----------------------------------------------------------

  /**
   * Gladys connected (again): the configuration read, retried every 30 s
   * while it cannot be; then the status, the Discovery and the states are
   * sent again (Gladys keeps them in memory only).
   */
  async onConnected(getConfig) {
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    let raw;
    try {
      raw = await getConfig();
    } catch (err) {
      if (this.closed) return;
      this.logger.warn(`Reading the configuration failed: ${err.message}`);
      if (!this.started) {
        await this.sendStatus(false, T.noConfig);
      }
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        this.onConnected(getConfig).catch((e) => this.logger.error(`Start failed: ${e.message}`));
      }, TIMINGS.configRetry);
      return;
    }
    if (this.closed) return;
    this.gladys.forgetPublishedStates?.();
    const next = normalizeConfig(raw);
    if (!this.started || connectionKey(next) !== this.connKey) {
      await this.start(raw);
    } else {
      this.applySoft(raw, next);
      this.statusKey = undefined;
      await this.statusNow();
    }
    this.later('discovery', 0, () => this.publishDiscovery());
  }

  async configUpdated(raw) {
    const next = normalizeConfig(raw);
    if (this.started && connectionKey(next) === this.connKey) {
      this.applySoft(raw, next);
      await this.statusNow();
      return;
    }
    await this.start(raw);
  }

  /** Options and language: no reconnection. */
  applySoft(raw, next) {
    this.rawConfig = raw ?? {};
    this.config = next;
  }

  async start(raw = {}) {
    this.endClient();
    this.generation += 1;
    const generation = this.generation;
    this.clearTimers();
    this.started = true;
    this.rawConfig = raw ?? {};
    this.config = normalizeConfig(raw);
    this.connKey = connectionKey(this.config);
    this.protocolVersion = 5;
    this.lastError = undefined;
    this.unanswered = 0;
    this.refusedNow = undefined;
    this.certSeen = undefined;
    this.certStopped = false;
    this.flood = { second: -1, count: 0, dropped: false, lastDrop: undefined };
    this.certProbed = false;
    this.resetSession();
    if (this.config.problem) {
      await this.statusNow();
      return;
    }
    if (this.memoryState !== 'ok' && this.stops.size === 0) {
      // A shutoff clicked meanwhile connects anyway (src/app.js clickClose).
      await this.statusNow();
      return;
    }
    const refused = this.memory.refused;
    if (refused) {
      if (credentialMark(this.config, refused.salt) === refused.mark) {
        // Refused before (or 1 chance in 256, other credentials): the button lifts it.
        this.refusedNow = 'refused before';
        await this.statusNow();
        return;
      }
      // Other credentials: the stop on the refused ones is lifted.
      this.memory.refused = undefined;
      await this.saveMemory();
      if (generation !== this.generation || this.closed) {
        // Started again meanwhile (another configuration): that start connects.
        return;
      }
    }
    await this.connectNow();
  }

  // --- MQTT --------------------------------------------------------------------

  async connectNow() {
    const generation = this.generation;
    this.publisher.start();
    /**
     * A CONNECT left without CONNACK (so far): armed only once the transport
     * opened (src/mqtt.js: TCP connected, or TLS verified), since only then
     * may the credentials have left; cleared by a CONNACK and every attempt.
     */
    const UNANSWERED = 'the broker closed the connection without answering';
    let pending;
    let opened = false;
    const hooks = {
      onAttempt: () => {
        pending = undefined;
        opened = false;
      },
      onOpen: () => {
        opened = true;
        pending = UNANSWERED;
      },
      onCertificate: (seen) => {
        this.certSeen = seen;
      },
    };
    let client;
    try {
      client = this.connect(this.config, { protocolVersion: this.protocolVersion, ...hooks });
    } catch (err) {
      this.lastError = errorReason(err);
      await this.statusNow();
      return;
    }
    if (generation !== this.generation) {
      client.end?.(true);
      return;
    }
    this.client = client;
    const current = () => generation === this.generation && this.client === client && !this.closed;
    client.on('packetreceive', (packet) => {
      if (packet?.cmd === 'connack') {
        pending = undefined;
      }
    });
    client.on('connect', () => {
      if (current()) {
        this.unanswered = 0;
        this.lastError = undefined;
        this.onConnect(client, current).catch((err) =>
          this.logger.error(`After connection: ${err.message}`),
        );
      }
    });
    client.on('message', (topic, payload, packet) => {
      if (current()) {
        this.onMessage(topic, payload, packet);
      }
    });
    client.on('error', (err) => {
      if (!current()) {
        return;
      }
      let reason = errorReason(err);
      if (err?.message === 'connack timeout' && !opened) {
        reason = 'no answer from the broker at the network level';
      }
      this.lastError = reason;
      if (err?.code === 'CERT_MISMATCH') {
        pending = undefined;
        this.onCertificateMismatch().catch(() => {});
        return;
      }
      if (isRefusal(err)) {
        pending = undefined;
        this.onRefused(reason).catch((e) => this.logger.error(`After a refusal: ${e.message}`));
        return;
      }
      if (isProtocolRefusal(err) && this.protocolVersion === 5) {
        pending = undefined;
        this.onProtocolRefused().catch((e) => this.logger.error(`MQTT 3.1.1: ${e.message}`));
        return;
      }
      if (this.config.tls && !this.config.fingerprint && isCertificateRefusal(err)) {
        this.probeCertificate(generation).catch(() => {});
      }
      if (err?.message === 'connack timeout' && pending) {
        pending = 'no answer from the broker to the connection';
      }
      this.statusNow().catch(() => {});
    });
    client.on('close', () => {
      if (!current()) {
        return;
      }
      const wasConnected = this.mqttConnected;
      this.mqttConnected = false;
      this.resetSession();
      if (pending) {
        const reason = pending;
        pending = undefined;
        this.onUnanswered(reason).catch((e) => this.logger.error(`Unanswered: ${e.message}`));
        return;
      }
      if (wasConnected) {
        this.logger.warn(
          `Connection to the broker lost${this.lastError ? `: ${this.lastError}` : ''}`,
        );
      }
      this.statusNow().catch(() => {});
    });
    await this.statusNow();
  }

  async onConnect(client, current) {
    this.resetSession();
    const granted = await new Promise((resolve) => {
      client.subscribe(SUBSCRIPTIONS, { qos: 0 }, (err, list) => resolve(err ? undefined : list));
    });
    if (!current()) {
      return;
    }
    if (!granted || granted.some((g) => !(g?.qos >= 0 && g.qos <= 2))) {
      // Not tried again by itself (an ACL does not change alone): the button or a new configuration.
      this.logger.warn('The broker refused the subscription to drop_connect/#');
      this.endClient();
      this.refusedNow = 'subscription to drop_connect/# refused (ACL?)';
      await this.statusNow();
      return;
    }
    this.mqttConnected = true;
    this.logger.info(`Connected to ${this.config.brokerUrl}`);
    // The shutoffs kept leave first, without waiting for any message of the hub.
    this.fireAllStops();
    if (this.memory.refused) {
      // Accepted: nothing is kept of credentials that work.
      this.memory.refused = undefined;
      await this.saveMemory();
      if (!current()) return;
    }
    await this.statusNow();
  }

  /** Twice in a row with credentials: counted like refused credentials. */
  async onUnanswered(reason) {
    this.lastError = reason;
    this.unanswered += 1;
    if ((this.config.username || this.config.password) && this.unanswered >= 2) {
      this.unanswered = 0;
      await this.onRefused(`${reason}, twice`);
      return;
    }
    await this.statusNow();
  }

  async onProtocolRefused() {
    this.logger.warn('The MQTT broker does not support MQTT 5: using MQTT 3.1.1');
    this.endClient();
    this.protocolVersion = 4;
    await this.connectNow();
  }

  /** Refused: stopped, kept in /data (8 bits), never tried again by itself. */
  async onRefused(reason) {
    const generation = this.generation;
    this.logger.warn(`The MQTT broker refused the connection: ${reason}`);
    this.endClient();
    this.refusedNow = reason;
    const salt = newSalt();
    this.memory.refused = { salt, mark: credentialMark(this.config, salt) };
    await this.saveMemory();
    if (generation === this.generation) {
      await this.statusNow();
    }
  }

  /** A certificate refused without a pinned one: its fingerprint read once, to be shown. */
  async probeCertificate(generation) {
    if (this.certProbed) return;
    this.certProbed = true;
    const seen = await this.probe(this.config);
    if (generation !== this.generation || this.closed || !seen) return;
    this.certSeen = seen;
    await this.statusNow();
  }

  async onCertificateMismatch() {
    this.logger.warn(
      `The certificate of ${this.config.brokerUrl} is not the pinned one (seen ${this.certSeen ?? 'none'})`,
    );
    this.endClient();
    this.certStopped = true;
    await this.statusNow();
  }

  endClient() {
    const client = this.client;
    this.client = null;
    this.mqttConnected = false;
    if (client) {
      client.removeAllListeners?.();
      client.on?.('error', () => {});
      client.end?.(true);
    }
  }

  /** Every value back to unknown (a new connection, or none). */
  resetSession() {
    for (const entry of this.registry.values()) {
      entry.values.clear();
      entry.heard = false;
    }
  }

  // --- Messages ----------------------------------------------------------------

  onMessage(topic, payload, packet) {
    const mono = this.monotonic();
    const second = Math.floor(mono / SECOND);
    if (second !== this.flood.second) {
      this.flood.second = second;
      this.flood.count = 0;
    }
    this.flood.count += 1;
    if (this.flood.count > LIMITS.messagesPerSecond) {
      if (this.flood.lastDrop !== second) {
        // A dropped message may have been a leak: every value is unknown until the next one.
        for (const entry of this.registry.values()) entry.values.clear();
      }
      this.flood.lastDrop = second;
      if (!this.flood.dropped) {
        this.flood.dropped = true;
        this.logger.warn('Too many MQTT messages: some dropped');
        this.statusSoon();
      }
      return;
    }
    const t = parseTopic(topic);
    if (!t) {
      return;
    }
    if (t.kind === 'discovery') {
      this.onDiscovery(t, payload);
    } else {
      this.onData(t, payload, packet?.retain === true, mono);
    }
  }

  entryOf(t) {
    const pid = platformId(t.hub, t.device);
    let entry = this.registry.get(pid);
    if (entry) {
      return entry;
    }
    const hubs = new Set([...this.registry.values()].map((e) => e.hub));
    if (this.registry.size >= LIMITS.devices || (!hubs.has(t.hub) && hubs.size >= LIMITS.hubs)) {
      if (!this.ignored.has(pid) && this.ignored.size < 1000) {
        this.ignored.add(pid);
        this.statusSoon();
      }
      return undefined;
    }
    entry = {
      hub: t.hub,
      device: t.device,
      pid,
      discovered: undefined,
      values: new Map(),
      heard: false,
    };
    this.registry.set(pid, entry);
    return entry;
  }

  onDiscovery(t, payload) {
    const d = parseDiscovery(payload, t.device);
    if (!d) {
      return;
    }
    const pid = platformId(t.hub, t.device);
    if (!d.type) {
      if (!this.ignored.has(pid) && this.ignored.size < 1000) {
        this.ignored.add(pid);
        this.logger.info(`DROP device ${pid} of unknown type "${d.unknown}" ignored`);
        this.statusSoon();
      }
      return;
    }
    const entry = this.entryOf(t);
    if (!entry) {
      return;
    }
    const before = entry.discovered;
    entry.discovered = { type: d.type, name: d.name, description: d.description };
    if (
      !before ||
      before.type !== d.type ||
      before.name !== d.name ||
      before.description !== d.description
    ) {
      this.later('discovery', TIMINGS.discoveryDebounce, () => this.publishDiscovery());
    }
  }

  onData(t, payload, retained, mono) {
    const values = parseData(payload);
    if (!values) {
      return;
    }
    const entry = this.entryOf(t);
    if (!entry) {
      return;
    }
    const first = !entry.heard;
    entry.heard = true;
    for (const [key, value] of values) {
      if (value === undefined) {
        entry.values.delete(key);
      } else {
        entry.values.set(key, { value, at: mono, live: !retained });
      }
    }
    const stop = this.stops.get(entry.pid);
    if (stop && values.has('water')) {
      const water = values.get('water');
      if (water === 0 && stop.sends > 0) {
        // Seen closed after the shutoff left (a retained message too: the hub's
        // last word). Before it left, nothing lets it go: it leaves first.
        this.liftStop(stop, 'confirmed');
      } else if (water === 1 && !retained && stop.closedSeen) {
        // Known closed when it left: this is a turn-on made elsewhere (the DROP app), never fought.
        this.liftStop(stop, 'let go: the water was turned on elsewhere after it');
      } else if (
        water === 1 &&
        !retained &&
        stop.sends > 0 &&
        !stop.held &&
        mono - stop.lastSent >= TIMINGS.stopApplyDelay
      ) {
        // Contradicted: the water is still on after the shutoff left.
        this.retryStop(stop);
      }
    }
    if (!retained) {
      for (const waiter of [...this.waiters]) {
        if (
          waiter.pid === entry.pid &&
          values.has(waiter.key) &&
          values.get(waiter.key) === waiter.expected
        ) {
          this.waiters.delete(waiter);
          waiter.resolve(true);
        }
      }
    }
    this.publishStates(entry, new Set(values.keys()));
    if (first) {
      this.statusSoon();
    }
  }

  /**
   * The DROP type of an entry: what the hub announced (kept across
   * reconnections, replaced by a newer announcement), else the type of the
   * device created in Gladys.
   */
  typeOf(entry) {
    return entry.discovered?.type ?? typeOfCreated(this.createdDevice(entry));
  }

  createdDevice(entry) {
    const id = deviceIds(this.gladys, entry.hub, entry.device).device;
    return (this.gladys.devices ?? []).find((d) => d?.external_id === id);
  }

  /** The values of `keys` of an entry, to Gladys (only for a device created there). */
  publishStates(entry, keys, maxAge = Infinity) {
    const type = this.typeOf(entry);
    if (!type || !this.createdDevice(entry)) {
      return;
    }
    const mono = this.monotonic();
    const values = new Map();
    for (const [key, { value, at }] of entry.values) {
      if (mono - at <= maxAge) {
        values.set(key, value);
      }
    }
    const d = { hub: entry.hub, device: entry.device, type };
    for (const { device_feature_external_id: id, ...state } of statesOf(
      this.gladys,
      d,
      values,
      keys,
    )) {
      this.publisher.push(id, state);
    }
  }

  // --- Gladys devices ----------------------------------------------------------

  async scan() {
    await this.publishDiscovery();
  }

  async publishDiscovery() {
    if (this.closed) {
      return;
    }
    const devices = [];
    for (const entry of this.registry.values()) {
      const type = this.typeOf(entry);
      if (!type) continue;
      devices.push(
        buildDevice(
          this.gladys,
          {
            hub: entry.hub,
            device: entry.device,
            type,
            name: entry.discovered?.name,
            description: entry.discovered?.description,
          },
          this.config.language,
        ),
      );
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** A device created (or updated): its values heard in the last 2 minutes, never older. */
  deviceCreated(device) {
    const parsed = parseExternalId(device?.external_id);
    const entry = parsed && this.registry.get(platformId(parsed.hub, parsed.device));
    if (entry) {
      this.publishStates(entry, new Set(entry.values.keys()), TIMINGS.freshFor);
    }
  }

  deviceDeleted(device) {
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
    // Deleting the device gives up its shutoff (a device gone from the hub never confirms).
    const parsed = parseExternalId(device?.external_id);
    const stop = parsed && this.stops.get(platformId(parsed.hub, parsed.device));
    if (stop) this.liftStop(stop, 'given up: the device was deleted in Gladys');
  }

  // --- Commands ----------------------------------------------------------------

  async setValue(device, feature, value) {
    const clickAt = this.monotonic();
    const outcome = await this.decide(device, feature, value, clickAt);
    this.setLast(outcome.text, outcome.seq);
    // Never awaited: the answer to Gladys does not wait for the status.
    this.statusNow().catch(() => {});
    if (!outcome.ok) {
      throw new Error(word(outcome.text, this.config.language));
    }
    return word(outcome.text, this.config.language);
  }

  async decide(device, feature, value, clickAt) {
    const parsed = parseExternalId(feature?.external_id);
    if (!parsed?.key) {
      return { ok: false, text: C.unknownFeature };
    }
    const pid = platformId(parsed.hub, parsed.device);
    const entry = this.registry.get(pid);
    const name =
      typeof device?.name === 'string' && device.name.trim()
        ? device.name.trim().slice(0, 60)
        : pid;
    const createdType = typeOfCreated(device);
    const sessionType = entry?.discovered?.type;
    if (sessionType && createdType && sessionType !== createdType) {
      return { ok: false, text: C.typeChanged(name) };
    }
    const type = sessionType ?? createdType;
    const command = commandOf(type, parsed.key);
    if (!command) {
      return { ok: false, text: C.unknownFeature };
    }
    let arg;
    if (command === 'close' || command === 'open') {
      if (value !== PRESSED) return { ok: false, text: C.badValue(name) };
    } else if (command === 'bypass') {
      if (!Object.hasOwn(BYPASS_VALUES, value)) return { ok: false, text: C.badValue(name) };
      arg = BYPASS_VALUES[value];
    } else if (command === 'mode') {
      if (!PROTECT_MODES.includes(value)) return { ok: false, text: C.badValue(name) };
      arg = value;
    }
    const job = { pid, hub: parsed.hub, device: parsed.device, name, command, arg, clickAt };
    if (command === 'close') {
      // The stop: no option, nothing read before it leaves.
      return this.clickClose(job);
    }
    if (!this.config[OPTION_OF[command]]) {
      return { ok: false, text: C.notAllowed(name, command) };
    }
    return this.enqueue(job);
  }

  /**
   * The shutoff clicked: kept (memory, /data without waiting), every command
   * of the hub still waiting its turn cancelled, sent now if connected, else
   * right after the next SUBACK. Answered by 3.5 s; never refused.
   */
  async clickClose(job) {
    this.stopSeq.set(job.hub, (this.stopSeq.get(job.hub) ?? 0) + 1);
    this.commandSeq += 1;
    const seq = this.commandSeq;
    let stop = this.stops.get(job.pid);
    if (!stop) {
      stop = { pid: job.pid, hub: job.hub, device: job.device, sends: 0, lastSent: -Infinity };
      this.stops.set(job.pid, stop);
    }
    if (this.givenUp) this.givenUp = this.givenUp.filter((n) => n !== job.name);
    Object.assign(stop, {
      name: job.name,
      at: this.now(),
      budget: TIMINGS.stopResends,
      held: false,
      closedSeen: false,
      firstSent: undefined,
      seq,
    });
    // Never awaited: a slow or failing /data never holds the shutoff back.
    this.saveMemory().catch(() => {});
    if (!this.mqttConnected || !this.client) {
      this.wakeForStop();
      return { ok: true, text: C.closeKept(job.name), seq };
    }
    const waiter = this.watch(job.pid, 'water', 0);
    const written = await this.fireStop(stop);
    if (written === 'error' || written === 'offline') {
      waiter.cancel();
      return { ok: true, text: C.closeKept(job.name), seq };
    }
    const confirmed = await waiter.until(job.clickAt + TIMINGS.commandAnswerBy);
    waiter.cancel();
    if (confirmed) {
      return { ok: true, text: C.confirmed(job.name), seq };
    }
    return { ok: true, text: C.closeSentKept(job.name), seq };
  }

  /** A shutoff clicked while not connected because /data could not be read: connect anyway. */
  wakeForStop() {
    if (
      this.started &&
      !this.closed &&
      !this.client &&
      !this.config.problem &&
      !this.refusedNow &&
      !this.certStopped
    ) {
      this.start(this.rawConfig).catch((err) => this.logger.error(`Start failed: ${err.message}`));
    }
  }

  /** The shutoffs read from /data, added to those clicked since the start. */
  restoreStops() {
    for (const s of this.memory.stops ?? []) {
      const pid = platformId(s.hub, s.device);
      if (this.stops.has(pid)) continue;
      this.stops.set(pid, {
        pid,
        hub: s.hub,
        device: s.device,
        name: s.name || pid,
        at: s.at,
        budget: TIMINGS.stopResends,
        sends: 0,
        lastSent: -Infinity,
        held: false,
        seq: undefined,
      });
      this.logger.info(`Shutoff of ${s.name || pid} kept from before the restart: sent again`);
    }
    if (this.mqttConnected) {
      this.fireAllStops();
    }
  }

  /** At each connection: every shutoff kept leaves again, with a new budget. */
  fireAllStops() {
    for (const stop of this.stops.values()) {
      stop.budget = TIMINGS.stopResends;
      stop.held = false;
      this.fireStop(stop).catch(() => {});
    }
  }

  /** Sends one shutoff (QoS 0) and arms its check; 'ok' | 'error' | 'timeout' | 'offline'. */
  fireStop(stop) {
    const client = this.client;
    if (!this.mqttConnected || !client) {
      return Promise.resolve('offline');
    }
    // Known closed (by a live message, never a retained one) when it leaves:
    // a later live "water on" is a turn-on made elsewhere.
    const known = this.registry.get(stop.pid)?.values.get('water');
    if (known?.value === 0 && known.live) stop.closedSeen = true;
    stop.sends += 1;
    stop.lastSent = this.monotonic();
    // The 24 h of the give-up count from the first send in this process (monotonic).
    if (stop.firstSent === undefined) stop.firstSent = stop.lastSent;
    this.armStopCheck(stop);
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => resolve('timeout'), TIMINGS.publishWait);
      try {
        client.publish(
          commandTopic(stop.hub, stop.device),
          COMMANDS.water(false),
          { qos: 0, retain: false },
          (err) => {
            this.timers.clearTimeout(timer);
            resolve(err ? 'error' : 'ok');
          },
        );
      } catch {
        this.timers.clearTimeout(timer);
        resolve('error');
      }
    }).then((written) => {
      if (written !== 'error') {
        this.logger.info(`${stop.name}: shutoff sent (${stop.sends})`);
      }
      return written;
    });
  }

  armStopCheck(stop) {
    this.later(`stop:${stop.pid}`, stop.held ? TIMINGS.stopHeldEvery : TIMINGS.stopCheck, () =>
      this.retryStop(stop),
    );
  }

  /** Not seen applied (or contradicted): sent again within its budget, then held. */
  retryStop(stop) {
    if (this.stops.get(stop.pid) !== stop || !this.mqttConnected || this.closed) {
      return;
    }
    if (stop.firstSent !== undefined && this.monotonic() - stop.firstSent > TIMINGS.stopExpiry) {
      // Sent at least once, never seen applied in 24 h: given up, said in the status.
      this.givenUp = [stop.name, ...(this.givenUp ?? []).filter((n) => n !== stop.name)].slice(
        0,
        3,
      );
      this.liftStop(stop, 'given up: not seen applied in 24 h');
      this.statusNow().catch(() => {});
      return;
    }
    if (stop.held) {
      this.fireStop(stop).catch(() => {});
    } else if (stop.budget > 0) {
      stop.budget -= 1;
      this.fireStop(stop).catch(() => {});
    } else {
      stop.held = true;
      this.logger.warn(`${stop.name}: shutoff not seen applied, held (sent again every 10 min)`);
      this.armStopCheck(stop);
      this.statusSoon();
    }
  }

  /** The shutoff seen applied, or let go by a turn-on that left after it. */
  liftStop(stop, why) {
    if (this.stops.get(stop.pid) !== stop) return;
    this.stops.delete(stop.pid);
    this.timers.clearTimeout(this.timersById[`stop:${stop.pid}`]);
    this.timersById[`stop:${stop.pid}`] = undefined;
    this.logger.info(`${stop.name}: shutoff ${why}`);
    this.saveMemory().catch(() => {});
    if (why === 'confirmed' && stop.seq !== undefined && this.lastCommand?.seq === stop.seq) {
      this.setLast(C.confirmed(stop.name), stop.seq);
    }
    this.statusSoon();
  }

  /** The other commands: one at a time per device, answered by 3.5 s after the click. */
  enqueue(job) {
    job.seq = this.stopSeq.get(job.hub) ?? 0;
    const previous = this.lanes.get(job.pid) ?? Promise.resolve();
    const run = previous.then(() => this.runQueued(job));
    const tail = run.catch(() => {});
    this.lanes.set(job.pid, tail);
    tail.then(() => {
      if (this.lanes.get(job.pid) === tail) this.lanes.delete(job.pid);
    });
    let timer;
    const answerBy = new Promise((resolve) => {
      // Only for a command still waiting its turn: one that left answers by itself.
      timer = this.timers.setTimeout(
        () => job.sent || resolve({ ok: false, text: C.late(job.name) }),
        Math.max(0, job.clickAt + TIMINGS.commandAnswerBy - this.monotonic()),
      );
    });
    return Promise.race([run, answerBy]).finally(() => this.timers.clearTimeout(timer));
  }

  async runQueued(job) {
    const mono = this.monotonic();
    if (mono - job.clickAt > TIMINGS.commandSendBy) {
      return { ok: false, text: C.late(job.name) };
    }
    const entry = this.registry.get(job.pid);
    if (job.command === 'open') {
      const refusal = this.openRefusal(job, entry, mono);
      if (refusal) return refusal;
      return this.send(job, 'water', 1, COMMANDS.water(true));
    }
    if (job.command === 'bypass') {
      if (entry?.values.get('bypass')?.value === job.arg) {
        return { ok: true, text: C.already(job.name) };
      }
      return this.send(job, 'bypass', job.arg, COMMANDS.bypass(job.arg === 1));
    }
    if (entry?.values.get('pMode')?.value === job.arg) {
      return { ok: true, text: C.already(job.name) };
    }
    return this.send(job, 'pMode', job.arg, COMMANDS.mode(job.arg));
  }

  /** Why the water must not be turned on now, on what the hub said in this connection. */
  openRefusal(job, entry, mono) {
    for (const stop of this.stops.values()) {
      if (stop.hub === job.hub && mono - stop.lastSent < TIMINGS.stopWindow) {
        return { ok: false, text: C.closing(job.name) };
      }
    }
    const second = Math.floor(mono / SECOND);
    if (this.flood.lastDrop !== undefined && second - this.flood.lastDrop <= 1) {
      return { ok: false, text: C.flooded(job.name) };
    }
    const water = entry?.heard ? entry.values.get('water')?.value : undefined;
    if (water === undefined) {
      return { ok: false, text: C.notHeard(job.name) };
    }
    const leak = entry.values.get('leak')?.value;
    if (leak === undefined) {
      return { ok: false, text: C.leakUnknown(job.name) };
    }
    const leaking = [];
    const unknown = [];
    const seen = new Set();
    for (const other of this.registry.values()) {
      if (other.hub !== job.hub) continue;
      seen.add(other.pid);
      const type = this.typeOf(other);
      const name =
        other === entry
          ? job.name
          : (this.createdDevice(other)?.name ??
            deviceName(
              { ...other, ...other.discovered, type: type ?? TYPES.LEAK },
              this.config.language,
            ));
      // A leak or an alert heard from any device of the hub refuses, whatever its type.
      if (
        other.heard &&
        (other.values.get('leak')?.value === 1 || other.values.get('sens')?.value === 1)
      ) {
        leaking.push(name);
        continue;
      }
      const key = LEAK_KEY[type];
      if (key && (!other.heard || other.values.get(key)?.value === undefined)) {
        unknown.push(name);
      }
    }
    // Created in Gladys and never heard in this connection: unknown too.
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseExternalId(device?.external_id);
      if (!parsed || parsed.key || parsed.hub !== job.hub) continue;
      const pid = platformId(parsed.hub, parsed.device);
      if (seen.has(pid) || !LEAK_KEY[typeOfCreated(device)]) continue;
      unknown.push(typeof device.name === 'string' ? device.name.slice(0, 60) : pid);
    }
    if (leaking.length > 0) {
      return { ok: false, text: C.leak(job.name, leaking.slice(0, 3).join(', ')) };
    }
    if (unknown.length > 0) {
      return { ok: false, text: C.leakUnknownOthers(job.name, unknown.slice(0, 3).join(', ')) };
    }
    if (water === 1) {
      return { ok: true, text: C.already(job.name) };
    }
    return undefined;
  }

  /**
   * Publishes one command, after the last checks (synchronous with the
   * publication: nothing can change between them), and waits for the device
   * to show `expected` until 3.5 s after the click; watched 20 s after.
   */
  async send(job, key, expected, payload) {
    const client = this.client;
    if (!this.mqttConnected || !client) {
      return { ok: false, text: C.offline(job.name) };
    }
    if (!this.config[OPTION_OF[job.command]]) {
      return { ok: false, text: C.notAllowed(job.name, job.command) };
    }
    if ((this.stopSeq.get(job.hub) ?? 0) !== job.seq) {
      return { ok: false, text: C.cancelled(job.name) };
    }
    this.commandSeq += 1;
    const seq = this.commandSeq;
    const waiter = this.watch(job.pid, key, expected);
    // From here it may have left: never answered "Nothing sent" but on a write error.
    job.sent = true;
    const written = await new Promise((resolve) => {
      const timer = this.timers.setTimeout(() => resolve('timeout'), TIMINGS.publishWait);
      try {
        client.publish(
          commandTopic(job.hub, job.device),
          payload,
          { qos: 0, retain: false },
          (err) => {
            this.timers.clearTimeout(timer);
            resolve(err ? 'error' : 'ok');
          },
        );
      } catch {
        this.timers.clearTimeout(timer);
        resolve('error');
      }
    });
    if (written === 'error') {
      waiter.cancel();
      return { ok: false, text: C.notSent(job.name) };
    }
    this.logger.info(`${job.name}: ${job.command} sent`);
    if (job.command === 'open') {
      // A turn-on that left lets go every shutoff of the hub kept before it.
      for (const stop of [...this.stops.values()]) {
        if (stop.hub === job.hub && written === 'ok') {
          this.liftStop(stop, 'let go by a turn-on sent after it');
        }
      }
    }
    const sentAt = this.monotonic();
    const confirmed = await waiter.until(job.clickAt + TIMINGS.commandAnswerBy);
    if (confirmed) {
      waiter.cancel();
      return { ok: true, text: C.confirmed(job.name), seq };
    }
    // Still watched: the status says what the device shows within 20 s.
    waiter.until(sentAt + TIMINGS.confirmWatch).then((late) => {
      waiter.cancel();
      if (this.lastCommand?.seq === seq && !this.closed) {
        this.setLast(late ? C.confirmed(job.name) : C.noEffect(job.name), seq);
        this.statusNow().catch(() => {});
      }
    });
    return { ok: true, text: C.unconfirmed(job.name), seq };
  }

  /** A live message of `pid` showing `key` = `expected`, awaited until a monotonic time. */
  watch(pid, key, expected) {
    let resolveHit;
    const hit = new Promise((resolve) => {
      resolveHit = resolve;
    });
    const waiter = { pid, key, expected, resolve: resolveHit };
    this.waiters.add(waiter);
    return {
      until: (deadline) => {
        let timer;
        return Promise.race([
          hit,
          new Promise((resolve) => {
            timer = this.timers.setTimeout(
              () => resolve(false),
              Math.max(0, deadline - this.monotonic()),
            );
          }),
        ]).finally(() => this.timers.clearTimeout(timer));
      },
      cancel: () => {
        this.waiters.delete(waiter);
        resolveHit(false);
      },
    };
  }

  setLast(text, seq) {
    this.lastCommand = { text, seq };
  }

  // --- Status ------------------------------------------------------------------

  statusOf() {
    const url = this.config.brokerUrl ?? '';
    let connected = false;
    let message;
    if (!this.started) {
      message = T.noConfig;
    } else if (this.config.problem) {
      message = T.problem(this.config.problem);
    } else if (this.memoryState !== 'ok') {
      message = T.storeUnreadable;
    } else if (this.refusedNow) {
      message = T.refused(url, this.refusedNow);
    } else if (this.certStopped) {
      message = T.certificate(url, this.certSeen);
    } else if (!this.mqttConnected) {
      message = this.lastError ? T.unreachable(url, this.lastError) : T.connecting(url);
    } else {
      const heard = [...this.registry.values()].filter((e) => e.heard).length;
      connected = heard > 0;
      message = heard > 0 ? T.live(url, heard) : T.waiting(url);
      if (this.protocolVersion === 4) message = join(message, T.mqtt311);
    }
    if (this.certSeen && !this.certStopped && !this.mqttConnected && this.config.tls) {
      message = join(message, T.certSeen(this.certSeen));
    }
    if (this.givenUp?.length > 0) {
      message = join(message, T.stopsGivenUp(this.givenUp.join(', ')));
    }
    if (this.stops.size > 0) {
      const held = [...this.stops.values()].filter((stop) => stop.held).length;
      message = join(message, T.stopsKept(this.stops.size, held));
    }
    if (this.ignored.size > 0) message = join(message, T.ignored(this.ignored.size));
    if (this.flood.dropped) message = join(message, T.flood);
    if (this.lastCommand) message = join(message, T.lastCommand(this.lastCommand.text));
    return { connected, message };
  }

  async statusNow() {
    if (this.closed) return;
    const { connected, message } = this.statusOf();
    await this.sendStatus(connected, message);
  }

  async sendStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.statusKey) {
      return;
    }
    this.statusKey = key;
    this.statusAt = this.monotonic();
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      this.statusKey = undefined;
      this.logger.warn(`setConnectionStatus failed: ${err.message}`);
    }
  }

  /** A counter changed: the status within 5 s, never more often. */
  statusSoon() {
    if (this.timersById.status) {
      return;
    }
    const wait = Math.max(0, this.statusAt + TIMINGS.statusEvery - this.monotonic());
    this.later('status', wait, () => this.statusNow());
  }

  // --- The configuration screen button -----------------------------------------

  async testConnection() {
    const mono = this.monotonic();
    if (mono - this.lastTestAt < TIMINGS.testEvery) {
      return word(TEST.tooSoon, this.config.language);
    }
    this.lastTestAt = mono;
    if (!this.started) {
      return word(TEST.noConfig, this.config.language);
    }
    if (this.config.problem) {
      return word(TEST.problem(this.config.problem), this.config.language);
    }
    if (this.memoryState !== 'ok') {
      // The user asks for it: /data unreadable is no longer a reason to wait.
      this.memoryState = 'ok';
      this.memory = { refused: undefined, stops: [] };
      this.timers.clearTimeout(this.storeTimer);
      await this.saveMemory();
    }
    if (this.memory.refused) {
      this.memory.refused = undefined;
      await this.saveMemory();
    }
    await this.start(this.rawConfig);
    return word(TEST.started(this.config.brokerUrl), this.config.language);
  }

  // --- Shutdown ----------------------------------------------------------------

  async shutdown() {
    // The shutoffs kept are on /data before leaving (bounded wait, never blocking).
    if (!this.closed && this.stops.size > 0) {
      await this.saveMemory();
    }
    this.closed = true;
    this.generation += 1;
    this.clearTimers();
    this.timers.clearTimeout(this.storeTimer);
    this.timers.clearTimeout(this.configTimer);
    this.publisher.stop();
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter.resolve(false);
    }
    this.endClient();
  }
}
