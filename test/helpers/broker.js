// -----------------------------------------------------------------------------
// A small MQTT broker on a real local socket (TCP, or TLS with a test
// certificate), built on mqtt-packet: it records what each client sent (the
// CONNECT with its credentials, the subscriptions, the publications) and
// plays what the test asks (accept, refuse, MQTT 3.1.1 only, a message too
// large, a message of the hub).
// -----------------------------------------------------------------------------

import net from 'node:net';
import tls from 'node:tls';
import mqttPacket from 'mqtt-packet';

export async function fakeBroker({ tlsOptions, connack = () => ({ returnCode: 0 }) } = {}) {
  const broker = {
    connects: [],
    published: [],
    subscribed: [],
    sockets: new Set(),
    /** Bytes received on each connection (before any parsing). */
    received: [],
    connack,
    send(topic, payload, { retain = false } = {}) {
      for (const socket of broker.sockets) {
        if (!socket.mqttReady) continue;
        socket.write(
          mqttPacket.generate(
            {
              cmd: 'publish',
              topic,
              payload: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
              qos: 0,
              retain,
            },
            { protocolVersion: socket.protocolVersion },
          ),
        );
      }
    },
    /** Raw bytes to every client. */
    raw(bytes) {
      for (const socket of broker.sockets) socket.write(bytes);
    },
    async close() {
      for (const socket of broker.sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  const onSocket = (socket) => {
    broker.sockets.add(socket);
    const bytes = { count: 0 };
    broker.received.push(bytes);
    socket.protocolVersion = 4;
    let parser = mqttPacket.parser({ protocolVersion: 5 });
    socket.on('data', (chunk) => {
      bytes.count += chunk.length;
      parser.parse(chunk);
    });
    socket.on('error', () => {});
    socket.on('close', () => broker.sockets.delete(socket));
    const handle = (packet) => {
      if (packet.cmd === 'connect') {
        socket.protocolVersion = packet.protocolVersion;
        broker.connects.push({
          protocolVersion: packet.protocolVersion,
          username: packet.username,
          password: packet.password?.toString(),
          clientId: packet.clientId,
          properties: packet.properties,
        });
        const answer = broker.connack(packet);
        if (answer === 'silent') return;
        if (answer.v311Refusal) {
          // A 3.1.1 broker answering an MQTT 5 CONNECT: return code 1, then it closes.
          socket.end(
            mqttPacket.generate({ cmd: 'connack', returnCode: 1 }, { protocolVersion: 4 }),
          );
          return;
        }
        const ok = (answer.returnCode ?? answer.reasonCode ?? 0) === 0;
        const reply =
          packet.protocolVersion === 5
            ? { cmd: 'connack', reasonCode: answer.reasonCode ?? answer.returnCode ?? 0 }
            : { cmd: 'connack', returnCode: answer.returnCode ?? 0 };
        socket.write(mqttPacket.generate(reply, { protocolVersion: packet.protocolVersion }));
        if (!ok) {
          socket.end();
          return;
        }
        socket.mqttReady = true;
        parser = mqttPacket.parser({ protocolVersion: packet.protocolVersion });
        parser.on('packet', handle);
        parser.on('error', () => socket.destroy());
      } else if (packet.cmd === 'subscribe') {
        broker.subscribed.push(...packet.subscriptions.map((s) => s.topic));
        socket.write(
          mqttPacket.generate(
            {
              cmd: 'suback',
              messageId: packet.messageId,
              granted: packet.subscriptions.map(() => 0),
            },
            { protocolVersion: socket.protocolVersion },
          ),
        );
      } else if (packet.cmd === 'publish') {
        broker.published.push({
          topic: packet.topic,
          payload: packet.payload.toString(),
          qos: packet.qos,
          retain: packet.retain,
        });
      } else if (packet.cmd === 'pingreq') {
        socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
      } else if (packet.cmd === 'disconnect') {
        socket.end();
      }
    };
    parser.on('packet', handle);
    parser.on('error', () => socket.destroy());
  };
  const server = tlsOptions ? tls.createServer(tlsOptions, onSocket) : net.createServer(onSocket);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  broker.port = server.address().port;
  return broker;
}

/** A PUBLISH packet header announcing `size` bytes, followed by `sent` bytes of it. */
export function hugePublishHeader(size, sent = 64) {
  const header = [0x30];
  let n = size;
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    header.push(byte);
  } while (n > 0);
  return Buffer.concat([Buffer.from(header), Buffer.alloc(sent, 0x41)]);
}
