// A fake mqtt.js client: what the app subscribed to and published, and the
// broker side (connect, deliver a message, refuse, fail). `responder` plays
// the DROP hub: it is called on every publish and may deliver data back.
// Taken from gladys-qbus (test/helpers/fakeMqtt.js).

import { EventEmitter } from 'node:events';

export class FakeMqttClient extends EventEmitter {
  constructor(config, options, responder) {
    super();
    this.config = config;
    this.options = options;
    this.responder = responder;
    this.connected = false;
    this.subscriptions = [];
    this.published = [];
    this.ended = false;
    /** 'error' | 'hang' | undefined: how the next publications end. */
    this.publishMode = undefined;
    /** What the SUBACK grants (a qos 128 refuses). */
    this.granted = undefined;
  }

  subscribe(topics, options, callback) {
    this.subscriptions.push(...[].concat(topics));
    // Messages arriving in the same block as the SUBACK (retained unless said
    // otherwise): handled before its callback.
    for (const [topic, payload, retain = true] of this.withSuback ?? []) {
      this.deliver(topic, payload, { retain });
    }
    const granted = this.granted ?? [].concat(topics).map((topic) => ({ topic, qos: 0 }));
    if (this.dropOnSubscribe === 'before-suback') {
      // The connection drops before the SUBACK: mqtt.js fails the pending
      // SUBSCRIBE ("Connection closed"), then emits close.
      this.dropOnSubscribe = undefined;
      this.connected = false;
      callback?.(new Error('Connection closed'));
      this.emit('close');
      return;
    }
    callback?.(null, granted);
    if (this.dropOnSubscribe === 'after-suback') {
      // The SUBACK, then the connection cut in the same tick (before the app resumes).
      this.dropOnSubscribe = undefined;
      this.close();
    }
  }

  publish(topic, payload, options, callback) {
    if (!this.connected) {
      callback?.(new Error('client disconnecting'));
      return;
    }
    if (this.publishMode === 'error') {
      callback?.(new Error('write EPIPE'));
      return;
    }
    this.published.push({ topic, payload: String(payload), ...options });
    if (this.publishMode !== 'hang') {
      callback?.();
    }
    this.responder?.(topic, String(payload), this);
  }

  end() {
    this.ended = true;
    this.connected = false;
  }

  // --- The broker side ---
  open() {
    this.connected = true;
    this.emit('connect');
  }

  close() {
    this.connected = false;
    this.emit('close');
  }

  refuse(code = 5) {
    const err = new Error('Connection refused: Not authorized');
    err.code = code;
    this.emit('error', err);
    this.emit('close');
  }

  deliver(topic, payload, packet = { retain: false }) {
    this.emit(
      'message',
      topic,
      Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
      packet,
    );
  }

  /** The commands published, parsed. */
  commands() {
    return this.published.map((p) => ({ topic: p.topic, body: JSON.parse(p.payload) }));
  }
}

/** A connect function for the app, keeping every client it creates. */
export function fakeConnector(responder) {
  const clients = [];
  const connector = {
    clients,
    responder,
    options: [],
    connect: (config, options) => {
      connector.options.push(options);
      const client = new FakeMqttClient(config, options, (...args) =>
        connector.responder?.(...args),
      );
      clients.push(client);
      return client;
    },
    get last() {
      return clients.at(-1);
    },
  };
  return connector;
}
